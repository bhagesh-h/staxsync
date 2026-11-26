import { getStroke } from "perfect-freehand";
import { NOTE_SIZE, quadPolygon, type Point } from "../lib/geometry";
import type { Annotation, InkPoint, Quad } from "../lib/types";

/**
 * Draws a page's annotations as SVG inside the pdf.js page element. The SVG uses the page's
 * scale-1 viewport as its viewBox, so it scales with the page and only needs redrawing when the
 * annotations change (or pdf.js rebuilds the page).
 */

export interface ViewportLike {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export type Preview =
  | { kind: "quads"; markup: "highlight" | "underline"; quads: Quad[] }
  | { kind: "area"; rect: [number, number, number, number] }
  | { kind: "ink"; points: InkPoint[]; width: number; freehand: boolean };

const SVG = "http://www.w3.org/2000/svg";
const OVERLAY_CLASS = "sx-overlay";

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Creates the overlay if pdf.js removed it, and keeps it under the text layer so selection works. */
export function ensureOverlay(pageDiv: HTMLElement): SVGSVGElement {
  let root = pageDiv.querySelector<HTMLDivElement>(`:scope > .${OVERLAY_CLASS}`);
  if (!root) {
    root = document.createElement("div");
    root.className = OVERLAY_CLASS;
    root.setAttribute("aria-hidden", "true");
    root.appendChild(document.createElementNS(SVG, "svg"));
  }
  const textLayer = pageDiv.querySelector(":scope > .textLayer");
  if (textLayer) {
    if (root.nextElementSibling !== textLayer) textLayer.before(root);
  } else if (root.parentElement !== pageDiv) {
    pageDiv.appendChild(root);
  }
  return root.firstElementChild as SVGSVGElement;
}

function toView(vp: ViewportLike): (x: number, y: number) => Point {
  return (x, y) => {
    const [vx = 0, vy = 0] = vp.convertToViewportPoint(x, y);
    return [vx, vy];
  };
}

function polygonPoints(points: Point[]): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function outlinePath(outline: number[][]): string {
  if (outline.length < 2) return "";
  const [first, ...rest] = outline as [number[], ...number[][]];
  return `M${first[0]?.toFixed(2)} ${first[1]?.toFixed(2)} ${rest.map((p) => `L${p[0]?.toFixed(2)} ${p[1]?.toFixed(2)}`).join(" ")} Z`;
}

/** Stroke outline in view space; pressure is simulated for mouse/touch input. */
export function strokePath(points: InkPoint[], vp: ViewportLike, width: number, realPressure: boolean): string {
  const view = toView(vp);
  const scale = Math.abs((vp.convertToViewportPoint(1, 0)[0] ?? 1) - (vp.convertToViewportPoint(0, 0)[0] ?? 0)) || 1;
  const pts = points.map(([x, y, p]) => {
    const [vx, vy] = view(x, y);
    return [vx, vy, p];
  });
  const outline = getStroke(pts, {
    size: width * scale,
    thinning: realPressure ? 0.6 : 0.2,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !realPressure,
    last: true,
  });
  return outlinePath(outline);
}

function drawQuads(g: SVGGElement, quads: Quad[], markup: "highlight" | "underline", vp: ViewportLike, cls = ""): void {
  const view = toView(vp);
  for (const q of quads) {
    const poly = quadPolygon(q, view);
    if (markup === "highlight") {
      g.appendChild(el("polygon", { points: polygonPoints(poly), class: `sx-hl ${cls}` }));
    } else {
      const [, , br, bl] = poly as [Point, Point, Point, Point];
      const height = Math.hypot(poly[3]![0] - poly[0]![0], poly[3]![1] - poly[0]![1]);
      g.appendChild(el("line", { x1: bl[0], y1: bl[1], x2: br[0], y2: br[1], class: `sx-ul ${cls}`, "stroke-width": Math.max(0.8, height * 0.08) }));
    }
  }
}

function boundsOf(points: Point[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** View-space corner points of an annotation (for the selection outline and comment marker). */
function viewPoints(a: Annotation, vp: ViewportLike): Point[] {
  const view = toView(vp);
  if (a.quads) return a.quads.flatMap((q) => quadPolygon(q, view));
  if (a.rect) return [view(a.rect[0], a.rect[1]), view(a.rect[2], a.rect[3])];
  if (a.at) return [view(a.at[0], a.at[1]), view(a.at[0] + NOTE_SIZE, a.at[1] - NOTE_SIZE)];
  if (a.strokes) return a.strokes.flat().map(([x, y]) => view(x, y));
  return [];
}

function drawAnnotation(svg: SVGSVGElement, a: Annotation, vp: ViewportLike, selected: boolean): void {
  const g = el("g", { "data-annotation-id": a.id, "data-kind": a.kind, class: selected ? "sx-selected" : "" });
  const view = toView(vp);
  switch (a.kind) {
    case "highlight":
    case "underline":
      drawQuads(g, a.quads ?? [], a.kind, vp);
      break;
    case "area": {
      if (!a.rect) break;
      const [x0, y0, x1, y1] = boundsOf([view(a.rect[0], a.rect[1]), view(a.rect[2], a.rect[3])]);
      g.appendChild(el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: "sx-area" }));
      break;
    }
    case "note": {
      if (!a.at) break;
      const [x, y] = view(a.at[0], a.at[1]);
      g.appendChild(el("rect", { x, y, width: NOTE_SIZE, height: NOTE_SIZE, class: "sx-note" }));
      break;
    }
    case "ink":
    case "freehandHighlight":
      for (const stroke of a.strokes ?? []) {
        g.appendChild(el("path", { d: strokePath(stroke, vp, a.width ?? 1.5, a.input === "stylus"), class: a.kind === "ink" ? "sx-ink" : "sx-hl" }));
      }
      break;
  }
  const pts = viewPoints(a, vp);
  if (pts.length > 0) {
    const [x0, y0, x1, y1] = boundsOf(pts);
    if ((a.comment.trim() || a.replies.length > 0) && a.kind !== "note") {
      g.appendChild(el("rect", { x: x1 + 3, y: y0, width: 5, height: 5, class: "sx-comment-mark" }));
    }
    if (selected) {
      g.appendChild(el("rect", { x: x0 - 2, y: y0 - 2, width: x1 - x0 + 4, height: y1 - y0 + 4, class: "sx-selection" }));
    }
  }
  svg.appendChild(g);
}

function drawPreview(svg: SVGSVGElement, preview: Preview, vp: ViewportLike): void {
  const g = el("g", { class: "sx-preview" });
  if (preview.kind === "quads") drawQuads(g, preview.quads, preview.markup, vp);
  if (preview.kind === "area") {
    const view = toView(vp);
    const [x0, y0, x1, y1] = boundsOf([view(preview.rect[0], preview.rect[1]), view(preview.rect[2], preview.rect[3])]);
    g.appendChild(el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: "sx-area" }));
  }
  if (preview.kind === "ink" && preview.points.length > 0) {
    g.appendChild(el("path", { d: strokePath(preview.points, vp, preview.width, true), class: preview.freehand ? "sx-hl" : "sx-ink" }));
  }
  svg.appendChild(g);
}

export function drawOverlay(pageDiv: HTMLElement, vp: ViewportLike, annotations: Annotation[], selectedId: string | null, preview?: Preview): void {
  const svg = ensureOverlay(pageDiv);
  svg.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.replaceChildren();
  for (const a of annotations) drawAnnotation(svg, a, vp, a.id === selectedId);
  if (preview) drawPreview(svg, preview, vp);
}
