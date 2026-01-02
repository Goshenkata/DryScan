import * as vscode from "vscode";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext.js";
import { handleInitCommand } from "./extension/commands/initCommand.js";
import {
	DryScanTreeProvider,
	registerDryScanTreeView,
} from "./extension/views/dryScanTreeProvider.js";
import { DuplicateGroup } from "@goshenkata/dryscan-core";

export function activate(context: vscode.ExtensionContext): void {
	const provider = registerDryScanTreeView(context);
	context.subscriptions.push(
		registerInitCommand(),
		registerRefreshCommand(provider),
		registerOpenPairCommand(provider),
		registerExcludePairCommand(provider)
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

function registerOpenPairCommand(provider: DryScanTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand(
		"dryscan.openPair",
		(group: DuplicateGroup) => provider.handlePairClick(group)
	);
}

function registerExcludePairCommand(provider: DryScanTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand(
		"dryscan.excludePair",
		(group: DuplicateGroup) => provider.handleExcludePair(group)
	);
}
