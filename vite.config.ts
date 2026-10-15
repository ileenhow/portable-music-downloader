import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist", emptyOutDir: true, sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
        content: resolve(import.meta.dirname, "src/content/index.ts")
      },
      output: {
        entryFileNames: "assets/[name].js", chunkFileNames: "assets/[name].js",
        manualChunks: { source: [resolve(import.meta.dirname, "src/shared/source.ts"), resolve(import.meta.dirname, "src/shared/providers/index.ts")] },
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
