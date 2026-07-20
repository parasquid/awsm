import { describe, expect, it } from "vitest";
import { SynchronizationCoordinator } from "../../src/runtime/synchronization/coordinator";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("synchronization wake coordination", () => {
  it("coalesces wakes and preserves one final mutation pass", async () => {
    const firstRun = deferred();
    const calls: string[] = [];
    let executions = 0;
    const coordinator = new SynchronizationCoordinator({
      execute: async () => {
        executions += 1;
        calls.push(`execute:${String(executions)}`);
        if (executions === 1) await firstRun.promise;
      },
      preparePassivePoll: async () => {
        calls.push("passive");
      },
      prepareInteractiveWake: async () => {
        calls.push("interactive");
      },
      prepareMutation: async (vaultId) => {
        calls.push(`mutation:${vaultId}`);
      },
      prepareCableWake: async (cursor) => {
        calls.push(`cable:${String(cursor)}`);
      },
    });

    const running = coordinator.continue();
    await Promise.resolve();
    void coordinator.mutation("vault-a");
    void coordinator.mutation("vault-a");
    void coordinator.cable(3);
    void coordinator.cable(8);
    firstRun.resolve();
    await running;

    expect(calls).toEqual(["execute:1", "mutation:vault-a", "cable:8", "execute:2"]);
  });

  it("does not add a redundant pass for repeated continuation reads", async () => {
    const firstRun = deferred();
    let executions = 0;
    const coordinator = new SynchronizationCoordinator({
      execute: async () => {
        executions += 1;
        await firstRun.promise;
      },
      preparePassivePoll: () => Promise.resolve(),
      prepareInteractiveWake: () => Promise.resolve(),
      prepareMutation: () => Promise.resolve(),
      prepareCableWake: () => Promise.resolve(),
    });

    const running = coordinator.continue();
    await Promise.resolve();
    expect(coordinator.continue()).toBe(running);
    firstRun.resolve();
    await running;

    expect(executions).toBe(1);
  });

  it("keeps passive and interactive wake semantics distinct", async () => {
    const calls: string[] = [];
    const coordinator = new SynchronizationCoordinator({
      execute: async () => {
        calls.push("execute");
      },
      preparePassivePoll: async () => {
        calls.push("passive");
      },
      prepareInteractiveWake: async () => {
        calls.push("interactive");
      },
      prepareMutation: () => Promise.resolve(),
      prepareCableWake: () => Promise.resolve(),
    });

    void coordinator.passivePoll();
    await coordinator.interactiveWake();

    expect(calls).toEqual(["passive", "execute", "interactive", "execute"]);
  });

  it("holds new wakes until an exclusive operation resumes synchronization", async () => {
    const calls: string[] = [];
    const coordinator = new SynchronizationCoordinator({
      execute: async () => {
        calls.push("execute");
      },
      preparePassivePoll: () => Promise.resolve(),
      prepareInteractiveWake: () => Promise.resolve(),
      prepareMutation: async (vaultId) => {
        calls.push(`mutation:${vaultId}`);
      },
      prepareCableWake: () => Promise.resolve(),
    });

    const resume = await coordinator.suspend();
    await coordinator.mutation("vault-a");
    expect(calls).toEqual([]);
    resume();
    await coordinator.continue();

    expect(calls).toEqual(["mutation:vault-a", "execute"]);
  });

  it("stops after the active pass when suspension races with a new wake", async () => {
    const firstRun = deferred();
    const calls: string[] = [];
    const coordinator = new SynchronizationCoordinator({
      execute: async () => {
        calls.push("execute");
        if (calls.length === 1) await firstRun.promise;
      },
      preparePassivePoll: () => Promise.resolve(),
      prepareInteractiveWake: () => Promise.resolve(),
      prepareMutation: () => Promise.resolve(),
      prepareCableWake: async (cursor) => {
        calls.push(`cable:${String(cursor)}`);
      },
    });

    const running = coordinator.continue();
    await Promise.resolve();
    const suspended = coordinator.suspend();
    void coordinator.cable(4);
    firstRun.resolve();
    const resume = await suspended;
    await running;

    expect(calls).toEqual(["execute"]);
    resume();
    await coordinator.continue();

    expect(calls).toEqual(["execute", "cable:4", "execute"]);
  });

  it("aborts active work and discards old wakes before replacing context", async () => {
    const started = deferred();
    const stopped = deferred();
    const calls: string[] = [];
    const coordinator = new SynchronizationCoordinator({
      execute: async (signal) => {
        calls.push("execute");
        started.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              calls.push("aborted");
              resolve();
            },
            { once: true },
          );
        });
        stopped.resolve();
      },
      preparePassivePoll: () => Promise.resolve(),
      prepareInteractiveWake: () => Promise.resolve(),
      prepareMutation: () => Promise.resolve(),
      prepareCableWake: () => Promise.resolve(),
    });

    void coordinator.continue();
    await started.promise;
    void coordinator.mutation("old-vault");
    await coordinator.replaceContext(async () => {
      calls.push("replace");
    });
    await stopped.promise;

    expect(calls).toEqual(["execute", "aborted", "replace"]);
  });
});
