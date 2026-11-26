import { boxToQuad, mergeLineBoxes, type Box, type Point } from "../lib/geometry";
import type { Quad, TextAnchor } from "../lib/types";
import type { ViewportLike } from "./overlay";

/** DOM ↔ PDF conversions for text selections and pointer positions inside pdf.js pages. */

export interface PageRef {
  index: number;
  div: HTMLElement;
  vp: ViewportLike;
}

/** Client (screen) point → PDF user-space point on a page. */
export function clientToPdf(page: PageRef, clientX: number, clientY: number): Point {
  const r = page.div.getBoundingClientRect();
  const x = ((clientX - r.left) * page.vp.width) / r.width;
  const y = ((clientY - r.top) * page.vp.height) / r.height;
  const [px = 0, py = 0] = page.vp.convertToPdfPoint(x, y);
  return [px, py];
}

/** PDF units per screen pixel on a page (for hit-test tolerances). */
export function pdfUnitsPerPixel(page: PageRef): number {
  const r = page.div.getBoundingClientRect();
  return r.width > 0 ? page.vp.width / r.width : 1;
}

/** Splits a DOM range into per-page PDF quads. */
export function rangeToQuads(range: Range, pages: PageRef[]): Map<number, Quad[]> {
  const byPage = new Map<number, Box[]>();
  const pageRects = pages.map((p) => ({ p, r: p.div.getBoundingClientRect() }));
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = pageRects.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
    if (!hit) continue;
    const sx = hit.p.vp.width / hit.r.width;
    const sy = hit.p.vp.height / hit.r.height;
    const boxes = byPage.get(hit.p.index) ?? [];
    boxes.push({
      left: (rect.left - hit.r.left) * sx,
      right: (rect.right - hit.r.left) * sx,
      top: (rect.top - hit.r.top) * sy,
      bottom: (rect.bottom - hit.r.top) * sy,
    });
    byPage.set(hit.p.index, boxes);
  }
  const result = new Map<number, Quad[]>();
  for (const [index, boxes] of byPage) {
    const page = pages.find((p) => p.index === index);
    if (!page) continue;
    const toPdf = (x: number, y: number): Point => {
      const [px = 0, py = 0] = page.vp.convertToPdfPoint(x, y);
      return [px, py];
    };
    const quads = mergeLineBoxes(boxes).map((b) => boxToQuad(b, toPdf));
    if (quads.length) result.set(index, quads);
  }
  return result;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Quote + context for re-anchoring later (W3C TextQuoteSelector style). */
export function anchorForRange(range: Range): TextAnchor {
  const exact = squash(range.toString());
  const layer = (range.startContainer.parentElement ?? (range.startContainer as Element)).closest?.(".textLayer");
  const endLayer = (range.endContainer.parentElement ?? (range.endContainer as Element)).closest?.(".textLayer");
  let prefix = "";
  let suffix = "";
  try {
    if (layer) {
      const before = document.createRange();
      before.setStart(layer, 0);
      before.setEnd(range.startContainer, range.startOffset);
      prefix = squash(before.toString()).slice(-32);
    }
    if (endLayer) {
      const after = document.createRange();
      after.setStart(range.endContainer, range.endOffset);
      after.setEnd(endLayer, endLayer.childNodes.length);
      suffix = squash(after.toString()).slice(0, 32);
    }
  } catch {
    // Context is a nicety; the quote alone still identifies the passage.
  }
  return { exact, prefix, suffix };
}

export interface Caret {
  node: Node;
  offset: number;
}

/** The text position under a screen point, if it is inside a pdf.js text layer. */
export function caretAt(x: number, y: number): Caret | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let caret: Caret | null = null;
  if (typeof d.caretPositionFromPoint === "function") {
    const p = d.caretPositionFromPoint(x, y);
    if (p) caret = { node: p.offsetNode, offset: p.offset };
  } else if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    if (r) caret = { node: r.startContainer, offset: r.startOffset };
  }
  if (!caret) return null;
  const element = caret.node.nodeType === Node.ELEMENT_NODE ? (caret.node as Element) : caret.node.parentElement;
  if (!element?.closest(".textLayer") || element.classList.contains("endOfContent")) return null;
  if (caret.node.nodeType !== Node.TEXT_NODE) return null;
  return caret;
}

export function rangeBetween(a: Caret, b: Caret): Range {
  let first = a;
  let last = b;
  if (a.node === b.node) {
    if (b.offset < a.offset) [first, last] = [b, a];
  } else if (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_PRECEDING) {
    [first, last] = [b, a];
  }
  const r = document.createRange();
  r.setStart(first.node, first.offset);
  r.setEnd(last.node, last.offset);
  return r;
}

/** Extends a range to whole words, as the stylus highlighter snaps to words. */
export function snapToWords(range: Range): Range {
  const r = range.cloneRange();
  if (r.startContainer.nodeType === Node.TEXT_NODE) {
    const t = r.startContainer.textContent ?? "";
    let s = r.startOffset;
    while (s > 0 && /\S/.test(t[s - 1] ?? "")) s--;
    r.setStart(r.startContainer, s);
  }
  if (r.endContainer.nodeType === Node.TEXT_NODE) {
    const t = r.endContainer.textContent ?? "";
    let e = r.endOffset;
    while (e < t.length && /\S/.test(t[e] ?? "")) e++;
    r.setEnd(r.endContainer, e);
  }
  return r;
}
