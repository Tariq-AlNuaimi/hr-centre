---
name: new-project
description: One-prompt orchestrator — turns a paragraph-long idea into a fresh GitHub repo with scaffolded entities, deployed to staging, in one run. Claude proposes the entity model, commits a plan JSON, then triggers the `new-project.yml` GitHub Actions workflow (ADR-004). Use when the user says "new project", "spin up a tracker for...", "start a new app", "/new-project", "from scratch".
---

# /new-project — Idea to live staging URL (CI-driven)

Highest-leverage skill in the template: one Claude prompt → working staging
URL in ~10 minutes, no manual GitHub clicks.

> **Executes via GH Actions workflow.** Claude reasons about the idea,
> proposes entities, commits a plan JSON to `plans/<ts>-<slug>.json` via the
> GitHub MCP `push_files` tool, then composes a `gh workflow run
> new-project.yml` command. See ADR-004.

## Flow

### 1. Gather + propose

If the operator types `/new-project` with no arguments, ask:
- A paragraph describing the project (what it does, who uses it, what it
  tracks).
- A project slug (kebab-case, e.g. `rihal-tasks`).
- Display name (e.g. `Rihal Tasks`).
- A staging domain (e.g. `tasks.staging.rihal.com`).
- (Optional) GitHub owner — defaults to the operator's gh user.

If the operator passes the description inline, skip to proposing.

### 2. Propose an entity model

Read the description. Propose entities + fields + relations + enums, in
exactly the `/scaffold-entity` flag formats:

```
Entity:    Project
  fields:    name:string,code:string
  enums:     status:ACTIVE|ARCHIVED

Entity:    Task
  fields:    title:string,description:text?,dueAt:date?
  enums:     status:TODO|IN_PROGRESS|DONE,priority:LOW|MED|HIGH
  relations: project:Project,assignee:User?
```

**Always wait for operator confirmation before committing.**

### 3. Commit the plan JSON

Claude writes the plan to `plans/<YYYYMMDD-HHmmss>-<slug>.json` in the
template repo (where the workflow lives — `new-project.yml` reads this
path). The plan has the shape:

```json
{
  "slug": "task-tracker",
  "displayName": "Task Tracker",
  "ghOwner": "tariq-alnuaimi",
  "domain": "tasks.example.com",
  "env": "staging",
  "entities": [
    {
      "name": "Task",
      "fields": "title:string!,description:string,dueAt:datetime",
      "enums": "status:TODO|IN_PROGRESS|DONE",
      "relations": "assignee:User?"
    }
  ]
}
```

(The script normalizes `ghOwner` → `owner` and accepts the existing fuller
shape as well; see `head -40 scripts/new-project.mjs`.)

Commit path: `plans/<UTC-timestamp>-<slug>.json`. Use the GitHub MCP
`mcp__github__push_files` tool with a commit message like
`chore(plans): add <slug> new-project plan`. Falls back to instructing the
operator to `git add` and `git push` the plan if MCP isn't available.

### 4. Trigger the workflow

```sh
gh workflow run new-project.yml \
  -f plan_path=plans/20260518-170000-task-tracker.json
```

### 5. Tail

Claude attempts via MCP (`mcp__github__list_workflow_runs` if exposed) and
falls back to:

```sh
gh run watch
```

### 6. What the workflow does

1. Validates plan exists + parses as JSON.
2. Restores `.deploy-state.staging.json` from the state branch.
3. `npm ci` + installs `SSH_PRIVATE_KEY`.
4. Runs `scripts/new-project.mjs --plan <path> --yes` with all credentials
   from repo / env secrets (no `--*-token` flags needed):
   - Creates `<owner>/<slug>` from template via the GH API.
   - Clones into the runner workspace.
   - Runs `npm run rebrand`.
   - For each entity: `npm run scaffold -- --name ... --fields ...`.
   - Commits + pushes initial scaffold to `main`.
   - Calls `node scripts/deploy.mjs --env staging --domain ... --yes`.
5. Persists staging state back to `deployment-state`.

Total runtime: ~8–12 min.

## Refusal cases

- Plan entity model contradicts itself (e.g. relation target doesn't exist)
  → fix in the proposal step before committing.
- Repo already exists with content → script warns and reuses; operator may
  want a fresh name.
- Required repo secrets missing (`GH_AUTOMATION_TOKEN`, `DO_API_TOKEN`, etc.)
  → workflow fails fast on the deploy step; rerun `/first-fork`.

## Report back

```
Repo: https://github.com/<owner>/<slug>
Plan: plans/<ts>-<slug>.json
3 entities scaffolded: Project, Task, Comment
Staging live: https://tasks.staging.rihal.com
Portainer: (admin password in deployment-state .deploy-state.staging.json)
Next:
  - clone locally to iterate
  - /promote when ready
```

## Read before
- `.github/workflows/new-project.yml`
- `scripts/new-project.mjs` — orchestrator
- `scripts/scaffold-entity.mjs` — entity codegen
- `scripts/deploy.mjs` — chained for staging deploy
- ADR-004
