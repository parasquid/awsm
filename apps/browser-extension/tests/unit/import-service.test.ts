import { describe, expect, it } from "vitest";
import { validateImportPassphrase } from "../../src/runtime/import/service";

describe("Vault Import Service input", () => {
  it("accepts exact short input and rejects more than 1,024 UTF-8 bytes", () => {
    expect(validateImportPassphrase(" x ")).toBe(" x ");
    expect(validateImportPassphrase("é".repeat(512))).toBe("é".repeat(512));
    expect(() => validateImportPassphrase(`a${"é".repeat(512)}`)).toThrowError(
      expect.objectContaining({ id: "IMPORT_AUTHENTICATION_FAILED" }),
    );
  });
});
