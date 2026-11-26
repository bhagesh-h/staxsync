import { newId, paperIdForFile } from "./ids";
import type { LibraryDoc } from "./storage";
import type { PaperRecord, ReadingStatus, Tag } from "./types";

/** Pure library operations: tags, filtering, sorting, search. */

export interface IndexedFile {
  file: string;
  size: number;
  mtime: string;
}

/** Adds files that appeared in the papers folder; keeps records (tags) of files that are gone. */
export function mergeIndex(doc: LibraryDoc, files: IndexedFile[], now: string): LibraryDoc {
  const papers = { ...doc.papers };
  for (const f of files) {
    const id = paperIdForFile(f.file);
    const existing = papers[id];
    papers[id] = existing
      ? { ...existing, file: f.file, size: f.size }
      : { id, file: f.file, size: f.size, tags: [], status: "unread", addedAt: now };
  }
  return { ...doc, papers };
}

export function normaliseTagName(name: string): string {
  return name.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 60);
}

/** Returns the doc with the tag present (case-insensitive match) and the tag's id. */
export function ensureTag(doc: LibraryDoc, rawName: string): { doc: LibraryDoc; tagId: string | null } {
  const name = normaliseTagName(rawName);
  if (!name) return { doc, tagId: null };
  const found = doc.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (found) return { doc, tagId: found.id };
  const tag: Tag = { id: newId("t"), name };
  return { doc: { ...doc, tags: [...doc.tags, tag] }, tagId: tag.id };
}

export function addTagToPaper(doc: LibraryDoc, paperId: string, rawName: string): LibraryDoc {
  const paper = doc.papers[paperId];
  if (!paper) return doc;
  const { doc: withTag, tagId } = ensureTag(doc, rawName);
  if (!tagId || paper.tags.includes(tagId)) return withTag;
  return { ...withTag, papers: { ...withTag.papers, [paperId]: { ...paper, tags: [...paper.tags, tagId] } } };
}

export function removeTagFromPaper(doc: LibraryDoc, paperId: string, tagId: string): LibraryDoc {
  const paper = doc.papers[paperId];
  if (!paper) return doc;
  return { ...doc, papers: { ...doc.papers, [paperId]: { ...paper, tags: paper.tags.filter((t) => t !== tagId) } } };
}

/** Deletes a tag everywhere. */
export function deleteTag(doc: LibraryDoc, tagId: string): LibraryDoc {
  const papers: Record<string, PaperRecord> = {};
  for (const [id, p] of Object.entries(doc.papers)) papers[id] = { ...p, tags: p.tags.filter((t) => t !== tagId) };
  return { ...doc, tags: doc.tags.filter((t) => t.id !== tagId), papers };
}

export function setStatus(doc: LibraryDoc, paperId: string, status: ReadingStatus): LibraryDoc {
  const paper = doc.papers[paperId];
  if (!paper) return doc;
  return { ...doc, papers: { ...doc.papers, [paperId]: { ...paper, status } } };
}

export type TagMode = "all" | "any";

export interface LibraryFilter {
  include: string[];
  exclude: string[];
  mode: TagMode;
  untagged: boolean;
  status: ReadingStatus | "any";
  query: string;
}

export const emptyFilter: LibraryFilter = { include: [], exclude: [], mode: "all", untagged: false, status: "any", query: "" };

export function matchesTags(paper: PaperRecord, f: LibraryFilter): boolean {
  if (f.untagged && paper.tags.length > 0) return false;
  if (f.exclude.some((t) => paper.tags.includes(t))) return false;
  if (f.include.length === 0) return true;
  return f.mode === "all" ? f.include.every((t) => paper.tags.includes(t)) : f.include.some((t) => paper.tags.includes(t));
}

/** Text a paper can be found by. `extra` carries annotation quotes, comments and the paper note. */
export function searchText(paper: PaperRecord, tags: Tag[], extra = ""): string {
  const m = paper.meta;
  const tagNames = paper.tags.map((id) => tags.find((t) => t.id === id)?.name ?? "").join(" ");
  return [m?.title, m?.authors.join(" "), m?.journal, m?.doi, m?.year, paper.file, tagNames, extra]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesQuery(haystack: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}

export function filterPapers(
  papers: PaperRecord[],
  tags: Tag[],
  f: LibraryFilter,
  extraText: (id: string) => string = () => "",
): PaperRecord[] {
  return papers.filter(
    (p) =>
      (f.status === "any" || p.status === f.status) &&
      matchesTags(p, f) &&
      (!f.query.trim() || matchesQuery(searchText(p, tags, extraText(p.id)), f.query)),
  );
}

/** Tag counts over a result set (faceted: they follow the current filter). */
export function tagCounts(papers: PaperRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of papers) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

export type SortKey = "added" | "title" | "author" | "year" | "opened";

export function sortPapers(papers: PaperRecord[], key: SortKey): PaperRecord[] {
  const title = (p: PaperRecord) => (p.meta?.title ?? p.file).toLowerCase();
  const cmp: Record<SortKey, (a: PaperRecord, b: PaperRecord) => number> = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt) || title(a).localeCompare(title(b)),
    title: (a, b) => title(a).localeCompare(title(b)),
    author: (a, b) => (a.meta?.authors[0] ?? "~").localeCompare(b.meta?.authors[0] ?? "~") || title(a).localeCompare(title(b)),
    year: (a, b) => (b.meta?.year ?? 0) - (a.meta?.year ?? 0) || title(a).localeCompare(title(b)),
    opened: (a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || title(a).localeCompare(title(b)),
  };
  return [...papers].sort(cmp[key]);
}

/** Cycles a tag's filter state: off → include → exclude → off. */
export function cycleTagFilter(f: LibraryFilter, tagId: string): LibraryFilter {
  if (f.include.includes(tagId)) {
    return { ...f, include: f.include.filter((t) => t !== tagId), exclude: [...f.exclude, tagId] };
  }
  if (f.exclude.includes(tagId)) return { ...f, exclude: f.exclude.filter((t) => t !== tagId) };
  return { ...f, include: [...f.include, tagId], untagged: false };
}
