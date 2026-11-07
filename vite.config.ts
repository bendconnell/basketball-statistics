import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { uiPreviewPlugin } from "./dev/ui-preview-plugin.mjs";

export default defineConfig(({ mode, command }) => ({
  cacheDir: mode === "ui" ? "node_modules/.vite-ui" : "node_modules/.vite",
  plugins: [react(), ...(command === "serve" && mode === "ui" ? [uiPreviewPlugin()] : [])]
}));
