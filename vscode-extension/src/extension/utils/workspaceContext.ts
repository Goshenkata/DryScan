import * as vscode from "vscode";

export function getPrimaryWorkspacePath(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath ?? null;
}
