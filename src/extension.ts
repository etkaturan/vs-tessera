import * as vscode from "vscode";
import { TesseraPanelProvider } from "./panelProvider";
import { runCommitFlow } from "./commitFlow";

export function activate(context: vscode.ExtensionContext) {
  const provider = new TesseraPanelProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TesseraPanelProvider.viewType,
      provider
    )
  );

  const commit = vscode.commands.registerCommand("tessera.commit", async () => {
    await runCommitFlow();
    void provider.refresh();
  });
  context.subscriptions.push(commit);

  const refresh = vscode.commands.registerCommand("tessera.refresh", () => {
    void provider.refresh();
  });
  context.subscriptions.push(refresh);
}

export function deactivate() {}