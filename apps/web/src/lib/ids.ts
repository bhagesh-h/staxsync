/** Sortable unique id: time prefix + random suffix. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${time}${Array.from(random, (n) => n.toString(36).padStart(7, "0")).join("")}`;
}

/** Stable paper id for a file in the papers folder (sync will switch to content hashes). */
export function paperIdForFile(file: string): string {
  return `p_${file.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
