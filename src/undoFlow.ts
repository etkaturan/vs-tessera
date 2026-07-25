import * as vscode from "vscode";
import { promisify } from "util";
import { exec as execCb } from "child_process";
import { getGitApi, pickRepository, canSafelyUndo } from "./git";

const exec = promisify(execCb);

export async function runUndoFlow(): Promise<void> {
  const api = getGitApi();
  const repo = api ? pickRepository(api) : undefined;
  if (!repo) {
    vscode.window.showErrorMessage("Tessera: no Git repository detected.");
    return;
  }

  // Fetch the last commit's message so the user knows what they're undoing.
  let lastMessage = "";
  try {
    const log = await repo.log({ maxEntries: 1 });
    lastMessage = log[0]?.message ?? "";
  } catch {
    // Non-fatal; we can still offer undo without the message preview.
  }

  const { safe, reason } = canSafelyUndo(repo);

  if (!safe) {
    // Pushed (or unknown) history — refuse by default, warn loudly.
    const choice = await vscode.window.showWarningMessage(
      "Tessera: undoing this commit is unsafe.",
      {
        modal: true,
        detail:
          `${reason}\n\n` +
          `The last commit${lastMessage ? ` ("${lastMessage}")` : ""} appears to be pushed. ` +
          `Undoing it would rewrite published history, which can break anyone who has pulled it. ` +
          `Tessera won't do this automatically. If you truly need to, do it manually with full awareness.`,
      },
      "I Understand"
    );
    // No action taken regardless of choice — this is informational refusal.
    void choice;
    return;
  }

  // Safe path: local-only commit. Confirm, then soft-reset (keeps changes).
  const confirm = await vscode.window.showWarningMessage(
    `Undo the last commit?${lastMessage ? ` ("${lastMessage}")` : ""}`,
    {
      modal: true,
      detail:
        `${reason}\n\n` +
        `Your changes will be kept and un-staged — only the commit is removed. ` +
        `Nothing is deleted.`,
    },
    "Undo Commit"
  );

  if (confirm !== "Undo Commit") {
    return;
  }

  try {
    // Soft reset via git directly — the Git API's reset() is version-inconsistent.
    // --soft moves HEAD back one commit but keeps every change in the working tree.
    await exec("git reset --soft HEAD~1", { cwd: repo.rootUri.fsPath });
    vscode.window.showInformationMessage(
      "Tessera: last commit undone. Your changes are preserved."
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Tessera undo failed: ${String(err)}`);
  }
}