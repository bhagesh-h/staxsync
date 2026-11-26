import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useCommands } from "../app-context";
import type { Command } from "../lib/commands";
import { paperIdForFile } from "../lib/ids";
import {
  addTagToPaper,
  cycleTagFilter,
  deleteTag,
  emptyFilter,
  filterPapers,
  mergeIndex,
  removeTagFromPaper,
  setStatus,
  sortPapers,
  tagCounts,
  type IndexedFile,
  type LibraryFilter,
  type SortKey,
} from "../lib/library";
import { loadPaper, loadPreference, savePreference, type LibraryDoc } from "../lib/storage";
import type { PaperRecord, ReadingStatus, Tag } from "../lib/types";
import { readPaperMeta } from "../pdf/metadata";
import { CitePanel } from "./CitePanel";

interface Props {
  library: LibraryDoc;
  setLibrary: (update: (doc: LibraryDoc) => LibraryDoc) => void;
  missingPaper: boolean;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "opened", label: "Recently opened" },
  { key: "title", label: "Title" },
  { key: "author", label: "First author" },
  { key: "year", label: "Year" },
];

const STATUSES: { key: ReadingStatus | "any"; label: string }[] = [
  { key: "any", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "reading", label: "Reading" },
  { key: "read", label: "Read" },
];

/** Annotation quotes, comments and the paper note, so search finds papers by what you wrote. */
function annotationText(paperId: string): string {
  const doc = loadPaper(paperId);
  return [doc.note, ...doc.annotations.flatMap((a) => [a.anchor?.exact ?? "", a.comment, ...a.replies.map((r) => r.body)])].join(" ");
}

function authorsLine(p: PaperRecord): string {
  const m = p.meta;
  if (!m) return "";
  const names = m.authors.slice(0, 3).join(", ");
  return names + (m.moreAuthors || m.authors.length > 3 ? " et al." : "");
}

