# Contributing to gravity-lite

Thanks for taking the time to contribute! Every bug report, doc fix, and code improvement makes gravity-lite better for everyone.

This project is MIT licensed — anything you contribute ships under the same terms.

---

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Workflow](#workflow)
- [Commit Messages](#commit-messages)
- [Pull Request Checklist](#pull-request-checklist)
- [Response Time](#response-time)

---

## Ways to Contribute

**🐛 Report a bug**
Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include steps to reproduce, expected vs actual behavior, and your OS/Chrome/Node versions.

**💡 Suggest a feature**
Open an issue using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the problem it solves before proposing a solution. For new MCP tools, explain what CDP data they expose and why an AI assistant would need it.

**📝 Fix docs**
Typos, unclear steps, missing examples — all welcome, no issue required.

**🔧 Submit code**
Look for issues labeled `good first issue` or `help wanted`. For anything larger, open an issue first so we can align before you invest time.

---

## Development Setup

**Prerequisites:** Node.js ≥ 16, Chrome ≥ 116

```bash
# 1. Fork the repo, then clone your fork
git clone https://github.com/YOUR_USERNAME/gravity-lite.git
cd gravity-lite

# 2. Install dependencies
npm install

# 3. Add the upstream remote
git remote add upstream https://github.com/DharuNamikaze/gravity-lite.git

# 4. Build
npm run build    # compiles src/ → dist/
```

**Project layout**

| Path | What lives here |
|---|---|
| `src/` | TypeScript source — MCP server, bridge, diagnostics, CLI |
| `extension/` | Chrome MV3 extension (background, offscreen, popup) |
| `dist/` | Compiled output (generated, do not edit) |
| `test/` | Test pages |

---

## Workflow

```bash
# 1. Sync with upstream before starting
git fetch upstream
git rebase upstream/main

# 2. Create a focused branch
git checkout -b fix/stacking-context-detection
# or
git checkout -b feat/add-animation-tool

# 3. Make changes, build, verify
npm run build

# 4. Push and open a PR against main
git push origin your-branch-name
```

**Branch naming**

| Prefix | When to use |
|---|---|
| `feat/` | New feature or MCP tool |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code cleanup, no behavior change |
| `chore/` | Build, deps, config |

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

**Types:** `feat` · `fix` · `docs` · `refactor` · `test` · `chore`

**Scope** (optional): `bridge` · `mcp` · `extension` · `cli` · `diagnostics`

**Examples**

```
feat(mcp): add get_animation_state tool
fix(bridge): handle reconnect when tab is reloaded
docs: clarify GRAVITY_PORT env variable
refactor(diagnostics): extract overflow detection helper
```

Keep the subject line under 72 characters. Use the body for *why*, not *what*.

---

## Pull Request Checklist

Before opening a PR, run through this list:

- [ ] `npm run build` completes without errors
- [ ] Changes are scoped to one fix or feature
- [ ] New MCP tools are added to the Tools table in `README.md`
- [ ] No unrelated files are included in the diff
- [ ] Commit messages follow the Conventional Commits format above

Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md) when you open the PR.

---

## Response Time

We aim to review PRs within **7 days**. If you haven't heard back after that, feel free to leave a comment — it won't be seen as pushy.

---

[npm](https://www.npmjs.com/package/gravity-lite) · [GitHub](https://github.com/DharuNamikaze/gravity-lite)
