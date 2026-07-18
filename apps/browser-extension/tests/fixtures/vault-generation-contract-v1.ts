export const activeGenerationFixture = {
  version: 1,
  vaultId: "00000000-0000-4000-8000-000000000001",
  generationId: "00000000-0000-4000-8000-000000000003",
  generationNumber: 2,
} as const;

export const supersededGenerationFixture = {
  version: 1,
  vaultId: activeGenerationFixture.vaultId,
  generationId: "00000000-0000-4000-8000-000000000002",
  generationNumber: 1,
} as const;
