import * as vscode from "vscode";
import { DuplicateGroup } from "@goshenkata/dryscan-core";

/**
 * Manages inline decorations (underlines) for duplicate code in active editors.
 */
export class DecorationsManager {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private currentDecorations: Map<string, vscode.Range[]> = new Map();

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editorWarning.background"),
      borderColor: new vscode.ThemeColor("editorWarning.border"),
      borderWidth: "0 0 2px 0",
      borderStyle: "solid",
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // Update decorations when active editor changes
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.applyDecorationsToEditor(editor);
      }
    });

    // Update decorations when visible editors change
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach((editor) => this.applyDecorationsToEditor(editor));
    });
  }

  /**
   * Updates decorations for all duplicate pairs across all visible editors.
   * @param pairs Array of duplicate pairs to decorate
   * @param workspacePath Root path of the workspace for resolving absolute paths
   */
  updateDecorations(pairs: DuplicateGroup[], workspacePath: string): void {
    // Clear existing decorations
    this.currentDecorations.clear();

    // Build decoration map
    for (const pair of pairs) {
      this.addDecorationForSide(pair.left, workspacePath);
      this.addDecorationForSide(pair.right, workspacePath);
    }

    // Apply to all visible editors
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.applyDecorationsToEditor(editor);
    });
  }

  /**
   * Clears all DryScan decorations from all editors.
   */
  clear(): void {
    this.currentDecorations.clear();
    vscode.window.visibleTextEditors.forEach((editor) => {
      editor.setDecorations(this.decorationType, []);
    });
  }

  dispose(): void {
    this.decorationType.dispose();
  }

  private addDecorationForSide(side: DuplicateGroup["left"], workspacePath: string): void {
    const absPath = this.resolveAbsolutePath(side.filePath, workspacePath);
    const range = new vscode.Range(
      new vscode.Position(Math.max(0, side.startLine - 1), 0),
      new vscode.Position(Math.max(0, side.endLine - 1), Number.MAX_SAFE_INTEGER)
    );

    const existing = this.currentDecorations.get(absPath) || [];
    existing.push(range);
    this.currentDecorations.set(absPath, existing);
  }

  private resolveAbsolutePath(filePath: string, workspacePath: string): string {
    if (vscode.Uri.file(filePath).scheme === 'file' && filePath.startsWith('/')) {
      return filePath;
    }
    return vscode.Uri.joinPath(vscode.Uri.file(workspacePath), filePath).fsPath;
  }

  private applyDecorationsToEditor(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const ranges = this.currentDecorations.get(filePath) || [];
    editor.setDecorations(this.decorationType, ranges);
  }
}
