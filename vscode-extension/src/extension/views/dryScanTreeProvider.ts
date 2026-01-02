import * as vscode from "vscode";
import { getPrimaryWorkspacePath } from "../utils/workspaceContext.js";
import { dryFolderExists } from "../utils/dryFolder.js";

export const DRYSCAN_VIEW_ID = "dryscanView";

type Dependencies = {
  getWorkspacePath: () => string | null;
  hasDryFolder: (repoPath: string) => Promise<boolean>;
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

  constructor(
    private readonly dependencies: Dependencies = {
      getWorkspacePath: getPrimaryWorkspacePath,
      hasDryFolder: dryFolderExists,
    }
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(): Promise<DryScanTreeItem[]> {
    const workspacePath = this.dependencies.getWorkspacePath();

    if (!workspacePath) {
      return [this.createInfoItem("Open a workspace to use DryScan")];
    }

    const hasDryFolder = await this.dependencies.hasDryFolder(workspacePath);
    if (hasDryFolder) {
      return [];
    }

    return [this.createInitializeItem(workspacePath)];
  }

  getTreeItem(element: DryScanTreeItem): vscode.TreeItem {
    return element;
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
