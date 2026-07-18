import { decodeFirst } from "cborg";
import { encodeCanonicalCbor } from "./cbor";
import { DomainValidationError } from "./errors";
import { bytesEqual } from "./hash";
import { boolean, canonicalRecord, integer, literal, string } from "./validation";

const BLOCK_ID = /^B[0-9]{6}$/u;

export interface StructuredLinkV1 {
  readonly text: string;
  readonly href: string;
}

export type StructuredBlockV1 =
  | {
      readonly blockVersion: 1;
      readonly blockId: string;
      readonly kind: "Heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly text: string;
      readonly links: readonly StructuredLinkV1[];
    }
  | {
      readonly blockVersion: 1;
      readonly blockId: string;
      readonly kind: "Paragraph" | "Quote";
      readonly text: string;
      readonly links: readonly StructuredLinkV1[];
    }
  | {
      readonly blockVersion: 1;
      readonly blockId: string;
      readonly kind: "ListItem";
      readonly ordered: boolean;
      readonly depth: number;
      readonly text: string;
      readonly links: readonly StructuredLinkV1[];
    }
  | {
      readonly blockVersion: 1;
      readonly blockId: string;
      readonly kind: "Preformatted";
      readonly text: string;
    }
  | {
      readonly blockVersion: 1;
      readonly blockId: string;
      readonly kind: "Table";
      readonly rows: readonly (readonly string[])[];
    };

function blockId(value: unknown, index: number): string {
  const parsed = string(value, `structured.blocks.${index}.blockId`);
  const expected = `B${String(index + 1).padStart(6, "0")}`;
  if (!BLOCK_ID.test(parsed) || parsed !== expected) {
    throw new DomainValidationError(`structured.blocks.${index}.blockId`, `must equal ${expected}`);
  }
  return parsed;
}

function absoluteUrl(value: unknown, field: string): string {
  const parsed = string(value, field);
  try {
    const url = new URL(parsed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.href !== parsed)
      throw new Error("not canonical");
  } catch {
    throw new DomainValidationError(field, "must be a canonical absolute URL");
  }
  return parsed;
}

function links(value: unknown, field: string): readonly StructuredLinkV1[] {
  if (!Array.isArray(value)) throw new DomainValidationError(field, "must be an array");
  return value.map((entry, index) => {
    const link = canonicalRecord(entry, `${field}.${index}`, ["text", "href"]);
    return {
      text: string(link.text, `${field}.${index}.text`),
      href: absoluteUrl(link.href, `${field}.${index}.href`),
    };
  });
}

function nonEmptyText(value: unknown, field: string): string {
  return string(value, field);
}

function decodeBlock(value: unknown, index: number): StructuredBlockV1 {
  const base = canonicalRecord(value, `structured.blocks.${index}`, [
    "blockVersion",
    "blockId",
    "kind",
    "level",
    "text",
    "links",
    "ordered",
    "depth",
    "rows",
  ]);
  literal(base.blockVersion, 1, `structured.blocks.${index}.blockVersion`);
  const id = blockId(base.blockId, index);
  const kind = string(base.kind, `structured.blocks.${index}.kind`);
  if (kind === "Heading") {
    const input = canonicalRecord(value, `structured.blocks.${index}`, [
      "blockVersion",
      "blockId",
      "kind",
      "level",
      "text",
      "links",
    ]);
    const level = integer(input.level, `structured.blocks.${index}.level`);
    if (level < 1 || level > 6)
      throw new DomainValidationError(`structured.blocks.${index}.level`, "must be 1 through 6");
    return {
      blockVersion: 1,
      blockId: id,
      kind,
      level: level as 1 | 2 | 3 | 4 | 5 | 6,
      text: nonEmptyText(input.text, `structured.blocks.${index}.text`),
      links: links(input.links, `structured.blocks.${index}.links`),
    };
  }
  if (kind === "Paragraph" || kind === "Quote") {
    const input = canonicalRecord(value, `structured.blocks.${index}`, [
      "blockVersion",
      "blockId",
      "kind",
      "text",
      "links",
    ]);
    return {
      blockVersion: 1,
      blockId: id,
      kind,
      text: nonEmptyText(input.text, `structured.blocks.${index}.text`),
      links: links(input.links, `structured.blocks.${index}.links`),
    };
  }
  if (kind === "ListItem") {
    const input = canonicalRecord(value, `structured.blocks.${index}`, [
      "blockVersion",
      "blockId",
      "kind",
      "ordered",
      "depth",
      "text",
      "links",
    ]);
    const depth = integer(input.depth, `structured.blocks.${index}.depth`);
    if (depth > 32)
      throw new DomainValidationError(`structured.blocks.${index}.depth`, "must be at most 32");
    return {
      blockVersion: 1,
      blockId: id,
      kind,
      ordered: boolean(input.ordered, `structured.blocks.${index}.ordered`),
      depth,
      text: nonEmptyText(input.text, `structured.blocks.${index}.text`),
      links: links(input.links, `structured.blocks.${index}.links`),
    };
  }
  if (kind === "Preformatted") {
    const input = canonicalRecord(value, `structured.blocks.${index}`, [
      "blockVersion",
      "blockId",
      "kind",
      "text",
    ]);
    return {
      blockVersion: 1,
      blockId: id,
      kind,
      text: nonEmptyText(input.text, `structured.blocks.${index}.text`),
    };
  }
  if (kind === "Table") {
    const input = canonicalRecord(value, `structured.blocks.${index}`, [
      "blockVersion",
      "blockId",
      "kind",
      "rows",
    ]);
    if (!Array.isArray(input.rows) || input.rows.length === 0)
      throw new DomainValidationError(`structured.blocks.${index}.rows`, "must be non-empty");
    const rows = input.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length === 0)
        throw new DomainValidationError(
          `structured.blocks.${index}.rows.${rowIndex}`,
          "must be non-empty",
        );
      return row.map((cell, cellIndex) =>
        nonEmptyText(cell, `structured.blocks.${index}.rows.${rowIndex}.${cellIndex}`),
      );
    });
    return { blockVersion: 1, blockId: id, kind, rows };
  }
  throw new DomainValidationError(`structured.blocks.${index}.kind`, "is unsupported");
}

