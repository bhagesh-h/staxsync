import { useEffect, useRef, useState } from "react";
import { useApp } from "../app-context";
import { CITE_FORMATS, citekey, citePapers, formatInfo, isCiteFormat, type CiteFormat } from "../lib/cite";
import { loadPreference, savePreference } from "../lib/storage";
import type { PaperRecord } from "../lib/types";

interface Props {
  papers: PaperRecord[];
  /** "export" starts on a file format (BibTeX); "cite" on a citation style. */
  mode: "cite" | "export";
  onClose: () => void;
}

function initialFormat(mode: "cite" | "export"): CiteFormat {
  const saved = loadPreference(mode === "export" ? "exportFormat" : "citeFormat");
  if (isCiteFormat(saved)) return saved;
  return mode === "export" ? "bibtex" : "apa";
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Cite or export one or more papers: pick a style or format, then copy or download. */
export function CitePanel({ papers, mode, onClose }: Props) {
  const { announce } = useApp();
  const [format, setFormat] = useState<CiteFormat>(() => initialFormat(mode));
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [fromPdf, setFromPdf] = useState(0);
  const selectRef = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    selectRef.current?.focus();
    const back = returnFocus.current;
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void citePapers(papers, format).then((r) => {
      if (cancelled) return;
      setText(r.text);
      setFromPdf(r.fromPdf);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [papers, format]);

  const pick = (f: CiteFormat) => {
    setFormat(f);
    savePreference(mode === "export" ? "exportFormat" : "citeFormat", f);
  };

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => announce("Citation copied"),
      () => announce("Copy isn't allowed here; select the text instead"),
    );
  };

  const save = () => {
    const ext = formatInfo(format).ext;
    const first = papers[0];
    const name = papers.length === 1 && first?.meta ? citekey(first.meta) : "staxsync-citations";
    download(`${name}.${ext}`, `${text}\n`);
    announce("Downloaded");
  };

  const title = papers.length === 1 ? (mode === "export" ? "Export" : "Cite") : `${mode === "export" ? "Export" : "Cite"} ${papers.length} papers`;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div
        className="floating cite-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="cite-panel"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="row">
          <strong>{title}</strong>
          <span style={{ flex: 1 }} />
          <label className="meta" htmlFor="cite-format">
            Format
          </label>
          <select id="cite-format" ref={selectRef} className="field" value={format} onChange={(e) => pick(e.target.value as CiteFormat)}>
            {CITE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <textarea className="field cite-output" readOnly aria-label="Citation" value={status === "loading" ? "Loading…" : text} data-testid="cite-output" />
        {status === "ready" && fromPdf > 0 && (
          <p className="meta" role="status">
            {fromPdf === papers.length ? "Couldn't reach doi.org, so this" : `${fromPdf} of these couldn't be fetched from doi.org; they`} use{fromPdf === papers.length ? "s" : ""} only what the PDF says (often just the first author).
          </p>
        )}
        <div className="row">
          <button className="btn" onClick={copy} disabled={status !== "ready"}>
            Copy
          </button>
          <button className="btn" onClick={save} disabled={status !== "ready"}>
            Download
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}
