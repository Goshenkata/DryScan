import * as vscode from "vscode";
import { DryScanSingleton } from "./extension/utils/dryscanSingleton";
import { dryFolderExists } from "./extension/utils/dryFolder";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext";
import { handleInitCommand } from "./extension/commands/initCommand";
import { vscodeProgressWrapper } from "./extension/utils/progress";
import { DryScanWebviewProvider } from "./extension/views/dryscanWebviewProvider";

export function activate(context: vscode.ExtensionContext): void {
	const initWebviewProvider = new DryScanWebviewProvider(context);

	context.subscriptions.push(
		initWebviewProvider,
		vscode.window.registerWebviewViewProvider("dryscan.explorer", initWebviewProvider),
		registerInitCommand(initWebviewProvider)
	);
}

export function deactivate(): void {}

function registerInitCommand(refresher: { refresh: () => void }): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.init", async () => {
		const repoPath = getPrimaryWorkspacePath();
		await handleInitCommand({
			repoPath,
			checkDryFolder: dryFolderExists,
			initDryScan: async (path: string) => {
				const instance = await DryScanSingleton.get(path);
				await (instance as any).init();
			},
			refreshView: () => refresher.refresh(),
			withProgress: <T>(message: string, task: () => Promise<T>) =>
				vscodeProgressWrapper(message, task),
			showInfo: (message: string) => vscode.window.showInformationMessage(message),
			showError: (message: string) => vscode.window.showErrorMessage(message),
		});
	});
}
