import * as vscode from "vscode";

/**
 * Manages automatic report regeneration when files change.
 * Implements debouncing to avoid excessive regenerations.
 */
export class AutoRefreshManager {
  private readonly refreshCallback: () => void;
  private readonly debounceDelayMs: number;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastRefreshTime: number = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(refreshCallback: () => void, debounceDelayMs: number = 500) {
    this.refreshCallback = refreshCallback;
    this.debounceDelayMs = debounceDelayMs;
    this.registerFileWatcher();
  }

  private registerFileWatcher(): void {
    const onDocumentChange = vscode.workspace.onDidChangeTextDocument((event) => {
      this.handleDocumentChange(event);
    });

    this.disposables.push(onDocumentChange);
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (!this.shouldProcessChange(event)) {
      return;
    }

    this.scheduleRefresh();
  }

  private shouldProcessChange(event: vscode.TextDocumentChangeEvent): boolean {
    return (
      !this.isUntitledDocument(event.document) &&
      this.hasContentChanges(event) &&
      this.isWorkspaceFile(event.document)
    );
  }

  private isUntitledDocument(document: vscode.TextDocument): boolean {
    return document.isUntitled;
  }

  private hasContentChanges(event: vscode.TextDocumentChangeEvent): boolean {
    return event.contentChanges.length > 0;
  }

  private isWorkspaceFile(document: vscode.TextDocument): boolean {
    return vscode.workspace.getWorkspaceFolder(document.uri) !== undefined;
  }

  private scheduleRefresh(): void {
    this.cancelPendingRefresh();

    this.debounceTimer = setTimeout(() => {
      this.executeRefresh();
    }, this.debounceDelayMs);
  }

  private cancelPendingRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private executeRefresh(): void {
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastRefreshTime;

    if (timeSinceLastRefresh < this.debounceDelayMs) {
      this.scheduleRefresh();
      return;
    }

    this.lastRefreshTime = now;
    this.refreshCallback();
  }

  dispose(): void {
    this.cancelPendingRefresh();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
  }
}
