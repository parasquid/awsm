import { expect, it } from "vitest";
import { storageError } from "../../src/drivers/indexeddb";

it.each(["VAULT_CONTEXT_CHANGED", "VAULT_BUSY", "VAULT_NOT_FOUND"] as const)(
  "preserves the stable %s management error across the transaction boundary",
  (id) => {
    expect(storageError(Object.assign(new Error("management conflict"), { id }))).toMatchObject({
      id,
    });
  },
);
