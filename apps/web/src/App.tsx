import { useCallback, useEffect, useMemo, useState } from "react";
import { AppContext, type AppServices } from "./app-context";
import { CommandPalette } from "./components/CommandPalette";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { CommandRegistry } from "./lib/commands";
import { loadLibrary, loadPreference, saveLibrary, savePreference, type LibraryDoc } from "./lib/storage";

type Route = { name: "library" } | { name: "paper"; id: string };

function parseHash(): Route {
  const m = /^#\/paper\/([^/?#]+)/.exec(window.location.hash);
  return m?.[1] ? { name: "paper", id: decodeURIComponent(m[1]) } : { name: "library" };
}

function initialTheme(): "light" | "dark" {
  const saved = loadPreference("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const registry = useMemo(() => new CommandRegistry(), []);
  const [route, setRoute] = useState<Route>(parseHash);
  const [library, setLibraryState] = useState<LibraryDoc>(loadLibrary);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreference("theme", theme);
  }, [theme]);

  const setLibrary = useCallback((update: (doc: LibraryDoc) => LibraryDoc) => {
    setLibraryState((prev) => {
      const next = update(prev);
      if (next !== prev) saveLibrary(next);
      return next;
    });
  }, []);

  const announce = useCallback((text: string) => {
    // Clearing first makes screen readers repeat identical messages.
    setMessage("");
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  useEffect(
    () =>
      registry.register([
        { id: "app_palette_open", title: "Show all commands", keys: ["mod+k"], global: true, run: () => setPaletteOpen(true) },
        { id: "app_theme_toggle", title: "Switch light / dark theme", run: toggleTheme },
        { id: "app_library_open", title: "Go to library", run: () => (window.location.hash = "#/") },
      ]),
    [registry, toggleTheme],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const command = registry.forKey(e);
      if (command) {
        e.preventDefault();
        command.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);

  const services: AppServices = useMemo(() => ({ registry, announce, theme, toggleTheme }), [registry, announce, theme, toggleTheme]);
  const paper = route.name === "paper" ? library.papers[route.id] : undefined;

  return (
    <AppContext.Provider value={services}>
      {route.name === "paper" && paper ? (
        <Reader key={paper.id} paper={paper} setLibrary={setLibrary} />
      ) : (
        <Library library={library} setLibrary={setLibrary} missingPaper={route.name === "paper"} />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <div className="visually-hidden" aria-live="polite" role="status">
        {message}
      </div>
    </AppContext.Provider>
  );
}
