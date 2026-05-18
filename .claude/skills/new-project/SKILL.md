---
name: new-project
description: One-prompt orchestrator — turns a paragraph-long idea into a fresh GitHub repo with scaffolded entities, deployed to staging, in one run. Claude reasons about the entity model, the operator confirms or edits, then `scripts/new-project.mjs` chains repo-create → rebrand → scaffold (per entity) → deploy. Use when the user says "new project", "spin up a tracker for...", "start a new app", "/new-project", "from scratch", or describes a project idea expecting an end-to-end skeleton.
---

# /new-project — Idea to live staging URL

This is the highest-leverage skill in the template. One Claude prompt → working staging URL in ~10 minutes, no manual GitHub clicks.

## Flow

### 1. Gather + propose

If the operator types `/new-project` with no arguments, ask:
- A paragraph describing the project (what it does, who uses it, what it tracks)
- A project slug (kebab-case, e.g. `rihal-tasks`)
- Display name (e.g. `Rihal Tasks`)
- A staging domain (e.g. `tasks.staging.rihal.com`)
- (Optional) GitHub owner — defaults to the operator's gh user

If the operator passes the description inline (`/new-project "Internal task tracker..."`), skip to proposing.

### 2. Propose an entity model

Read the description. Propose entities + fields + relations + enums. Match the `/scaffold-entity` flag formats exactly:

```
Entity:    Project
  fields:    name:string,code:string
  enums:     status:ACTIVE|ARCHIVED

Entity:    Task
  fields:    title:string,description:text?,dueAt:date?
  enums:     status:TODO|IN_PROGRESS|DONE,priority:LOW|MED|HIGH
  relations: project:Project,assignee:User?

Entity:    Comment
  fields:    body:text
  relations: task:Task,author:User
```

**Always wait for operator confirmation before running.** The operator can edit field types, add/remove entities, change relations, or accept verbatim.

### 3. Build the plan JSON

Write `/tmp/new-project.json` with the locked shape (see `head -30 scripts/new-project.mjs`):

```json
{
  "templateOwner": "tariq-alnuaimi",
  "templateRepo":  "fullstack-vibe-template",
  "owner":         "tariq-alnuaimi",
  "slug":          "rihal-tasks",
  "displayName":   "Rihal Tasks",
  "description":   "Internal task tracker",
  "domain":        "tasks.staging.rihal.com",
  "entities": [
    { "name": "Project", "fields": "name:string,code:string", "enums": "status:ACTIVE|ARCHIVED", "relations": null },
    { "name": "Task", "fields": "title:string,description:text?,dueAt:date?", "enums": "status:TODO|IN_PROGRESS|DONE,priority:LOW|MED|HIGH", "relations": "project:Project,assignee:User?" },
    { "name": "Comment", "fields": "body:text", "enums": null, "relations": "task:Task,author:User" }
  ]
}
```

### 4. Gather deploy credentials

Same as `/deploy` (DO token, CF token, GH token, SSH pubkey, Caddy email). Reuse from a prior `/deploy` if the operator has them in env vars or `~/.netrc`.

### 5. Run the orchestrator

```
npm run new-project -- \
  --plan /tmp/new-project.json \
  --gh-token ghp_... \
  --do-token dop_v1_... \
  --cf-token <token> \
  --ssh-pubkey "$(cat ~/.ssh/id_ed25519.pub)" \
  --caddy-email you@example.com \
  --yes
```

What it does:
1. Creates the repo from the template via `POST /repos/<template-owner>/<template>/generate`
2. Clones into a temp workdir
3. Runs `npm run rebrand -- --slug ... --name ...`
4. For each entity: `npm run scaffold -- --name ... --fields ...`
5. Commits + pushes initial scaffold to `main`
6. Calls `npm run deploy -- --env staging --domain ... --yes` (the full Stage 1 pipeline)

Total time: ~8-10 min.

### 6. Report

```
✅ Repo: https://github.com/<owner>/<slug>
✅ Local workdir: /tmp/new-project-XXXX/<slug>
✅ Rebranded
✅ 3 entities scaffolded: Project, Task, Comment
✅ Staging live: https://tasks.staging.rihal.com
✅ Portainer: https://<ip>:9443 (password in .deploy-state.staging.json)
Next:
  cd /tmp/new-project-XXXX/<slug>
  # iterate locally; commits to main re-deploy via docker-build.yml
  # when ready: npm run promote -- --sha HEAD --gh-token ghp_... --yes
```

## Refusal cases

- Entity model contradicts itself (e.g. relation target doesn't exist) → fix in the proposal step before running.
- Repo already exists with content → script warns and reuses; operator may want a fresh name.
- Operator skipped credential setup → falls through to `/first-fork` checklist for any leftover.

## Read before
- `scripts/new-project.mjs` — orchestrator
- `scripts/scaffold-entity.mjs` — entity codegen (the heart of the loop)
- `scripts/deploy.mjs` — Stage 1 pipeline this skill chains into
