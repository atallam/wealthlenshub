import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  // Vitest reads this block. The first test in a file cold-imports the whole
  // service graph (slow on OneDrive), so 5s is too tight; the env stubs let tests
  // that import the real lib/db.js build a client without a .env (locally and in CI).
  test: {
    testTimeout: 20000,
    env: { SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_KEY: "test-service-key" },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) return "react-vendor";
            if (id.includes("@supabase")) return "supabase";
            if (id.includes("xlsx") || id.includes("papaparse") || id.includes("pdf-parse") || id.includes("pdfjs")) return "parsers";
            return "vendor";
          }
        },
      },
    },
  },
});
