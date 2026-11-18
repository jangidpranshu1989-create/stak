import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  root: import.meta.dirname,
  base: "./",
  build: { outDir: path.resolve(import.meta.dirname, "../public"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { "/api": "http://localhost:5000" } },
});
