import { describe, expect, it } from "vitest";
import type { CaptureMetadataV1 } from "../../src/domain/bundle";
import type {
  StoredEvent,
  StoredObjectV1,
  StoredVaultGenerationV1,
  StoredVaultHeadV1,
} from "../../src/drivers/indexeddb/schema";
import { prepareCaptureRegistration } from "../../src/runtime/capture/registration";
import {
  VaultExportService,
  type VaultExportSource,
  type VaultPackageEntry,
  validateVaultPackage,
  writeVaultPackageBlob,
} from "../../src/runtime/export";
import { type VaultRecordsV1, type VaultRepository, VaultService } from "../../src/runtime/vault";
import { prepareVaultNameChange } from "../../src/runtime/vault/name-crypto";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

class MemoryVaultRepository implements VaultRepository {
  records: VaultRecordsV1 | undefined;
  async load(): Promise<VaultRecordsV1 | undefined> {
    return this.records;
  }
  async setManualLock(): Promise<void> {}
}

class MemoryExportSource implements VaultExportSource {
  constructor(
    readonly head: StoredVaultHeadV1,
    readonly generation: StoredVaultGenerationV1,
    readonly events: ReadonlyMap<string, StoredEvent> = new Map(),
    readonly objects: ReadonlyMap<string, StoredObjectV1> = new Map(),
  ) {}
  async getVaultHead(): Promise<StoredVaultHeadV1> {
    return this.head;
  }
  async getVaultGeneration(): Promise<StoredVaultGenerationV1> {
    return this.generation;
  }
  async getStoredEvent(id: string): Promise<StoredEvent | undefined> {
    return this.events.get(id);
  }
  async getStoredObject(id: string): Promise<StoredObjectV1 | undefined> {
    return this.objects.get(id);
  }
  async listAuthoritativeIds(): Promise<{
    eventIds: readonly string[];
    objectIds: readonly string[];
  }> {
    return {
      eventIds: [...this.events.keys()].toSorted(),
      objectIds: [...this.objects.keys()].toSorted(),
    };
  }
}

describe("Vault Export Service", () => {
  it("streams a complete active Generation into an independently unlockable package", async () => {
    const repository = new MemoryVaultRepository();
    const vault = new VaultService(repository);
    const preparedVault = await vault.prepareCreate({
      name: "Amber Archive",
      createdAt: "2026-07-18T20:00:00.000Z",
    });
    repository.records = preparedVault.records;
    const activeVault = new VaultService(repository, preparedVault.records.metadata.vaultId);
    activeVault.activatePrepared(preparedVault);
    const capturedAt = "2026-07-18T20:00:30.000Z";
    const metadata: CaptureMetadataV1 = {
      version: 1,
      originalUrl: "https://fixture.test/article",
      finalUrl: "https://fixture.test/article",
      title: "Fixture",
      capturedAt,
      contentType: "text/html",
      viewport: { width: 800, height: 600 },
      document: { width: 800, height: 1200 },
      chromeVersion: "149",
      extensionVersion: "0.1.0",
      captureProfileId: "ChromeWebPage-v1",
      captureProfileVersion: 1,
    };
    const registration = await prepareCaptureRegistration({
      rootKey: preparedVault.rootKey,
      vaultId: preparedVault.records.metadata.vaultId,
      deviceId: preparedVault.records.metadata.deviceId,
      commandId: id(10),
      bundleId: id(11),
      bundleObjectId: id(12),
      eventId: id(13),
      collectionId: id(14),
      capturedAt,
      metadata,
      mhtml: new TextEncoder().encode("MIME-Version: 1.0\r\nFixture"),
      warnings: [],
      clientVersion: "0.1.0",
    });
    const vaultCreated = await prepareVaultNameChange({
      rootKey: preparedVault.rootKey,
      eventType: "VaultCreated",
      vaultId: preparedVault.records.metadata.vaultId,
      deviceId: preparedVault.records.metadata.deviceId,
      eventId: id(9),
      timestamp: "2026-07-18T20:00:00.000Z",
      name: "Amber Archive",
    });
    const source = new MemoryExportSource(
      {
        ...preparedVault.records.head,
        appendedEventIds: [vaultCreated.event.eventId, registration.event.eventId].toSorted(),
        appendedObjectIds: [registration.object.objectId],
      },
      preparedVault.records.generation,
      new Map([
        [vaultCreated.event.eventId, vaultCreated.event],
        [registration.event.eventId, registration.event],
      ]),
      new Map([[registration.object.objectId, registration.object]]),
    );
    const prepared = await new VaultExportService(
      source,
      activeVault,
      preparedVault.records.metadata.vaultId,
    ).prepare({
      packageId: "10000000-0000-4000-8000-000000000001",
      createdAt: "2026-07-18T20:01:00.000Z",
      passphrase: "correct horse battery staple",
      salt: new Uint8Array(16).fill(7),
      nonce: new Uint8Array(24).fill(9),
    });

    const firstBytes = new Uint8Array(
      await (await writeVaultPackageBlob(prepared.entries)).arrayBuffer(),
    );
    const secondBytes = new Uint8Array(
      await (await writeVaultPackageBlob(prepared.entries)).arrayBuffer(),
    );
    expect(secondBytes).toEqual(firstBytes);
    const serializedPackage = new TextDecoder().decode(firstBytes);
    expect(serializedPackage).not.toContain("Amber Archive");
    expect(serializedPackage).not.toContain("https://fixture.test/article");
    expect(serializedPackage).not.toContain("MIME-Version: 1.0");
    const blob = new Blob([firstBytes]);
    await prepared.assertSnapshotCurrent();
    const validated = await validateVaultPackage(blob, "correct horse battery staple");

    expect(validated.manifest.generationId).toBe(preparedVault.records.generation.generationId);
    expect(validated.manifest.objectCount).toBe(1);
    expect(validated.manifest.eventCount).toBe(2);
    expect(validated.rootKey.extractable).toBe(false);
    expect(source.head.appendedObjectIds).toEqual([registration.object.objectId]);
    expect(source.head.appendedEventIds).toEqual(
      [vaultCreated.event.eventId, registration.event.eventId].toSorted(),
    );
    await expect(
      validateVaultPackage(blob, "incorrect horse battery staple"),
    ).rejects.toMatchObject({
      id: "EXPORT_AUTHENTICATION_FAILED",
    });
    const corruptedEntries: VaultPackageEntry[] = [];
    for await (const entry of prepared.entries) {
      corruptedEntries.push(
        entry.path.startsWith("objects/")
          ? { ...entry, bytes: entry.bytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte)) }
          : entry,
      );
    }
    const corrupted = await writeVaultPackageBlob(corruptedEntries);
    await expect(
      validateVaultPackage(corrupted, "correct horse battery staple"),
    ).rejects.toMatchObject({
      id: "EXPORT_PACKAGE_INVALID",
    });
  }, 30_000);
});
