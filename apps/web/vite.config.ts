import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Folder whose PDFs the MVP library shows. Defaults to the repository's `test/` folder. */
const papersDir = path.resolve(here, process.env.PAPERS_DIR ?? "../../test");

/** Dependencies live in the Docker image above the bind-mounted repo (see /Dockerfile). */
function findNodeModules(start: string): string {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (fs.existsSync(path.join(candidate, "vite"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return path.join(start, "node_modules");
    dir = parent;
  }
}

interface PaperFile {
  file: string;
  size: number;
  mtime: string;
}

const MAX_PDF_BYTES = 200 * 1024 * 1024;

function listPapers(): PaperFile[] {
  if (!fs.existsSync(papersDir)) return [];
  return fs
    .readdirSync(papersDir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort()
    .flatMap((name) => {
      const stat = fs.statSync(path.join(papersDir, name));
      if (!stat.isFile() || stat.size > MAX_PDF_BYTES) return [];
      return [{ file: name, size: stat.size, mtime: stat.mtime.toISOString() }];
    });
}

/**
 * Serves the example papers at /papers/index.json and /papers/<file>.pdf in development, and
 * copies them into the build. This stands in for Google Drive until sync exists.
 */
function papersPlugin(): Plugin {
  return {
    name: "staxsync-papers",
    configureServer(server) {
      server.middlewares.use("/papers", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        if (urlPath === "/index.json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ version: 1, papers: listPapers() }));
          return;
        }
        // basename() keeps requests inside papersDir.
        const name = path.basename(urlPath);
        const known = listPapers().find((p) => p.file === name);
        if (!known) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(known.size));
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(path.join(papersDir, name)).pipe(res);
      });
    },
    generateBundle() {
      const papers = listPapers();
      for (const paper of papers) {
        this.emitFile({
          type: "asset",
          fileName: `papers/${paper.file}`,
          source: fs.readFileSync(path.join(papersDir, paper.file)),
        });
      }
      this.emitFile({
        type: "asset",
        fileName: "papers/index.json",
        source: JSON.stringify({ version: 1, papers }),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), papersPlugin()],
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  server: {
    fs: { allow: [here, findNodeModules(here), papersDir] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
