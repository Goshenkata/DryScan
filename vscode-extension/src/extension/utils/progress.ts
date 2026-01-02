import * as vscode from "vscode";

export function vscodeProgressWrapper<T>(message: string, task: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false,
      },
      task
    )
  );
}
