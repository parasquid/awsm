import { decode, encode, rfc8949EncodeOptions } from "cborg";

export function encodeCanonicalCbor(value: unknown): Uint8Array {
  return encode(value, rfc8949EncodeOptions);
}

export function decodeCanonicalCbor(bytes: Uint8Array): unknown {
  return decode(bytes);
}
