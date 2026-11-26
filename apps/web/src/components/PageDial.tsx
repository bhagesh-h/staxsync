import { useEffect, useRef, useState } from "react";

interface Props {
  page: number;
  count: number;
  label: (page: number) => string;
  onChange: (page: number) => void;
}

/** The dial turns through 300°, from −150° (first page) to +150° (last page). */
const SWEEP = 300;
/** Degrees of turning per page click, so short and long papers both feel like a dial. */
function detentFor(count: number): number {
  return Math.max(10, Math.min(36, SWEEP / Math.max(1, count - 1)));
}

function angleOf(e: { clientX: number; clientY: number }, el: Element): number {
  const r = el.getBoundingClientRect();
  return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
}

/**
 * Page dial in place of a scrollbar: turn it (drag around it, or scroll the wheel over it) and it
 * clicks one page at a time; the centre shows the page number. A click without turning opens
 * a field to jump to a page. Keyboard: arrows, Page Up/Down, Home/End, Enter.
 */
export function PageDial({ page, count, label, onChange }: Props) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jump, setJump] = useState("");
  const dialRef = useRef<HTMLDivElement>(null);
  const turn = useRef<{ pointerId: number; last: number; acc: number; turned: boolean; page: number } | null>(null);
  const jumpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (jumpOpen) {
      setJump(label(page - 1));
      requestAnimationFrame(() => jumpRef.current?.select());
    }
  }, [jumpOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: number) => {
    const next = Math.max(1, Math.min(count, p));
    if (next !== page) {
      onChange(next);
      // A short tick on devices that can vibrate, like the click of a dial.
      navigator.vibrate?.(4);
    }
    return next;
  };

  const ticks = Math.min(count, 48);
  const position = count > 1 ? (page - 1) / (count - 1) : 0;
  const pointer = -SWEEP / 2 + position * SWEEP; // degrees, 0 = up

  return (
    <div className="dial-wrap">
      {jumpOpen && (
        <form
          className="dial-jump floating-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const labels = Array.from({ length: count }, (_, i) => label(i));
            const idx = labels.indexOf(jump.trim());
            go(idx >= 0 ? idx + 1 : Number(jump));
            setJumpOpen(false);
          }}
        >
          <label className="meta" htmlFor="dial-jump">
            Page
          </label>
          <input
            id="dial-jump"
            ref={jumpRef}
            className="field"
            inputMode="numeric"
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setJumpOpen(false))}
            onBlur={() => setJumpOpen(false)}
            style={{ width: "6ch" }}
          />
        </form>
      )}
      <div
        ref={dialRef}
        className="dial"
        role="slider"
        tabIndex={0}
        aria-label="Page"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={page}
        aria-valuetext={`Page ${label(page - 1)} of ${count}`}
        title="Turn to change page, click to jump"
        data-testid="page-dial"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Turning still works without capture.
          }
          turn.current = { pointerId: e.pointerId, last: angleOf(e, e.currentTarget), acc: 0, turned: false, page };
        }}
        onPointerMove={(e) => {
          const t = turn.current;
          if (!t || t.pointerId !== e.pointerId) return;
          const a = angleOf(e, e.currentTarget);
          let delta = a - t.last;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          t.last = a;
          t.acc += delta;
          const detent = detentFor(count);
          while (Math.abs(t.acc) >= detent) {
            const dir = t.acc > 0 ? 1 : -1;
            t.acc -= dir * detent;
            t.turned = true;
            t.page = go(t.page + dir);
          }
        }}
        onPointerUp={(e) => {
          const t = turn.current;
          turn.current = null;
          if (t && t.pointerId === e.pointerId && !t.turned) setJumpOpen((o) => !o);
        }}
        onPointerCancel={() => {
          turn.current = null;
        }}
        onWheel={(e) => {
          e.preventDefault();
          if (Math.abs(e.deltaY) > 0.5) go(page + (e.deltaY > 0 ? 1 : -1));
        }}
        onKeyDown={(e) => {
          const step: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
          if (e.key in step) {
            e.preventDefault();
            go(page + (step[e.key] ?? 0));
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            go(e.key === "Home" ? 1 : count);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setJumpOpen(true);
          }
        }}
      >
        <svg viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="46" className="dial-face" />
          {Array.from({ length: ticks }, (_, i) => {
            const a = ((-SWEEP / 2 + (ticks > 1 ? (i / (ticks - 1)) * SWEEP : 0)) * Math.PI) / 180;
            return <line key={i} x1={Math.sin(a) * 38} y1={-Math.cos(a) * 38} x2={Math.sin(a) * 44} y2={-Math.cos(a) * 44} className="dial-tick" />;
          })}
          <line x1={0} y1={-33} x2={0} y2={-45} className="dial-pointer" transform={`rotate(${pointer})`} />
        </svg>
        <span className="dial-page">{label(page - 1)}</span>
        <span className="dial-count meta" data-testid="page-count">
          of {count}
        </span>
      </div>
    </div>
  );
}
