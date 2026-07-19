import { wipe } from "../../crypto/sodium";
import type { StoredAccountMetadataV1 } from "../../drivers/indexeddb/schema";
import {
  ACCOUNT_KDF_ALGORITHM,
  ACCOUNT_KDF_MEMORY_BYTES,
  ACCOUNT_KDF_OPERATIONS,
  ACCOUNT_KEY_WRAP_ALGORITHM,
  type AccountKeyEnvelopeV1,
  createAccountKeyEnvelope,
  deriveAccountPasswordKeys,
  openAccountKeyEnvelope,
} from "./crypto";
import type {
  AccountHttp,
  AuthenticatedSession,
  AuthenticationParameters,
  WireAccountKeyEnvelopeV1,
} from "./http";
import { base64UrlToBytes, bytesToBase64Url } from "./wire";

interface AccountCredentialStore {
  saveAuthenticated(input: {
    readonly metadata: StoredAccountMetadataV1;
    readonly accountEncryptionKey: Uint8Array;
    readonly refreshToken: string;
  }): Promise<void>;
}

function failure(id = "AUTHENTICATION_FAILED"): Error {
  return Object.assign(new Error(id), { id });
}

export function normalizeAccountEmail(value: string): string {
  const email = value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "").toLowerCase();
  if (
    new TextEncoder().encode(email).byteLength > 254 ||
    !/^[\x21-\x7e]+@[\x21-\x7e]+$/u.test(email) ||
    email.includes(" ")
  )
    throw Object.assign(new Error("Invalid Account email"), { id: "ACCOUNT_INPUT_INVALID" });
  return email;
}

function decodeEnvelope(value: WireAccountKeyEnvelopeV1): AccountKeyEnvelopeV1 {
  if (
    value.version !== 1 ||
    value.kdfAlgorithm !== ACCOUNT_KDF_ALGORITHM ||
    value.kdfOperations !== ACCOUNT_KDF_OPERATIONS ||
    value.kdfMemoryBytes !== ACCOUNT_KDF_MEMORY_BYTES ||
    value.wrappingAlgorithm !== ACCOUNT_KEY_WRAP_ALGORITHM
  )
    throw failure();
  return {
    ...value,
    kdfSalt: base64UrlToBytes(value.kdfSalt, 16),
    nonce: base64UrlToBytes(value.nonce, 24),
    ciphertext: base64UrlToBytes(value.ciphertext, 48),
  };
}

function encodeEnvelope(value: AccountKeyEnvelopeV1): WireAccountKeyEnvelopeV1 {
  return {
    ...value,
    kdfMemoryBytes: 67_108_864,
    kdfSalt: bytesToBase64Url(value.kdfSalt),
    nonce: bytesToBase64Url(value.nonce),
    ciphertext: bytesToBase64Url(value.ciphertext),
  };
}

function parametersMatch(
  parameters: AuthenticationParameters,
  envelope: WireAccountKeyEnvelopeV1,
): boolean {
  return (
    parameters.accountKeyId === envelope.accountKeyId &&
    parameters.kdfAlgorithm === envelope.kdfAlgorithm &&
    parameters.kdfSalt === envelope.kdfSalt &&
    parameters.kdfOperations === envelope.kdfOperations &&
    parameters.kdfMemoryBytes === envelope.kdfMemoryBytes
  );
}

export class AccountAuthenticationService {
  constructor(
    private readonly http: Pick<
      AccountHttp,
      "authenticationParameters" | "createSession" | "createAccount"
    >,
    private readonly store: AccountCredentialStore,
  ) {}

  async login(input: { readonly email: string; readonly password: string }): Promise<string> {
    const email = normalizeAccountEmail(input.email);
    const parameters = await this.http.authenticationParameters(email);
    const salt = base64UrlToBytes(parameters.kdfSalt, 16);
    const keys = await deriveAccountPasswordKeys({
      password: input.password,
      accountKeyId: parameters.accountKeyId,
      salt,
    });
    let accountEncryptionKey: Uint8Array | undefined;
    try {
      const session = await this.http.createSession(
        email,
        bytesToBase64Url(keys.authenticationDerivative),
      );
      if (!parametersMatch(parameters, session.account.accountKeyEnvelope)) throw failure();
      const envelope = decodeEnvelope(session.account.accountKeyEnvelope);
      accountEncryptionKey = await openAccountKeyEnvelope(envelope, keys.passwordWrappingKey);
      await this.persist(session, accountEncryptionKey);
      return session.accessToken;
    } catch {
      throw failure();
    } finally {
      await Promise.all([
        wipe(keys.authenticationDerivative),
        wipe(keys.passwordWrappingKey),
        ...(accountEncryptionKey === undefined ? [] : [wipe(accountEncryptionKey)]),
      ]);
    }
  }

  async signup(input: { readonly email: string; readonly password: string }): Promise<string> {
    const email = normalizeAccountEmail(input.email);
    const accountKeyId = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const accountEncryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const keys = await deriveAccountPasswordKeys({
      password: input.password,
      accountKeyId,
      salt,
    });
    try {
      const envelope = await createAccountKeyEnvelope({
        accountKeyId,
        salt,
        accountEncryptionKey,
        passwordWrappingKey: keys.passwordWrappingKey,
      });
      const wireEnvelope = encodeEnvelope(envelope);
      const session = await this.http.createAccount({
        email,
        authenticationSecret: bytesToBase64Url(keys.authenticationDerivative),
        accountKeyEnvelope: wireEnvelope,
      });
      if (JSON.stringify(session.account.accountKeyEnvelope) !== JSON.stringify(wireEnvelope))
        throw failure("SYNCHRONIZATION_INTEGRITY_FAILED");
      await this.persist(session, accountEncryptionKey);
      return session.accessToken;
    } finally {
      await Promise.all([
        wipe(keys.authenticationDerivative),
        wipe(keys.passwordWrappingKey),
        wipe(accountEncryptionKey),
      ]);
    }
  }

  private persist(session: AuthenticatedSession, accountEncryptionKey: Uint8Array): Promise<void> {
    return this.store.saveAuthenticated({
      metadata: {
        version: 1,
        accountId: session.account.accountId,
        sessionId: session.sessionId,
        email: session.account.email,
        accountKeyId: session.account.accountKeyEnvelope.accountKeyId,
        accountKeyEnvelope: session.account.accountKeyEnvelope,
      },
      accountEncryptionKey,
      refreshToken: session.refreshToken,
    });
  }
}
