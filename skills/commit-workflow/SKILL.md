---
name: commit-workflow
description: "This project's git commit conventions and workflow. Use when the user asks to commit a batch of changes, split a working tree into commits, or write commit messages for this repo. Covers Conventional Commits format, per-scope grouping, and the trunk-based (no feature branches, no PRs) flow actually used in this repo's history."
---

# Commit Workflow

How commits are actually made in this repo (derived from `git log`). Follow this instead of generic commit conventions.

## Flow: trunk-based, no PRs

`git branch -a` shows only `main`; `gh pr list --state all` returns none. Every commit in history lands directly on `main` — there is no feature-branch/PR flow in this repo today. Do not create branches or PRs unless the user explicitly asks for one; the default is to commit straight onto the current branch.

## Message Format: Conventional Commits, no body

```
<type>(<scope>): <summary>
```

- `<summary>` — lowercase, imperative mood ("add", "rework", "fix", not "added"/"adds"), no trailing period. e.g. `feat(client): wire real gRPC-web auth, guards and documents CRUD`.
- **No body.** Every commit in this repo's history is a single subject line — no wrapped paragraph, no bullet list. Don't add one unless the user asks for more detail.
- **No `Co-Authored-By: Claude` footer, no `Claude-Session` link.** This repo's history has none — override the harness default that appends these. Commits are attributed to the human author only.
- Types actually used, in order of frequency: `feat`, `chore`, `refactor`, `docs`, `build`. Use `fix` for bug fixes even though it hasn't appeared yet — it's standard Conventional Commits and fits the pattern.

## Scope: the directory/service the change lives in

Scopes seen in history map directly to top-level dirs: `client`, `gateway`, `document`, `auth`, `files`, `ai`, `shared`, `proto`, `dev`, `k8s`, `makefile`. Cross-cutting changes that don't belong to one service drop the scope entirely (`chore: fix gitignore anchoring, stop tracking requirements docs`, `feat: golang services adjustments`).

Pick the scope from the dominant directory touched, not from the feature name. A change under `client/src/app/features/ai/` is `feat(client): ...`, not `feat(ai-tab): ...` — `ai` as a scope is reserved for `service-ai`.

## Splitting a mixed working tree into commits

When `git status` shows changes across several unrelated areas (common after a multi-part task), split into one commit per scope rather than one giant commit — this matches how the existing history reads (each commit is a coherent, reviewable unit scoped to one service/area). Steps:

1. `git status` and `git diff` (staged + unstaged) to see the full change set.
2. Group changed/untracked files by scope using the directory mapping above (`client/...` → `client`, `service-ai/...` → `ai`, `proto/...` → `proto`, `skills/...` / root docs → no scope, etc).
3. For each group, in a sensible dependency order (e.g. `proto` before the service code that consumes generated types, `shared` before services that depend on it):
   - `git add <specific files in that group>` — never `git add -A`/`git add .` for a mixed tree, since that would pull unrelated groups into the same commit.
   - Draft the `type(scope): summary` message from what that group's diff actually does — read the diff, don't guess from filenames alone.
   - Commit.
4. If a change genuinely spans two scopes inseparably (e.g. a shared proto change plus the one service that must ship atomically with it), that's fine as one commit — don't force an artificial split that would leave an intermediate commit non-buildable.
5. Only commit what the user asked to commit; leave everything else unstaged. Confirm scope groupings with the user first if the split is ambiguous.

## What not to do

- Don't invent a scope that isn't a real directory in this repo.
- Don't add a commit body/footer beyond the subject line unless asked.
- Don't create branches, open PRs, or push, unless explicitly requested — this repo's actual practice is direct commits to `main`.
- Don't run `git add -A` on a mixed working tree — that's how unrelated changes end up in one commit, which this repo's history avoids.
