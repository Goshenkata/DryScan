import * as vscode from "vscode";
import {
  DryScan,
  configStore,
  DryConfig,
  DuplicateGroup,
  DuplicateReport,
} from "@goshenkata/dryscan-core";
import { getPrimaryWorkspacePath } from "../utils/workspaceContext.js";
import { dryFolderExists } from "../utils/dryFolder.js";
import { DiagnosticsManager } from "../managers/DiagnosticsManager.js";
import { DecorationsManager } from "../managers/DecorationsManager.js";

export const DRYSCAN_VIEW_ID = "dryscanView";

type Dependencies = {
  getWorkspacePath: () => string | null;
  hasDryFolder: (repoPath: string) => Promise<boolean>;
  createDryScan: (repoPath: string) => DryScan;
  loadConfig: (repoPath: string) => Promise<DryConfig>;
  saveConfig: (repoPath: string, config: DryConfig) => Promise<void>;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  diagnosticsManager?: DiagnosticsManager;
  decorationsManager?: DecorationsManager;
};

export class DryScanTreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }
}

export class DryScanTreeProvider implements vscode.TreeDataProvider<DryScanTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    DryScanTreeItem | undefined | null | void
  >();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private currentRepoPath: string | null = null;
  private cachedReport: DuplicateReport | null = null;
  private reportPromise: Promise<DuplicateReport | null> | null = null;

  constructor(
    private readonly dependencies: Dependencies = {
      getWorkspacePath: getPrimaryWorkspacePath,
      hasDryFolder: dryFolderExists,
      createDryScan: (repoPath: string) => new DryScan(repoPath),
      loadConfig: (repoPath: string) => configStore.get(repoPath),
      saveConfig: (repoPath: string, config: DryConfig) => configStore.save(repoPath, config),
      showError: (message: string) => {
        void vscode.window.showErrorMessage(message);
      },
      showInfo: (message: string) => {
        void vscode.window.showInformationMessage(message);
      },
    }
  ) {}

  refresh(): void {
    this.clearCachedReport();
    this.onDidChangeTreeDataEmitter.fire();
    void this.updateManagers();
  }

  async getChildren(): Promise<DryScanTreeItem[]> {
    const workspacePath = this.dependencies.getWorkspacePath();

    if (!workspacePath) {
      return [this.createInfoItem("Open a workspace to use DryScan")];
    }

    const hasDryFolder = await this.dependencies.hasDryFolder(workspacePath);
    if (!hasDryFolder) {
      return [this.createInitializeItem(workspacePath)];
    }

    const report = await this.getOrBuildReport(workspacePath);

    if (!report) {
      return [this.createInfoItem("Unable to load DryScan report")];
    }

    return this.createReportItems(report);
  }

  getTreeItem(element: DryScanTreeItem): vscode.TreeItem {
    return element;
  }

  handlePairClick(group: DuplicateGroup | undefined): void {
    if (!group) {
      return;
    }

    void this.presentPairActions(group);
  }

  async handleExcludePair(group: DuplicateGroup | undefined): Promise<void> {
    if (!group) {
      return;
    }

    const repoPath = this.currentRepoPath ?? this.dependencies.getWorkspacePath();
    if (!repoPath) {
      this.dependencies.showError("Open a workspace to exclude a duplicate pair.");
      return;
    }

    try {
      const config = await this.dependencies.loadConfig(repoPath);

      if (!config.excludedPairs.includes(group.exclusionString)) {
        const updated: DryConfig = {
          ...config,
          excludedPairs: [...config.excludedPairs, group.exclusionString],
        };

        await this.dependencies.saveConfig(repoPath, updated);
      }

      this.removePairFromReport(group.id);
      this.refresh();
    } catch (error) {
      console.error("Failed to exclude duplicate pair", error);
      this.dependencies.showError("Failed to exclude duplicate pair. See console for details.");
    }
  }

  private createInitializeItem(repoPath: string): DryScanTreeItem {
    const item = new DryScanTreeItem(
      "Initialize DryScan",
      vscode.TreeItemCollapsibleState.None
    );

    item.tooltip = "Initialize DryScan to start detecting duplicates";
    item.command = {
      command: "dryscan.init",
      title: "Initialize DryScan",
      arguments: [repoPath],
    };
    item.iconPath = new vscode.ThemeIcon(
      "play-circle",
      new vscode.ThemeColor("charts.green")
    );
    item.contextValue = "dryscan.initialize";

    return item;
  }

  private createInfoItem(message: string): DryScanTreeItem {
    const item = new DryScanTreeItem(
      message,
      vscode.TreeItemCollapsibleState.None
    );

    item.tooltip = message;
    item.iconPath = new vscode.ThemeIcon("info");
    item.contextValue = "dryscan.info";

    return item;
  }

  private createReportItems(report: DuplicateReport): DryScanTreeItem[] {
    const items: DryScanTreeItem[] = [this.createSummaryItem(report)];

    if (report.duplicates.length === 0) {
      items.push(this.createInfoItem("No duplicate pairs found."));
      return items;
    }

    const pairs = report.duplicates.map((group) => this.createPairItem(group));
    return [...items, ...pairs];
  }

  private createSummaryItem(report: DuplicateReport): DryScanTreeItem {
    const score = report.score;
    const percent = score.score.toFixed(1);
    const label = `Duplication ${percent}% [${report.grade}]`;
    const description = `Pairs ${report.duplicates.length} | Lines ${score.duplicateLines}`;

    const item = new DryScanTreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;

    const tooltip = new vscode.MarkdownString(
      [
        `**Duplication score:** ${score.score.toFixed(2)}%`,
        `**Grade:** ${report.grade}`,
        `**Duplicate pairs:** ${report.duplicates.length}`,
        `**Lines affected:** ${score.duplicateLines}`,
      ].join("\n\n")
    );
    tooltip.isTrusted = true;
    item.tooltip = tooltip;

    const iconName = score.score >= 20 ? "flame" : "shield";
    const iconColor = new vscode.ThemeColor(score.score >= 20 ? "charts.red" : "charts.green");
    item.iconPath = new vscode.ThemeIcon(iconName, iconColor);
    item.contextValue = "dryscan.summary";

    return item;
  }

  private createPairItem(group: DuplicateGroup): DryScanTreeItem {
    const similarityPercent = (group.similarity * 100).toFixed(1);
    const label = `${group.left.name} ⇔ ${group.right.name}`;
    const description = `${similarityPercent}%`;
    const item = new DryScanTreeItem(label, vscode.TreeItemCollapsibleState.None);

    item.id = group.id;
    item.description = description;
    const tooltip = new vscode.MarkdownString(
      [
        `**Left:** ${this.formatLocation(group.left)}`,
        `**Right:** ${this.formatLocation(group.right)}`,
        `**Similarity:** ${similarityPercent}%`,
        `**Exclusion key:** ${group.exclusionString}`,
      ].join("\n\n")
    );
    tooltip.isTrusted = true;
    item.tooltip = tooltip;
    item.command = {
      command: "dryscan.openPair",
      title: "Open Duplicate Pair",
      arguments: [group],
    };
    item.iconPath = new vscode.ThemeIcon("link", new vscode.ThemeColor("charts.blue"));
    item.contextValue = "dryscan.duplicatePair";

    return item;
  }

  private formatLocation(side: DuplicateGroup["left"]): string {
    const relativePath = vscode.workspace.asRelativePath(side.filePath, false);
    return `${relativePath}:${side.startLine}-${side.endLine}`;
  }

  private relativePath(filePath: string): string {
    return vscode.workspace.asRelativePath(filePath, false);
  }

  private async presentPairActions(group: DuplicateGroup): Promise<void> {
    const detail = [
      `Left: ${this.formatLocation(group.left)}`,
      `Right: ${this.formatLocation(group.right)}`,
      `Similarity: ${(group.similarity * 100).toFixed(1)}%`,
    ].join("\n");

    const selection = await vscode.window.showInformationMessage(
      detail,
      "Open both",
      "Open left",
      "Open right",
      "Copy details"
    );

    if (!selection) {
      return;
    }

    if (selection === "Copy details") {
      await vscode.env.clipboard.writeText(detail);
      return;
    }

    if (selection === "Open both") {
      await this.openSide(group.left, vscode.ViewColumn.One);
      await this.openSide(group.right, vscode.ViewColumn.Two);
      return;
    }

    if (selection === "Open left") {
      await this.openSide(group.left, vscode.ViewColumn.Active);
      return;
    }

    if (selection === "Open right") {
      await this.openSide(group.right, vscode.ViewColumn.Active);
    }
  }

  private async openSide(
    side: DuplicateGroup["left"],
    viewColumn: vscode.ViewColumn
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(side.filePath);
      const range = this.getRange(document, side.startLine, side.endLine);
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn,
        selection: range,
        preview: false,
      });

      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      console.error("Failed to open duplicate pair location", error);
      this.dependencies.showError("Unable to open duplicate pair. See console for details.");
    }
  }

  private getRange(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number
  ): vscode.Range {
    const clampedStart = Math.max(startLine - 1, 0);
    const clampedEnd = Math.max(endLine - 1, clampedStart);
    const endCharacter = document.lineAt(Math.min(clampedEnd, document.lineCount - 1)).range.end.character;

    const start = new vscode.Position(clampedStart, 0);
    const end = new vscode.Position(clampedEnd, endCharacter);
    return new vscode.Range(start, end);
  }

  private async getOrBuildReport(repoPath: string): Promise<DuplicateReport | null> {
    if (this.currentRepoPath !== repoPath) {
      this.currentRepoPath = repoPath;
      this.clearCachedReport();
    }

    if (!this.reportPromise) {
      this.reportPromise = this.buildReport(repoPath);
    }

    this.cachedReport = await this.reportPromise;
    return this.cachedReport;
  }

  private async buildReport(repoPath: string): Promise<DuplicateReport | null> {
    try {
      const dryScan = this.dependencies.createDryScan(repoPath);
      return await dryScan.buildDuplicateReport();
    } catch (error) {
      console.error("Failed to build DryScan report", error);
      this.dependencies.showError("Failed to build DryScan report. See console for details.");
      return null;
    }
  }

  private removePairFromReport(pairId: string): void {
    if (!this.cachedReport) {
      return;
    }

    const remaining = this.cachedReport.duplicates.filter((group) => group.id !== pairId);
    const updatedScore = {
      ...this.cachedReport.score,
      duplicateGroups: remaining.length,
    };

    this.cachedReport = {
      ...this.cachedReport,
      duplicates: remaining,
      score: updatedScore,
    };

    this.reportPromise = Promise.resolve(this.cachedReport);
  }

  private clearCachedReport(): void {
    this.cachedReport = null;
    this.reportPromise = null;
  }

  getPairById(pairId: string): DuplicateGroup | undefined {
    if (!this.cachedReport) {
      return undefined;
    }
    return this.cachedReport.duplicates.find((group) => group.id === pairId);
  }

  private async updateManagers(): Promise<void> {
    const repoPath = this.dependencies.getWorkspacePath();
    if (!repoPath) {
      return;
    }

    const report = await this.getOrBuildReport(repoPath);
    if (!report) {
      this.dependencies.diagnosticsManager?.clear();
      this.dependencies.decorationsManager?.clear();
      return;
    }

    this.dependencies.diagnosticsManager?.updateDiagnostics(report.duplicates, repoPath);
    this.dependencies.decorationsManager?.updateDecorations(report.duplicates, repoPath);
  }
}

export function registerDryScanTreeView(
  context: vscode.ExtensionContext,
  diagnosticsManager: DiagnosticsManager,
  decorationsManager: DecorationsManager
): DryScanTreeProvider {
  const provider = new DryScanTreeProvider({
    getWorkspacePath: getPrimaryWorkspacePath,
    hasDryFolder: dryFolderExists,
    createDryScan: (repoPath: string) => new DryScan(repoPath),
    loadConfig: (repoPath: string) => configStore.get(repoPath),
    saveConfig: (repoPath: string, config: DryConfig) => configStore.save(repoPath, config),
    showError: (message: string) => {
      void vscode.window.showErrorMessage(message);
    },
    showInfo: (message: string) => {
      void vscode.window.showInformationMessage(message);
    },
    diagnosticsManager,
    decorationsManager,
  });

  const treeView = vscode.window.createTreeView(DRYSCAN_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const visibilityDisposable = treeView.onDidChangeVisibility((event) => {
    if (event.visible) {
      provider.refresh();
    }
  });

  context.subscriptions.push(treeView, visibilityDisposable);

  return provider;
}
