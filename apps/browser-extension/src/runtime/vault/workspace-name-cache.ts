import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../domain/cbor";
import { normalizeVaultName } from "./name";

export { createWorkspaceNameCacheKey } from "./workspace-name-key";

const CACHE_DOMAIN = "awsm:workspace-vault-name-cache:v1";

export interface WorkspaceVaultNameCacheV1 {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceEventId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

interface EncryptWorkspaceVaultNameInput {
  readonly key: CryptoKey;
  readonly workspaceId: string;
  readonly vaultId: string;
  readonly sourceEventId: string;
  readonly name: string;
}

function cacheAad(workspaceId: string, vaultId: string): Uint8Array {
  return encodeCanonicalCbor([CACHE_DOMAIN, workspaceId, vaultId, 1]);
}

export async function encryptWorkspaceVaultName(
  input: EncryptWorkspaceVaultNameInput,
): Promise<WorkspaceVaultNameCacheV1> {
  const name = normalizeVaultName(input.name);
  if (name !== input.name) throw new Error("Workspace name caches require a canonical Vault name.");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(nonce),
      additionalData: Uint8Array.from(cacheAad(input.workspaceId, input.vaultId)),
      tagLength: 128,
    },
    input.key,
    Uint8Array.from(encodeCanonicalCbor(name)),
  );
  return {
    version: 1,
    vaultId: input.vaultId,
    sourceEventId: input.sourceEventId,
    nonce,
    ciphertext: new Uint8Array(ciphertext),
  };
}

export async function decryptWorkspaceVaultName(
  key: CryptoKey,
  workspaceId: string,
  cache: WorkspaceVaultNameCacheV1,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(cache.nonce),
      additionalData: Uint8Array.from(cacheAad(workspaceId, cache.vaultId)),
      tagLength: 128,
    },
    key,
    Uint8Array.from(cache.ciphertext),
  );
  const decoded: unknown = decodeCanonicalCbor(new Uint8Array(plaintext));
  if (typeof decoded !== "string") throw new Error("The Workspace Vault name cache is invalid.");
  const normalized = normalizeVaultName(decoded);
  if (normalized !== decoded) throw new Error("The Workspace Vault name cache is not canonical.");
  return normalized;
}
