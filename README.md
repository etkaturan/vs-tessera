# Tessera

**One-click, honest git commits — right from your VS Code sidebar.**

A *tessera* is a single tile in a mosaic. Every commit is one tile; your work, over time, is the mosaic. Tessera helps you lay each tile without the friction of typing `git add`, `git commit`, and `git push` by hand — while keeping every commit an honest reflection of what you actually changed.

---

## Why

Committing often is good practice, but the friction adds up: check status, stage files, think of a message, commit, push. That friction is why small, real progress goes uncommitted. Tessera collapses it into a single click — so you commit more of the work you genuinely do.

**Tessera never fabricates work.** No empty commits, no filler changes, no gaming the contribution graph. If there's no real diff, there's no commit. The only thing it automates is the typing.

## Features

- **Live working-tree panel** — see your branch, staged/changed/new counts, and every changed file at a glance.
- **One-click commit & push** — stages everything, generates a Conventional Commit message from the actual diff, commits, and pushes.
- **Editable messages** — the generated message is a starting point; tweak or rewrite it before committing.
- **Commit without push** — keep work local when you want to; it pushes when you choose.
- **Safe undo** — undo your last commit (a soft reset that keeps all your changes). Tessera refuses to undo commits that are already pushed, so you can't accidentally rewrite published history.
- **Built-in secret gate** — before every commit, Tessera scans for likely secrets (API keys, private keys, `.env` files, and more) and blocks the commit if it finds one.

## The secret gate

Tessera scans staged content and filenames for common high-risk patterns — Anthropic/OpenAI/AWS/GitHub tokens, private-key blocks, `.env` and credential files — and **blocks** the commit when it finds something dangerous, or **warns** on borderline cases.

> **This is a safety net, not a security guarantee.** It catches common mistakes; it is not a replacement for dedicated tools like `gitleaks` or `trufflehog`, and it won't catch every possible secret. Treat it as a helpful last check, not your only line of defense.

## Commit messages

Messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `docs:`, `chore:`, etc.), derived from what actually changed in the diff. Tessera won't inflate a small change into something grander than it is — a one-line style tweak is `style:`, not `refactor:`. Honest history is the point.

## Requirements

- VS Code 1.85 or newer
- Git installed and available on your PATH

## Install

**From a packaged build:**
1. Download the latest `.vsix` from the [Releases](https://github.com/etkaturan/vs-tessera/releases) page.
2. In VS Code: run `Extensions: Install from VSIX…` from the Command Palette, and select the file.

**From source:**
```bash
git clone https://github.com/etkaturan/vs-tessera.git
cd vs-tessera
npm install
npm run compile
```
Press `F5` to launch an Extension Development Host with Tessera loaded.

## Usage

1. Open the **Tessera** icon in the activity bar.
2. Make changes in your repo — the panel updates live.
3. Review or edit the suggested commit message.
4. Click **Commit & Push** (or **Commit only**).

## Roadmap

- Smarter messages that summarize *what* the code does, not just which files changed
- Optional local-LLM message generation (privacy-preserving, no cloud)
- A `.gitignore` generator for new projects
- Companion PWA for committing small work from any device
- Continuous integration and a test suite

## License

MIT © [etkaturan](https://github.com/etkaturan)