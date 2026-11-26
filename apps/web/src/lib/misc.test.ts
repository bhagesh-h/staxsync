import { describe, expect, it } from "vitest";
import { COMMAND_ID, CommandRegistry, normaliseKey } from "./commands";
import { History } from "./history";
import { annotationsToMarkdown } from "./markdown";
import type { Annotation } from "./types";
import { readVersioned } from "./versioned";

describe("history", () => {
  it("undo returns the earlier state and redo brings the change back", () => {
    const h = new History<number[]>();
    h.record([]);
    const undone = h.undo([1]);
    expect(undone).toEqual([]);
    expect(h.redo(undone!)).toEqual([1]);
  });

  it("a new change after undo clears redo", () => {
    const h = new History<number>();
    h.record(0);
    h.undo(1);
    h.record(0);
    expect(h.canRedo).toBe(false);
  });
});

describe("versioned documents", () => {
  const isDoc = (d: unknown): d is { version: 2; name: string } => (d as { name?: unknown }).name !== undefined;

  it("brings an older document forward through each migration", () => {
    const result = readVersioned(JSON.stringify({ version: 1, title: "x" }), 2, { 1: ({ title, ...rest }) => ({ ...rest, name: title }) }, isDoc);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.value.name).toBe("x");
  });

  it("marks a document from a newer version instead of reading it", () => {
    expect(readVersioned(JSON.stringify({ version: 9, name: "x" }), 2, {}, isDoc).status).toBe("newer");
  });

  it("reports unreadable data instead of throwing", () => {
    expect(readVersioned("{not json", 1, {}, isDoc).status).toBe("invalid");
  });
});

describe("commands", () => {
  it("refuses ids outside the <area>_<object>_<action> scheme", () => {
    const r = new CommandRegistry();
    expect(() => r.register([{ id: "badId", title: "x", run: () => {} }])).toThrow();
    expect(COMMAND_ID.test("reader_selection_highlight")).toBe(true);
  });

  it("treats Ctrl and ⌘ alike and keeps shift for letters", () => {
    expect(normaliseKey({ key: "z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      normaliseKey({ key: "z", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }),
    );
    expect(normaliseKey({ key: "Z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toContain("shift");
  });
});

describe("markdown export", () => {
  it("lists annotations in reading order with quotes and comments", () => {
    const base = { comment: "", replies: [], input: "mouse" as const, createdAt: "", updatedAt: "" };
    const later: Annotation = { ...base, id: "2", kind: "underline", page: 3, quads: [[0, 10, 5, 10, 0, 0, 5, 0]], anchor: { exact: "second", prefix: "", suffix: "" } };
    const first: Annotation = { ...base, id: "1", kind: "highlight", page: 0, quads: [[0, 10, 5, 10, 0, 0, 5, 0]], anchor: { exact: "first", prefix: "", suffix: "" }, comment: "why" };
    const md = annotationsToMarkdown(undefined, "paper", [later, first], "");
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
    expect(md).toContain("> first");
    expect(md).toContain("why");
  });
});
