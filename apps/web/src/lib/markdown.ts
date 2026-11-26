import { colorLabel, colorOf } from "./colors";
import { compareAnnotations } from "./geometry";
import type { Annotation, PaperMeta } from "./types";

const KIND_LABEL: Record<Annotation["kind"], string> = {
  highlight: "Highlight",
  underline: "Underline",
  freehandHighlight: "Freehand highlight",
  area: "Area",
  ink: "Drawing",
  note: "Note",
};

export function kindLabel(kind: Annotation["kind"]): string {
  return KIND_LABEL[kind];
}

function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Annotations as Markdown: a citation header, then each annotation in reading order. */
export function annotationsToMarkdown(
  meta: Pick<PaperMeta, "title" | "authors" | "moreAuthors" | "year" | "journal" | "doi"> | undefined,
  fallbackTitle: string,
  annotations: Annotation[],
  note: string,
  pageLabel: (page: number) => string = (p) => String(p + 1),
): string {
  const lines: string[] = [`# ${meta?.title ?? fallbackTitle}`, ""];
  if (meta) {
    const authors = meta.authors.join(", ") + (meta.moreAuthors ? " et al." : "");
    const parts = [authors, meta.journal, meta.year ? String(meta.year) : undefined].filter(Boolean);
    if (parts.length) lines.push(parts.join(" · "));
    if (meta.doi) lines.push(`https://doi.org/${meta.doi}`);
    lines.push("");
  }
  if (note.trim()) lines.push("## Note", "", note.trim(), "");
  const sorted = [...annotations].sort(compareAnnotations);
  if (sorted.length) lines.push("## Annotations", "");
  for (const a of sorted) {
    const color = colorOf(a);
    lines.push(`### p. ${pageLabel(a.page)} · ${kindLabel(a.kind)}${color ? ` (${colorLabel(color).toLowerCase()})` : ""}`, "");
    if (a.anchor?.exact) lines.push(quoteBlock(a.anchor.exact), "");
    if (a.comment.trim()) lines.push(a.comment.trim(), "");
    for (const r of a.replies) lines.push(`- ${r.body.trim()}`);
    if (a.replies.length) lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
