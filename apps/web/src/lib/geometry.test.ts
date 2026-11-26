import { describe, expect, it } from "vitest";
import { boxToQuad, compareAnnotations, hitsAnnotation, mergeLineBoxes, type Box } from "./geometry";
import type { Annotation } from "./types";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

function annotation(fields: Partial<Annotation>): Annotation {
  return { id: "a", kind: "highlight", page: 0, comment: "", replies: [], input: "mouse", createdAt: "", updatedAt: "", ...fields };
}

describe("mergeLineBoxes", () => {
  it("joins the word boxes of one line into one box that covers them all", () => {
    const words = [box(10, 100, 40, 112), box(44, 100, 80, 112), box(84, 101, 120, 112)];
    const lines = mergeLineBoxes(words);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const w of words) {
      expect(line!.left).toBeLessThanOrEqual(w.left);
      expect(line!.right).toBeGreaterThanOrEqual(w.right);
    }
  });

  it("keeps separate lines separate, in reading order", () => {
    const lines = mergeLineBoxes([box(10, 130, 90, 142), box(10, 100, 90, 112)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.top).toBeLessThan(lines[1]!.top);
  });

  it("drops slivers and container-sized rects", () => {
    const lines = mergeLineBoxes([box(10, 100, 90, 112), box(10, 100, 10.2, 112), box(0, 0, 600, 800)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.bottom - lines[0]!.top).toBeLessThan(50);
  });

  it("does not join two columns on the same line", () => {
    expect(mergeLineBoxes([box(10, 100, 250, 112), box(320, 100, 560, 112)])).toHaveLength(2);
  });
});

describe("hit testing", () => {
  // A PDF page uses y up; this maps a 600×800 page-space box to PDF space.
  const toPdf = (x: number, y: number): [number, number] => [x, 800 - y];
  const quad = boxToQuad(box(100, 100, 200, 112), toPdf);

  it("finds a highlight under the point and misses points away from it", () => {
    const a = annotation({ quads: [quad] });
    expect(hitsAnnotation(a, [150, 694], 1)).toBe(true);
    expect(hitsAnnotation(a, [150, 600], 1)).toBe(false);
  });

  it("ink is hit near its stroke, within the tolerance", () => {
    const ink = annotation({ kind: "ink", strokes: [[[0, 0, 0.5], [100, 0, 0.5]]], width: 2 });
    expect(hitsAnnotation(ink, [50, 2], 2)).toBe(true);
    expect(hitsAnnotation(ink, [50, 20], 2)).toBe(false);
  });
});

describe("reading order", () => {
  it("orders by page, then from the top of the page down", () => {
    const top = annotation({ id: "top", kind: "area", rect: [10, 700, 50, 750] });
    const lower = annotation({ id: "lower", kind: "area", rect: [10, 100, 50, 150] });
    const nextPage = annotation({ id: "next", kind: "area", page: 1, rect: [10, 700, 50, 750] });
    const order = [nextPage, lower, top].sort(compareAnnotations).map((a) => a.id);
    expect(order).toEqual(["top", "lower", "next"]);
  });
});
