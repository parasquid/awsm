import type { AccountConfigurationV1 } from "../../drivers/indexeddb/schema";

export const HOSTED_SERVER_ORIGIN = "https://awsm.foo";

export type ServerSelectionErrorId = "SERVER_INCOMPATIBLE" | "SERVER_PERMISSION_DENIED";

class ServerSelectionError extends Error {
  constructor(readonly id: ServerSelectionErrorId) {
    super(id);
    this.name = "ServerSelectionError";
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname)
  );
}

export function validateServerOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ServerSelectionError("SERVER_INCOMPATIBLE");
  }
  const safeTransport =
    url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
  if (
    !safeTransport ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ServerSelectionError("SERVER_INCOMPATIBLE");
  }
  return url.origin;
}

export function serverPermissionPattern(origin: string): string {
  return `${validateServerOrigin(origin)}/*`;
}

interface ProbeResult {
  readonly status: number;
  readonly redirected: boolean;
  readonly body: unknown;
}

export interface ServerConfigurationHost {
  requestPermission(pattern: string): Promise<boolean>;
  probe(url: string): Promise<ProbeResult>;
  commit(configuration: AccountConfigurationV1): Promise<void>;
}

function compatibleInformation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).toSorted().join("\n") !==
      ["capabilities", "protocolVersion", "service"].toSorted().join("\n") ||
    body.service !== "AWSM Coordination Server" ||
    body.protocolVersion !== "1" ||
    typeof body.capabilities !== "object" ||
    body.capabilities === null
  )
    return false;
  const capabilities = body.capabilities as Record<string, unknown>;
  return (
    Object.keys(capabilities).toSorted().join("\n") ===
      ["accountPassword", "accountVaultLimit", "completeReplicaSynchronization"]
        .toSorted()
        .join("\n") &&
    capabilities.accountPassword === true &&
    capabilities.accountVaultLimit === 1 &&
    capabilities.completeReplicaSynchronization === true
  );
}

export async function configureSyncServer(
  input: string,
  host: ServerConfigurationHost,
): Promise<AccountConfigurationV1> {
  const serverOrigin = await validateSyncServer(input, host);
  const configuration = { version: 1, mode: "Configured", serverOrigin } as const;
  await host.commit(configuration);
  return configuration;
}

export async function validateSyncServer(
  input: string,
  host: Pick<ServerConfigurationHost, "requestPermission" | "probe">,
): Promise<string> {
  const serverOrigin = validateServerOrigin(input);
  let permissionGranted = false;
  try {
    permissionGranted = await host.requestPermission(serverPermissionPattern(serverOrigin));
  } catch {
    throw new ServerSelectionError("SERVER_PERMISSION_DENIED");
  }
  if (!permissionGranted) {
    throw new ServerSelectionError("SERVER_PERMISSION_DENIED");
  }
  let response: ProbeResult;
  try {
    response = await host.probe(`${serverOrigin}/api/server-information`);
  } catch {
    throw new ServerSelectionError("SERVER_INCOMPATIBLE");
  }
  if (response.redirected || response.status !== 200 || !compatibleInformation(response.body)) {
    throw new ServerSelectionError("SERVER_INCOMPATIBLE");
  }
  return serverOrigin;
}
