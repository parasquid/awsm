export interface WireAccountKeyEnvelopeV1 {
  readonly version: 1;
  readonly accountKeyId: string;
  readonly kdfAlgorithm: "kdf:argon2id13:account:v1";
  readonly kdfSalt: string;
  readonly kdfOperations: 3;
  readonly kdfMemoryBytes: 67108864;
  readonly wrappingAlgorithm: "wrap:xchacha20poly1305:account-password:v1";
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface AuthenticationParameters {
  readonly accountKeyId: string;
  readonly kdfAlgorithm: "kdf:argon2id13:account:v1";
  readonly kdfSalt: string;
  readonly kdfOperations: 3;
  readonly kdfMemoryBytes: 67108864;
}

export interface AuthenticatedSession {
  readonly account: {
    readonly accountId: string;
    readonly email: string;
    readonly accountKeyEnvelope: WireAccountKeyEnvelopeV1;
  };
  readonly sessionId: string;
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

export interface AccountHttp {
  authenticationParameters(email: string): Promise<AuthenticationParameters>;
  createSession(email: string, authenticationSecret: string): Promise<AuthenticatedSession>;
  createAccount(input: {
    readonly email: string;
    readonly authenticationSecret: string;
    readonly accountKeyEnvelope: WireAccountKeyEnvelopeV1;
  }): Promise<AuthenticatedSession>;
  refresh(refreshToken: string): Promise<AuthenticatedSession>;
  logout(accessToken: string): Promise<void>;
}

function envelope(value: unknown): WireAccountKeyEnvelopeV1 {
  const input = canonicalRecord(value, "accountKeyEnvelope", [
    "version",
    "accountKeyId",
    "kdfAlgorithm",
    "kdfSalt",
    "kdfOperations",
    "kdfMemoryBytes",
    "wrappingAlgorithm",
    "nonce",
    "ciphertext",
  ]);
  const kdfSalt = string(input.kdfSalt, "accountKeyEnvelope.kdfSalt");
  const nonce = string(input.nonce, "accountKeyEnvelope.nonce");
  const ciphertext = string(input.ciphertext, "accountKeyEnvelope.ciphertext");
  base64UrlToBytes(kdfSalt, 16);
  base64UrlToBytes(nonce, 24);
  base64UrlToBytes(ciphertext, 48);
  return {
    version: literal(input.version, 1, "accountKeyEnvelope.version"),
    accountKeyId: uuid(input.accountKeyId, "accountKeyEnvelope.accountKeyId"),
    kdfAlgorithm: literal(
      input.kdfAlgorithm,
      "kdf:argon2id13:account:v1",
      "accountKeyEnvelope.kdfAlgorithm",
    ),
    kdfSalt,
    kdfOperations: literal(input.kdfOperations, 3, "accountKeyEnvelope.kdfOperations"),
    kdfMemoryBytes: literal(input.kdfMemoryBytes, 67_108_864, "accountKeyEnvelope.kdfMemoryBytes"),
    wrappingAlgorithm: literal(
      input.wrappingAlgorithm,
      "wrap:xchacha20poly1305:account-password:v1",
      "accountKeyEnvelope.wrappingAlgorithm",
    ),
    nonce,
    ciphertext,
  };
}

function authenticationParameters(value: unknown): AuthenticationParameters {
  const input = canonicalRecord(value, "authenticationParameters", [
    "accountKeyId",
    "kdfAlgorithm",
    "kdfSalt",
    "kdfOperations",
    "kdfMemoryBytes",
  ]);
  const kdfSalt = string(input.kdfSalt, "authenticationParameters.kdfSalt");
  base64UrlToBytes(kdfSalt, 16);
  return {
    accountKeyId: uuid(input.accountKeyId, "authenticationParameters.accountKeyId"),
    kdfAlgorithm: literal(
      input.kdfAlgorithm,
      "kdf:argon2id13:account:v1",
      "authenticationParameters.kdfAlgorithm",
    ),
    kdfSalt,
    kdfOperations: literal(input.kdfOperations, 3, "authenticationParameters.kdfOperations"),
    kdfMemoryBytes: literal(
      input.kdfMemoryBytes,
      67_108_864,
      "authenticationParameters.kdfMemoryBytes",
    ),
  };
}

function authenticatedSession(value: unknown): AuthenticatedSession {
  const input = canonicalRecord(value, "authenticatedSession", [
    "account",
    "sessionId",
    "accessToken",
    "accessExpiresAt",
    "refreshToken",
    "refreshExpiresAt",
  ]);
  const account = canonicalRecord(input.account, "authenticatedSession.account", [
    "accountId",
    "email",
    "accountKeyEnvelope",
  ]);
  return {
    account: {
      accountId: uuid(account.accountId, "authenticatedSession.account.accountId"),
      email: string(account.email, "authenticatedSession.account.email"),
      accountKeyEnvelope: envelope(account.accountKeyEnvelope),
    },
    sessionId: uuid(input.sessionId, "authenticatedSession.sessionId"),
    accessToken: string(input.accessToken, "authenticatedSession.accessToken"),
    accessExpiresAt: timestamp(input.accessExpiresAt, "authenticatedSession.accessExpiresAt"),
    refreshToken: string(input.refreshToken, "authenticatedSession.refreshToken"),
    refreshExpiresAt: timestamp(input.refreshExpiresAt, "authenticatedSession.refreshExpiresAt"),
  };
}

class AccountHttpError extends Error {
  constructor(readonly id: string) {
    super(id);
  }
}

export class CoordinationAccountHttp implements AccountHttp {
  constructor(
    private readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private fetch(input: string, init: RequestInit): Promise<Response> {
    return this.fetcher.call(globalThis, input, init);
  }

  private async post(path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    const response = await this.fetch(`${this.origin}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Awsm-Protocol-Version": "1",
        "Awsm-Request-ID": crypto.randomUUID(),
        ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || response.redirected) {
      const outcome =
        typeof payload === "object" && payload !== null && "outcome" in payload
          ? String(payload.outcome)
          : "SERVER_INCOMPATIBLE";
      throw new AccountHttpError(outcome);
    }
    return payload;
  }

  async authenticationParameters(email: string): Promise<AuthenticationParameters> {
    return authenticationParameters(await this.post("/api/authentication-parameters", { email }));
  }

  async createSession(email: string, authenticationSecret: string): Promise<AuthenticatedSession> {
    return authenticatedSession(await this.post("/api/sessions", { email, authenticationSecret }));
  }

  async createAccount(input: {
    readonly email: string;
    readonly authenticationSecret: string;
    readonly accountKeyEnvelope: WireAccountKeyEnvelopeV1;
  }): Promise<AuthenticatedSession> {
    return authenticatedSession(await this.post("/api/accounts", input, crypto.randomUUID()));
  }

  async refresh(refreshToken: string): Promise<AuthenticatedSession> {
    return authenticatedSession(await this.post("/api/session/refresh", { refreshToken }));
  }

  async logout(accessToken: string): Promise<void> {
    const response = await this.fetch(`${this.origin}/api/session`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Awsm-Protocol-Version": "1",
        "Awsm-Request-ID": crypto.randomUUID(),
      },
    });
    if (response.status !== 204) throw new AccountHttpError("AUTHENTICATION_FAILED");
  }
}

import { canonicalRecord, literal, string, timestamp, uuid } from "../../domain/validation";
import { base64UrlToBytes } from "./wire";