export function Library({ library, setLibrary, missingPaper }: Props) {
  const { announce, theme, toggleTheme } = useApp();
  const [filter, setFilter] = useState<LibraryFilter>(emptyFilter);
  const [sort, setSort] = useState<SortKey>(() => (loadPreference("sort") as SortKey | null) ?? "added");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  // Load the papers folder index, then read metadata from PDFs that are new or changed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("papers/index.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { papers?: IndexedFile[] };
        const files = Array.isArray(body.papers) ? body.papers : [];
        if (cancelled) return;
        const now = new Date().toISOString();
        // The state update lands on the next render, so work from the merged copy here.
        const merged = mergeIndex(libraryRef.current, files, now);
        setLibrary((doc) => mergeIndex(doc, files, now));
        setLoading(false);
        for (const f of files) {
          const current = merged.papers[paperIdForFile(f.file)];
          const key = `${f.file}:${f.size}`;
          if (!current || current.metaKey === key) continue;
          try {
            const meta = await readPaperMeta(f.file);
            if (cancelled) return;
            setLibrary((doc) => {
              const p = doc.papers[current.id];
              return p ? { ...doc, papers: { ...doc.papers, [p.id]: { ...p, meta, metaKey: key } } } : doc;
            });
          } catch {
            // The row still shows the file name; the reader reports the actual error.
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(`Couldn't load the paper list (${e instanceof Error ? e.message : "unknown error"}).`);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLibrary]);

  useEffect(() => savePreference("sort", sort), [sort]);

  const all = useMemo(() => Object.values(library.papers), [library.papers]);
  const textCache = useMemo(() => new Map<string, string>(), [library]);
  const extra = (id: string) => {
    let t = textCache.get(id);
    if (t === undefined) {
      t = annotationText(id);
      textCache.set(id, t);
    }
    return t;
  };
  const shown = useMemo(() => sortPapers(filterPapers(all, library.tags, filter, extra), sort), [all, library.tags, filter, sort]);
  const counts = useMemo(() => tagCounts(filterPapers(all, library.tags, { ...filter, include: [], exclude: [], untagged: false }, extra)), [all, library.tags, filter]);
  const tagsByName = useMemo(() => [...library.tags].sort((a, b) => a.name.localeCompare(b.name)), [library.tags]);
  const tagName = (id: string) => library.tags.find((t) => t.id === id)?.name ?? "?";
  const filtering = filter.include.length + filter.exclude.length > 0 || filter.untagged || filter.status !== "any" || filter.query.trim() !== "";

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [citeMode, setCiteMode] = useState<"cite" | "export" | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () => [
      { id: "library_search_focus", title: "Search library", keys: ["/"], run: () => searchRef.current?.focus() },
      { id: "library_filter_clear", title: "Clear filters", run: () => setFilter(emptyFilter) },
      { id: "library_selection_clear", title: "Clear selection", run: () => setSelected(new Set()) },
    ],
    [],
  );
  useCommands(commands);

  const usedTags = tagsByName.filter((t) => all.some((p) => p.tags.includes(t.id)));
  const shownSelected = shown.filter((p) => selected.has(p.id));
  const allShownSelected = shown.length > 0 && shownSelected.length === shown.length;
  const selectedPapers = sortPapers(all.filter((p) => selected.has(p.id)), sort);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = shownSelected.length > 0 && !allShownSelected;
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Removing a tag from its last paper removes the tag itself. */
  const removeTag = (paperId: string, tagId: string) =>
    setLibrary((doc) => {
      const next = removeTagFromPaper(doc, paperId, tagId);
      return Object.values(next.papers).some((p) => p.tags.includes(tagId)) ? next : deleteTag(next, tagId);
    });

  const addBulkTag = () => {
    const names = bulkTag.split(",").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    setLibrary((doc) => {
      let next = doc;
      for (const id of selected) for (const name of names) next = addTagToPaper(next, id, name);
      return next;
    });
    announce(`Tagged ${selected.size} paper${selected.size === 1 ? "" : "s"}`);
    setBulkTag("");
  };

  return (
    <div className="app">
      <header className="bar" role="banner">
        <span className="brand">StaxSync</span>
        <input
          ref={searchRef}
          className="field"
          type="search"
          placeholder="Search papers, notes, highlights"
          aria-label="Search library"
          value={filter.query}
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          style={{ flex: "1 1 200px", maxWidth: 420 }}
        />
        <label className="meta" htmlFor="sort">
          Sort
        </label>
        <select id="sort" className="field" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn" onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <div className="bar filters" role="toolbar" aria-label="Filters">
        <label className="meta" htmlFor="status">
          Status
        </label>
        <select id="status" className="field" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as LibraryFilter["status"] }))}>
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="meta">Tags</span>
        {usedTags.map((t) => {
          const state = filter.include.includes(t.id) ? "included" : filter.exclude.includes(t.id) ? "excluded" : "not filtered";
          return (
            <button
              key={t.id}
              className={`btn tag-filter ${state === "included" ? "is-active" : ""} ${state === "excluded" ? "is-excluded" : ""}`}
              aria-label={`${t.name}, ${state}`}
              title="Click: include, exclude, off"
              onClick={() => setFilter((f) => cycleTagFilter(f, t.id))}
            >
              {t.name}
              <span className="count">{counts.get(t.id) ?? 0}</span>
            </button>
          );
        })}
        <button className="btn" aria-pressed={filter.untagged} onClick={() => setFilter((f) => ({ ...f, untagged: !f.untagged, include: f.untagged ? f.include : [] }))}>
          Untagged
        </button>
        {filter.include.length > 1 && (
          <button className="btn" onClick={() => setFilter((f) => ({ ...f, mode: f.mode === "all" ? "any" : "all" }))}>
            {filter.mode === "all" ? "Match all" : "Match any"}
          </button>
        )}
        <span className="spacer" />
        <span className="meta">
          {shown.length} of {all.length}
        </span>
        {filtering && (
          <button className="btn" onClick={() => setFilter(emptyFilter)}>
            Clear filters
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bar selection-bar" role="toolbar" aria-label="Selected papers">
          <span>{selected.size} selected</span>
          <button className="btn" onClick={() => setCiteMode("cite")}>
            Cite
          </button>
          <button className="btn" onClick={() => setCiteMode("export")}>
            Export
          </button>
          <input
            className="field tag-input"
            placeholder="Add tag"
            aria-label="Add tag to selected papers"
            list="all-tags"
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBulkTag()}
          />
          <span className="spacer" />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <main className="papers" aria-label="Papers">
        {shown.length > 0 && (
          <label className="select-all meta">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allShownSelected}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const p of shown) {
                    if (allShownSelected) next.delete(p.id);
                    else next.add(p.id);
                  }
                  return next;
                })
              }
            />
            Select all
          </label>
        )}
        {missingPaper && <p className="empty">That paper isn't in the library.</p>}
        {loadError && <p className="empty">{loadError}</p>}
        {loading && !loadError && <p className="empty">Loading papers</p>}
        {!loading && !loadError && all.length === 0 && <p className="empty">No PDFs found in the papers folder.</p>}
        {!loading && all.length > 0 && shown.length === 0 && <p className="empty">No papers match these filters.</p>}
        {shown.map((p) => (
          <PaperRow
            key={p.id}
            paper={p}
            tags={library.tags}
            selected={selected.has(p.id)}
            onToggle={() => toggle(p.id)}
            annotationCount={loadPaper(p.id).annotations.length}
            onAddTag={(name) => setLibrary((doc) => addTagToPaper(doc, p.id, name))}
            onRemoveTag={(tagId) => removeTag(p.id, tagId)}
            onStatus={(s) => setLibrary((doc) => setStatus(doc, p.id, s))}
          />
        ))}
        <datalist id="all-tags">
          {tagsByName.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </main>

      {citeMode && selectedPapers.length > 0 && <CitePanel papers={selectedPapers} mode={citeMode} onClose={() => setCiteMode(null)} />}
    </div>
  );
}

