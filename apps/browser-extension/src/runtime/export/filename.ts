const UTC_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/u;

export function vaultExportFilename(createdAt: string): string {
  const date = UTC_DATE_PREFIX.exec(createdAt)?.[0];
  if (date === undefined || Number.isNaN(Date.parse(createdAt)))
    throw new TypeError("Invalid Export creation timestamp.");
  return `awsm-vault-${date}.awsm`;
}
