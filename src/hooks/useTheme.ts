import { useEffect } from "react";
import type { ThemeMode } from "../model";

/** Sync document `data-theme` with user preference and macOS system appearance. */
export function useTheme(mode: ThemeMode) {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        mode === "system" ? (query.matches ? "dark" : "light") : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (mode !== "system") return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [mode]);
}
