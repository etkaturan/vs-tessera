import * as vscode from "vscode";
import { ensureGitApi, getGitApi, pickRepository, readStatus, allChangeFacts, TesseraStatus } from "./git";
import { buildMessage } from "./message";

export class TesseraPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tessera.panel";
  private view?: vscode.WebviewView;
  private repoListener?: vscode.Disposable;
  private previewMessage = "";

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };

    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "commit") {
        vscode.commands.executeCommand("tessera.commit");
      } else if (msg?.type === "refresh") {
        void this.refresh();
      }
    });

    void this.wireRepo();
    void this.refresh();
  }

  // Re-render whenever the repository state changes (files edited, staged, etc.)
  private async wireRepo() {
    const api = await ensureGitApi();
    if (!api) {
      return;
    }

    // The Git extension discovers repositories asynchronously, so the list can
    // be empty right after activation. Re-wire whenever a repo appears.
    const openListener = api.onDidOpenRepository(() => {
      void this.attachRepo();
      void this.refresh();
    });
    this.context.subscriptions.push(openListener);

    this.attachRepo();
  }

  private attachRepo() {
    const api = getGitApi();
    if (!api) {
      return;
    }
    const repo = pickRepository(api);
    if (!repo) {
      return;
    }
    this.repoListener?.dispose();
    this.repoListener = repo.state.onDidChange(() => void this.refresh());
    this.context.subscriptions.push(this.repoListener);
  }

  async refresh() {
    if (!this.view) {
      return;
    }
    const api = await ensureGitApi();
    const repo = api ? pickRepository(api) : undefined;
    const status = repo ? readStatus(repo) : undefined;
    if (repo && status && status.files.length > 0) {
      const facts = allChangeFacts(repo);
      this.previewMessage = buildMessage(facts);
    } else {
      this.previewMessage = "";
    }
    this.view.webview.html = this.render(status);
  }

  private render(status?: TesseraStatus): string {
    if (!status) {
      return this.shell(`<p class="muted">No Git repository detected.</p>`);
    }

    const total = status.staged + status.unstaged + status.untracked;
    const rows = status.files
      .map(
        (f) =>
          `<div class="row"><span class="dot ${f.state}"></span><span class="path">${escapeHtml(
            f.path
          )}</span></div>`
      )
      .join("");

    const body = `
      <div class="branch">⎇ ${escapeHtml(status.branch)}</div>
      <div class="counts">
        <span class="staged">${status.staged} staged</span> ·
        <span class="unstaged">${status.unstaged} changed</span> ·
        <span class="untracked">${status.untracked} new</span>
      </div>
      <div class="files">${rows || `<p class="muted">Working tree clean.</p>`}</div>
      ${total > 0 ? `<div class="msg-label">Commit message preview</div>
      <div class="msg">${escapeHtml(this.previewMessage)}</div>` : ""}
      <button id="commit" ${total === 0 ? "disabled" : ""}>Commit</button>
    `;
    return this.shell(body);
  }

  private shell(inner: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: var(--vscode-font-family); font-size: 12px; padding: 8px; color: var(--vscode-foreground); }
  .branch { font-weight: 600; margin-bottom: 4px; }
  .counts { color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .files { margin-bottom: 10px; max-height: 300px; overflow-y: auto; }
  .row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
  .path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.staged { background: var(--vscode-gitDecoration-stageModifiedResourceForeground, #4a4); }
  .dot.unstaged { background: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
  .dot.untracked { background: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991); }
  .muted { color: var(--vscode-descriptionForeground); }
  .msg-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
  .msg { font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textBlockQuote-background); padding: 5px 7px; border-radius: 3px; margin-bottom: 8px; word-break: break-word; }
  button { width: 100%; padding: 6px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; }
  button:disabled { opacity: 0.5; cursor: default; }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  ${inner}
  <script>
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById('commit');
    if (btn) btn.addEventListener('click', () => vscode.postMessage({ type: 'commit' }));
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}