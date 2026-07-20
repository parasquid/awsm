import { describe, expect, it } from "vitest";
import {
  classifyServerSwitch,
  type ServerSwitchClassificationInput,
} from "../../src/runtime/synchronization/server-switch-classifier";

const local = {
  vaultId: "01900000-0000-7000-8000-000000000001",
  generation: {
    generationId: "01900000-0000-7000-8000-000000000002",
    generationNumber: 4,
  },
};
const candidate = {
  vaultId: local.vaultId,
  generation: {
    generationId: "01900000-0000-7000-8000-000000000003",
    generationNumber: 4,
  },
};

function input(
  overrides: Partial<ServerSwitchClassificationInput> = {},
): ServerSwitchClassificationInput {
  return {
    local,
    candidate,
    rootKeysEqual: true,
    immutableIntersectionEqual: true,
    ...overrides,
  };
}

describe("server switch classification", () => {
  it("publishes local authority to an empty candidate Account", () => {
    const { candidate: _candidate, ...emptyCandidate } = input();
    expect(classifyServerSwitch(emptyCandidate)).toEqual({
      kind: "Direction",
      direction: "PublishLocal",
    });
  });

  it("rejects a candidate Account that owns another Vault", () => {
    expect(
      classifyServerSwitch(
        input({ candidate: { ...candidate, vaultId: "01900000-0000-7000-8000-000000000099" } }),
      ),
    ).toEqual({ kind: "Failure", errorId: "SERVER_SWITCH_VAULT_MISMATCH" });
  });

  it.each([
    { rootKeysEqual: false, immutableIntersectionEqual: true },
    { rootKeysEqual: true, immutableIntersectionEqual: false },
  ])("fails closed for Root Key or immutable-byte mismatch", (mismatch) => {
    expect(classifyServerSwitch(input(mismatch))).toEqual({
      kind: "Failure",
      errorId: "SYNCHRONIZATION_INTEGRITY_FAILED",
    });
  });

  it("unions replicas in the same byte-identical Generation", () => {
    expect(
      classifyServerSwitch(
        input({
          candidate: {
            ...candidate,
            generation: { ...local.generation },
          },
        }),
      ),
    ).toEqual({ kind: "Direction", direction: "Union" });
  });

  it("rejects equal Generation IDs with unequal numbers", () => {
    expect(
      classifyServerSwitch(
        input({
          candidate: {
            ...candidate,
            generation: { ...local.generation, generationNumber: 5 },
          },
        }),
      ),
    ).toEqual({ kind: "Failure", errorId: "SYNCHRONIZATION_INTEGRITY_FAILED" });
  });

  it("fast-forwards the candidate from an exact source Recovery base", () => {
    expect(
      classifyServerSwitch(
        input({
          local: {
            ...local,
            generation: {
              generationId: "01900000-0000-7000-8000-000000000004",
              generationNumber: 5,
              predecessorGenerationId: candidate.generation.generationId,
            },
          },
          sourceRecovery: { state: "Exact" },
        }),
      ),
    ).toEqual({ kind: "Direction", direction: "FastForwardCandidate" });
  });

  it("fast-forwards local authority from an exact candidate Recovery base", () => {
    expect(
      classifyServerSwitch(
        input({
          candidate: {
            ...candidate,
            generation: {
              generationId: "01900000-0000-7000-8000-000000000004",
              generationNumber: 5,
              predecessorGenerationId: local.generation.generationId,
            },
          },
          candidateRecovery: { state: "Exact" },
        }),
      ),
    ).toEqual({ kind: "Direction", direction: "FastForwardLocal" });
  });

  it.each(["source", "candidate"] as const)(
    "requires the %s direct successor to increment its Generation number exactly once",
    (successorSide) => {
      const successor = {
        generationId: "01900000-0000-7000-8000-000000000004",
        generationNumber: 7,
        predecessorGenerationId:
          successorSide === "source"
            ? candidate.generation.generationId
            : local.generation.generationId,
      };
      expect(
        classifyServerSwitch(
          input(
            successorSide === "source"
              ? { local: { ...local, generation: successor }, sourceRecovery: { state: "Exact" } }
              : {
                  candidate: { ...candidate, generation: successor },
                  candidateRecovery: { state: "Exact" },
                },
          ),
        ),
      ).toEqual({ kind: "Failure", errorId: "SYNCHRONIZATION_INTEGRITY_FAILED" });
    },
  );

  it.each(["source", "candidate"] as const)(
    "declares the %s history divergent when its recovered base differs",
    (successorSide) => {
      const successor = {
        generationId: "01900000-0000-7000-8000-000000000004",
        generationNumber: 5,
        predecessorGenerationId:
          successorSide === "source"
            ? candidate.generation.generationId
            : local.generation.generationId,
      };
      expect(
        classifyServerSwitch(
          input(
            successorSide === "source"
              ? {
                  local: { ...local, generation: successor },
                  sourceRecovery: { state: "Different" },
                }
              : {
                  candidate: { ...candidate, generation: successor },
                  candidateRecovery: { state: "Different" },
                },
          ),
        ),
      ).toEqual({
        kind: "Conflict",
        errorId: "SERVER_SWITCH_CONFLICT",
        reason: "DivergedGeneration",
      });
    },
  );

  it.each([undefined, { state: "Unavailable" } as const])(
    "declares direct ancestry unavailable without exact Recovery evidence",
    (sourceRecovery) => {
      expect(
        classifyServerSwitch(
          input({
            local: {
              ...local,
              generation: {
                generationId: "01900000-0000-7000-8000-000000000004",
                generationNumber: 5,
                predecessorGenerationId: candidate.generation.generationId,
              },
            },
            ...(sourceRecovery === undefined ? {} : { sourceRecovery }),
          }),
        ),
      ).toEqual({
        kind: "Conflict",
        errorId: "SERVER_SWITCH_CONFLICT",
        reason: "AncestryUnavailable",
      });
    },
  );

  it("treats corrupt Recovery evidence as an integrity failure", () => {
    expect(
      classifyServerSwitch(
        input({
          candidate: {
            ...candidate,
            generation: {
              generationId: "01900000-0000-7000-8000-000000000004",
              generationNumber: 5,
              predecessorGenerationId: local.generation.generationId,
            },
          },
          candidateRecovery: { state: "IntegrityFailure" },
        }),
      ),
    ).toEqual({ kind: "Failure", errorId: "SYNCHRONIZATION_INTEGRITY_FAILED" });
  });

  it("declares different successors of one predecessor divergent", () => {
    const predecessorGenerationId = "01900000-0000-7000-8000-000000000099";
    expect(
      classifyServerSwitch(
        input({
          local: {
            ...local,
            generation: { ...local.generation, predecessorGenerationId },
          },
          candidate: {
            ...candidate,
            generation: { ...candidate.generation, predecessorGenerationId },
          },
        }),
      ),
    ).toEqual({
      kind: "Conflict",
      errorId: "SERVER_SWITCH_CONFLICT",
      reason: "DivergedGeneration",
    });
  });

  it("declares unrelated retained ancestry unavailable", () => {
    expect(classifyServerSwitch(input())).toEqual({
      kind: "Conflict",
      errorId: "SERVER_SWITCH_CONFLICT",
      reason: "AncestryUnavailable",
    });
  });
});
