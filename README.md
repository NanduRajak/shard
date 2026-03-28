# Shard

Shard is an autonomous web QA app with a GitHub review bot.

It can:

- run live QA sessions against a URL in Steel cloud or your own local Chrome
- execute task-driven browser workflows such as adding an item to cart or creating a record
- queue multi-agent background QA batches for the same site or multiple sites
- capture findings, screenshots, traces, performance audits, and run timelines
- generate archived QA reports with coverage, task outcome, and prioritized defects
- review GitHub pull requests with tracked repositories and rerunnable PR reviews

## Product areas

### Web QA

Shard supports three QA execution paths:

- `Cloud session`: interactive run in Steel with live preview
- `Local session`: interactive run in your own Chrome through the local helper
- `Background agents`: queued Playwright workers for long-running scans and batch jobs

All three paths now use the same shared QA engine for:

- planning and fallback behavior
- safe action rules
- task completion checks
- browser finding capture
- Lighthouse selection
- scoring and report generation

### Saved credentials

Shard can store website credentials and use them during QA runs when a login wall blocks useful exploration. Credentials stay outside the model and are injected by runtime code.

### Reports and history

Every run stores:

- findings with severity, confidence, impact, and score
- runtime browser signals for console, network, and page errors
- screenshots and HTML report artifacts
- optional Playwright trace or Steel replay links
- route coverage and performance audit results

Completed runs can be reviewed from the history page. Active runs stream a filtered timeline focused on QA-relevant actions and findings.

### Dashboard

The dashboard shows recent QA runs, run status counts, and Lighthouse deltas for completed scans.

### Review bot

Shard also includes a GitHub review bot that can:

- connect to GitHub
- track repositories and pull requests
- run PR reviews
- surface findings and review summaries
- rerun reviews for tracked PRs

## How QA runs work

### Prompt format

The home page accepts a prompt that contains:

- a URL only for exploratory QA
- a URL plus instructions for task-driven QA

Examples:

```text
https://shop.example.com
```

```text
https://shop.example.com add Sony headphones to cart and verify the cart flow
```

### Run modes

- If the prompt contains only a URL, Shard creates an `explore` run.
- If the prompt contains a URL plus extra text, Shard creates a `task` run.

### Browser providers

- `steel`: hosted cloud session with live preview
- `local_chrome`: your own Chrome through the local helper
- `playwright`: background worker mode used by background agents

## Background agents

Shard supports two background batch patterns:

- `Site-first batch`: one site, multiple agents, optional shared task, auto-sharded coverage lanes
- `Advanced multi-site batch`: one row per agent for different sites or different tasks

Same-site batches produce a merged batch report with:

- deduped findings
- shared coverage summary
- merged performance audits
- per-agent timeline lanes

Multi-site batches stay separated by agent and site.

## Main routes

- `/` home run launcher
- `/runs/$runId` live run timeline
- `/history` archived run list
- `/history/$runId` archived QA report
- `/background-agents` queued and merged background QA
- `/credentials` saved website logins
- `/dashboard` recent QA overview
- `/review-bot` GitHub review bot

## Tech stack

- TanStack Start
- React
- Convex
- Inngest
- Playwright
- Steel
- AI SDK
- Gemini
- Lighthouse
- Chrome DevTools MCP
- Probot and Octokit

## Local development

### Requirements

- Node.js
- pnpm
- a Convex deployment
- Steel API access for cloud runs
- Gemini API access
- optional GitHub app credentials for the review bot
- optional local Chrome setup for local runs

### Main scripts

```bash
pnpm dev
pnpm inngest:dev
pnpm local-helper
pnpm test
pnpm typecheck
pnpm lint
```

### Typical dev workflow

1. Start the app:

```bash
pnpm dev
```

2. Start the Inngest worker in another terminal:

```bash
pnpm inngest:dev
```

3. If you want local Chrome runs, start the helper:

```bash
pnpm local-helper
```

4. If you use Convex locally, run your Convex dev process in parallel.

## Environment variables

Important server-side environment variables include:

- `VITE_CONVEX_URL`
- `STEEL_API_KEY`
- `GEMINI_API_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `LOCAL_HELPER_SECRET`
- `QA_DIRECT_RUN_FALLBACK`
- `APP_BASE_URL`

Optional GitHub and review-bot variables include:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_TOKEN`
- `GITHUB_WEBHOOK_SECRET`
- `REVIEW_BOT_SECRET`

Inngest-related variables include:

- `INNGEST_BASE_URL`
- `INNGEST_DEV`
- `INNGEST_EVENT_KEY`
- `INNGEST_SERVE_ORIGIN`
- `INNGEST_SIGNING_KEY`

## Data model

Core records stored in Convex include:

- `runs`
- `runEvents`
- `findings`
- `artifacts`
- `performanceAudits`
- `sessions`
- `backgroundBatches`
- `credentials`
- `localHelpers`
- `trackedRepos`
- `trackedPullRequests`
- `prReviews`

## Current behavior

- Shard focuses on web application QA.
- Mobile application testing is not in scope.
- The agent is allowed to perform safe, reversible task actions.
- The agent blocks destructive actions, final purchase submission, payment submission, and irreversible confirmations.
- Task runs are marked complete only when the visible UI provides proof.

## Notes

- Cloud and local interactive runs are launched from the home page.
- Background Playwright runs are launched from the background agents page.
- The dashboard is intentionally lightweight today and can be expanded later.
