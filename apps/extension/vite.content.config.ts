import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/contentScript.ts"),
      output: {
        format: "iife",
        name: "PasswordWebDAVContentScript",
        entryFileNames: "assets/contentScript.js",
        inlineDynamicImports: true,
      },
    },
  },
});
