import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const commit = vscode.commands.registerCommand("tessera.commit", () => {
    vscode.window.showInformationMessage("Tessera: commit flow not built yet.");
  });
  context.subscriptions.push(commit);
}

export function deactivate() {}