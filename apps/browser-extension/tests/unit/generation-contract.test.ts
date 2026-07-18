import { describe, expect, it } from "vitest";
import {
  decodeGenerationFence,
  generationSubmissionOutcome,
  supersededBackupRecoveryMode,
} from "../../src/runtime/synchronization/generation-contract";
import {
  activeGenerationFixture,
  supersededGenerationFixture,
} from "../fixtures/vault-generation-contract-v1";

describe("deferred synchronization Vault Generation contract", () => {
  it("round-trips opaque generation fields through the public decoder", () => {
    expect(decodeGenerationFence(structuredClone(activeGenerationFixture))).toEqual(
      activeGenerationFixture,
    );
  });

  it("rejects a superseded authoritative submission with the stable outcome", () => {
    expect(generationSubmissionOutcome(supersededGenerationFixture, activeGenerationFixture)).toBe(
      "VAULT_GENERATION_SUPERSEDED",
    );
  });

  it("routes a superseded Backup Set to isolated recovery rather than merge", () => {
    expect(supersededBackupRecoveryMode(supersededGenerationFixture, activeGenerationFixture)).toBe(
      "ISOLATED_RECOVERY",
    );
  });
});
