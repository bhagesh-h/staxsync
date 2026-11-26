import type { Annotation, InkPoint, PdfRect, Quad } from "./types";

/** Pure geometry for annotations. Page-space = CSS px of the page at scale 1; PDF space = user units. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Point = [number, number];
export type ToPdf = (x: number, y: number) => Point;

/** Lower median: one oversized container rect can't pull the typical line height up. */
function lowerMedian(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/**
 * Turns the client rects of a text selection into one box per line: drops slivers and oversized
 * container rects, then joins boxes that share a line and touch or nearly touch.
 */
export function mergeLineBoxes(boxes: Box[]): Box[] {
  const usable = boxes.filter((b) => b.right - b.left >= 0.5 && b.bottom - b.top >= 0.5);
  if (usable.length === 0) return [];
  const typical = lowerMedian(usable.map((b) => b.bottom - b.top));
  const sized = usable.filter((b) => b.bottom - b.top <= typical * 2.5);
  const sorted = [...sized].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[] = [];
  for (const b of sorted) {
    const h = b.bottom - b.top;
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, b.bottom) - Math.max(l.top, b.top);
      const minH = Math.min(l.bottom - l.top, h);
      const gap = Math.max(b.left - l.right, l.left - b.right);
      return overlap >= minH * 0.5 && gap <= Math.max(h, l.bottom - l.top) * 0.8;
    });
    if (line) {
      line.left = Math.min(line.left, b.left);
      line.right = Math.max(line.right, b.right);
      line.top = Math.min(line.top, b.top);
      line.bottom = Math.max(line.bottom, b.bottom);
    } else {
      lines.push({ ...b });
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

export function boxToQuad(b: Box, toPdf: ToPdf): Quad {
  const [x1, y1] = toPdf(b.left, b.top);
  const [x2, y2] = toPdf(b.right, b.top);
  const [x3, y3] = toPdf(b.left, b.bottom);
  const [x4, y4] = toPdf(b.right, b.bottom);
  return [x1, y1, x2, y2, x3, y3, x4, y4];
}

/** Quad corners in drawing order (TL, TR, BR, BL), mapped to view space. */
export function quadPolygon(q: Quad, toView: (x: number, y: number) => Point): Point[] {
  return [toView(q[0], q[1]), toView(q[2], q[3]), toView(q[6], q[7]), toView(q[4], q[5])];
}

export function normaliseRect(a: Point, b: Point): PdfRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Point;
    const [xj, yj] = poly[j] as Point;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function quadAsPolygon(q: Quad): Point[] {
  return [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ];
}

export const NOTE_SIZE = 14;

/** Whether a PDF-space point touches an annotation, within `tolerance` PDF units. */
export function hitsAnnotation(a: Annotation, p: Point, tolerance: number): boolean {
  switch (a.kind) {
    case "highlight":
    case "underline":
      return (a.quads ?? []).some((q) => {
        const poly = quadAsPolygon(q);
        if (pointInPolygon(p, poly)) return true;
        return poly.some((v, i) => distanceToSegment(p, v, poly[(i + 1) % poly.length] as Point) <= tolerance);
      });
    case "area": {
      const r = a.rect;
      if (!r) return false;
      return p[0] >= r[0] - tolerance && p[0] <= r[2] + tolerance && p[1] >= r[1] - tolerance && p[1] <= r[3] + tolerance;
    }
    case "note": {
      const at = a.at;
      if (!at) return false;
      // `at` is the note's top-left corner; PDF y grows upwards.
      return p[0] >= at[0] - tolerance && p[0] <= at[0] + NOTE_SIZE + tolerance && p[1] <= at[1] + tolerance && p[1] >= at[1] - NOTE_SIZE - tolerance;
    }
    case "ink":
    case "freehandHighlight": {
      const reach = tolerance + (a.width ?? 1) / 2;
      return (a.strokes ?? []).some((s) =>
        s.length === 1
          ? Math.hypot(p[0] - (s[0] as InkPoint)[0], p[1] - (s[0] as InkPoint)[1]) <= reach
          : s.some((pt, i) => i > 0 && distanceToSegment(p, [pt[0], pt[1]], [(s[i - 1] as InkPoint)[0], (s[i - 1] as InkPoint)[1]]) <= reach),
      );
    }
  }
}

/** Topmost position of an annotation in PDF space (largest y) and its left x, for sorting and jumping. */
export function annotationAnchorPoint(a: Annotation): Point {
  if (a.quads && a.quads.length > 0) {
    const q = a.quads[0] as Quad;
    return [Math.min(q[0], q[4]), Math.max(q[1], q[3])];
  }
  if (a.rect) return [a.rect[0], a.rect[3]];
  if (a.at) return [a.at[0], a.at[1]];
  if (a.strokes && a.strokes.length > 0) {
    const pts = a.strokes.flat();
    return [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  return [0, 0];
}

/** Reading order: page, then top to bottom, then left to right. */
export function compareAnnotations(a: Annotation, b: Annotation): number {
  if (a.page !== b.page) return a.page - b.page;
  const [ax, ay] = annotationAnchorPoint(a);
  const [bx, by] = annotationAnchorPoint(b);
  return by - ay || ax - bx;
}
