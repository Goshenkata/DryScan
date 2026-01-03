import * as vscode from "vscode";
import { getPrimaryWorkspacePath } from "./extension/utils/workspaceContext.js";
import { handleInitCommand } from "./extension/commands/initCommand.js";
import {
	DryScanTreeProvider,
	registerDryScanTreeView,
} from "./extension/views/dryScanTreeProvider.js";
import { DuplicateGroup } from "@goshenkata/dryscan-core";
import { DiagnosticsManager } from "./extension/managers/DiagnosticsManager.js";
import { DecorationsManager } from "./extension/managers/DecorationsManager.js";

export function activate(context: vscode.ExtensionContext): void {
	const diagnosticsManager = new DiagnosticsManager();
	const decorationsManager = new DecorationsManager();
	const provider = registerDryScanTreeView(context, diagnosticsManager, decorationsManager);

	context.subscriptions.push(
		diagnosticsManager,
		decorationsManager,
		registerInitCommand(provider),
		registerRefreshCommand(provider),
		registerOpenPairCommand(provider),
		registerExcludePairCommand(provider),
		registerOpenPairFromDiagnosticCommand(provider)
	);
}

export function deactivate(): void {}

function registerInitCommand(provider: DryScanTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand("dryscan.init", async (pathFromCommand?: string) => {
		const repoPath = typeof pathFromCommand === "string"
			? pathFromCommand
			: getPrimaryWorkspacePath();
		if (!repoPath) {
			vscode.window.showErrorMessage("Open a workspace folder to initialize DryScan.");
			return;
		}
		await handleInitCommand(repoPath);
		provider.refresh();
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
		(group: any) => provider.handleExcludePair(group.command.arguments[0] as DuplicateGroup)
	);
}

function registerOpenPairFromDiagnosticCommand(provider: DryScanTreeProvider): vscode.Disposable {
	return vscode.commands.registerCommand(
		"dryscan.openPairFromDiagnostic",
		async (args: { pairId: string }) => {
			const pair = provider.getPairById(args.pairId);
			if (pair) {
				await provider.handlePairClick(pair);
			}
		}
	);
}
