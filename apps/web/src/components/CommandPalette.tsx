import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app-context";
import { formatKey } from "../lib/commands";

/** ⌘K: every registered command, searchable. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { registry } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);

  const commands = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return registry
      .list()
      .filter((c) => !c.enabled || c.enabled())
      .filter((c) => words.every((w) => c.title.toLowerCase().includes(w)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [registry, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const back = returnFocus.current;
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  const run = (id: string) => {
    onClose();
    // Let the palette close (and focus return) before the command acts.
    requestAnimationFrame(() => registry.run(id));
  };

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette floating" role="dialog" aria-modal="true" aria-label="Commands">
        <input
          ref={inputRef}
          className="field"
          placeholder="Type a command"
          aria-label="Command"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, commands.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && commands[active]) run(commands[active].id);
          }}
        />
        <ul role="listbox" aria-label="Commands">
          {commands.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button className={`btn ${i === active ? "is-active" : ""}`} onClick={() => run(c.id)} onMouseEnter={() => setActive(i)}>
                <span>{c.title}</span>
                <span className="meta">{c.keys?.[0] ? formatKey(c.keys[0]) : ""}</span>
              </button>
            </li>
          ))}
          {commands.length === 0 && <li className="meta">No matching command</li>}
        </ul>
      </div>
    </>
  );
}
