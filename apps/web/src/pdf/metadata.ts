import type { PaperMeta } from "../lib/types";
import { loadPdfjs, paperUrl } from "./pdfjs";

const DOI = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;

function cleanDoi(raw: string): string {
  return raw.replace(/[.,;)\]]+$/, "");
}

interface InfoDict {
  Title?: string;
  Author?: string;
  Subject?: string;
  CreationDate?: string;
}

/** Metadata from the PDF itself (document info + first-page text). No network lookups yet. */
export function metaFromPdf(info: InfoDict, firstPageText: string, pages: number, fallbackTitle: string): PaperMeta {
  const subject = info.Subject ?? "";
  const doiMatch = DOI.exec(subject) ?? DOI.exec(firstPageText);
  const journal = subject.includes(",") ? subject.split(",")[0]?.trim() : undefined;
  const yearInText = /\((19|20)\d{2}\)\s*\d+\s*:\s*\d+/.exec(firstPageText) ?? /©\s*((19|20)\d{2})/.exec(firstPageText);
  const yearFromText = yearInText ? Number(/(19|20)\d{2}/.exec(yearInText[0])?.[0]) : undefined;
  const yearFromInfo = info.CreationDate ? Number(/D:(\d{4})/.exec(info.CreationDate)?.[1]) : undefined;
  const author = info.Author?.trim();
  const authors = author ? author.split(/\s*;\s*|\s+and\s+/).filter(Boolean) : [];
  // Publisher metadata often lists only the first author; the first page shows whether more follow.
  const afterFirst = author ? firstPageText.slice(firstPageText.indexOf(author) + author.length, firstPageText.indexOf(author) + author.length + 120) : "";
  const moreAuthors = authors.length === 1 && /,\s*\S/.test(afterFirst);
  return {
    title: info.Title?.trim() || fallbackTitle,
    authors,
    moreAuthors,
    year: yearFromText ?? (yearFromInfo && yearFromInfo > 1900 ? yearFromInfo : undefined),
    journal: journal || undefined,
    doi: doiMatch?.[1] ? cleanDoi(doiMatch[1]) : undefined,
    pages,
  };
}

export async function readPaperMeta(file: string): Promise<PaperMeta> {
  const { lib } = await loadPdfjs();
  const task = lib.getDocument({ url: paperUrl(file), disableAutoFetch: true, disableStream: false });
  const doc = await task.promise;
  try {
    const { info } = await doc.getMetadata();
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    return metaFromPdf(info as InfoDict, text, doc.numPages, file.replace(/\.pdf$/i, ""));
  } finally {
    await doc.destroy();
  }
}