function PaperRow({
  paper,
  tags,
  selected,
  onToggle,
  annotationCount,
  onAddTag,
  onRemoveTag,
  onStatus,
}: {
  paper: PaperRecord;
  tags: Tag[];
  selected: boolean;
  onToggle: () => void;
  annotationCount: number;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
  onStatus: (s: ReadingStatus) => void;
}) {
  const [draft, setDraft] = useState("");
  const m = paper.meta;
  const title = m?.title ?? paper.file;
  const commit = () => {
    for (const name of draft.split(",")) if (name.trim()) onAddTag(name);
    setDraft("");
  };
  return (
    <article className={`paper-row ${selected ? "is-selected" : ""}`} data-testid="paper-row" data-paper-id={paper.id}>
      <input type="checkbox" className="row-check" checked={selected} onChange={onToggle} aria-label={`Select ${title}`} />
      <div className="paper-body">
        <a className="link paper-title" href={`#/paper/${encodeURIComponent(paper.id)}`}>
          {title}
        </a>
        <div className="paper-line meta">
          {authorsLine(paper) && <span>{authorsLine(paper)}</span>}
          {m?.journal && <span>{m.journal}</span>}
          {m?.year && <span>{m.year}</span>}
          {m?.pages ? <span>{m.pages} pages</span> : null}
          {annotationCount > 0 && <span>{annotationCount} annotation{annotationCount === 1 ? "" : "s"}</span>}
        </div>
        {m?.doi && (
          <div className="paper-line">
            <a className="doi" href={`https://doi.org/${m.doi}`} target="_blank" rel="noopener noreferrer" data-testid="paper-doi">
              doi:{m.doi}
            </a>
          </div>
        )}
        <div className="paper-line">
          {paper.tags.map((id) => {
            const name = tags.find((t) => t.id === id)?.name ?? "";
            return (
              <button key={id} className="btn tag-chip" data-testid="paper-tag" aria-label={`Remove tag ${name}`} title="Remove tag" onClick={() => onRemoveTag(id)}>
                {name}
              </button>
            );
          })}
          <input
            className="field tag-input"
            placeholder="Add tag"
            aria-label={`Add tag to ${title}`}
            list="all-tags"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Backspace" && draft === "" && paper.tags.length > 0) onRemoveTag(paper.tags[paper.tags.length - 1] as string);
            }}
            onBlur={commit}
          />
          <span style={{ flex: 1 }} />
          <select className="field" aria-label="Reading status" value={paper.status} onChange={(e) => onStatus(e.target.value as ReadingStatus)}>
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="read">Read</option>
          </select>
        </div>
      </div>
    </article>
  );
}
