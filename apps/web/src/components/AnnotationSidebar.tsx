import { useMemo, useState } from "react";
import { colorLabel, colorOf } from "../lib/colors";
import { compareAnnotations } from "../lib/geometry";
import { kindLabel } from "../lib/markdown";
import type { Annotation, AnnotationKind } from "../lib/types";

interface Props {
  annotations: Annotation[];
  selectedId: string | null;
  note: string;
  tab: "annotations" | "note";
  pageLabel: (page: number) => string;
  onTab: (tab: "annotations" | "note") => void;
  onSelect: (a: Annotation) => void;
  onDelete: (id: string) => void;
  onNote: (note: string) => void;
  onExport: () => void;
  onClose: () => void;
}

const KINDS: (AnnotationKind | "all")[] = ["all", "highlight", "underline", "area", "note", "ink", "freehandHighlight"];

export function AnnotationSidebar(p: Props) {
  const [kind, setKind] = useState<AnnotationKind | "all">("all");
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...p.annotations]
      .filter((a) => kind === "all" || a.kind === kind)
      .filter((a) => {
        const text = `${a.anchor?.exact ?? ""} ${a.comment} ${a.replies.map((r) => r.body).join(" ")}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort(compareAnnotations);
  }, [p.annotations, kind, query]);

  return (
    <aside className="panel" aria-label="Annotations and note" data-testid="sidebar">
      <div className="bar" role="tablist">
        <button className="btn" role="tab" aria-selected={p.tab === "annotations"} aria-pressed={p.tab === "annotations"} onClick={() => p.onTab("annotations")}>
          Annotations ({p.annotations.length})
        </button>
        <button className="btn" role="tab" aria-selected={p.tab === "note"} aria-pressed={p.tab === "note"} onClick={() => p.onTab("note")}>
          Note
        </button>
        <span className="spacer" />
        <button className="btn" onClick={p.onClose}>
          Close
        </button>
      </div>
      {p.tab === "annotations" ? (
        <>
          <div className="bar">
            <select className="field" aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as AnnotationKind | "all")}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "all" ? "All kinds" : kindLabel(k)}
                </option>
              ))}
            </select>
            <input className="field" style={{ flex: 1, minWidth: 0 }} type="search" placeholder="Search" aria-label="Search annotations" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="panel-body">
            {list.length === 0 && <p className="meta">{p.annotations.length === 0 ? "No annotations yet. Select text and choose Highlight." : "Nothing matches."}</p>}
            {list.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "flex-start" }}>
                <button className="ann-item" aria-current={a.id === p.selectedId} onClick={() => p.onSelect(a)} data-testid="sidebar-item">
                  <span className="meta">
                    {colorOf(a) && <span className={`dot c-${colorOf(a)}`} aria-hidden="true" />}
                    p. {p.pageLabel(a.page)} · {colorOf(a) ? `${colorLabel(colorOf(a)!)} ${kindLabel(a.kind).toLowerCase()}` : kindLabel(a.kind)}
                  </span>
                  {a.anchor?.exact && <span className="ann-quote">{a.anchor.exact.length > 220 ? `${a.anchor.exact.slice(0, 220)}…` : a.anchor.exact}</span>}
                  {a.comment && <span style={{ display: "block", marginTop: 4 }}>{a.comment}</span>}
                  {a.replies.length > 0 && <span className="meta">{a.replies.length} repl{a.replies.length === 1 ? "y" : "ies"}</span>}
                </button>
                <button className="btn" aria-label={`Delete ${kindLabel(a.kind).toLowerCase()} on page ${p.pageLabel(a.page)}`} onClick={() => p.onDelete(a.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="panel-body">
          <label className="meta" htmlFor="paper-note">
            Note for this paper (Markdown)
          </label>
          <textarea id="paper-note" className="field" style={{ minHeight: "50vh" }} value={p.note} onChange={(e) => p.onNote(e.target.value)} />
        </div>
      )}
      <div className="bar" style={{ borderTop: "1px solid var(--muted)", borderBottom: "none" }}>
        <button className="btn" onClick={p.onExport}>
          Export Markdown
        </button>
      </div>
    </aside>
  );
}