function concat(values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

export function encodeStructuredContentSequence(values: readonly StructuredBlockV1[]): Uint8Array {
  const blocks = values.map((value, index) => decodeBlock(value, index));
  return concat([
    encodeCanonicalCbor({ structuredContentVersion: 1, source: "LiveDOM" }),
    ...blocks.map((block) => encodeCanonicalCbor(block)),
  ]);
}

export function decodeStructuredContentSequence(bytes: Uint8Array): readonly StructuredBlockV1[] {
  try {
    let remainder = bytes;
    const decoded: unknown[] = [];
    while (remainder.byteLength > 0) {
      const before = remainder;
      const [value, rest] = decodeFirst(before, {
        strict: true,
        allowIndefinite: false,
        allowUndefined: false,
        allowInfinity: false,
        allowNaN: false,
        allowBigInt: false,
        rejectDuplicateMapKeys: true,
      });
      const consumed = before.subarray(0, before.byteLength - rest.byteLength);
      if (!bytesEqual(consumed, encodeCanonicalCbor(value))) {
        throw new DomainValidationError("structured", "must use canonical CBOR sequence items");
      }
      decoded.push(value);
      remainder = rest;
    }
    const header = canonicalRecord(decoded[0], "structured.header", [
      "structuredContentVersion",
      "source",
    ]);
    literal(header.structuredContentVersion, 1, "structured.header.structuredContentVersion");
    literal(header.source, "LiveDOM", "structured.header.source");
    return decoded.slice(1).map(decodeBlock);
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    throw new DomainValidationError("structured", "must be a valid canonical CBOR sequence");
  }
}

function lineEndings(value: string): string {
  return value.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function trimBlankEdges(lines: string[]): string[] {
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function normalized(value: string, preformatted: boolean): string {
  const lines = lineEndings(value)
    .split("\n")
    .map((line) => {
      const spaces = preformatted ? line : line.replace(/[\t\f\v \u00a0]+/gu, " ");
      return spaces.replace(/[\t\f\v \u00a0]+$/gu, "");
    });
  const trimmed = trimBlankEdges(lines);
  return (preformatted ? trimmed.join("\n") : trimmed.join("\n").trim()).replace(
    /\n{3,}/gu,
    "\n\n",
  );
}

export function normalizedTextFromBlocks(blocks: readonly StructuredBlockV1[]): Uint8Array {
  const validated = blocks.map((block, index) => decodeBlock(block, index));
  const rendered = validated
    .map((block) => {
      if (block.kind === "Table") {
        return block.rows
          .map((row) => row.map((cell) => normalized(cell, false)).join("\t"))
          .join("\n");
      }
      return normalized(block.text, block.kind === "Preformatted");
    })
    .filter((value) => value.length > 0)
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n");
  return new TextEncoder().encode(rendered.length === 0 ? "" : `${rendered}\n`);
}
