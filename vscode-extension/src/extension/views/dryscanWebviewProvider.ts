import * as vscode from "vscode";
import { dryFolderExists } from "../utils/dryFolder";
import { getPrimaryWorkspacePath } from "../utils/workspaceContext";

export class DryScanWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  constructor(private readonly context: vscode.ExtensionContext) {}

  dispose(): void {
  }

  refresh(): void {
    if (this.view) {
      this.render(this.view.webview);
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "init") {
        await vscode.commands.executeCommand("dryscan.init");
        this.refresh();
      }
      if (message?.type === "refresh") {
        this.refresh();
      }
    });
    await this.render(webviewView.webview);
  }

  private async render(webview: vscode.Webview): Promise<void> {
    const repoPath = getPrimaryWorkspacePath();
    if (!repoPath) {
      webview.html = this.renderHtml({ state: "no-workspace" });
      return;
    }

    const hasDryFolder = await dryFolderExists(repoPath);
    webview.html = this.renderHtml({ state: hasDryFolder ? "initialized" : "ready" });
  }

  private renderHtml(state: { state: "ready" | "initialized" | "no-workspace" }): string {
    const showButton = state.state === "ready";
    const message =
      state.state === "initialized"
        ? "DryScan is already initialized."
        : state.state === "no-workspace"
          ? "Open a workspace folder to initialize DryScan."
          : "";

    const nonce = getNonce();
    return /* html */ `
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 12px;
              font-family: var(--vscode-font-family);
              color: var(--vscode-foreground);
              background: var(--vscode-sideBar-background);
            }
            .toolbar {
              display: flex;
              justify-content: flex-end;
              margin-bottom: 8px;
            }
            .icon-btn {
              background: transparent;
              border: 1px solid var(--vscode-panel-border);
              border-radius: 4px;
              padding: 4px 8px;
              color: var(--vscode-foreground);
              cursor: pointer;
            }
            .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
            .card {
              border: 1px solid var(--vscode-panel-border);
              border-radius: 10px;
              padding: 18px;
              background: var(--vscode-editor-background);
              box-shadow: 0 6px 14px rgba(0,0,0,0.12);
              text-align: center;
            }
            .title {
              font-size: 15px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .message {
              margin-top: 8px;
              color: var(--vscode-descriptionForeground);
            }
            .button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              padding: 14px 18px;
              margin-top: 12px;
              border-radius: 8px;
              border: 1px solid #0f7b0f;
              background: #0f7b0f;
              color: #fff;
              font-weight: 700;
              cursor: pointer;
              text-decoration: none;
              box-shadow: 0 3px 10px rgba(0,0,0,0.25);
              font-size: 14px;
              min-width: 200px;
            }
            .button:hover { background: #129712; }
            .button:active { background: #0d6d0d; }
            .hidden { display: none; }
          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="icon-btn" id="refreshBtn" title="Refresh">
              &#x21bb; Refresh
            </button>
          </div>
          <div class="card">
            <div class="title">DryScan setup</div>
            ${message ? `<div class="message">${message}</div>` : ""}
            <button class="button ${showButton ? "" : "hidden"}" id="initBtn">
              <span>Initialize DryScan</span>
            </button>
          </div>
          <script nonce="${nonce}">
            const vscodeApi = acquireVsCodeApi();
            const btn = document.getElementById('initBtn');
            if (btn) {
              btn.addEventListener('click', () => {
                vscodeApi.postMessage({ type: 'init' });
              });
            }
            const refreshBtn = document.getElementById('refreshBtn');
            if (refreshBtn) {
              refreshBtn.addEventListener('click', () => {
                vscodeApi.postMessage({ type: 'refresh' });
              });
            }
          </script>
        </body>
      </html>
    `;
  }
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join("");
}
