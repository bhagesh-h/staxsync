import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp, useCommands } from "../app-context";
import { colorLabel, DEFAULT_COLOR, HIGHLIGHT_COLORS, isHighlightColor, takesColor } from "../lib/colors";
import type { Command } from "../lib/commands";
import { annotationAnchorPoint, hitsAnnotation, normaliseRect, type Point } from "../lib/geometry";
import { History } from "../lib/history";
import { newId } from "../lib/ids";
import { annotationsToMarkdown, kindLabel } from "../lib/markdown";
import { loadPaper, loadPreference, savePaper, savePreference, type LibraryDoc } from "../lib/storage";
import type { Annotation, AnnotationKind, HighlightColor, InkPoint, InputKind, PaperRecord, ReadingPosition } from "../lib/types";
import { metaFromPdf } from "../pdf/metadata";
import { drawOverlay, type Preview } from "../pdf/overlay";
import { loadPdfjs, paperUrl } from "../pdf/pdfjs";
import { anchorForRange, caretAt, clientToPdf, pdfUnitsPerPixel, rangeBetween, rangeToQuads, snapToWords, type Caret, type PageRef } from "../pdf/selection";
import { AnnotationPopover } from "./AnnotationPopover";
import { AnnotationSidebar } from "./AnnotationSidebar";
import { CitePanel } from "./CitePanel";
import { PageDial } from "./PageDial";
import { ColorMenu } from "./ColorMenu";
import { OutlineTree, type OutlineNode } from "./OutlineTree";

type Tool = "select" | "highlight" | "underline" | "area" | "note" | "pen" | "eraser";

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "v" },
  { tool: "highlight", label: "Highlight", key: "h" },
  { tool: "underline", label: "Underline", key: "u" },
  { tool: "area", label: "Area", key: "a" },
  { tool: "note", label: "Note", key: "n" },
  { tool: "pen", label: "Pen", key: "p" },
  { tool: "eraser", label: "Eraser", key: "e" },
];

const INK_WIDTH = 1.6;
/** Height of the selection menu's colour row, used to keep the menu above the selected text. */
const SEL_ROW = 41;
const FREEHAND_WIDTH = 12;
/** pdf.js FindState values. */
const FIND_NOT_FOUND = 1;

type Gesture =
  | { type: "area"; pointerId: number; page: PageRef; start: Point; end: Point; input: InputKind }
  | { type: "ink"; pointerId: number; page: PageRef; points: InkPoint[]; input: InputKind; freehand: boolean }
  | { type: "erase"; pointerId: number; page: PageRef; before: Annotation[]; removed: number }
  | { type: "snap"; pointerId: number; page: PageRef; start: Caret; markup: "highlight" | "underline"; range: Range | null }
  | { type: "tap"; pointerId: number; page: PageRef; x: number; y: number; moved: boolean; input: InputKind; pointerType: string };

interface Props {
  paper: PaperRecord;
  setLibrary: (update: (doc: LibraryDoc) => LibraryDoc) => void;
}

function inputOf(e: PointerEvent): InputKind {
  return e.pointerType === "pen" ? "stylus" : e.pointerType === "touch" ? "touch" : "mouse";
}

