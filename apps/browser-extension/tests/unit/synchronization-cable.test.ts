import { describe, expect, it, vi } from "vitest";
import { CableHintSubscriber } from "../../src/runtime/synchronization/cable";

class FakeSocket {
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  readonly send = vi.fn();
  readonly close = vi.fn();

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("Action Cable synchronization hints", () => {
  it("puts only a one-use Cable ticket in the URL and treats a hint as a wake-up", async () => {
    const socket = new FakeSocket();
    let url = "";
    const wake = vi.fn();
    const subscriber = new CableHintSubscriber(
      "https://sync.example.test",
      {
        request: async () => ({
          status: 201,
          body: { ticket: "ticket.secret", expiresAt: "2026-07-19T12:01:00.000Z" },
        }),
      },
      wake,
      (value) => {
        url = value;
        return socket;
      },
    );
    const vaultId = "01900000-0000-7000-8000-000000000401";

    await subscriber.connect(vaultId);
    expect(url).toBe("wss://sync.example.test/cable?ticket=ticket.secret");
    expect(url).not.toContain("access");
    socket.emit("open", new Event("open"));
    const identifier = JSON.stringify({ channel: "VaultChangesChannel", vaultId });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ command: "subscribe", identifier }));
    socket.emit(
      "message",
      new MessageEvent("message", {
        data: JSON.stringify({ identifier, message: { vaultId, latestCursor: 12 } }),
      }),
    );
    expect(wake).toHaveBeenCalledWith(12);
  });
});
