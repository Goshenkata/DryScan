import * as vscode from "vscode";
import { DryScanSingleton } from "../utils/dryscanSingleton.js";
import { dryFolderExists } from "../utils/dryFolder.js";
import { vscodeProgressWrapper } from "../utils/progress.js";

export async function handleInitCommand(repoPath: string): Promise<void> {
  if (await dryFolderExists(repoPath)) {
    vscode.window.showInformationMessage("DryScan is already initialized.");
    return;
  }

  try {
    await vscodeProgressWrapper("Initialising DryScan...", async () => {
      const instance = await DryScanSingleton.get(repoPath);
      await (instance as any).init();
    });
    vscode.window.showInformationMessage("DryScan initialised successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Failed to initialise DryScan: ${message}`);
  }
}
