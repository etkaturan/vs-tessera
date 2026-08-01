// Deterministic commit-message engine.
// Turns raw facts about staged changes into an honest Conventional Commit line.
// No vscode import — pure and unit-testable. Never inflates scope.

export interface MessageFacts {
  files: string[];
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
}

type CommitType = "feat" | "fix" | "docs" | "test" | "chore" | "style" | "refactor";

const DOC_RE = /\.(md|mdx|txt|rst|adoc)$/i;
const TEST_RE = /(\.|_|\/)(test|spec)\.[jt]sx?$|(^|\/)tests?\//i;
const STYLE_RE = /\.(css|scss|sass|less)$/i;
const CONFIG_RE =
  /(^|\/)(package\.json|package-lock\.json|tsconfig.*\.json|\.gitignore|\.vscodeignore|.*\.ya?ml|.*\.toml|.*\.config\.[jt]s)$/i;
const SOURCE_RE = /\.[jt]sx?$|\.(py|rs|go|java|c|cpp|cs|rb|php)$/i;

function classifyType(f: MessageFacts): CommitType {
  const files = f.files;
  const all = (re: RegExp) => files.length > 0 && files.every((p) => re.test(p));
  const any = (re: RegExp) => files.some((p) => re.test(p));

  // Homogeneous change sets get the specific type.
  if (all(DOC_RE)) return "docs";
  if (all(TEST_RE)) return "test";
  if (all(STYLE_RE)) return "style";
  if (all(CONFIG_RE)) return "chore";

  // New source files present, nothing deleted → most likely a feature.
  if (f.added > 0 && any(SOURCE_RE) && f.deleted === 0) return "feat";

  // Only edits to existing source → refactor if broad, fix if narrow.
  if (f.modified > 0 && f.added === 0 && f.deleted === 0 && any(SOURCE_RE)) {
    return f.modified >= 4 ? "refactor" : "fix";
  }

  // Mixed / unclear: default to chore rather than inventing something grander.
  return "chore";
}

function deriveScope(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const parts = files.map((p) => p.split("/"));
  // Common leading directory across all files.
  const first = parts[0];
  let common = "";
  for (let i = 0; i < first.length - 1; i++) {
    const seg = first[i];
    if (parts.every((p) => p[i] === seg)) {
      common = seg;
    } else {
      break;
    }
  }
  // Prefer the last meaningful segment (e.g. src/core -> core), skip "src".
  if (!common || common === "src") {
    // try one level deeper
    const second = parts.every((p) => p.length > 1 && p[0] === "src")
      ? parts[0][1]
      : "";
    if (second && parts.every((p) => p[1] === second)) {
      return stripExt(second);
    }
    return undefined;
  }
  return stripExt(common);
}

function stripExt(s: string): string {
  return s.replace(/\.[^.]+$/, "");
}

// Matches one declaration name per added diff line. Order matters: the first
// pattern that matches a given line wins, so more specific forms (e.g. an
// exported const) are listed before broader ones (e.g. any const/let).
const DECLARATION_PATTERNS: RegExp[] = [
  // JS/TS named function
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/,
  // JS/TS class (also covers Python-style "class Name:" via the separate pattern below)
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  // JS/TS exported const (covers plain exports and exported arrow components)
  /\bexport\s+(?:default\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/,
  // JS/TS arrow function/component assigned to a const or let
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^=]*\)\s*=>/,
  // Python function
  /\bdef\s+([A-Za-z_]\w*)\s*\(/,
  // Rust function
  /\bfn\s+([A-Za-z_]\w*)\s*[(<]/,
  // Rust struct
  /\bstruct\s+([A-Za-z_]\w*)/,
  // Rust enum
  /\benum\s+([A-Za-z_]\w*)/,
  // Go function or method (receiver optional)
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
];

// A unified-diff "file header" line also starts with "+++"; don't mistake it
// for an added code line.
const DIFF_FILE_HEADER_RE = /^\+\+\+ (a\/|b\/|\/dev\/null)/;

// Extracts names of new declarations (functions, classes, exported consts,
// arrow components, structs, enums) from added lines in a unified diff.
// Deduplicated, in first-seen order. Never returns a name that isn't
// literally present in an added line — Tessera must not invent scope.
export function extractDeclaredNames(diffText: string): string[] {
  if (!diffText) return [];
  const seen = new Set<string>();
  const names: string[] = [];

  for (const raw of diffText.split(/\r?\n/)) {
    if (!raw.startsWith("+") || DIFF_FILE_HEADER_RE.test(raw)) continue;
    const content = raw.slice(1);
    for (const re of DECLARATION_PATTERNS) {
      const match = content.match(re);
      if (match && match[1]) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          names.push(match[1]);
        }
        break; // one declaration per line is enough
      }
    }
  }
  return names;
}

function summarizeWithNames(f: MessageFacts, names: string[]): string {
  const verb = f.added ? "add" : f.deleted ? "remove" : "update";
  return `${verb} ${names.slice(0, 3).join(", ")}`;
}

function summarize(f: MessageFacts): string {
  const bits: string[] = [];
  if (f.added) bits.push(`add ${f.added} file${f.added > 1 ? "s" : ""}`);
  if (f.modified) bits.push(`update ${f.modified} file${f.modified > 1 ? "s" : ""}`);
  if (f.deleted) bits.push(`remove ${f.deleted} file${f.deleted > 1 ? "s" : ""}`);
  if (f.renamed) bits.push(`rename ${f.renamed} file${f.renamed > 1 ? "s" : ""}`);

  if (bits.length === 0) return "update files";

  // If a single file, name it — more informative than a count.
  if (f.files.length === 1) {
    const name = f.files[0].split("/").pop() ?? f.files[0];
    const verb = f.added ? "add" : f.deleted ? "remove" : "update";
    return `${verb} ${name}`;
  }

  return bits.join(", ");
}

export function buildMessage(f: MessageFacts, diffText?: string): string {
  const type = classifyType(f);
  const scope = deriveScope(f.files);
  const names = diffText ? extractDeclaredNames(diffText) : [];
  const summary = names.length > 0 ? summarizeWithNames(f, names) : summarize(f);
  const head = scope ? `${type}(${scope})` : type;
  return `${head}: ${summary}`;
}