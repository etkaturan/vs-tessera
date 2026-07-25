import * as vscode from "vscode";
import { getGitApi, pickRepository, allChangeFacts } from "./git";
import { buildMessage } from "./message";
import { scan, hasBlocking, Finding, ScanTarget } from "./secrets";

// Reads the content of each changed file so the scanner can inspect it.
async function collectTargets(
  repoRoot: vscode.Uri,
  files: string[]
): Promise<ScanTarget[]> {
  const targets: ScanTarget[] = [];
  for (const rel of files) {
    const uri = vscode.Uri.joinPath(repoRoot, rel);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      // Skip obviously-binary or huge files; scan text only.
      if (bytes.length > 512 * 1024) {
        continue;
      }
      const content = Buffer.from(bytes).toString("utf8");
      targets.push({ file: rel, content });
    } catch {
      // File may be deleted/unreadable; nothing to scan.
    }
  }
  return targets;
}

function formatFindings(findings: Finding[]): string {
  return findings
    .map((f) => {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      const tag = f.severity === "block" ? "BLOCK" : "warn";
      return `[${tag}] ${where} — ${f.reason}`;
    })
    .join("\n");
}

export interface CommitOptions {
  message?: string;   // override; when absent, generate from diff
  push?: boolean;     // when false, commit locally only
}

export async function runCommitFlow(opts: CommitOptions = {}): Promise<void> {
  const api = getGitApi();
  const repo = api ? pickRepository(api) : undefined;
  if (!repo) {
    vscode.window.showErrorMessage("Tessera: no Git repository detected.");
    return;
  }

  const facts = allChangeFacts(repo);
  if (facts.files.length === 0) {
    vscode.window.showInformationMessage("Tessera: nothing to commit.");
    return;
  }

  // 1. Scan for secrets BEFORE anything is staged or committed.
  const targets = await collectTargets(repo.rootUri, facts.files);
  const findings = scan(targets);

  if (hasBlocking(findings)) {
    const detail = formatFindings(findings.filter((f) => f.severity === "block"));
    const choice = await vscode.window.showErrorMessage(
      "Tessera blocked the commit — possible secrets detected.",
      { modal: true, detail },
      "Show Details"
    );
    if (choice === "Show Details") {
      const doc = await vscode.workspace.openTextDocument({
        content: `Tessera secret-scan findings:\n\n${formatFindings(findings)}\n`,
        language: "text",
      });
      await vscode.window.showTextDocument(doc);
    }
    return; // hard stop — no commit
  }

  // 2. Warnings (non-blocking) — surface but proceed.
  const warnings = findings.filter((f) => f.severity === "warn");
  if (warnings.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `Tessera: ${warnings.length} potential issue(s) flagged. Commit anyway?`,
      { modal: true, detail: formatFindings(warnings) },
      "Commit Anyway"
    );
    if (proceed !== "Commit Anyway") {
      return;
    }
  }

  // 3. Stage everything, resolve the message (override or generated), commit.
  const generated = buildMessage(facts);
  const message = opts.message?.trim() ? opts.message.trim() : generated;

  try {
    await repo.add([]); // empty array = stage all tracked+untracked changes
    await repo.commit(message);
    vscode.window.showInformationMessage(`Tessera committed: ${message}`);

    // 4. Push only if requested (default true for the combined action).
    if (opts.push !== false) {
      try {
        await repo.push();
        vscode.window.showInformationMessage("Tessera pushed to remote.");
      } catch {
        vscode.window.showWarningMessage(
          "Tessera committed locally, but push failed (offline?). It will push next time."
        );
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Tessera commit failed: ${String(err)}`);
  }
}