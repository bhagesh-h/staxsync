import { describe, expect, it } from "vitest";
import { addTagToPaper, cycleTagFilter, deleteTag, emptyFilter, filterPapers, mergeIndex, removeTagFromPaper, sortPapers, tagCounts } from "./library";
import type { LibraryDoc } from "./storage";

function libraryWith(files: string[]): LibraryDoc {
  return mergeIndex({ version: 1, papers: {}, tags: [] }, files.map((file) => ({ file, size: 1, mtime: "" })), "2026-01-01T00:00:00Z");
}

function tagged(): { doc: LibraryDoc; ids: string[] } {
  let doc = libraryWith(["a.pdf", "b.pdf", "c.pdf"]);
  const ids = Object.keys(doc.papers).sort();
  doc = addTagToPaper(doc, ids[0]!, "ml");
  doc = addTagToPaper(doc, ids[0]!, "nlp");
  doc = addTagToPaper(doc, ids[1]!, "ml");
  return { doc, ids };
}

describe("tags", () => {
  it("reuses a tag whose name differs only in case and ignores duplicates on a paper", () => {
    const { doc, ids } = tagged();
    const again = addTagToPaper(addTagToPaper(doc, ids[1]!, "ML"), ids[1]!, "#ml");
    expect(again.tags).toHaveLength(doc.tags.length);
    expect(again.papers[ids[1]!]!.tags).toEqual(doc.papers[ids[1]!]!.tags);
  });

  it("keeps several tags per paper and removes just one", () => {
    const { doc, ids } = tagged();
    const ml = doc.tags.find((t) => t.name === "ml")!.id;
    const after = removeTagFromPaper(doc, ids[0]!, ml);
    expect(after.papers[ids[0]!]!.tags).toHaveLength(1);
    expect(after.papers[ids[1]!]!.tags).toContain(ml);
  });

  it("deleting a tag removes it from every paper", () => {
    const { doc } = tagged();
    const ml = doc.tags.find((t) => t.name === "ml")!.id;
    const after = deleteTag(doc, ml);
    expect(Object.values(after.papers).some((p) => p.tags.includes(ml))).toBe(false);
  });
});

describe("tag filter", () => {
  const { doc } = tagged();
  const papers = Object.values(doc.papers);
  const ml = doc.tags.find((t) => t.name === "ml")!.id;
  const nlp = doc.tags.find((t) => t.name === "nlp")!.id;

  it("'all' results are a subset of 'any' results", () => {
    const all = filterPapers(papers, doc.tags, { ...emptyFilter, include: [ml, nlp], mode: "all" });
    const any = filterPapers(papers, doc.tags, { ...emptyFilter, include: [ml, nlp], mode: "any" });
    expect(all.length).toBeLessThan(any.length);
    for (const p of all) expect(any).toContain(p);
  });

  it("excluding a tag removes every paper carrying it", () => {
    const result = filterPapers(papers, doc.tags, { ...emptyFilter, exclude: [nlp] });
    expect(result.every((p) => !p.tags.includes(nlp))).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("untagged shows only papers without tags", () => {
    const result = filterPapers(papers, doc.tags, { ...emptyFilter, untagged: true });
    expect(result.every((p) => p.tags.length === 0)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("a tag click cycles include → exclude → off", () => {
    const once = cycleTagFilter(emptyFilter, ml);
    const twice = cycleTagFilter(once, ml);
    const thrice = cycleTagFilter(twice, ml);
    expect(once.include).toContain(ml);
    expect(twice.exclude).toContain(ml);
    expect(twice.include).not.toContain(ml);
    expect(thrice.include.concat(thrice.exclude)).not.toContain(ml);
  });

  it("counts follow the papers given", () => {
    const counts = tagCounts(filterPapers(papers, doc.tags, { ...emptyFilter, exclude: [nlp] }));
    expect(counts.get(ml) ?? 0).toBeLessThan(tagCounts(papers).get(ml) ?? 0);
  });

  it("search matches tag names and extra text", () => {
    expect(filterPapers(papers, doc.tags, { ...emptyFilter, query: "nlp" })).toHaveLength(1);
    const byNote = filterPapers(papers, doc.tags, { ...emptyFilter, query: "methylation" }, (id) => (id === papers[2]!.id ? "notes on methylation" : ""));
    expect(byNote.map((p) => p.id)).toEqual([papers[2]!.id]);
  });
});

describe("index merge and sort", () => {
  it("keeps tags of known files when the index is reloaded", () => {
    const { doc, ids } = tagged();
    const reloaded = mergeIndex(doc, [{ file: "a.pdf", size: 2, mtime: "" }], "2027-01-01T00:00:00Z");
    expect(reloaded.papers[ids[0]!]!.tags).toEqual(doc.papers[ids[0]!]!.tags);
    expect(reloaded.papers[ids[0]!]!.addedAt).toBe(doc.papers[ids[0]!]!.addedAt);
  });

  it("sorts by title alphabetically", () => {
    let doc = libraryWith(["z.pdf", "m.pdf", "a.pdf"]);
    const sorted = sortPapers(Object.values(doc.papers), "title").map((p) => p.file);
    expect(sorted).toEqual([...sorted].sort());
    doc = { ...doc };
  });
});
