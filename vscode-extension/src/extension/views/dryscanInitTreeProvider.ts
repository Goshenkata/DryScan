import * as vscode from "vscode";
import { dryFolderExists } from "../utils/dryFolder.js";
import { getPrimaryWorkspacePath } from "../utils/workspaceContext.js";

export class DryScanInitTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const repoPath = getPrimaryWorkspacePath();
    if (!repoPath) {
      return [];
    }

    const hasDryFolder = await dryFolderExists(repoPath);
    if (hasDryFolder) {
      return [];
    }

    return [this.buildInitItem()];
  }

  private buildInitItem(): vscode.TreeItem {
    const item = new vscode.TreeItem("Initialise DryScan", vscode.TreeItemCollapsibleState.None);
    item.description = "Set up the repository";
    item.iconPath = new vscode.ThemeIcon("play-circle", new vscode.ThemeColor("charts.blue"));
    item.command = {
      command: "dryscan.init",
      title: "Initialise DryScan"
    };
    return item;
  }
}
