/**
 * Versioned JSON files (todo.md §17.4). Older data is brought forward through migration steps;
 * data from a newer app version is returned read-only and must never be written over.
 */

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

export type ReadResult<T> =
  | { status: "missing" }
  | { status: "ok"; value: T; migrated: boolean }
  | { status: "newer"; value: unknown; version: number }
  | { status: "invalid"; reason: string };

export function readVersioned<T>(
  raw: string | null,
  currentVersion: number,
  migrations: Record<number, Migration>,
  validate: (data: unknown) => data is T,
): ReadResult<T> {
  if (raw === null) return { status: "missing" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "not JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { status: "invalid", reason: "not an object" };
  }
  let record = data as Record<string, unknown>;
  let version = typeof record.version === "number" ? record.version : 0;
  if (!Number.isInteger(version) || version < 0) return { status: "invalid", reason: "bad version" };
  if (version > currentVersion) return { status: "newer", value: record, version };
  const startVersion = version;
  while (version < currentVersion) {
    const step = migrations[version];
    if (!step) return { status: "invalid", reason: `no migration from version ${version}` };
    record = { ...step(record), version: version + 1 };
    version += 1;
  }
  if (!validate(record)) return { status: "invalid", reason: "unexpected shape" };
  return { status: "ok", value: record, migrated: version !== startVersion };
}
