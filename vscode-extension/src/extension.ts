import * as vscode from "vscode";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext.js";
import { handleInitCommand } from "./extension/commands/initCommand.js";
import {
	DryScanTreeProvider,
	registerDryScanTreeView,
} from "./extension/views/dryScanTreeProvider.js";

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		registerInitCommand(),
		registerRefreshCommand(registerDryScanTreeView(context))
	);
}

export function deactivate(): void {}

function registerInitCommand(): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.init", async (pathFromCommand?: string) => {
		const repoPath = typeof pathFromCommand === "string"
			? pathFromCommand
			: getPrimaryWorkspacePath();
		if (!repoPath) {
			vscode.window.showErrorMessage("Open a workspace folder to initialize DryScan.");
			return;
		}
		await handleInitCommand(repoPath);
	});
}

function registerRefreshCommand(provider: DryScanTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.refreshView", () => {
		provider.refresh();
	});
}
