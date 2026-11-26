import type { Annotation, PaperRecord, ReadingPosition, Tag } from "./types";
import { readVersioned } from "./versioned";

/**
 * Browser storage for the MVP (no sync yet). Every value is a versioned document so the same
 * shapes can move to GitHub later. Storage can be unavailable (private mode, quota); reads then
 * fall back to empty state and writes report failure instead of throwing.
 */

const PREFIX = "staxsync.";

export interface LibraryDoc {
  version: 1;
  papers: Record<string, PaperRecord>;
  tags: Tag[];
}

export interface PaperDoc {
  version: 1;
  paperId: string;
  annotations: Annotation[];
  note: string;
  position?: ReadingPosition;
}

function isLibraryDoc(data: unknown): data is LibraryDoc {
  const d = data as LibraryDoc;
  return d.version === 1 && typeof d.papers === "object" && d.papers !== null && Array.isArray(d.tags);
}

function isPaperDoc(data: unknown): data is PaperDoc {
  const d = data as PaperDoc;
  return d.version === 1 && typeof d.paperId === "string" && Array.isArray(d.annotations) && typeof d.note === "string";
}

function getRaw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function setRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

/** Keys whose stored data came from a newer app version: never overwrite them. */
const readOnlyKeys = new Set<string>();

export function isReadOnly(key: string): boolean {
  return readOnlyKeys.has(key);
}

function load<T>(key: string, version: number, validate: (d: unknown) => d is T, empty: () => T): T {
  const result = readVersioned<T>(getRaw(key), version, {}, validate);
  switch (result.status) {
    case "ok":
      return result.value;
    case "newer":
      readOnlyKeys.add(key);
      return empty();
    case "invalid": {
      // Keep the unreadable data aside instead of silently losing it.
      const raw = getRaw(key);
      if (raw !== null) setRaw(`${key}.unreadable`, raw);
      return empty();
    }
    case "missing":
      return empty();
  }
}

function save(key: string, value: unknown): boolean {
  if (readOnlyKeys.has(key)) return false;
  return setRaw(key, JSON.stringify(value));
}

export const LIBRARY_KEY = "library";

export function loadLibrary(): LibraryDoc {
  return load<LibraryDoc>(LIBRARY_KEY, 1, isLibraryDoc, () => ({ version: 1, papers: {}, tags: [] }));
}

export function saveLibrary(doc: LibraryDoc): boolean {
  return save(LIBRARY_KEY, doc);
}

export function paperKey(paperId: string): string {
  return `paper.${paperId}`;
}

export function loadPaper(paperId: string): PaperDoc {
  return load<PaperDoc>(paperKey(paperId), 1, isPaperDoc, () => ({ version: 1, paperId, annotations: [], note: "" }));
}

export function savePaper(doc: PaperDoc): boolean {
  return save(paperKey(doc.paperId), doc);
}

export function loadPreference(name: string): string | null {
  return getRaw(`pref.${name}`);
}

export function savePreference(name: string, value: string): void {
  setRaw(`pref.${name}`, value);
}
