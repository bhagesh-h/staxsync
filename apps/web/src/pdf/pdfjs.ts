import type * as PdfjsLib from "pdfjs-dist";
import type * as PdfjsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

export type Pdfjs = typeof PdfjsLib;
export type PdfjsViewerModule = typeof PdfjsViewer;

let loading: Promise<{ lib: Pdfjs; viewer: PdfjsViewerModule }> | null = null;

/**
 * Loads pdf.js lazily (it's large, and the library screen needs only metadata).
 * The viewer components read the core library from `globalThis.pdfjsLib`, so it must be set
 * before the viewer module is evaluated.
 */
export function loadPdfjs(): Promise<{ lib: Pdfjs; viewer: PdfjsViewerModule }> {
  loading ??= (async () => {
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    (globalThis as unknown as { pdfjsLib: Pdfjs }).pdfjsLib = lib;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    return { lib, viewer };
  })();
  return loading;
}

export function paperUrl(file: string): string {
  return `papers/${encodeURIComponent(file)}`;
}
