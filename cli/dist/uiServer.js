import { createServer } from "http";
import path from "path";
import { resolve, join } from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import { DryScan, configStore } from "@goshenkata/dryscan-core";
import { applyExclusionFromLatestReport, writeDuplicateReport } from "./reports.js";
const defaultPort = 3000;
const gradeMeta = {
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
    options;
    port;
    server;
    templatePromise;
    repoRoot;
    state;
    regenerating;
    configReady;
    constructor(options) {
        this.options = options;
        this.port = options.port ?? defaultPort;
        this.templatePromise = loadTemplate();
        this.repoRoot = resolve(options.repoPath);
        this.configReady = configStore.init(this.repoRoot);
        this.state = {
            duplicates: options.duplicates,
            score: options.score,
            threshold: options.threshold,
        };
    }
    async start() {
        const template = await this.templatePromise;
        this.server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url || "/", `http://${req.headers.host}`);
                if (url.pathname === "/api/duplicates") {
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify(this.state.duplicates));
                    return;
                }
                if (url.pathname === "/api/exclusions" && req.method === "POST") {
                    try {
                        const payload = await readJsonBody(req);
                        const id = payload?.id;
                        if (!id || typeof id !== "string") {
                            res.statusCode = 400;
                            res.end(JSON.stringify({ error: "Missing or invalid id" }));
                            return;
                        }
                        const result = await applyExclusionFromLatestReport(this.repoRoot, id);
                        await this.regenerateReport();
                        res.setHeader("content-type", "application/json");
                        res.end(JSON.stringify({
                            exclusion: result.exclusion,
                            status: result.added ? "added" : "already-present",
                        }));
                    }
                    catch (err) {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: err?.message || "Unable to apply exclusion" }));
                    }
                    return;
                }
                if (url.pathname === "/api/regenerate" && req.method === "POST") {
                    try {
                        await this.regenerateReport();
                        res.setHeader("content-type", "application/json");
                        res.end(JSON.stringify({ status: "ok" }));
                    }
                    catch (err) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: err?.message || "Unable to regenerate report" }));
                    }
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
                    }
                    catch (err) {
                        res.statusCode = 404;
                        res.end(JSON.stringify({ error: "Not found", message: err?.message }));
                    }
                    return;
                }
                res.setHeader("content-type", "text/html; charset=utf-8");
                const html = template({
                    thresholdPct: Math.round(this.state.threshold * 100),
                    duplicatesJson: JSON.stringify(this.state.duplicates),
                    score: buildScoreView(this.state.score),
                    enableExclusions: true,
                });
                res.end(html);
            }
            catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: "Internal server error", message: err?.message }));
            }
        });
        await new Promise((resolvePromise, rejectPromise) => {
            this.server.on("error", rejectPromise);
            this.server.on("listening", () => resolvePromise());
            this.server.listen(this.port, () => {
                console.log(`\nUI available at http://localhost:${this.port}\n`);
            });
        });
    }
    async regenerateReport() {
        if (this.regenerating) {
            return this.regenerating;
        }
        const run = async () => {
            await this.configReady;
            const scanner = new DryScan(this.repoRoot);
            const report = await scanner.buildDuplicateReport();
            await writeDuplicateReport(this.repoRoot, report);
            this.state = {
                duplicates: report.duplicates,
                score: report.score,
                threshold: report.threshold,
            };
        };
        this.regenerating = run();
        try {
            await this.regenerating;
        }
        finally {
            this.regenerating = undefined;
        }
    }
}
async function loadTemplate() {
    const templatePath = join(fileURLToPath(new URL(".", import.meta.url)), "templates", "report.hbs");
    const source = await readFile(templatePath, "utf8");
    return Handlebars.compile(source, { noEscape: true });
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch (_err) {
        throw new Error("Invalid JSON body");
    }
}
function buildScoreView(score) {
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
/**
 * Renders the HTML report as a string without starting a server.
 */
export async function renderHtmlReport(options) {
    const template = await loadTemplate();
    return template({
        thresholdPct: Math.round(options.threshold * 100),
        duplicatesJson: JSON.stringify(options.duplicates),
        score: buildScoreView(options.score),
        enableExclusions: options.enableExclusions,
    });
}
//# sourceMappingURL=uiServer.js.map