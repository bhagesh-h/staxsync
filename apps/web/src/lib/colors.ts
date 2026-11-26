import type { Annotation, HighlightColor } from "./types";

/** RGBY highlight colours, in the order shown in the UI. Keys 1–4 pick them. */
export const HIGHLIGHT_COLORS: { color: HighlightColor; label: string; key: string }[] = [
  { color: "red", label: "Red", key: "1" },
  { color: "green", label: "Green", key: "2" },
  { color: "blue", label: "Blue", key: "3" },
  { color: "yellow", label: "Yellow", key: "4" },
];

export const DEFAULT_COLOR: HighlightColor = "yellow";

export function isHighlightColor(value: unknown): value is HighlightColor {
  return value === "red" || value === "green" || value === "blue" || value === "yellow";
}

/** Whether an annotation kind takes a colour. */
export function takesColor(kind: Annotation["kind"]): boolean {
  return kind === "highlight" || kind === "freehandHighlight" || kind === "note";
}

export function colorOf(a: Annotation): HighlightColor | undefined {
  return takesColor(a.kind) ? (a.color ?? DEFAULT_COLOR) : undefined;
}

export function colorLabel(color: HighlightColor): string {
  return HIGHLIGHT_COLORS.find((c) => c.color === color)?.label ?? color;
}