/** Canvas budget by device, so phones and tablets don't run out of canvas memory. */
function maxCanvasPixels(): number {
  const small = Math.min(window.screen.width, window.screen.height) < 700;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return small ? 4_194_304 : coarse ? 8_388_608 : 16_777_216;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Reader({ paper, setLibrary }: Props) {
  const { announce, theme, toggleTheme } = useApp();
  const initial = useMemo(() => loadPaper(paper.id), [paper.id]);
  const title = paper.meta?.title ?? paper.file;

  const [annotations, setAnnotationsState] = useState<Annotation[]>(initial.annotations);
  const [note, setNoteState] = useState(initial.note);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [tool, setToolState] = useState<Tool>("select");
  const [color, setColorState] = useState<HighlightColor>(() => {
    const saved = loadPreference("highlightColor");
    return isHighlightColor(saved) ? saved : DEFAULT_COLOR;
  });
  const [fingerDraws, setFingerDraws] = useState(() => loadPreference("fingerDraws") === "1");
  const [hasStylus, setHasStylus] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [citeOpen, setCiteOpen] = useState(false);
  const [scalePct, setScalePct] = useState(100);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"annotations" | "note">("annotations");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findInfo, setFindInfo] = useState("");
  const [readMode, setReadMode] = useState(false);
  const [twoUp, setTwoUp] = useState(false);
  const [invert, setInvert] = useState(() => loadPreference("invertPages") === "1");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null);
  const [selColorsOpen, setSelColorsOpen] = useState(false);
  const [toolColorsAt, setToolColorsAt] = useState<{ x: number; y: number } | null>(null);
  const [popover, setPopover] = useState<{ id: string; x: number; y: number; focus: boolean } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [, setHistoryTick] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const selMenuRef = useRef<HTMLDivElement>(null);
  const viewerDivRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const labelsRef = useRef<string[] | null>(null);
  const annRef = useRef(annotations);
  const noteRef = useRef(note);
  const selectedRef = useRef<string | null>(null);
  const toolRef = useRef<Tool>("select");
  const colorRef = useRef<HighlightColor>(color);
  const fingerDrawsRef = useRef(fingerDraws);
  const positionRef = useRef<ReadingPosition | undefined>(initial.position);
  const historyRef = useRef(new History<Annotation[]>());
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<{ page: number; preview: Preview } | null>(null);
  const blockTouchRef = useRef(false);
  const lastInputRef = useRef<InputKind>("mouse");
  const savedRangeRef = useRef<Range | null>(null);
  const persistTimer = useRef<number | undefined>(undefined);

  fingerDrawsRef.current = fingerDraws;

  // ---- persistence ------------------------------------------------------------------

  const persist = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    const ok = savePaper({ version: 1, paperId: paper.id, annotations: annRef.current, note: noteRef.current, position: positionRef.current });
    setSaveFailed(!ok);
  }, [paper.id]);

  const schedulePersist = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(persist, 300);
  }, [persist]);

  useEffect(() => {
    const flush = () => persist();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      persist();
    };
  }, [persist]);

  useEffect(() => {
    document.title = `${title} · StaxSync`;
    setLibrary((doc) => {
      const p = doc.papers[paper.id];
      if (!p) return doc;
      return { ...doc, papers: { ...doc.papers, [p.id]: { ...p, lastOpenedAt: new Date().toISOString(), status: p.status === "unread" ? "reading" : p.status } } };
    });
    return () => {
      document.title = "StaxSync";
    };
  }, [paper.id, title, setLibrary]);

  // ---- page access and drawing ------------------------------------------------------

  const pageRef = (index: number): PageRef | null => {
    const pv = pdfViewerRef.current?.getPageView(index) as { div?: HTMLElement; viewport?: { clone(o: { scale: number }): PageRef["vp"] } } | undefined;
    if (!pv?.div || !pv.viewport) return null;
    return { index, div: pv.div, vp: pv.viewport.clone({ scale: 1 }) };
  };

  const pageFromElement = (el: Element | null): PageRef | null => {
    const div = el?.closest?.(".page") as HTMLElement | null;
    const n = Number(div?.dataset.pageNumber);
    return Number.isFinite(n) && n > 0 ? pageRef(n - 1) : null;
  };

  const allPages = (): PageRef[] => {
    const count = pdfViewerRef.current?.pagesCount ?? 0;
    const pages: PageRef[] = [];
    for (let i = 0; i < count; i++) {
      const p = pageRef(i);
      if (p) pages.push(p);
    }
    return pages;
  };

  const drawPage = (index: number) => {
    const p = pageRef(index);
    if (!p) return;
    const preview = previewRef.current?.page === index ? previewRef.current.preview : undefined;
    drawOverlay(
      p.div,
      p.vp,
      annRef.current.filter((a) => a.page === index),
      selectedRef.current,
      preview,
    );
  };

  const drawAll = () => {
    const count = pdfViewerRef.current?.pagesCount ?? 0;
    for (let i = 0; i < count; i++) drawPage(i);
  };

  const pageLabel = useCallback((index: number) => labelsRef.current?.[index] ?? String(index + 1), []);

  // ---- annotation state (every change is one undo step) -----------------------------

  const setLive = (next: Annotation[]) => {
    annRef.current = next;
    setAnnotationsState(next);
    schedulePersist();
  };

  const commit = (next: Annotation[], before: Annotation[] = annRef.current) => {
    historyRef.current.record(before);
    setLive(next);
    setHistoryTick((t) => t + 1);
  };

  const setSelected = (id: string | null) => {
    selectedRef.current = id;
    setSelectedIdState(id);
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    const now = new Date().toISOString();
    commit(annRef.current.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now } : a)));
  };

  const deleteAnnotation = (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a) return;
    commit(annRef.current.filter((x) => x.id !== id));
    if (selectedRef.current === id) setSelected(null);
    setPopover((p) => (p?.id === id ? null : p));
    announce(`${kindLabel(a.kind)} deleted`);
  };

  const addAnnotations = (list: Annotation[]) => {
    if (list.length === 0) return;
    commit([...annRef.current, ...list]);
    const first = list[0] as Annotation;
    announce(`${kindLabel(first.kind)} added on page ${pageLabel(first.page)}`);
  };

  const makeAnnotation = (kind: AnnotationKind, page: number, input: InputKind, fields: Partial<Annotation>): Annotation => {
    const now = new Date().toISOString();
    const base: Annotation = { id: newId("a"), kind, page, comment: "", replies: [], input, createdAt: now, updatedAt: now };
    if (takesColor(kind)) base.color = colorRef.current;
    return { ...base, ...fields };
  };

  const createFromRange = (range: Range, kind: "highlight" | "underline", input: InputKind, pick?: HighlightColor): Annotation[] => {
    const byPage = rangeToQuads(range, allPages());
    if (byPage.size === 0) {
      announce("Couldn't find text in that selection");
      return [];
    }
    const anchor = anchorForRange(range);
    const list = [...byPage].map(([page, quads]) => makeAnnotation(kind, page, input, kind === "highlight" ? { quads, anchor, color: pick ?? colorRef.current } : { quads, anchor }));
    addAnnotations(list);
    return list;
  };

  const currentSelectionRange = (): Range | null => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (viewerDivRef.current?.contains(r.commonAncestorContainer)) return r;
    }
    return savedRangeRef.current;
  };

  const createFromSelection = (kind: "highlight" | "underline", pick?: HighlightColor): Annotation[] => {
    const range = currentSelectionRange();
    if (!range || range.collapsed) return [];
    const list = createFromRange(range, kind, lastInputRef.current, pick);
    window.getSelection()?.removeAllRanges();
    savedRangeRef.current = null;
    setSelMenu(null);
    return list;
  };

  const openPopover = (id: string, focus = false, x?: number, y?: number) => {
    if (x !== undefined && y !== undefined) {
      setPopover({ id, x, y: y + 12, focus });
      return;
    }
    requestAnimationFrame(() => {
      const el = viewerDivRef.current?.querySelector(`[data-annotation-id="${id}"]`);
      const r = el?.getBoundingClientRect();
      setPopover({ id, x: r ? r.left : window.innerWidth / 2 - 170, y: r ? r.bottom + 8 : 120, focus });
    });
  };

  const commentOnSelection = () => {
    const list = createFromSelection("highlight");
    if (list[0]) openPopover(list[0].id, true);
  };

  const undo = () => {
    const prev = historyRef.current.undo(annRef.current);
    if (!prev) return;
    setLive(prev);
    setHistoryTick((t) => t + 1);
    if (selectedRef.current && !prev.some((a) => a.id === selectedRef.current)) setSelected(null);
    announce("Undone");
  };

  const redo = () => {
    const next = historyRef.current.redo(annRef.current);
    if (!next) return;
    setLive(next);
    setHistoryTick((t) => t + 1);
    announce("Redone");
  };

  const setColor = (c: HighlightColor) => {
    colorRef.current = c;
    setColorState(c);
    savePreference("highlightColor", c);
  };

  /** Number keys / swatches: highlight the selection in that colour, or just pick the colour. */
  const pickColor = (c: HighlightColor) => {
    setColor(c);
    if (currentSelectionRange()) createFromSelection("highlight", c);
    else announce(`${colorLabel(c)} highlighter`);
  };

  const selectTool = (t: Tool) => {
    toolRef.current = t;
    setToolState(t);
    if (t !== "select") setSelMenu(null);
  };

  useEffect(() => {
    drawAll();
  }, [annotations, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pdf.js viewer ----------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void>; promise: Promise<PDFDocumentProxy> } | null = null;
    let resize: ResizeObserver | null = null;
    (async () => {
      try {
        const { lib, viewer: V } = await loadPdfjs();
        const container = scrollRef.current;
        const viewerDiv = viewerDivRef.current;
        if (cancelled || !container || !viewerDiv) return;
        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({ eventBus });
        const findController = new V.PDFFindController({ eventBus, linkService });
        const pdfViewer = new V.PDFViewer({
          container,
          viewer: viewerDiv,
          eventBus,
          linkService,
          findController,
          removePageBorders: true,
          textLayerMode: 1,
          annotationMode: lib.AnnotationMode.ENABLE,
          annotationEditorMode: lib.AnnotationEditorType.DISABLE,
          maxCanvasPixels: maxCanvasPixels(),
        });
        linkService.setViewer(pdfViewer);
        pdfViewerRef.current = pdfViewer;
        linkServiceRef.current = linkService;
        eventBusRef.current = eventBus;

        eventBus.on("pagesinit", () => {
          const pos = positionRef.current;
          pdfViewer.currentScaleValue = pos?.scale || "page-width";
          if (pos) {
            pdfViewer.scrollPageIntoView({ pageNumber: pos.page, destArray: [null, { name: "XYZ" }, pos.left, pos.top, null], allowNegativeOffset: true });
          }
          drawAll();
        });
        eventBus.on("pagerendered", (e: { pageNumber: number }) => drawPage(e.pageNumber - 1));
        eventBus.on("textlayerrendered", (e: { pageNumber: number }) => drawPage(e.pageNumber - 1));
        eventBus.on("pagechanging", (e: { pageNumber: number }) => {
          setPageNumber(e.pageNumber);
        });
        eventBus.on("scalechanging", (e: { scale: number }) => setScalePct(Math.round(e.scale * 100)));
        eventBus.on("updateviewarea", (e: { location?: { pageNumber: number; top: number; left: number } }) => {
          if (!e.location) return;
          positionRef.current = { page: e.location.pageNumber, top: e.location.top, left: e.location.left, scale: String(pdfViewer.currentScaleValue) };
          schedulePersist();
        });
        const showFind = (state: number | undefined, count?: { current: number; total: number }) => {
          if (count && count.total > 0) setFindInfo(`${count.current} of ${count.total}`);
          else if (state === FIND_NOT_FOUND) setFindInfo("No matches");
          else setFindInfo("");
        };
        eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => showFind(undefined, e.matchesCount));
        eventBus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) => showFind(e.state, e.matchesCount));

        task = lib.getDocument({ url: paperUrl(paper.file) });
        const doc = await task.promise;
        if (cancelled) return;
        pdfViewer.setDocument(doc);
        linkService.setDocument(doc, null);
        setNumPages(doc.numPages);
        setStatus("ready");
        void doc.getOutline().then((items) => !cancelled && setOutline((items as OutlineNode[] | null) ?? []));
        if (!paper.meta) {
          // Opened by link before the library read this paper's metadata: read it here.
          void (async () => {
            const { info } = await doc.getMetadata();
            const content = await (await doc.getPage(1)).getTextContent();
            const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
            const meta = metaFromPdf(info as Parameters<typeof metaFromPdf>[0], text, doc.numPages, paper.file.replace(/\.pdf$/i, ""));
            if (cancelled) return;
            setLibrary((d) => {
              const p = d.papers[paper.id];
              return p ? { ...d, papers: { ...d.papers, [p.id]: { ...p, meta, metaKey: `${p.file}:${p.size}` } } } : d;
            });
          })().catch(() => {});
        }
        void doc.getPageLabels().then((labels) => {
          if (cancelled || !labels) return;
          labelsRef.current = labels;
          pdfViewer.setPageLabels(labels);
        });

        // Keep "fit width"/"fit page" true when the window or panels change size.
        resize = new ResizeObserver(() => {
          const v = pdfViewerRef.current;
          if (!v) return;
          const value = String(v.currentScaleValue);
          if (value === "page-width" || value === "page-fit" || value === "auto") v.currentScaleValue = value;
          else v.update();
        });
        resize.observe(container);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      pdfViewerRef.current?.setDocument(null as unknown as PDFDocumentProxy);
      pdfViewerRef.current = null;
      void task?.destroy();
    };
  }, [paper.file]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer input: mouse, touch, stylus ------------------------------------------

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const eraseAt = (g: Extract<Gesture, { type: "erase" }>, e: PointerEvent) => {
      const p = clientToPdf(g.page, e.clientX, e.clientY);
      const tol = 8 * pdfUnitsPerPixel(g.page);
      const keep = annRef.current.filter((a) => a.page !== g.page.index || !hitsAnnotation(a, p, tol));
      if (keep.length !== annRef.current.length) {
        g.removed += annRef.current.length - keep.length;
        setLive(keep);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.pointerType === "pen") setHasStylus(true);
      const target = e.target as Element;
      if (target.closest?.(".annotationLayer a")) return;
      const page = pageFromElement(target);
      if (!page) return;
      const input = inputOf(e);
      lastInputRef.current = input;
      const t = toolRef.current;
      const mayDraw = e.pointerType !== "touch" || fingerDrawsRef.current;
      const start = clientToPdf(page, e.clientX, e.clientY);
      const take = () => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a convenience (keeps the stroke when leaving the page); drawing works without it.
        }
        blockTouchRef.current = true;
      };

      if ((t === "area" || t === "pen" || t === "eraser") && mayDraw) {
        take();
        if (t === "area") gestureRef.current = { type: "area", pointerId: e.pointerId, page, start, end: start, input };
        if (t === "pen") gestureRef.current = { type: "ink", pointerId: e.pointerId, page, points: [[start[0], start[1], e.pressure || 0.5]], input, freehand: false };
        if (t === "eraser") {
          const g: Gesture = { type: "erase", pointerId: e.pointerId, page, before: annRef.current, removed: 0 };
          gestureRef.current = g;
          eraseAt(g, e);
        }
        return;
      }
      if ((t === "highlight" || t === "underline") && e.pointerType === "pen") {
        take();
        const caret = caretAt(e.clientX, e.clientY);
        gestureRef.current = caret
          ? { type: "snap", pointerId: e.pointerId, page, start: caret, markup: t, range: null }
          : { type: "ink", pointerId: e.pointerId, page, points: [[start[0], start[1], e.pressure || 0.5]], input, freehand: true };
        return;
      }
      gestureRef.current = { type: "tap", pointerId: e.pointerId, page, x: e.clientX, y: e.clientY, moved: false, input, pointerType: e.pointerType };
    };

    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      switch (g.type) {
        case "area":
          g.end = clientToPdf(g.page, e.clientX, e.clientY);
          previewRef.current = { page: g.page.index, preview: { kind: "area", rect: normaliseRect(g.start, g.end) } };
          drawPage(g.page.index);
          break;
        case "ink": {
          const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
          for (const ev of events.length ? events : [e]) {
            const p = clientToPdf(g.page, ev.clientX, ev.clientY);
            g.points.push([p[0], p[1], ev.pressure || 0.5]);
          }
          previewRef.current = { page: g.page.index, preview: { kind: "ink", points: g.points, width: g.freehand ? FREEHAND_WIDTH : INK_WIDTH, freehand: g.freehand, color: colorRef.current } };
          drawPage(g.page.index);
          break;
        }
        case "erase":
          eraseAt(g, e);
          break;
        case "snap": {
          const caret = caretAt(e.clientX, e.clientY);
          if (!caret) break;
          g.range = snapToWords(rangeBetween(g.start, caret));
          const quads = rangeToQuads(g.range, [g.page]).get(g.page.index) ?? [];
          previewRef.current = { page: g.page.index, preview: { kind: "quads", markup: g.markup, quads, color: colorRef.current } };
          drawPage(g.page.index);
          break;
        }
        case "tap":
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) g.moved = true;
          break;
      }
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      gestureRef.current = null;
      blockTouchRef.current = false;
      const hadPreview = previewRef.current?.page;
      previewRef.current = null;
      if (cancelled) {
        if (g.type === "erase" && g.removed > 0) setLive(g.before);
        if (hadPreview !== undefined) drawPage(hadPreview);
        return;
      }
      switch (g.type) {
        case "area": {
          const rect = normaliseRect(g.start, g.end);
          if (rect[2] - rect[0] > 3 && rect[3] - rect[1] > 3) addAnnotations([makeAnnotation("area", g.page.index, g.input, { rect })]);
          else drawPage(g.page.index);
          break;
        }
        case "ink":
          if (g.points.length > 0) {
            addAnnotations([
              makeAnnotation(g.freehand ? "freehandHighlight" : "ink", g.page.index, g.input, { strokes: [g.points], width: g.freehand ? FREEHAND_WIDTH : INK_WIDTH }),
            ]);
          }
          break;
        case "erase":
          if (g.removed > 0) {
            historyRef.current.record(g.before);
            setHistoryTick((t) => t + 1);
            announce(`Erased ${g.removed} annotation${g.removed === 1 ? "" : "s"}`);
          }
          break;
        case "snap":
          if (g.range && !g.range.collapsed) createFromRange(g.range, g.markup, "stylus");
          else drawPage(g.page.index);
          break;
        case "tap": {
          const t = toolRef.current;
          const sel = window.getSelection();
          const hasSelection = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && !!viewerDivRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer);
          if (hasSelection) {
            // With the Highlight/Underline tool, a mouse selection is marked at once.
            if ((t === "highlight" || t === "underline") && g.pointerType === "mouse") createFromSelection(t);
            else updateSelectionMenu();
            break;
          }
          if (g.moved) break;
          const p = clientToPdf(g.page, e.clientX, e.clientY);
          if (t === "note") {
            const a = makeAnnotation("note", g.page.index, g.input, { at: [p[0] - 2, p[1] + 2] });
            addAnnotations([a]);
            openPopover(a.id, true);
            break;
          }
          const tol = 6 * pdfUnitsPerPixel(g.page);
          const hit = [...annRef.current].reverse().find((a) => a.page === g.page.index && hitsAnnotation(a, p, tol));
          if (hit) {
            setSelected(hit.id);
            openPopover(hit.id, false, e.clientX, e.clientY);
          } else {
            setSelected(null);
            setPopover(null);
          }
          break;
        }
      }
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);
    // pointerdown fires before touchstart, so a stylus stroke can stop the page from scrolling.
    const onTouch = (e: TouchEvent) => {
      if (blockTouchRef.current) e.preventDefault();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchstart", onTouch, { passive: false });
    el.addEventListener("touchmove", onTouch, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchstart", onTouch);
      el.removeEventListener("touchmove", onTouch);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection menu ---------------------------------------------------------------

  function updateSelectionMenu() {
    if (toolRef.current !== "select" && lastInputRef.current === "mouse") {
      setSelMenu(null);
      return;
    }
    const g = gestureRef.current;
    if (g?.type === "tap" && g.pointerType === "mouse") return; // still dragging
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!viewerDivRef.current?.contains(range.commonAncestorContainer)) {
      setSelMenu(null);
      return;
    }
    savedRangeRef.current = range.cloneRange();
    const r = range.getBoundingClientRect();
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const width = 300;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    // Below the text on touch screens, so the browser's own selection menu stays visible.
    const y = coarse ? Math.min(r.bottom + 12, window.innerHeight - 56) : Math.max(8, r.top - 48);
    setSelMenu({ x, y });
  }

  useEffect(() => {
    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setSelMenu(null);
          return;
        }
        if (lastInputRef.current !== "mouse") updateSelectionMenu();
      });
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- navigation, zoom, find -------------------------------------------------------

  const goToPage = (n: number) => {
    const v = pdfViewerRef.current;
    if (!v || !Number.isFinite(n)) return;
    v.currentPageNumber = Math.max(1, Math.min(v.pagesCount, Math.round(n)));
  };

  /** W/S and the up/down arrows: scroll a quarter of the view (instantly, no animation). */
  const scrollBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (el) el.scrollTop += direction * Math.round(el.clientHeight * 0.25);
  };

  /** A/D and the left/right arrows: previous/next page. */
  const stepPage = (direction: 1 | -1) => {
    const v = pdfViewerRef.current;
    if (v) goToPage(v.currentPageNumber + direction);
  };

  const zoomIn = () => pdfViewerRef.current?.increaseScale();
  const zoomOut = () => pdfViewerRef.current?.decreaseScale();
  const fitWidth = () => {
    if (pdfViewerRef.current) pdfViewerRef.current.currentScaleValue = "page-width";
  };

  const dispatchFind = (query: string, again: boolean, previous = false) => {
    eventBusRef.current?.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };

  const openFind = () => {
    setFindOpen(true);
    setReadMode(false);
    requestAnimationFrame(() => findInputRef.current?.select());
  };

  const closeFind = () => {
    setFindOpen(false);
    eventBusRef.current?.dispatch("findbarclose", { source: null });
    setFindInfo("");
  };

  const jumpTo = (a: Annotation) => {
    const [x, y] = annotationAnchorPoint(a);
    pdfViewerRef.current?.scrollPageIntoView({ pageNumber: a.page + 1, destArray: [null, { name: "XYZ" }, Math.max(0, x - 24), y + 48, null], allowNegativeOffset: true });
    setSelected(a.id);
  };

  const exportMarkdown = () => {
    const md = annotationsToMarkdown(paper.meta, paper.file, annRef.current, noteRef.current, pageLabel);
    download(`${paper.file.replace(/\.pdf$/i, "")}-annotations.md`, md, "text/markdown");
    announce("Markdown exported");
  };

  const setNote = (value: string) => {
    noteRef.current = value;
    setNoteState(value);
    schedulePersist();
  };

  const dismiss = () => {
    if (citeOpen) return setCiteOpen(false);
    if (popover) return setPopover(null);
    if (toolColorsAt) return setToolColorsAt(null);
    if (selMenu) return setSelMenu(null);
    if (menuOpen) return setMenuOpen(false);
    if (findOpen) return closeFind();
    if (readMode) return setReadMode(false);
    if (selectedRef.current) return setSelected(null);
    if (toolRef.current !== "select") selectTool("select");
  };

  const hasSelection = () => !!currentSelectionRange();

  /** Opens/closes the selection menu's colour row. Above the text (mouse), the menu grows upwards so the row never covers the selection. */
  const showSelColors = (open: boolean) => {
    if (open === selColorsOpen) return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      setSelMenu((m) => m && { ...m, y: Math.max(8, m.y + (open ? -SEL_ROW : SEL_ROW)) });
    }
    setSelColorsOpen(open);
  };

  // ---- commands ---------------------------------------------------------------------

  const actions = useRef({ createFromSelection, commentOnSelection, selectTool, pickColor, undo, redo, openFind, zoomIn, zoomOut, fitWidth, exportMarkdown, dismiss, deleteAnnotation, hasSelection, scrollBy, stepPage });
  actions.current = { createFromSelection, commentOnSelection, selectTool, pickColor, undo, redo, openFind, zoomIn, zoomOut, fitWidth, exportMarkdown, dismiss, deleteAnnotation, hasSelection, scrollBy, stepPage };

  const commands: Command[] = useMemo(() => {
    const act = () => actions.current;
    return [
      { id: "reader_selection_highlight", title: "Highlight selection (or Highlight tool)", keys: ["h"], run: () => (act().hasSelection() ? act().createFromSelection("highlight") : act().selectTool("highlight")) },
      { id: "reader_selection_underline", title: "Underline selection (or Underline tool)", keys: ["u"], run: () => (act().hasSelection() ? act().createFromSelection("underline") : act().selectTool("underline")) },
      { id: "reader_selection_comment", title: "Comment on selection", keys: ["c"], run: () => act().commentOnSelection() },
      ...HIGHLIGHT_COLORS.map((c) => ({
        id: `reader_color_${c.color}`,
        title: `${c.label} highlight (selection or next highlight)`,
        keys: [c.key],
        run: () => act().pickColor(c.color),
      })),
      { id: "reader_tool_select", title: "Select tool", keys: ["v"], run: () => act().selectTool("select") },
      { id: "reader_tool_area", title: "Area tool", keys: ["r"], run: () => act().selectTool("area") },
      { id: "reader_view_up", title: "Scroll up", keys: ["w", "arrowup"], run: () => act().scrollBy(-1) },
      { id: "reader_view_down", title: "Scroll down", keys: ["s", "arrowdown"], run: () => act().scrollBy(1) },
      { id: "reader_page_previous", title: "Previous page", keys: ["a", "arrowleft"], run: () => act().stepPage(-1) },
      { id: "reader_page_next", title: "Next page", keys: ["d", "arrowright"], run: () => act().stepPage(1) },
      { id: "reader_paper_cite", title: "Cite this paper", run: () => setCiteOpen(true) },
      { id: "reader_tool_note", title: "Note tool", keys: ["n"], run: () => act().selectTool("note") },
      { id: "reader_tool_pen", title: "Pen tool", keys: ["p"], run: () => act().selectTool("pen") },
      { id: "reader_tool_eraser", title: "Eraser tool", keys: ["e"], run: () => act().selectTool("eraser") },
      { id: "reader_history_undo", title: "Undo", keys: ["mod+z"], run: () => act().undo() },
      { id: "reader_history_redo", title: "Redo", keys: ["mod+shift+z", "mod+y"], run: () => act().redo() },
      { id: "reader_find_open", title: "Find in document", keys: ["mod+f"], global: true, run: () => act().openFind() },
      { id: "reader_mode_toggle", title: "Toggle read mode", keys: ["f"], run: () => setReadMode((r) => !r) },
      { id: "reader_zoom_in", title: "Zoom in", keys: ["+", "=", "mod+="], run: () => act().zoomIn() },
      { id: "reader_zoom_out", title: "Zoom out", keys: ["-", "mod+-"], run: () => act().zoomOut() },
      { id: "reader_zoom_fit", title: "Fit width", keys: ["0"], run: () => act().fitWidth() },
      { id: "reader_panel_annotations", title: "Show annotations", keys: ["l"], run: () => (setRightOpen((o) => !o), setRightTab("annotations")) },
      { id: "reader_panel_note", title: "Show paper note", run: () => (setRightOpen(true), setRightTab("note")) },
      { id: "reader_panel_outline", title: "Show outline", keys: ["o"], run: () => setLeftOpen((o) => !o) },
      { id: "reader_layout_twoup", title: "Toggle two-page layout", run: () => setTwoUp((t) => !t) },
      { id: "reader_annotations_export", title: "Export annotations as Markdown", run: () => act().exportMarkdown() },
      { id: "reader_annotation_delete", title: "Delete selected annotation", keys: ["delete", "backspace"], enabled: () => !!selectedRef.current, run: () => selectedRef.current && act().deleteAnnotation(selectedRef.current) },
      { id: "reader_overlay_dismiss", title: "Close or cancel", keys: ["escape"], run: () => act().dismiss() },
    ];
  }, []);
  useCommands(commands);

  useEffect(() => {
    const v = pdfViewerRef.current;
    if (v && status === "ready") v.spreadMode = twoUp ? 1 : 0;
  }, [twoUp, status]);

  useEffect(() => {
    if (!selMenu) setSelColorsOpen(false);
  }, [selMenu]);

  // Keep the selection menu inside the window, using its real width.
  useLayoutEffect(() => {
    const el = selMenuRef.current;
    if (!el || !selMenu) return;
    const maxLeft = window.innerWidth - el.offsetWidth - 8;
    if (selMenu.x > maxLeft) setSelMenu({ ...selMenu, x: Math.max(8, maxLeft) });
  }, [selMenu, selColorsOpen]);

  useEffect(() => savePreference("invertPages", invert ? "1" : "0"), [invert]);
  useEffect(() => savePreference("fingerDraws", fingerDraws ? "1" : "0"), [fingerDraws]);

  // ---- render -----------------------------------------------------------------------

  const popoverAnnotation = popover ? annotations.find((a) => a.id === popover.id) : undefined;
  const toolClass = tool === "area" || tool === "pen" || tool === "eraser" ? "tool-draw" : tool === "note" ? "tool-note" : "";
  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;
  const keepSelection = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  return (
    <div className={`reader ${invert ? "invert-pages" : ""}`}>
      {!readMode && (
        <>
          <header className="bar">
            <a className="btn btn-nav" href="#/" style={{ display: "inline-flex", alignItems: "center" }}>
              Library
            </a>
            <span className="reader-title" title={title}>
              {title}
            </span>
            {paper.meta?.doi && (
              <a className="doi reader-doi" href={`https://doi.org/${paper.meta.doi}`} target="_blank" rel="noopener noreferrer" data-testid="reader-doi">
                doi:{paper.meta.doi}
              </a>
            )}
            <span className="spacer" />
            <button className="btn btn-nav" onClick={zoomOut}>
              Zoom out
            </button>
            <span className="meta" style={{ minWidth: "4ch", textAlign: "center" }} aria-label="Zoom level">
              {scalePct}%
            </span>
            <button className="btn btn-nav" onClick={zoomIn}>
              Zoom in
            </button>
            <button className="btn btn-nav" onClick={fitWidth}>
              Fit width
            </button>
            <span className="sep" />
            <button className="btn btn-nav" aria-pressed={findOpen} onClick={() => (findOpen ? closeFind() : openFind())}>
              Find
            </button>
            <button className="btn btn-nav" aria-pressed={leftOpen} onClick={() => setLeftOpen((o) => !o)}>
              Outline
            </button>
            <button className="btn btn-nav" aria-pressed={rightOpen} onClick={() => setRightOpen((o) => !o)}>
              Notes {annotations.length > 0 ? annotations.length : ""}
            </button>
            <button className="btn btn-nav" aria-pressed={citeOpen} onClick={() => setCiteOpen(true)}>
              Cite
            </button>
            <button className="btn btn-nav" onClick={() => setReadMode(true)}>
              Read
            </button>
            <button className="btn btn-nav" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              More
            </button>
            {menuOpen && (
              <div className="menu floating" role="menu" onClick={() => setMenuOpen(false)}>
                <button className="btn" role="menuitemcheckbox" aria-checked={twoUp} onClick={() => setTwoUp((t) => !t)}>
                  Two pages side by side
                </button>
                <button className="btn" role="menuitem" onClick={toggleTheme}>
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </button>
                {theme === "dark" && (
                  <button className="btn" role="menuitemcheckbox" aria-checked={invert} onClick={() => setInvert((i) => !i)}>
                    Dark pages
                  </button>
                )}
                <button className="btn" role="menuitemcheckbox" aria-checked={fingerDraws} onClick={() => setFingerDraws((f) => !f)}>
                  Fingers draw (not only stylus)
                </button>
                <button className="btn" role="menuitem" onClick={exportMarkdown}>
                  Export annotations (Markdown)
                </button>
                <span className="meta" style={{ padding: "4px 8px" }}>
                  All commands: Ctrl or Cmd K
                </span>
              </div>
            )}
          </header>
          <div className="bar toolstrip" role="toolbar" aria-label="Annotation tools">
            {TOOLS.map((t) =>
              t.tool === "highlight" ? (
                <button
                  key={t.tool}
                  className="btn"
                  data-color-menu-toggle
                  aria-pressed={tool === "highlight"}
                  aria-haspopup="menu"
                  aria-expanded={!!toolColorsAt}
                  aria-label={`Highlight tool, ${colorLabel(color).toLowerCase()}`}
                  title="Highlight (H) · colours 1–4"
                  onClick={(e) => {
                    selectTool("highlight");
                    const r = e.currentTarget.getBoundingClientRect();
                    setToolColorsAt((open) => (open ? null : { x: r.left, y: r.bottom + 4 }));
                  }}
                >
                  <span className={`dot c-${color}`} aria-hidden="true" />
                  Highlight
                </button>
              ) : (
                <button key={t.tool} className="btn" aria-pressed={tool === t.tool} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => selectTool(t.tool)}>
                  {t.label}
                </button>
              ),
            )}
            <span className="sep" />
            <button className="btn" disabled={!canUndo} onClick={undo}>
              Undo
            </button>
            <button className="btn" disabled={!canRedo} onClick={redo}>
              Redo
            </button>
            {hasStylus && <span className="meta">Stylus: {fingerDraws ? "fingers draw too" : "fingers scroll"}</span>}
          </div>
          {findOpen && (
            <div className="bar findbar" role="search">
              <input
                ref={findInputRef}
                className="field"
                type="search"
                placeholder="Find in document"
                aria-label="Find in document"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  dispatchFind(e.target.value, false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") dispatchFind(findQuery, true, e.shiftKey);
                  if (e.key === "Escape") closeFind();
                }}
              />
              <span className="meta" data-testid="find-info" aria-live="polite">
                {findInfo}
              </span>
              <button className="btn" onClick={() => dispatchFind(findQuery, true, true)}>
                Previous
              </button>
              <button className="btn" onClick={() => dispatchFind(findQuery, true)}>
                Next
              </button>
              <button className="btn" onClick={closeFind}>
                Close
              </button>
            </div>
          )}
        </>
      )}

      <div className="reader-body">
        {leftOpen && !readMode && (
          <aside className="panel left" aria-label="Outline">
            <div className="bar">
              <strong>Outline</strong>
              <span className="spacer" />
              <button className="btn" onClick={() => setLeftOpen(false)}>
                Close
              </button>
            </div>
            <div className="panel-body">
              {outline === null && <p className="meta">Loading…</p>}
              {outline && outline.length === 0 && <p className="meta">This PDF has no outline.</p>}
              {outline && outline.length > 0 && (
                <OutlineTree
                  items={outline}
                  onPick={(n) => {
                    if (n.dest) void linkServiceRef.current?.goToDestination(n.dest as string);
                    if (window.innerWidth <= 720) setLeftOpen(false);
                  }}
                />
              )}
            </div>
          </aside>
        )}

        <div className="viewer-host">
          <div ref={scrollRef} className={`viewer-scroll ${toolClass}`} data-testid="viewer" data-tool={tool} aria-label="Document" tabIndex={-1}>
            <div ref={viewerDivRef} className="pdfViewer" />
          </div>
          {status === "ready" && numPages > 0 && <PageDial page={pageNumber} count={numPages} label={pageLabel} onChange={goToPage} />}
          {status === "loading" && <p className="status">Opening…</p>}
          {status === "error" && <p className="status">Couldn't open this PDF: {error}</p>}
          {readMode && (
            <>
              <button className="btn btn-nav read-mode-exit" onClick={() => setReadMode(false)}>
                Exit read mode
              </button>

            </>
          )}
        </div>

        {rightOpen && !readMode && (
          <AnnotationSidebar
            annotations={annotations}
            selectedId={selectedId}
            note={note}
            tab={rightTab}
            pageLabel={pageLabel}
            onTab={setRightTab}
            onSelect={(a) => {
              jumpTo(a);
              if (window.innerWidth <= 720) setRightOpen(false);
            }}
            onDelete={deleteAnnotation}
            onNote={setNote}
            onExport={exportMarkdown}
            onClose={() => setRightOpen(false)}
          />
        )}
      </div>

      {selMenu && (
        <div ref={selMenuRef} className="floating selection-menu" style={{ left: selMenu.x, top: selMenu.y }} role="toolbar" aria-label="Selected text" data-testid="selection-menu" onPointerDown={keepSelection} onMouseDown={keepSelection}>
          <button
            className="btn"
            data-color-menu-toggle
            aria-haspopup="menu"
            aria-expanded={selColorsOpen}
            onClick={() => showSelColors(!selColorsOpen)}
          >
            <span className={`dot c-${color}`} aria-hidden="true" />
            Highlight
          </button>
          <button className="btn" onClick={() => createFromSelection("underline")}>
            Underline
          </button>
          <button className="btn" onClick={commentOnSelection}>
            Comment
          </button>
          <button
            className="btn"
            onClick={() => {
              const text = currentSelectionRange()?.toString() ?? "";
              void navigator.clipboard?.writeText(text).then(
                () => announce("Copied"),
                () => announce("Copy isn't allowed here"),
              );
              setSelMenu(null);
            }}
          >
            Copy
          </button>
          {selColorsOpen && <ColorMenu value={color} keepSelection row onPick={pickColor} onClose={() => showSelColors(false)} />}
        </div>
      )}

      {toolColorsAt && !readMode && <ColorMenu value={color} at={toolColorsAt} onPick={setColor} onClose={() => setToolColorsAt(null)} />}

      {popover && popoverAnnotation && (
        <AnnotationPopover
          annotation={popoverAnnotation}
          x={popover.x}
          y={popover.y}
          autoFocus={popover.focus}
          pageLabel={pageLabel(popoverAnnotation.page)}
          onChange={(patch) => updateAnnotation(popoverAnnotation.id, patch)}
          onDelete={() => deleteAnnotation(popoverAnnotation.id)}
          onClose={() => setPopover(null)}
        />
      )}

      {citeOpen && <CitePanel papers={[paper]} mode="cite" onClose={() => setCiteOpen(false)} />}

      {saveFailed && (
        <div className="floating" role="alert" style={{ left: 8, bottom: 8, padding: 8 }}>
          Changes can't be saved in this browser (storage is blocked or full). Keep this tab open.
        </div>
      )}
    </div>
  );
}
