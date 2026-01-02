import * as vscode from "vscode";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext.js";
import { handleInitCommand } from "./extension/commands/initCommand.js";
import { DryScanWebviewProvider } from "./extension/views/dryscanWebviewProvider.js";

export function activate(context: vscode.ExtensionContext): void {
	const initWebviewProvider = new DryScanWebviewProvider();

	context.subscriptions.push(
		initWebviewProvider,
		vscode.window.registerWebviewViewProvider("dryscan.explorer", initWebviewProvider),
		registerInitCommand()
	);
}

export function deactivate(): void {}

function registerInitCommand(): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.init", async () => {
		const repoPath = getPrimaryWorkspacePath();
		if (!repoPath) {
			vscode.window.showErrorMessage("Open a workspace folder to initialize DryScan.");
			return;
		}
		await handleInitCommand(repoPath);
	});
}
