# Setup

This file is the practical spin-up guide for running Shard locally.

## Prerequisites

- Node.js 22 or newer
- `pnpm` 10 or newer
- A working Convex deployment
- An OpenAI API key
- A Steel API key for hosted browser sessions
- Google Chrome, if you want local browser runs
- Docker, if you want to run the Inngest dev server with `docker compose`

Verified locally with:

- Node `v25.8.0`
- `pnpm` `10.28.0`

## Install Dependencies

```bash
pnpm install
```

## Environment Setup

Shard reads from `.env` and `.env.local`.

### Required for the app

```bash
VITE_CONVEX_URL=
CREDENTIAL_ENCRYPTION_KEY=
OPENAI_API_KEY=
STEEL_API_KEY=
```

### Recommended base app settings

```bash
APP_BASE_URL=http://localhost:3000
OPENAI_MODEL=
INNGEST_DEV=1
```

### Required for local Chrome mode

```bash
APP_BASE_URL=http://localhost:3000
LOCAL_HELPER_SECRET=
```

Optional local Chrome settings:

```bash
LOCAL_CHROME_BROWSER_URL=
LOCAL_HELPER_MACHINE_LABEL=
LOCAL_HELPER_ID=
```

### Required for the GitHub review bot

```bash
APP_BASE_URL=http://localhost:3000
REVIEW_BOT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_SLUG=
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
```

### Optional Inngest and workflow settings

```bash
INNGEST_BASE_URL=
INNGEST_SERVE_ORIGIN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
QA_DIRECT_RUN_FALLBACK=0
```

Notes:

- `CREDENTIAL_ENCRYPTION_KEY`, `LOCAL_HELPER_SECRET`, and `REVIEW_BOT_SECRET` should be long random strings.
- `QA_DIRECT_RUN_FALLBACK=1` is useful if you want QA jobs to run directly on the app server instead of waiting for the background worker.
- No demo credentials ship with this repo. Add site logins from the `/credentials` page when needed.

## Start the App

Run the web app:

```bash
pnpm dev
```

By default this starts Vite on `http://localhost:3000`.

## Start Inngest

Use one of these options in a separate terminal.

```bash
docker-compose up -d
```

## Optional: Start the Local Chrome Helper

If you want to run QA in your own Chrome window:

```bash
pnpm local-helper
```

The default mode launches a fresh visible Chrome window and drives it directly.

If you want to attach to an existing Chrome instance, first start Chrome with remote debugging enabled:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/shard-chrome-profile
```

Then start the helper like this:

```bash
LOCAL_CHROME_BROWSER_URL=http://127.0.0.1:9222 pnpm local-helper
```

## Optional: Convex Workflow

This repo expects a valid `VITE_CONVEX_URL`. If you manage your own Convex development deployment, run your usual Convex workflow alongside the app and keep `.env.local` pointed at that deployment.

## Running the Main Features

### 1. Exploratory QA

- Open `http://localhost:3000`
- Paste a URL such as `https://example.com`
- Choose a run mode
- Start the run

### 2. Task-Driven QA

- Paste a URL plus instructions
- Example:

```text
https://shop.example.com add Sony headphones to cart and verify the cart flow
```

### 3. Background Agents

- Open `/background-agents`
- Enter the target site URL
- Add an optional shared task
- Choose the number of agents
- Start the orchestrator

### 4. Saved Credentials

- Open `/credentials`
- Add a website URL, login, and password
- Mark the preferred login as default if you want it auto-selected later

### 5. GitHub Review Bot

- Finish the GitHub env setup
- Open `/review-bot`
- Connect GitHub
- Pick a repository and pull request
- Start or rerun the review

## Useful Commands

```bash
pnpm dev
pnpm inngest:dev
pnpm local-helper
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm preview
```

## Verification Notes

What I verified while updating the docs:

- `pnpm test` passes
- `pnpm lint` passes with existing warnings
- `pnpm typecheck` currently fails because `TimelineEvent` is imported from `@/components/ui/agent-plan` but not exported from that module
- `pnpm build` passes

## Troubleshooting

### Local Chrome mode is unavailable

Check that:

- `LOCAL_HELPER_SECRET` is set in the app environment
- `APP_BASE_URL` points to the running app
- `pnpm local-helper` is running

### Runs are queued but never start

Check that:

- the Inngest dev server is running
- your app can reach `/api/inngest`
- `QA_DIRECT_RUN_FALLBACK` is set to `1` if you want direct execution without the worker

### GitHub review bot is not ready

Check that all of these are configured:

- `APP_BASE_URL`
- `REVIEW_BOT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
