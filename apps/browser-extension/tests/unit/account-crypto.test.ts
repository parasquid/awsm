import { describe, expect, it } from "vitest";

import {
  accountKeyEnvelopeAad,
  accountVaultSlotAad,
  createAccountKeyEnvelope,
  createAccountVaultSlot,
  deriveAccountPasswordKeys,
  openAccountKeyEnvelope,
  openAccountVaultSlot,
} from "../../src/runtime/account/crypto";

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Account cryptographic contracts", () => {
  const accountKeyId = "01900000-0000-7000-8000-000000000010";
  const vaultId = "01900000-0000-7000-8000-000000000011";
  const slotId = "01900000-0000-7000-8000-000000000012";
  const salt = fromHex("000102030405060708090a0b0c0d0e0f");

  it("matches the committed Argon2id and domain-separated HKDF vectors", async () => {
    const keys = await deriveAccountPasswordKeys({
      password: "correct horse battery staple",
      accountKeyId,
      salt,
    });

    expect(toHex(keys.authenticationDerivative)).toBe(
      "7b5464cd0de1bdcde15760bad161153e00d191be62f657e2ac118b50d9d561e0",
    );
    expect(toHex(keys.passwordWrappingKey)).toBe(
      "ebe055b1774da2f90fa9fe893091e9664846bfa4ffc183ce0a841f8d64ffbf5b",
    );
    expect(keys.authenticationDerivative).not.toEqual(keys.passwordWrappingKey);
  });

  it("matches fixed Account envelope and Vault-slot AAD/ciphertext vectors", async () => {
    const keys = await deriveAccountPasswordKeys({
      password: "correct horse battery staple",
      accountKeyId,
      salt,
    });
    const envelope = await createAccountKeyEnvelope({
      accountKeyId,
      salt,
      accountEncryptionKey: new Uint8Array(32).fill(0x21),
      passwordWrappingKey: keys.passwordWrappingKey,
      nonce: new Uint8Array(24).fill(0x31),
    });
    const slot = await createAccountVaultSlot({
      slotId,
      vaultId,
      accountKeyId,
      accountEncryptionKey: new Uint8Array(32).fill(0x21),
      vaultRootKey: new Uint8Array(32).fill(0x41),
      nonce: new Uint8Array(24).fill(0x51),
    });

    expect(toHex(accountKeyEnvelopeAad(envelope))).toBe(
      "8801782430313930303030302d303030302d373030302d383030302d30303030303030303030313078196b64663a6172676f6e32696431333a6163636f756e743a763150000102030405060708090a0b0c0d0e0f031a04000000782a777261703a786368616368613230706f6c79313330353a6163636f756e742d70617373776f72643a76315818313131313131313131313131313131313131313131313131",
    );
    expect(toHex(envelope.ciphertext)).toBe(
      "3db6777aaeaefb532b1ff41b8d97d473fc9dada9eceaeb44fe5fbb8ad1a465dd726a4f963db433e2e5002d0fd9eadb20",
    );
    expect(toHex(accountVaultSlotAad(slot))).toBe(
      "8601782430313930303030302d303030302d373030302d383030302d303030303030303030303132782430313930303030302d303030302d373030302d383030302d303030303030303030303131782430313930303030302d303030302d373030302d383030302d3030303030303030303031307821777261703a786368616368613230706f6c79313330353a6163636f756e743a76315818515151515151515151515151515151515151515151515151",
    );
    expect(toHex(slot.ciphertext)).toBe(
      "d8501f4098cf5955a183a0e77bdba054d18ce1c21b36b5b46edb536acb4422217c900f69d85e3678c8d8b3f34522d730",
    );
    expect(await openAccountKeyEnvelope(envelope, keys.passwordWrappingKey)).toEqual(
      new Uint8Array(32).fill(0x21),
    );
    expect(await openAccountVaultSlot(slot, new Uint8Array(32).fill(0x21))).toEqual(
      new Uint8Array(32).fill(0x41),
    );
  });

  it("fails closed when password or authenticated Account/Vault metadata is substituted", async () => {
    const keys = await deriveAccountPasswordKeys({
      password: "correct horse battery staple",
      accountKeyId,
      salt,
    });
    const wrongKeys = await deriveAccountPasswordKeys({
      password: "correct horse battery staplf",
      accountKeyId,
      salt,
    });
    const envelope = await createAccountKeyEnvelope({
      accountKeyId,
      salt,
      accountEncryptionKey: new Uint8Array(32).fill(0x21),
      passwordWrappingKey: keys.passwordWrappingKey,
      nonce: new Uint8Array(24).fill(0x31),
    });
    const slot = await createAccountVaultSlot({
      slotId,
      vaultId,
      accountKeyId,
      accountEncryptionKey: new Uint8Array(32).fill(0x21),
      vaultRootKey: new Uint8Array(32).fill(0x41),
      nonce: new Uint8Array(24).fill(0x51),
    });

    await expect(openAccountKeyEnvelope(envelope, wrongKeys.passwordWrappingKey)).rejects.toThrow();
    await expect(
      openAccountKeyEnvelope(
        { ...envelope, accountKeyId: crypto.randomUUID() },
        keys.passwordWrappingKey,
      ),
    ).rejects.toThrow();
    await expect(
      openAccountVaultSlot(
        { ...slot, vaultId: crypto.randomUUID() },
        new Uint8Array(32).fill(0x21),
      ),
    ).rejects.toThrow();
  });
});
