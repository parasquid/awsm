import { describe, expect, it } from "vitest";
import {
  decodeStructuredContentSequence,
  encodeStructuredContentSequence,
  normalizedTextFromBlocks,
  type StructuredBlockV1,
} from "../../src/domain/structured-content";

const blocks: readonly StructuredBlockV1[] = [
  {
    blockVersion: 1,
    blockId: "B000001",
    kind: "Heading",
    level: 1,
    text: "  Cafe\u0301   Archive  ",
    links: [],
  },
  {
    blockVersion: 1,
    blockId: "B000002",
    kind: "Paragraph",
    text: "First\r\nline   with space",
    links: [{ text: "AWSM", href: "https://example.test/docs" }],
  },
  {
    blockVersion: 1,
    blockId: "B000003",
    kind: "ListItem",
    ordered: false,
    depth: 2,
    text: "Nested item",
    links: [],
  },
  {
    blockVersion: 1,
    blockId: "B000004",
    kind: "Quote",
    text: "Quoted",
    links: [],
  },
  {
    blockVersion: 1,
    blockId: "B000005",
    kind: "Preformatted",
    text: "  exact\r\ntext  ",
  },
  {
    blockVersion: 1,
    blockId: "B000006",
    kind: "Table",
    rows: [
      [" A ", "B"],
      ["C", "D"],
    ],
  },
];

describe("structured Capture content", () => {
  it("encodes a canonical CBOR sequence and strictly decodes every semantic block", () => {
    const encoded = encodeStructuredContentSequence(blocks);
    expect(decodeStructuredContentSequence(encoded)).toEqual(blocks);
    expect(encodeStructuredContentSequence(decodeStructuredContentSequence(encoded))).toEqual(
      encoded,
    );
  });

  it("represents an empty valid page with only the sequence header", () => {
    const encoded = encodeStructuredContentSequence([]);
    expect(encoded.byteLength).toBeGreaterThan(0);
    expect(decodeStructuredContentSequence(encoded)).toEqual([]);
    expect(normalizedTextFromBlocks([])).toEqual(new Uint8Array());
  });

  it("derives deterministic normalized UTF-8 text from the same blocks", () => {
    expect(new TextDecoder().decode(normalizedTextFromBlocks(blocks))).toBe(
      "Café Archive\n\nFirst\nline with space\n\nNested item\n\nQuoted\n\n  exact\ntext\n\nA\tB\nC\tD\n",
    );
  });

  it("rejects non-contiguous IDs, unknown fields, invalid links, and trailing garbage", () => {
    const invalidId = [{ ...blocks[0], blockId: "B000002" }] as readonly StructuredBlockV1[];
    expect(() => encodeStructuredContentSequence(invalidId)).toThrow();
    expect(() =>
      encodeStructuredContentSequence([
        { ...blocks[1], blockId: "B000001", links: [{ text: "x", href: "not a URL" }] },
      ] as readonly StructuredBlockV1[]),
    ).toThrow();
    const valid = encodeStructuredContentSequence([]);
    expect(() => decodeStructuredContentSequence(Uint8Array.from([...valid, 0xff]))).toThrow();
  });
});
