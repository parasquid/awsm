import sodium from "libsodium-wrappers-sumo";

export async function readySodium(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

export async function wipe(bytes: Uint8Array): Promise<void> {
  try {
    const library = await readySodium();
    library.memzero(bytes);
  } catch {
    bytes.fill(0);
  }
}
