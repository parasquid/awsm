const ADJECTIVES = [
  "Amber",
  "Ancient",
  "Enduring",
  "Evergreen",
  "Golden",
  "Quiet",
  "Starlit",
  "Timeless",
] as const;

const NOUNS = [
  "Archive",
  "Chronicle",
  "Codex",
  "Folio",
  "Ledger",
  "Memory",
  "Record",
  "Reliquary",
] as const;

const SPACE_RUN = /\s+/gu;

function containsForbiddenNameCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0x2028 && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    );
  });
}

export class InvalidVaultNameError extends Error {
  readonly id = "INVALID_VAULT_NAME" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidVaultNameError";
  }
}

export function normalizeVaultName(value: string): string {
  if (containsForbiddenNameCharacter(value)) {
    throw new InvalidVaultNameError("Vault names must not contain control characters.");
  }
  const normalized = value.normalize("NFC").trim().replace(SPACE_RUN, " ");
  const codePointLength = [...normalized].length;
  if (codePointLength < 1 || codePointLength > 64) {
    throw new InvalidVaultNameError("Vault names must contain between 1 and 64 characters.");
  }
  return normalized;
}

export function vaultNameComparisonKey(value: string): string {
  return normalizeVaultName(value).toLowerCase();
}

function secureRandomIndex(upperBound: number): number {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0) {
    throw new RangeError("The random upper bound must be a positive safe integer.");
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % upperBound);
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while ((sample[0] ?? range) >= limit);
  return (sample[0] ?? 0) % upperBound;
}

export function suggestVaultName(
  existingNames: readonly string[],
  randomIndex: (upperBound: number) => number = secureRandomIndex,
): string {
  const used = new Set(existingNames.map(vaultNameComparisonKey));
  let lastCandidate = "Amber Archive";
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const adjective = ADJECTIVES[randomIndex(ADJECTIVES.length)];
    const noun = NOUNS[randomIndex(NOUNS.length)];
    if (adjective === undefined || noun === undefined) {
      throw new RangeError("The random name index is outside the word list.");
    }
    lastCandidate = `${adjective} ${noun}`;
    if (!used.has(vaultNameComparisonKey(lastCandidate))) return lastCandidate;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${lastCandidate} ${String(suffix)}`;
    if (!used.has(vaultNameComparisonKey(candidate))) return candidate;
  }
}
