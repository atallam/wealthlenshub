import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
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
