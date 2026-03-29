# Shard

Shard is an autonomous web QA app with a built-in GitHub review bot. It can run live browser sessions, launch background QA agents, store reusable site credentials, and turn runs into reports that are easier to review and share.

## What It Does

Shard currently supports these use cases:

- Exploratory QA by pasting a URL
- Task-driven QA by pasting a URL with instructions
- Live cloud browser sessions through Steel
- Live local browser sessions through the local helper and your own Chrome install
- Multi-agent background QA automation for a single site
- Saved login profiles matched to site origin
- Live run timelines with streamed status, findings, and artifacts
- Archived reports with findings, coverage, screenshots, traces, replay links, and Lighthouse data
- Dashboard views for recent runs and Lighthouse deltas
- GitHub PR reviews with repo tracking, pull request selection, reruns, and review summaries

## Quick Start

```bash
pnpm install
pnpm dev
docker-compose up -d
```

Optional local Chrome support:

```bash
pnpm local-helper
```

The app runs on `http://localhost:3000`.

Full setup, environment variables, and service wiring live in [SETUP.md](./SETUP.md).

## Typical Workflow

1. Start the app and Inngest worker.
2. Open `http://localhost:3000`.
3. Paste a URL for exploratory QA, or a URL plus instructions for task-driven QA.
4. Review the live run at `/runs/:runId` and archived results in `/history`.
5. Use `/credentials`, `/background-agents`, `/dashboard`, and `/review-bot` as needed.

Example prompts:

```text
https://shop.example.com
```

```text
https://shop.example.com add Sony headphones to cart and verify the cart flow
```

## Architecture Overview

- `src/routes`: TanStack Start routes for the app UI and API entry points
- `src/lib`: shared QA, reporting, scoring, and workflow logic
- `convex/`: persistent data layer for runs, findings, credentials, artifacts, and review state
- `inngest/`: background jobs for QA runs and PR review workflows
- `scripts/local-helper.ts`: local Chrome bridge for on-machine browser runs

At a high level, the app uses React and TanStack Start for the UI, Convex for state and storage, Inngest for async orchestration, and Playwright or Steel for browser execution.

## Stack

- TanStack Start
- React
- Convex
- Inngest
- Playwright
- Steel
- AI SDK
- OpenAI SDK
- Lighthouse
- Octokit and Probot

## Screenshots

-SCREENSHOTS HERE

## Notes

### Challenges

- Keeping cloud runs, local Chrome runs, and background agents aligned behind one QA flow
- Capturing useful artifacts without overwhelming the report surface
- Supporting stored credentials without exposing them directly to the model
- Making PR review state, reruns, and repository tracking feel consistent with the QA side of the app

### Assumptions

- A working Convex deployment is available
- OpenAI and Steel credentials are available for the environments where the app runs
- Site credentials are created inside the app when a target flow needs authentication

### Current Limitations

- Full functionality depends on external services such as Convex, Inngest, Steel, and OpenAI
- Local Chrome runs require the helper process and a compatible Chrome install on the same machine
- The GitHub review bot only works after the full GitHub App and OAuth configuration is in place
- No demo credentials or screenshots are bundled with the repo

## Verification

Useful commands:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Pre-submission checklist:

- Keep commits focused and readable
- Run the validation commands above
- Get a teammate review before submission
