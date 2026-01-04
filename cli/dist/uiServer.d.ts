import type { DuplicateGroup, DuplicationScore } from "@goshenkata/dryscan-core";
export interface UiServerOptions {
    port?: number;
    threshold: number;
    repoPath: string;
    duplicates: DuplicateGroup[];
    score: DuplicationScore;
}
export interface HtmlRenderOptions {
    threshold: number;
    duplicates: DuplicateGroup[];
    score: DuplicationScore;
    enableExclusions: boolean;
}
/**
 * Responsible for serving the interactive duplicates UI.
 */
export declare class DuplicateReportServer {
    private readonly options;
    private readonly port;
    private server?;
    private readonly templatePromise;
    private readonly repoRoot;
    private state;
    private regenerating?;
    private readonly configReady;
    constructor(options: UiServerOptions);
    start(): Promise<void>;
    private regenerateReport;
}
/**
 * Renders the HTML report as a string without starting a server.
 */
export declare function renderHtmlReport(options: HtmlRenderOptions): Promise<string>;
//# sourceMappingURL=uiServer.d.ts.map