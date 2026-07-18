import { describe, expect, it } from "vitest";

import {
  type VaultRecordsV1,
  type VaultRepository,
  VaultService,
  VaultServiceError,
} from "../../src/runtime/vault";

class MemoryVaultRepository implements VaultRepository {
  private records: VaultRecordsV1 | undefined;
  failCreate = false;

  async create(records: VaultRecordsV1): Promise<void> {
    if (this.failCreate) {
      throw new Error("simulated atomic create failure");
    }
    this.records = records;
  }

  async load(): Promise<VaultRecordsV1 | undefined> {
    return this.records;
  }

  async setManualLock(manuallyLocked: boolean): Promise<void> {
    const current = this.requireRecords();
    this.records = {
      ...current,
      metadata: { ...current.metadata, manuallyLocked },
    };
  }

  requireRecords(): VaultRecordsV1 {
    if (this.records === undefined) {
      throw new Error("Expected Vault records");
    }
    return this.records;
  }

  mutateDeviceIdentity(): void {
    const current = this.requireRecords();
    this.records = {
      ...current,
      deviceSlot: {
        ...current.deviceSlot,
        deviceId: crypto.randomUUID(),
      },
    };
  }

  corruptVerifier(): void {
    const current = this.requireRecords();
    this.records = {
      ...current,
      metadata: {
        ...current.metadata,
        verifier: {
          ...current.metadata.verifier,
          ciphertext: current.metadata.verifier.ciphertext.map((byte, index) =>
            index === 0 ? byte ^ 1 : byte,
          ),
        },
      },
    };
  }

  corruptPassphraseSlot(): void {
    const current = this.requireRecords();
    const passphraseSlot = current.passphraseSlot;
    if (passphraseSlot === undefined) {
      throw new Error("Expected passphrase slot");
    }
    this.records = {
      ...current,
      passphraseSlot: {
        ...passphraseSlot,
        ciphertext: passphraseSlot.ciphertext.map((byte, index) => (index === 0 ? byte ^ 1 : byte)),
      },
    };
  }
}

describe("Vault lifecycle", () => {
  it("creates a device-only Vault without persisting an unwrapped Root Key", async () => {
    const repository = new MemoryVaultRepository();
    const service = new VaultService(repository);

    const created = await service.create({});
    const records = repository.requireRecords();

    expect(created.vaultId).toBe(records.metadata.vaultId);
    expect(service.isUnlocked()).toBe(true);
    expect(records.deviceKey.extractable).toBe(false);
    expect(records.deviceSlot.wrappedRootKey.byteLength).toBe(40);
    expect(records.passphraseSlot).toBeUndefined();
    expect(records.head).toMatchObject({
      version: 1,
      vaultId: created.vaultId,
      generationNumber: 0,
    });
    expect(records.generation).toMatchObject({
      version: 1,
      generationId: records.head.generationId,
      generationNumber: 0,
    });
    expect(Object.keys(records)).not.toContain("rootKey");
  });

  it("persists manual lock across service-worker activation", async () => {
    const repository = new MemoryVaultRepository();
    const first = new VaultService(repository);
    await first.create({});
    await first.lock();

    const restarted = new VaultService(repository);
    expect(await restarted.autoUnlock()).toBe(false);
    expect(restarted.isUnlocked()).toBe(false);

    await restarted.unlockWithDevice();
    expect(restarted.isUnlocked()).toBe(true);
    expect(repository.requireRecords().metadata.manuallyLocked).toBe(false);
  });

  it("automatically unlocks through the device slot when not manually locked", async () => {
    const repository = new MemoryVaultRepository();
    await new VaultService(repository).create({});

    const restarted = new VaultService(repository);
    expect(await restarted.autoUnlock()).toBe(true);
    expect(restarted.isUnlocked()).toBe(true);
  });

  it("creates and unlocks an optional passphrase slot", async () => {
    const repository = new MemoryVaultRepository();
    const service = new VaultService(repository);
    await service.create({ passphrase: "correct horse battery staple" });
    await service.lock();

    await service.unlockWithPassphrase("correct horse battery staple");

    expect(service.isUnlocked()).toBe(true);
    expect(repository.requireRecords().passphraseSlot).toMatchObject({
      version: 1,
      algorithm: "wrap:xchacha20poly1305:passphrase:v1",
      kdf: "kdf:argon2id:v1",
      operations: 3,
      memoryBytes: 64 * 1024 * 1024,
    });
  });

  it("returns the same public error for wrong passphrases and corrupt slots", async () => {
    const repository = new MemoryVaultRepository();
    const service = new VaultService(repository);
    await service.create({ passphrase: "correct horse battery staple" });
    await service.lock();

    await expect(
      service.unlockWithPassphrase("this is definitely incorrect"),
    ).rejects.toMatchObject({
      id: "WRONG_PASSPHRASE",
    });

    repository.corruptPassphraseSlot();
    await expect(
      service.unlockWithPassphrase("correct horse battery staple"),
    ).rejects.toMatchObject({
      id: "WRONG_PASSPHRASE",
    });
  });

  it("rejects tampered device-slot metadata and Vault verifiers", async () => {
    const repository = new MemoryVaultRepository();
    const service = new VaultService(repository);
    await service.create({});
    await service.lock();

    repository.mutateDeviceIdentity();
    await expect(service.unlockWithDevice()).rejects.toBeInstanceOf(VaultServiceError);

    const secondRepository = new MemoryVaultRepository();
    const second = new VaultService(secondRepository);
    await second.create({});
    await second.lock();
    secondRepository.corruptVerifier();
    await expect(second.unlockWithDevice()).rejects.toMatchObject({
      id: "CRYPTO_AUTHENTICATION_FAILED",
    });
  });

  it("does not retain an unlocked Vault after atomic onboarding failure", async () => {
    const repository = new MemoryVaultRepository();
    repository.failCreate = true;
    const service = new VaultService(repository);

    await expect(service.create({})).rejects.toMatchObject({
      id: "STORAGE_TRANSACTION_FAILED",
    });
    expect(service.isUnlocked()).toBe(false);
    expect(await repository.load()).toBeUndefined();
  });
});
