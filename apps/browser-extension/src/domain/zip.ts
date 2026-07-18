import { unzipSync, type Zippable, zipSync } from "fflate";

const ZIP_COMPRESSION_LEVEL = 6;

function zipEpoch(): Date {
  return new Date(1980, 0, 1, 0, 0, 0, 0);
}

export function createDeterministicZip(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const zippable: Zippable = {};
  for (const path of Object.keys(entries).sort()) {
    const bytes = entries[path];
    if (bytes !== undefined) {
      zippable[path] = bytes;
    }
  }
  return zipSync(zippable, {
    level: ZIP_COMPRESSION_LEVEL,
    mtime: zipEpoch(),
  });
}

export function readZipEntries(bytes: Uint8Array): Readonly<Record<string, Uint8Array>> {
  return unzipSync(bytes);
}
