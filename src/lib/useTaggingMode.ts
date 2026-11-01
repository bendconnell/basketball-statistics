import { useEffect, useState } from "react";

export type TaggingMode = "typing" | "buttons";

// A device preference shared by Configuration and capture, not a game mutation.
export function useTaggingMode() {
  const [mode, setMode] = useState<TaggingMode>(() => {
    try { return localStorage.getItem("bball-stats.tagging-mode.v1") === "buttons" ? "buttons" : "typing"; }
    catch { return "typing"; }
  });
  useEffect(() => {
    try { localStorage.setItem("bball-stats.tagging-mode.v1", mode); }
    catch { /* Capture remains available when device storage is unavailable. */ }
  }, [mode]);
  return [mode, setMode] as const;
}