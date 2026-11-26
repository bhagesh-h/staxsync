/**
 * The command registry (todo.md §17.2): every user action is a command with one id. Toolbar
 * buttons, keyboard shortcuts and the ⌘K palette all dispatch through it.
 * Ids follow `<area>_<object>_<action>`.
 */

export interface Command {
  id: string;
  title: string;
  /** Shortcuts such as "h", "mod+z", "mod+shift+z", "escape". `mod` is ⌘ on Apple, Ctrl elsewhere. */
  keys?: string[];
  /** Runs even while typing in a text field (for example the palette shortcut). */
  global?: boolean;
  enabled?: () => boolean;
  run: () => void;
}

export const COMMAND_ID = /^[a-z]+_[a-z]+_[a-z]+$/;

export function normaliseKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // Shift is implied by the character for symbols like "?" or "+".
  if (e.shiftKey && (e.key.length !== 1 || /[a-z]/i.test(e.key))) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<() => void>();

  register(list: Command[]): () => void {
    for (const c of list) {
      if (!COMMAND_ID.test(c.id)) throw new Error(`Command id "${c.id}" must be <area>_<object>_<action>`);
      this.commands.set(c.id, c);
    }
    this.emit();
    return () => {
      for (const c of list) if (this.commands.get(c.id) === c) this.commands.delete(c.id);
      this.emit();
    };
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  run(id: string): boolean {
    const c = this.commands.get(id);
    if (!c || (c.enabled && !c.enabled())) return false;
    c.run();
    return true;
  }

  /** The command bound to a key event, honouring text-field focus. */
  forKey(e: KeyboardEvent): Command | undefined {
    const key = normaliseKey(e);
    const editing = isEditableTarget(e.target);
    for (const c of this.commands.values()) {
      if (!c.keys?.includes(key)) continue;
      if (editing && !c.global) continue;
      if (c.enabled && !c.enabled()) continue;
      return c;
    }
    return undefined;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export function formatKey(key: string): string {
  const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return key
    .split("+")
    .map((k) => (k === "mod" ? (apple ? "⌘" : "Ctrl") : k === "shift" ? "Shift" : k === "alt" ? (apple ? "⌥" : "Alt") : k.length === 1 ? k.toUpperCase() : k[0]?.toUpperCase() + k.slice(1)))
    .join(apple ? "" : "+");
}
