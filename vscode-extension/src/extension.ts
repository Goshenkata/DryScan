import * as vscode from "vscode";
import { DryScanSingleton } from "./extension/utils/dryscanSingleton.js";
import { DryScanInitTreeProvider } from "./extension/views/dryscanInitTreeProvider.js";
import { dryFolderExists } from "./extension/utils/dryFolder.js";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext.js";
import { handleInitCommand } from "./extension/commands/initCommand.js";
import { vscodeProgressWrapper } from "./extension/utils/progress.js";

export function activate(context: vscode.ExtensionContext): void {
	const initTreeProvider = new DryScanInitTreeProvider();

	context.subscriptions.push(
		initTreeProvider,
		vscode.window.registerTreeDataProvider("dryscan.explorer", initTreeProvider),
		registerInitCommand(initTreeProvider)
	);
}

export function deactivate(): void {}

function registerInitCommand(treeProvider: DryScanInitTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.init", async () => {
		const repoPath = getPrimaryWorkspacePath();
		await handleInitCommand({
			repoPath,
			checkDryFolder: dryFolderExists,
			initDryScan: async (path: string) => {
				const instance = DryScanSingleton.get(path);
				await instance.init();
			},
			refreshView: () => treeProvider.refresh(),
			withProgress: <T>(message: string, task: () => Promise<T>) =>
				vscodeProgressWrapper(message, task),
			showInfo: (message: string) => vscode.window.showInformationMessage(message),
			showError: (message: string) => vscode.window.showErrorMessage(message),
		});
	});
}
