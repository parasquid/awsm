import { describe, expect, it, vi } from "vitest";

import {
  AccountAuthenticationService,
  normalizeAccountEmail,
} from "../../src/runtime/account/service";

describe("Account authentication service", () => {
  it("normalizes one ASCII email form and rejects invalid input", () => {
    expect(normalizeAccountEmail(" Reader@Example.Test \n")).toBe("reader@example.test");
    expect(() => normalizeAccountEmail("not-an-email")).toThrow();
    expect(() => normalizeAccountEmail("réader@example.test")).toThrow();
  });

  it("fails before persistence when login envelope identity differs from public parameters", async () => {
    const saveAuthenticated = vi.fn();
    const service = new AccountAuthenticationService(
      {
        createAccount: vi.fn(),
        authenticationParameters: vi.fn(async () => ({
          accountKeyId: "01900000-0000-7000-8000-000000000030",
          kdfAlgorithm: "kdf:argon2id13:account:v1" as const,
          kdfSalt: "AAECAwQFBgcICQoLDA0ODw",
          kdfOperations: 3 as const,
          kdfMemoryBytes: 67_108_864 as const,
        })),
        createSession: vi.fn(async () => ({
          account: {
            accountId: "01900000-0000-7000-8000-000000000031",
            email: "reader@example.test",
            accountKeyEnvelope: {
              version: 1 as const,
              accountKeyId: "01900000-0000-7000-8000-000000000099",
              kdfAlgorithm: "kdf:argon2id13:account:v1" as const,
              kdfSalt: "AAECAwQFBgcICQoLDA0ODw",
              kdfOperations: 3 as const,
              kdfMemoryBytes: 67_108_864 as const,
              wrappingAlgorithm: "wrap:xchacha20poly1305:account-password:v1" as const,
              nonce: "MTExMTExMTExMTExMTExMTExMTExMTEx",
              ciphertext: "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj",
            },
          },
          sessionId: "01900000-0000-7000-8000-000000000032",
          accessToken: "access",
          accessExpiresAt: "2026-07-19T21:00:00.000Z",
          refreshToken: "refresh",
          refreshExpiresAt: "2026-08-19T21:00:00.000Z",
        })),
      },
      { saveAuthenticated },
    );

    await expect(
      service.login({ email: "reader@example.test", password: "correct horse battery staple" }),
    ).rejects.toMatchObject({ id: "AUTHENTICATION_FAILED" });
    expect(saveAuthenticated).not.toHaveBeenCalled();
  });
});
