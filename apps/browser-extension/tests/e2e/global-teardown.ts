import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default function teardownBrowserProof(): void {
  const repositoryRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "compose.sync-proof.yml"),
      "-f",
      resolve(repositoryRoot, "compose.browser-proof.yml"),
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Browser proof teardown failed: ${result.stderr || result.stdout}`);
  }
}
