import { useEffect, useRef } from "react";
import { HIGHLIGHT_COLORS } from "../lib/colors";
import type { HighlightColor } from "../lib/types";

interface Props {
  value: HighlightColor;
  onPick: (color: HighlightColor) => void;
  onClose: () => void;
  /** Fixed position (viewport coordinates) of the menu's top-left corner; omit to flow inline. */
  at?: { x: number; y: number };
  /** Keep the text selection in the page while choosing (selection menu). */
  keepSelection?: boolean;
  /** One compact row instead of a list (inside the selection menu). */
  row?: boolean;
}

/** The highlight colour dropdown: shown only after Highlight is clicked. */
export function ColorMenu({ value, onPick, onClose, at, keepSelection, row }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!keepSelection) ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target) || target?.closest?.("[data-color-menu-toggle]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, keepSelection]);

  const keep = keepSelection ? (e: React.PointerEvent | React.MouseEvent) => e.preventDefault() : undefined;

  return (
    <div
      ref={ref}
      className={`color-menu ${at ? "floating" : ""} ${row ? "row" : ""}`}
      style={at ? { left: at.x, top: at.y } : undefined}
      role="menu"
      aria-label="Highlight colour"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        const next = row ? "ArrowRight" : "ArrowDown";
        const prev = row ? "ArrowLeft" : "ArrowUp";
        if (e.key === next || e.key === prev) {
          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(i + (e.key === next ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.color}
          type="button"
          className="btn color-option"
          role="menuitemradio"
          aria-checked={value === c.color}
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={() => {
            onPick(c.color);
            onClose();
          }}
        >
          <span className={`dot c-${c.color}`} aria-hidden="true" />
          {c.label}
          {!row && <span className="meta">{c.key}</span>}
        </button>
      ))}
    </div>
  );
}
