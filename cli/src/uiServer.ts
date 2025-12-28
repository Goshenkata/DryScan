import { createServer, Server } from "http";
import path from "path";
import { resolve, join } from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import { DuplicateGroup, DuplicationScore } from "@dryscan/core";

export interface UiServerOptions {
  port?: number;
  threshold: number;
  repoPath: string;
  duplicates: DuplicateGroup[];
  score: DuplicationScore;
}

const defaultPort = 3000;

const gradeMeta: Record<DuplicationScore["grade"], { emoji: string; className: string }> = {
  Excellent: { emoji: "🌟", className: "excellent" },
  Good: { emoji: "👍", className: "good" },
  Fair: { emoji: "⚠️", className: "fair" },
  Poor: { emoji: "🚨", className: "poor" },
  Critical: { emoji: "🔥", className: "critical" },
};

/**
 * Responsible for serving the interactive duplicates UI.
 */
export class DuplicateReportServer {
  private readonly port: number;
  private server?: Server;
  private readonly templatePromise: Promise<Handlebars.TemplateDelegate>;
  private readonly repoRoot: string;

  constructor(private readonly options: UiServerOptions) {
    this.port = options.port ?? defaultPort;
    this.templatePromise = loadTemplate();
    this.repoRoot = resolve(options.repoPath);
  }

  async start(): Promise<void> {
    const { threshold, duplicates, score } = this.options;
    const template = await this.templatePromise;

    this.server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (url.pathname === "/api/duplicates") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(duplicates));
        return;
      }

      if (url.pathname === "/api/file") {
        const relPathParam = url.searchParams.get("path");
        if (!relPathParam) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing path" }));
          return;
        }
        const sanitizedPath = relPathParam.replace(/^[/\\]+/, "");
        try {
          const fullPath = resolve(this.repoRoot, sanitizedPath);
          // Prevent escaping the repo folder
          if (!fullPath.startsWith(this.repoRoot + path.sep) && fullPath !== this.repoRoot) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid path" }));
            return;
          }
          const content = await readFile(fullPath, "utf8");
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ path: sanitizedPath, content }));
        } catch (err: any) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found", message: err?.message }));
        }
        return;
      }

        res.setHeader("content-type", "text/html; charset=utf-8");
        const html = template({
          thresholdPct: Math.round(threshold * 100),
          duplicatesJson: JSON.stringify(duplicates),
          score: buildScoreView(score),
        });
        res.end(html);
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Internal server error", message: err?.message }));
      }
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server!.on("error", rejectPromise);
      this.server!.on("listening", () => resolvePromise());
      this.server!.listen(this.port, () => {
        console.log(`\nUI available at http://localhost:${this.port}\n`);
      });
    });
  }
}

async function loadTemplate(): Promise<Handlebars.TemplateDelegate> {
  const templatePath = join(fileURLToPath(new URL(".", import.meta.url)), "templates", "report.hbs");
  const source = await readFile(templatePath, "utf8");
  return Handlebars.compile(source, { noEscape: true });
}

function buildScoreView(score: DuplicationScore) {
  const meta = gradeMeta[score.grade] ?? gradeMeta.Fair;
  return {
    ...score,
    gradeClass: meta.className,
    emoji: meta.emoji,
    scoreRounded: score.score.toFixed(1),
    totalLinesFormatted: score.totalLines.toLocaleString(),
    duplicateLinesFormatted: score.duplicateLines.toLocaleString(),
    duplicateGroupsFormatted: score.duplicateGroups.toLocaleString(),
  };
}
