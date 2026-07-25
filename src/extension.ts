import * as vscode from "vscode";
import { TesseraPanelProvider } from "./panelProvider";
import { runCommitFlow } from "./commitFlow";
import { runUndoFlow } from "./undoFlow";

export function activate(context: vscode.ExtensionContext) {
  const provider = new TesseraPanelProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TesseraPanelProvider.viewType,
      provider
    )
  );

  const commit = vscode.commands.registerCommand(
    "tessera.commit",
    async (opts?: { message?: string; push?: boolean }) => {
      await runCommitFlow(opts ?? {});
      void provider.refresh();
    }
  );
  context.subscriptions.push(commit);

  const undo = vscode.commands.registerCommand("tessera.undo", async () => {
    await runUndoFlow();
    void provider.refresh();
  });
  context.subscriptions.push(undo);

  const refresh = vscode.commands.registerCommand("tessera.refresh", () => {
    void provider.refresh();
  });
  context.subscriptions.push(refresh);
}

export function deactivate() {}