import { createContext, useContext, useEffect } from "react";
import type { Command, CommandRegistry } from "./lib/commands";

export interface AppServices {
  registry: CommandRegistry;
  /** Announces a change to screen readers (aria-live). */
  announce: (message: string) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  return ctx;
}

/** Registers commands while a component is mounted. `commands` should be memoised. */
export function useCommands(commands: Command[]): void {
  const { registry } = useApp();
  useEffect(() => registry.register(commands), [registry, commands]);
}
