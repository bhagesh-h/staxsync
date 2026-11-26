import type { PaperMeta, PaperRecord } from "./types";

/**
 * Citations. With a DOI, doi.org content negotiation returns the citation in any CSL style or as
 * BibTeX/RIS (registry metadata: full author lists, volume, pages). Without a DOI, or offline,
 * a basic citation is built from what the PDF itself says.
 */

export type CiteFormat = "apa" | "mla" | "chicago" | "harvard" | "ieee" | "vancouver" | "nature" | "bibtex" | "ris";

export interface CiteFormatInfo {
  id: CiteFormat;
  label: string;
  accept: string;
  /** File extension for downloads. */
  ext: "txt" | "bib" | "ris";
}

export const CITE_FORMATS: CiteFormatInfo[] = [
  { id: "apa", label: "APA", accept: "text/x-bibliography; style=apa", ext: "txt" },
  { id: "mla", label: "MLA", accept: "text/x-bibliography; style=modern-language-association", ext: "txt" },
  { id: "chicago", label: "Chicago", accept: "text/x-bibliography; style=chicago-author-date", ext: "txt" },
  { id: "harvard", label: "Harvard", accept: "text/x-bibliography; style=harvard-cite-them-right", ext: "txt" },
  { id: "ieee", label: "IEEE", accept: "text/x-bibliography; style=ieee", ext: "txt" },
  { id: "vancouver", label: "Vancouver", accept: "text/x-bibliography; style=vancouver", ext: "txt" },
  { id: "nature", label: "Nature", accept: "text/x-bibliography; style=nature", ext: "txt" },
  { id: "bibtex", label: "BibTeX", accept: "application/x-bibtex", ext: "bib" },
  { id: "ris", label: "RIS", accept: "application/x-research-info-systems", ext: "ris" },
];

export function formatInfo(id: CiteFormat): CiteFormatInfo {
  return CITE_FORMATS.find((f) => f.id === id) ?? (CITE_FORMATS[0] as CiteFormatInfo);
}

export function isCiteFormat(value: unknown): value is CiteFormat {
  return CITE_FORMATS.some((f) => f.id === value);
}

export interface Citation {
  text: string;
  /** Where the text came from: the DOI registry, or the PDF's own metadata. */
  source: "doi" | "pdf";
}

type Meta = Pick<PaperMeta, "title" | "authors" | "moreAuthors" | "year" | "journal" | "doi">;

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, -1)
    .map((p) => `${p[0]?.toUpperCase() ?? ""}.`)
    .join(" ");
}

