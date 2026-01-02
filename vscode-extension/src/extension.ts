import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "dryscan" is now active!');
	const disposable = vscode.commands.registerCommand('dryscan.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from DryScan!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
