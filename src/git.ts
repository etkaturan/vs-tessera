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
  diffIndexWithHEAD(): Promise<DiffChange[]>;
  diff(cached?: boolean): Promise<string>;
  add(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  reset(treeish: string, hard?: boolean): Promise<void>;
  log(options?: { maxEntries?: number }): Promise<Commit[]>;
}

interface Commit {
  hash: string;
  message: string;
}

interface DiffChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}
interface RepositoryState {
  readonly workingTreeChanges: Change[];
  readonly indexChanges: Change[];
  readonly untrackedChanges: Change[];
  readonly HEAD?: { name?: string; ahead?: number; behind?: number; upstream?: { name: string } };
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

  // Status 7 = UNTRACKED. The Git API surfaces untracked files inside
  // workingTreeChanges, so classify by status rather than by which list.
  const UNTRACKED = 7;
  const wtUntracked = s.workingTreeChanges.filter((c) => c.status === UNTRACKED);
  const wtModified = s.workingTreeChanges.filter((c) => c.status !== UNTRACKED);

  const files: TesseraStatus["files"] = [
    ...s.indexChanges.map((c) => ({ path: rel(c.uri), state: "staged" as const })),
    ...wtModified.map((c) => ({ path: rel(c.uri), state: "unstaged" as const })),
    ...wtUntracked.map((c) => ({ path: rel(c.uri), state: "untracked" as const })),
    ...s.untrackedChanges.map((c) => ({ path: rel(c.uri), state: "untracked" as const })),
  ];

  return {
    branch: s.HEAD?.name ?? "(detached)",
    staged: s.indexChanges.length,
    unstaged: wtModified.length,
    untracked: wtUntracked.length + s.untrackedChanges.length,
    files,
  };
}

// Raw facts about the staged changes, for the message engine.
export interface StagedFacts {
  files: string[];
  added: number;      // new files
  modified: number;   // edited files
  deleted: number;    // removed files
  renamed: number;
}

// VS Code Git API status codes for index changes.
// 0=INDEX_MODIFIED, 1=INDEX_ADDED, 2=INDEX_DELETED, 3=INDEX_RENAMED, 4=INDEX_COPIED
export function stagedFacts(repo: Repository): StagedFacts {
  const changes = repo.state.indexChanges;
  const rel = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false);
  const facts: StagedFacts = { files: [], added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const c of changes) {
    facts.files.push(rel(c.uri));
    switch (c.status) {
      case 1: facts.added++; break;
      case 2: facts.deleted++; break;
      case 3: facts.renamed++; break;
      case 4: facts.renamed++; break;
      default: facts.modified++; break;
    }
  }
  return facts;
}

// Combined staged+unstaged diff text for the message engine to read.
// Best-effort: any failure (e.g. no repo, git error) yields "" rather than throwing,
// since the message engine must still fall back to count-based summaries.
export async function readDiffText(repo: Repository): Promise<string> {
  try {
    const [staged, unstaged] = await Promise.all([
      repo.diff(true),
      repo.diff(false),
    ]);
    return `${staged ?? ""}\n${unstaged ?? ""}`;
  } catch {
    return "";
  }
}

// Facts about everything that WOULD be committed in the one-click flow
// (staged + unstaged + untracked), so the previewed message matches reality.
export function allChangeFacts(repo: Repository): StagedFacts {
  const rel = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false);
  const facts: StagedFacts = { files: [], added: 0, modified: 0, deleted: 0, renamed: 0 };

  const bump = (status: number) => {
    switch (status) {
      case 1: facts.added++; break;   // added (index)
      case 2: facts.deleted++; break;
      case 3: case 4: facts.renamed++; break;
      case 6: facts.deleted++; break; // deleted (working tree)
      case 7: facts.added++; break;   // untracked
      default: facts.modified++; break;
    }
  };

  for (const c of repo.state.indexChanges) { facts.files.push(rel(c.uri)); bump(c.status); }
  for (const c of repo.state.workingTreeChanges) { facts.files.push(rel(c.uri)); bump(c.status); }
  for (const c of repo.state.untrackedChanges) { facts.files.push(rel(c.uri)); facts.added++; facts.files; }

  // De-dupe files that appear in both staged and unstaged lists.
  facts.files = Array.from(new Set(facts.files));
  return facts;
}


// Determines whether the latest commit can be safely undone.
// Safe when there is at least one local commit not yet on the remote
// (ahead > 0), or when there is no upstream at all (nothing was pushed).
export function canSafelyUndo(repo: Repository): { safe: boolean; reason: string } {
  const head = repo.state.HEAD;
  if (!head) {
    return { safe: false, reason: "No HEAD commit found." };
  }
  const hasUpstream = !!head.upstream;
  const ahead = head.ahead ?? 0;

  if (!hasUpstream) {
    // No tracking branch — nothing has been pushed anywhere.
    return { safe: true, reason: "No upstream; commit is local only." };
  }
  // With an upstream, only allow undo when we can POSITIVELY confirm the commit
  // is unpushed (ahead > 0). If ahead is undefined/unknown for any reason,
  // fail safe: refuse rather than risk rewriting pushed history.
  if (head.ahead !== undefined && ahead > 0) {
    return { safe: true, reason: `${ahead} local commit(s) not yet pushed.` };
  }
  return {
    safe: false,
    reason:
      head.ahead === undefined
        ? "Could not confirm this commit is unpushed. Refusing undo to be safe."
        : "The latest commit appears to be pushed. Undoing published history is unsafe.",
  };
}