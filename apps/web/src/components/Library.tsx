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
  { key: "any", label: "All papers" },
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

  const commands: Command[] = useMemo(
    () => [
      { id: "library_search_focus", title: "Search library", keys: ["/"], run: () => searchRef.current?.focus() },
      { id: "library_filter_clear", title: "Clear filters", run: () => setFilter(emptyFilter) },
    ],
    [],
  );
  useCommands(commands);

  const summary = [
    filter.include.length ? filter.include.map(tagName).join(filter.mode === "all" ? " AND " : " OR ") : "",
    filter.exclude.length ? `NOT ${filter.exclude.map(tagName).join(", ")}` : "",
    filter.untagged ? "untagged" : "",
    filter.status !== "any" ? filter.status : "",
    filter.query.trim() ? `“${filter.query.trim()}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");

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
        <button className="btn btn-nav" onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <div className="library">
        <nav className="rail" aria-label="Filters">
          <h2>Status</h2>
          {STATUSES.map((s) => (
            <div className="rail-row" key={s.key}>
              <button className="btn" aria-pressed={filter.status === s.key} onClick={() => setFilter((f) => ({ ...f, status: s.key }))}>
                {s.label}
              </button>
            </div>
          ))}

          <h2>Tags</h2>
          <div className="rail-row" style={{ marginBottom: 4 }}>
            <span className="meta">Match</span>
            <span className="segmented" role="group" aria-label="Tag match mode">
              <button className="btn" aria-pressed={filter.mode === "all"} onClick={() => setFilter((f) => ({ ...f, mode: "all" }))}>
                All
              </button>
              <button className="btn" aria-pressed={filter.mode === "any"} onClick={() => setFilter((f) => ({ ...f, mode: "any" }))}>
                Any
              </button>
            </span>
          </div>
          {tagsByName.length === 0 && <p className="meta">No tags yet. Add one to a paper.</p>}
          {tagsByName.map((t) => (
            <TagFilterRow key={t.id} tag={t} count={counts.get(t.id) ?? 0} filter={filter} onCycle={() => setFilter((f) => cycleTagFilter(f, t.id))} onDelete={() => {
              const used = all.filter((p) => p.tags.includes(t.id)).length;
              if (used === 0 || window.confirm(`Remove tag “${t.name}” from ${used} paper${used === 1 ? "" : "s"}?`)) {
                setLibrary((doc) => deleteTag(doc, t.id));
                setFilter((f) => ({ ...f, include: f.include.filter((x) => x !== t.id), exclude: f.exclude.filter((x) => x !== t.id) }));
                announce(`Tag ${t.name} deleted`);
              }
            }} />
          ))}
          <div className="rail-row">
            <button className="btn" aria-pressed={filter.untagged} onClick={() => setFilter((f) => ({ ...f, untagged: !f.untagged, include: f.untagged ? f.include : [] }))}>
              Untagged
            </button>
            <span className="count">{all.filter((p) => p.tags.length === 0).length}</span>
          </div>
          <p className="meta">Click a tag: include, then exclude, then off.</p>
        </nav>

        <main className="papers" aria-label="Papers">
          <div className="filter-summary">
            <span>
              {shown.length} of {all.length} papers{summary ? ` · ${summary}` : ""}
            </span>
            {filtering && (
              <button className="btn" onClick={() => setFilter(emptyFilter)}>
                Clear
              </button>
            )}
          </div>
          {missingPaper && <p className="empty">That paper isn't in the library.</p>}
          {loadError && <p className="empty">{loadError}</p>}
          {loading && !loadError && <p className="empty">Loading papers…</p>}
          {!loading && !loadError && all.length === 0 && <p className="empty">No PDFs found in the papers folder.</p>}
          {!loading && all.length > 0 && shown.length === 0 && <p className="empty">No papers match these filters.</p>}
          {shown.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              tags={library.tags}
              annotationCount={loadPaper(p.id).annotations.length}
              onAddTag={(name) => setLibrary((doc) => addTagToPaper(doc, p.id, name))}
              onRemoveTag={(tagId) => setLibrary((doc) => removeTagFromPaper(doc, p.id, tagId))}
              onStatus={(s) => setLibrary((doc) => setStatus(doc, p.id, s))}
            />
          ))}
        </main>
      </div>
    </div>
  );
}

function TagFilterRow({ tag, count, filter, onCycle, onDelete }: { tag: Tag; count: number; filter: LibraryFilter; onCycle: () => void; onDelete: () => void }) {
  const state = filter.include.includes(tag.id) ? "include" : filter.exclude.includes(tag.id) ? "exclude" : "off";
  const mark = state === "include" ? "+ " : state === "exclude" ? "− " : "";
  return (
    <div className="rail-row">
      <button
        className={`btn ${state === "include" ? "is-active" : ""}`}
        aria-label={`${tag.name}, ${state === "off" ? "not filtered" : state === "include" ? "included" : "excluded"}`}
        onClick={onCycle}
        style={state === "exclude" ? { textDecoration: "line-through" } : undefined}
      >
        {mark}
        {tag.name}
      </button>
      <span className="count">{count}</span>
      <button className="btn" aria-label={`Delete tag ${tag.name}`} title="Delete tag" onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

function PaperRow({
  paper,
  tags,
  annotationCount,
  onAddTag,
  onRemoveTag,
  onStatus,
}: {
  paper: PaperRecord;
  tags: Tag[];
  annotationCount: number;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
  onStatus: (s: ReadingStatus) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = `tags-${paper.id}`;
  const m = paper.meta;
  const commit = () => {
    for (const name of draft.split(",")) if (name.trim()) onAddTag(name);
    setDraft("");
  };
  return (
    <article className="paper-row" data-testid="paper-row" data-paper-id={paper.id}>
      <a className="link paper-title" href={`#/paper/${encodeURIComponent(paper.id)}`}>
        {m?.title ?? paper.file}
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
          const name = tags.find((t) => t.id === id)?.name ?? "?";
          return (
            <span className="tag" key={id} data-testid="paper-tag">
              #{name}
              <button className="btn" aria-label={`Remove tag ${name}`} onClick={() => onRemoveTag(id)}>
                ×
              </button>
            </span>
          );
        })}
        <input
          className="field tag-input"
          placeholder="+ tag"
          aria-label={`Add tag to ${m?.title ?? paper.file}`}
          list={listId}
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
        <datalist id={listId}>
          {tags.filter((t) => !paper.tags.includes(t.id)).map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        <span className="spacer" style={{ flex: 1 }} />
        <select className="field" aria-label="Reading status" value={paper.status} onChange={(e) => onStatus(e.target.value as ReadingStatus)} style={{ minHeight: 28 }}>
          <option value="unread">Unread</option>
          <option value="reading">Reading</option>
          <option value="read">Read</option>
        </select>
      </div>
    </article>
  );
}
