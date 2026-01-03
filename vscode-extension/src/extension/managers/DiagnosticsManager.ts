import * as vscode from "vscode";
import { DuplicateGroup } from "@goshenkata/dryscan-core";

/**
 * Manages diagnostic reporting for duplicate code pairs in the Problems panel.
 * Creates two diagnostics per pair (one for each file) with linked messages.
 */
export class DiagnosticsManager {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private diagnosticToPairMap: Map<string, DuplicateGroup> = new Map();

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("dryscan");
  }

  /**
   * Updates diagnostics for all duplicate pairs in the workspace.
   * @param pairs Array of duplicate pairs to show in Problems panel
   * @param workspacePath Root path of the workspace for resolving absolute paths
   */
  updateDiagnostics(pairs: DuplicateGroup[], workspacePath: string): void {
    this.clear();

    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    for (const pair of pairs) {
      // Create diagnostic for left side
      const leftDiagnostic = this.createDiagnostic(pair, "left", workspacePath);
      const leftAbsPath = this.resolveAbsolutePath(pair.left.filePath, workspacePath);
      this.addDiagnosticToMap(diagnosticsByFile, leftAbsPath, leftDiagnostic);
      this.diagnosticToPairMap.set(this.getDiagnosticKey(leftAbsPath, leftDiagnostic), pair);

      // Create diagnostic for right side
      const rightDiagnostic = this.createDiagnostic(pair, "right", workspacePath);
      const rightAbsPath = this.resolveAbsolutePath(pair.right.filePath, workspacePath);
      this.addDiagnosticToMap(diagnosticsByFile, rightAbsPath, rightDiagnostic);
      this.diagnosticToPairMap.set(this.getDiagnosticKey(rightAbsPath, rightDiagnostic), pair);
    }

    // Set diagnostics for each file
    for (const [filePath, diagnostics] of diagnosticsByFile) {
      const uri = vscode.Uri.file(filePath);
      this.diagnosticCollection.set(uri, diagnostics);
    }
  }

  /**
   * Clears all DryScan diagnostics from the Problems panel.
   */
  clear(): void {
    this.diagnosticCollection.clear();
    this.diagnosticToPairMap.clear();
  }

  /**
   * Retrieves the duplicate pair associated with a diagnostic at the given position.
   */
  getPairForDiagnostic(document: vscode.TextDocument, range: vscode.Range): DuplicateGroup | undefined {
    const diagnostics = this.diagnosticCollection.get(document.uri);
    if (!diagnostics) {
      return undefined;
    }

    const diagnostic = diagnostics.find((d) => d.range.intersection(range) !== undefined);
    if (!diagnostic) {
      return undefined;
    }

    const key = this.getDiagnosticKey(document.uri.fsPath, diagnostic);
    return this.diagnosticToPairMap.get(key);
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }

  private createDiagnostic(pair: DuplicateGroup, side: "left" | "right", workspacePath: string): vscode.Diagnostic {
    const currentSide = pair[side];
    const otherSide = side === "left" ? pair.right : pair.left;
    
    const similarityPercent = (pair.similarity * 100).toFixed(1);
    const range = this.createRange(currentSide);
    const message = this.createDiagnosticMessage(similarityPercent);
    
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
    diagnostic.source = "DryScan";
    diagnostic.code = this.createCodeLink(otherSide, workspacePath);

    return diagnostic;
  }

  private createDiagnosticMessage(similarityPercent: string): string {
    return `Duplicate code (${similarityPercent}% similar)`;
  }

  private createCodeLink(side: DuplicateGroup["left"], workspacePath: string): { value: string; target: vscode.Uri } {
    const basename = this.getBasename(side.filePath);
    const codeValue = `${basename}:${side.startLine}-${side.endLine}`;
    const targetUri = this.createFileLocationUri(side, workspacePath);

    return {
      value: codeValue,
      target: targetUri
    };
  }

  private createFileLocationUri(side: DuplicateGroup["left"], workspacePath: string): vscode.Uri {
    const absolutePath = this.resolveAbsolutePath(side.filePath, workspacePath);
    const startLine = Math.max(0, side.startLine - 1);
    const endLine = Math.max(0, side.endLine - 1);
    
    return vscode.Uri.file(absolutePath).with({
      fragment: `L${startLine + 1}-L${endLine + 1}`
    });
  }

  private createRange(side: DuplicateGroup["left"]): vscode.Range {
    const startLine = Math.max(0, side.startLine - 1);
    const endLine = Math.max(0, side.endLine - 1);
    
    return new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
    );
  }

  private getBasename(filePath: string): string {
    const uri = vscode.Uri.file(filePath);
    return uri.path.split('/').pop() || filePath;
  }

  private resolveAbsolutePath(filePath: string, workspacePath: string): string {
    if (vscode.Uri.file(filePath).scheme === 'file' && filePath.startsWith('/')) {
      return filePath;
    }
    return vscode.Uri.joinPath(vscode.Uri.file(workspacePath), filePath).fsPath;
  }

  private addDiagnosticToMap(
    map: Map<string, vscode.Diagnostic[]>,
    filePath: string,
    diagnostic: vscode.Diagnostic
  ): void {
    const existing = map.get(filePath) || [];
    existing.push(diagnostic);
    map.set(filePath, existing);
  }

  private getDiagnosticKey(filePath: string, diagnostic: vscode.Diagnostic): string {
    return `${filePath}:${diagnostic.range.start.line}:${diagnostic.range.end.line}`;
  }
}
