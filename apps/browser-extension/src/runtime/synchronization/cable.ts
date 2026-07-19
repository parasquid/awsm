interface CableTransport {
  request(
    method: string,
    path: string,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

interface Socket {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function protocol(message: string): Error {
  return Object.assign(new Error(message), { id: "SYNCHRONIZATION_INTEGRITY_FAILED" });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw protocol("Cable payload is invalid");
  return value as Record<string, unknown>;
}

export class CableHintSubscriber {
  private socket: Socket | undefined;

  constructor(
    private readonly origin: string,
    private readonly transport: CableTransport,
    private readonly wake: (latestCursor: number) => void,
    private readonly createSocket: (url: string) => Socket = (url) => new WebSocket(url),
  ) {}

  async connect(vaultId: string): Promise<void> {
    if (this.socket !== undefined) return;
    const payload = object((await this.transport.request("POST", "/api/cable-tickets")).body);
    if (typeof payload.ticket !== "string" || payload.ticket.length === 0)
      throw protocol("Cable ticket is invalid");
    const url = new URL(this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/cable";
    url.search = `?ticket=${encodeURIComponent(payload.ticket)}`;
    const socket = this.createSocket(url.href);
    this.socket = socket;
    const identifier = JSON.stringify({ channel: "VaultChangesChannel", vaultId });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ command: "subscribe", identifier }));
    });
    socket.addEventListener("message", (event) => {
      try {
        if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
        const frame = object(JSON.parse(event.data));
        if (frame.identifier !== identifier || frame.message === undefined) return;
        const message = object(frame.message);
        if (message.vaultId !== vaultId) throw protocol("Cable Vault identity differs");
        if (
          typeof message.latestCursor !== "number" ||
          !Number.isSafeInteger(message.latestCursor) ||
          message.latestCursor < 0
        )
          throw protocol("Cable cursor is invalid");
        this.wake(message.latestCursor);
      } catch {
        socket.close(1008, "invalid hint");
      }
    });
    const clear = () => {
      if (this.socket === socket) this.socket = undefined;
    };
    socket.addEventListener("close", clear);
    socket.addEventListener("error", clear);
  }

  disconnect(): void {
    this.socket?.close(1000, "account context changed");
    this.socket = undefined;
  }
}
