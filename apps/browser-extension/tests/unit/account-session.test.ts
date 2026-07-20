import { describe, expect, it, vi } from "vitest";
import type { IndexedDbAccountRepository } from "../../src/drivers/indexeddb/account-repository";
import { AccountSessionManager } from "../../src/runtime/account/session";

describe("Account session cleanup", () => {
  it("erases prior Server Switch credentials when remote revocation fails", async () => {
    const repository = {
      logout: vi.fn(),
      eraseAuthenticated: vi.fn(async () => undefined),
    } as unknown as IndexedDbAccountRepository;
    const http = {
      refresh: vi.fn(),
      logout: vi.fn(async () => {
        throw new TypeError("Source server is unavailable");
      }),
    };
    const session = new AccountSessionManager(http, repository, "server-switch-prior");
    session.setAccessToken("ephemeral-access-token");

    await expect(session.logout()).resolves.toBeUndefined();

    expect(http.logout).toHaveBeenCalledWith("ephemeral-access-token");
    expect(repository.eraseAuthenticated).toHaveBeenCalledWith("server-switch-prior");
    expect(repository.logout).not.toHaveBeenCalled();
  });
});
