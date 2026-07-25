import * as vscode from "vscode";

// Minimal shapes from the built-in vscode.git extension API.
// We only type what we actually use, to avoid pulling a dependency.
interface GitExtension {
  getAPI(version: 1): GitAPI;
}
interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
}
interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}
interface RepositoryState {
  readonly workingTreeChanges: Change[];
  readonly indexChanges: Change[];
  readonly untrackedChanges: Change[];
  readonly HEAD?: { name?: string };
  readonly onDidChange: vscode.Event<void>;
}
interface Change {
  readonly uri: vscode.Uri;
  readonly status: number;
}

export interface TesseraStatus {
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
  files: { path: string; state: "staged" | "unstaged" | "untracked" }[];
}

let cachedApi: GitAPI | undefined;

export function getGitApi(): GitAPI | undefined {
  if (cachedApi) {
    return cachedApi;
  }
  const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) {
    return undefined;
  }
  if (!ext.isActive) {
    // Not activated yet; caller should retry after activation.
    return undefined;
  }
  cachedApi = ext.exports.getAPI(1);
  return cachedApi;
}

export async function ensureGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) {
    return undefined;
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  cachedApi = ext.exports.getAPI(1);
  return cachedApi;
}

// Picks the repository that owns the active file, else the first repo.
export function pickRepository(api: GitAPI): Repository | undefined {
  if (api.repositories.length === 0) {
    return undefined;
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const match = api.repositories.find((r) =>
      activeUri.fsPath.startsWith(r.rootUri.fsPath)
    );
    if (match) {
      return match;
    }
  }
  return api.repositories[0];
}

export function readStatus(repo: Repository): TesseraStatus {
  const s = repo.state;
  const rel = (uri: vscode.Uri) =>
    vscode.workspace.asRelativePath(uri, false);

  const files: TesseraStatus["files"] = [
    ...s.indexChanges.map((c) => ({ path: rel(c.uri), state: "staged" as const })),
    ...s.workingTreeChanges.map((c) => ({ path: rel(c.uri), state: "unstaged" as const })),
    ...s.untrackedChanges.map((c) => ({ path: rel(c.uri), state: "untracked" as const })),
  ];

  return {
    branch: s.HEAD?.name ?? "(detached)",
    staged: s.indexChanges.length,
    unstaged: s.workingTreeChanges.length,
    untracked: s.untrackedChanges.length,
    files,
  };
}