// Pure secret-scanner for Tessera's pre-commit gate.
// No vscode import — unit-testable. Returns findings; the commit flow decides.
// This is a practical safety net for common high-risk cases, NOT a
// compliance-grade tool (gitleaks/trufflehog cover that space).

export type Severity = "block" | "warn";

export interface Finding {
  file: string;
  line?: number;         // 1-based; undefined for filename-only findings
  reason: string;
  severity: Severity;
  kind: "filename" | "content"; // whole-file concern vs. a line inside otherwise-legitimate content
}

interface FilenameRule {
  test: RegExp;
  exclude?: RegExp; // matches here override a `test` hit — e.g. template/example files
  reason: string;
  severity: Severity;
}

interface ContentRule {
  test: RegExp;
  reason: string;
  severity: Severity;
}

const FILENAME_RULES: FilenameRule[] = [
  {
    test: /(^|\/)\.env(\.|$)/i,
    // Template/example env files are meant to be committed — no real values.
    // Their *content* is still scanned by CONTENT_RULES in case someone
    // pastes a real secret into one by mistake.
    exclude: /\.(example|sample|template|dist|defaults?)$/i,
    reason: "environment file (.env)",
    severity: "block",
  },
  { test: /\.pem$/i, reason: "PEM file", severity: "block" },
  { test: /\.key$/i, reason: "key file", severity: "block" },
  { test: /(^|\/)id_rsa$/i, reason: "SSH private key", severity: "block" },
  { test: /(^|\/)id_ed25519$/i, reason: "SSH private key", severity: "block" },
  { test: /credentials\.json$/i, reason: "credentials file", severity: "block" },
  { test: /service-account.*\.json$/i, reason: "service-account key", severity: "block" },
  { test: /\.vsix$/i, reason: "packaged extension artifact", severity: "warn" },
  { test: /(^|\/)\.vscode\/settings\.json$/i, reason: "machine-local VS Code settings", severity: "warn" },
];

const CONTENT_RULES: ContentRule[] = [
  { test: /sk-ant-[a-zA-Z0-9_-]{16,}/, reason: "Anthropic API key", severity: "block" },
  { test: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key ID", severity: "block" },
  { test: /\bghp_[a-zA-Z0-9]{30,}\b/, reason: "GitHub personal access token", severity: "block" },
  { test: /\bgithub_pat_[a-zA-Z0-9_]{40,}\b/, reason: "GitHub fine-grained token", severity: "block" },
  { test: /\bAIza[0-9A-Za-z_-]{35}\b/, reason: "Google API key", severity: "block" },
  { test: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, reason: "private key block", severity: "block" },
  { test: /\bsk-[a-zA-Z0-9]{32,}\b/, reason: "generic secret key (sk-…)", severity: "warn" },
  { test: /(SECRET|API_?KEY|TOKEN|PASSWORD)\s*[:=]\s*['"][^'"]{12,}['"]/i, reason: "hardcoded secret assignment", severity: "warn" },
];

export interface ScanTarget {
  file: string;
  content: string;
}

export function scanFilename(file: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of FILENAME_RULES) {
    if (rule.test.test(file) && !(rule.exclude && rule.exclude.test(file))) {
      findings.push({ file, reason: rule.reason, severity: rule.severity, kind: "filename" });
    }
  }
  return findings;
}

export function scanContent(target: ScanTarget): Finding[] {
  const findings: Finding[] = [];
  const lines = target.content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of CONTENT_RULES) {
      if (rule.test.test(lines[i])) {
        findings.push({
          file: target.file,
          line: i + 1,
          reason: rule.reason,
          severity: rule.severity,
          kind: "content",
        });
      }
    }
  }
  return findings;
}

export function scan(targets: ScanTarget[]): Finding[] {
  const findings: Finding[] = [];
  for (const t of targets) {
    findings.push(...scanFilename(t.file));
    findings.push(...scanContent(t));
  }
  return findings;
}

export function hasBlocking(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "block");
}