/** A citekey like `uddin2022clonal`. */
export function citekey(meta: Meta): string {
  const author = meta.authors[0] ? surname(meta.authors[0]) : "anon";
  const word = meta.title.split(/\s+/).find((w) => w.length > 3) ?? "paper";
  return `${author}${meta.year ?? ""}${word}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Basic citation from the PDF's own metadata (first author only when that's all the PDF lists). */
export function localCitation(meta: Meta, format: CiteFormat): string {
  const first = meta.authors[0] ?? "Unknown author";
  const etAl = meta.moreAuthors || meta.authors.length > 1;
  const year = meta.year ? String(meta.year) : "n.d.";
  const doiUrl = meta.doi ? `https://doi.org/${meta.doi}` : "";
  const journal = meta.journal ?? "";
  const apaAuthor = `${surname(first)}, ${initials(first)}${etAl ? ", et al." : ""}`;
  switch (format) {
    case "apa":
      return [`${apaAuthor} (${year}). ${meta.title}.`, journal && `${journal}.`, doiUrl].filter(Boolean).join(" ");
    case "mla":
      return [`${surname(first)}, ${first.split(/\s+/).slice(0, -1).join(" ")}${etAl ? ", et al" : ""}. “${meta.title}.”`, journal && `${journal},`, `${year}.`, doiUrl].filter(Boolean).join(" ");
    case "chicago":
      return [`${surname(first)}, ${first.split(/\s+/).slice(0, -1).join(" ")}${etAl ? ", et al" : ""}. ${year}. “${meta.title}.”`, journal && `${journal}.`, doiUrl].filter(Boolean).join(" ");
    case "harvard":
      return [`${surname(first)}, ${initials(first)}${etAl ? " et al." : ""} (${year}) ‘${meta.title}’,`, journal && `${journal}.`, doiUrl && `doi:${meta.doi}.`].filter(Boolean).join(" ");
    case "ieee":
      return [`[1] ${initials(first)} ${surname(first)}${etAl ? " et al." : ""}, “${meta.title},”`, journal && `${journal},`, `${year},`, meta.doi && `doi: ${meta.doi}.`].filter(Boolean).join(" ");
    case "vancouver":
      return [`1. ${surname(first)} ${initials(first).replace(/[.\s]/g, "")}${etAl ? ", et al" : ""}. ${meta.title}.`, journal && `${journal}.`, `${year}.`, meta.doi && `doi:${meta.doi}`].filter(Boolean).join(" ");
    case "nature":
      return [`1. ${surname(first)}, ${initials(first)}${etAl ? " et al." : ""} ${meta.title}.`, journal && `${journal}`, `(${year}).`].filter(Boolean).join(" ");
    case "bibtex": {
      const fields = [
        `  title = {${meta.title}}`,
        `  author = {${meta.authors.join(" and ")}${etAl && meta.authors.length <= 1 ? " and others" : ""}}`,
        journal && `  journal = {${journal}}`,
        meta.year && `  year = {${meta.year}}`,
        meta.doi && `  doi = {${meta.doi}}`,
      ].filter(Boolean);
      return `@article{${citekey(meta)},\n${fields.join(",\n")}\n}`;
    }
    case "ris":
      return [
        "TY  - JOUR",
        `TI  - ${meta.title}`,
        ...meta.authors.map((a) => `AU  - ${surname(a)}, ${a.split(/\s+/).slice(0, -1).join(" ")}`),
        journal && `JO  - ${journal}`,
        meta.year && `PY  - ${meta.year}`,
        meta.doi && `DO  - ${meta.doi}`,
        "ER  - ",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

const CACHE_PREFIX = "staxsync.cite.";

function cacheGet(key: string): string | null {
  try {
    return localStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, value);
  } catch {
    // A full or blocked storage only costs a refetch next time.
  }
}

/** A DOI in a doi.org URL: keep slashes, escape everything else that needs it. */
function doiPath(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

export async function citePaper(paper: PaperRecord, format: CiteFormat, fetchImpl: typeof fetch = fetch): Promise<Citation> {
  const meta: Meta = paper.meta ?? { title: paper.file.replace(/\.pdf$/i, ""), authors: [], moreAuthors: false };
  const doi = meta.doi;
  if (doi) {
    const key = `${doi.toLowerCase()}.${format}`;
    const cached = cacheGet(key);
    if (cached) return { text: cached, source: "doi" };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    try {
      const res = await fetchImpl(`https://doi.org/${doiPath(doi)}`, { headers: { Accept: formatInfo(format).accept }, signal: abort.signal });
      const text = (await res.text()).trim();
      // A registry answer, not an HTML landing page or an error page.
      if (res.ok && text && text.length < 50_000 && !/^\s*</.test(text)) {
        cacheSet(key, text);
        return { text, source: "doi" };
      }
    } catch {
      // Offline or blocked: fall through to the basic citation.
    } finally {
      clearTimeout(timer);
    }
  }
  return { text: localCitation(meta, format), source: "pdf" };
}

/** Citations for several papers, in the order given. */
export async function citePapers(papers: PaperRecord[], format: CiteFormat, fetchImpl: typeof fetch = fetch): Promise<{ text: string; fromPdf: number }> {
  const results = await Promise.all(papers.map((p) => citePaper(p, format, fetchImpl)));
  const separator = format === "bibtex" || format === "ris" ? "\n\n" : "\n\n";
  return { text: results.map((r) => r.text).join(separator), fromPdf: results.filter((r) => r.source === "pdf").length };
}
