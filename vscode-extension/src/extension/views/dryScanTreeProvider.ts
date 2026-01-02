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

export const DRYSCAN_VIEW_ID = "dryscanView";

type Dependencies = {
  getWorkspacePath: () => string | null;
  hasDryFolder: (repoPath: string) => Promise<boolean>;
  createDryScan: (repoPath: string) => DryScan;
  loadConfig: (repoPath: string) => Promise<DryConfig>;
  saveConfig: (repoPath: string, config: DryConfig) => Promise<void>;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
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
    this.dependencies.showInfo("Hello world");
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
    const label = `Duplication ${score.score.toFixed(1)}% (${report.grade})`;
    const description = `Pairs: ${report.duplicates.length} | Lines affected: ${score.duplicateLines}`;

    const item = new DryScanTreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.tooltip = [
      `Duplication score: ${score.score.toFixed(2)}%`,
      `Grade: ${report.grade}`,
      `Pairs: ${report.duplicates.length}`,
      `Lines affected: ${score.duplicateLines}`,
    ].join("\n");
    item.iconPath = new vscode.ThemeIcon("graph-line");
    item.contextValue = "dryscan.summary";

    return item;
  }

  private createPairItem(group: DuplicateGroup): DryScanTreeItem {
    const similarityPercent = (group.similarity * 100).toFixed(1);
    const label = `${group.left.name} <-> ${group.right.name}`;
    const description = `${similarityPercent}%`;
    const item = new DryScanTreeItem(label, vscode.TreeItemCollapsibleState.None);

    item.id = group.id;
    item.description = description;
    item.tooltip = [
      this.formatLocation(group.left),
      this.formatLocation(group.right),
      `Exclusion key: ${group.exclusionString}`,
    ].join("\n");
    item.command = {
      command: "dryscan.openPair",
      title: "Open Duplicate Pair",
      arguments: [group],
    };
    item.iconPath = new vscode.ThemeIcon("link");
    item.contextValue = "dryscan.duplicatePair";

    return item;
  }

  private formatLocation(side: DuplicateGroup["left"]): string {
    const relativePath = vscode.workspace.asRelativePath(side.filePath, false);
    return `${relativePath}:${side.startLine}-${side.endLine}`;
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
}

export function registerDryScanTreeView(
  context: vscode.ExtensionContext
): DryScanTreeProvider {
  const provider = new DryScanTreeProvider();
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
