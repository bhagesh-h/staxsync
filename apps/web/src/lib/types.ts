/** Data shapes of the MVP. They follow todo.md §3 so that GitHub sync can adopt them later. */

/** `[x1,y1, x2,y2, x3,y3, x4,y4]` in PDF user space: top-left, top-right, bottom-left, bottom-right (ISO 32000 §12.5.6.10). */
export type Quad = [number, number, number, number, number, number, number, number];

/** `[x0, y0, x1, y1]` in PDF user space, normalised so x0 ≤ x1 and y0 ≤ y1. */
export type PdfRect = [number, number, number, number];

/** A point of an ink stroke in PDF user space, with pen pressure 0–1. */
export type InkPoint = [number, number, number];

export type AnnotationKind = "highlight" | "underline" | "freehandHighlight" | "area" | "ink" | "note";

export type InputKind = "mouse" | "touch" | "stylus";

export interface Reply {
  id: string;
  body: string;
  createdAt: string;
}

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** Zero-based page index. */
  page: number;
  quads?: Quad[];
  rect?: PdfRect;
  at?: [number, number];
  strokes?: InkPoint[][];
  /** Stroke width in PDF units (ink and freehand highlight). */
  width?: number;
  anchor?: TextAnchor;
  comment: string;
  replies: Reply[];
  input: InputKind;
  createdAt: string;
  updatedAt: string;
}

export type ReadingStatus = "unread" | "reading" | "read";

export interface PaperMeta {
  title: string;
  authors: string[];
  /** True when only the first author is known (shown as "et al."). */
  moreAuthors: boolean;
  year?: number;
  journal?: string;
  doi?: string;
  pages: number;
}

export interface PaperRecord {
  id: string;
  file: string;
  size: number;
  tags: string[];
  status: ReadingStatus;
  addedAt: string;
  lastOpenedAt?: string;
  meta?: PaperMeta;
  /** `file:size` the metadata was read from, so a changed file is read again. */
  metaKey?: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface ReadingPosition {
  page: number;
  top: number;
  left: number;
  scale: string;
}
