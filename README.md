# Shard

Shard is an AI-assisted web QA and PR review app. It scans web apps through a real browser, surfaces defects in realtime, runs lightweight performance and hygiene checks, and produces a single quality view for both product teams and reviewers.

## What the app does

- Accepts a URL and starts an autonomous browser run.
- Explores the product with an agent loop powered by AI SDK and Playwright.
- Captures screenshots, findings, run progress, and artifacts in realtime.
- Runs focused performance checks on important pages and flows.
- Scores defects across browser, performance, hygiene, and test signals.
- Reviews pull requests with automated checks, summaries, and optional browser validation.
- Publishes review output to GitHub through check runs and annotations.

## Core workflows

### Web app scan

1. A user submits a URL.
2. Convex creates a run record.
3. Inngest starts the background workflow.
4. Steel creates a browser session.
5. Playwright and the agent explore the app.
6. Findings, screenshots, and artifacts stream back into Convex.
7. Lighthouse runs on important pages.
8. Defects are scored and shown in the dashboard.

### PR review

1. A GitHub webhook starts the PR workflow.
2. The app stores PR metadata and builds a context pack from the diff.
3. Hygiene checks run with tools like Semgrep, ESLint, TypeScript, and tests.
4. The LLM summarizes risks, groups findings, and suggests review comments.
5. Browser QA runs only when the PR likely affects frontend behavior.
6. Results are published as a GitHub Check Run with annotations when needed.

## Main modules

- Frontend: TanStack Start
- Realtime backend and storage metadata: Convex
- Background orchestration: Inngest
- Browser sessions and replay: Steel.dev
- Browser automation: Playwright
- Agent decision loop: AI SDK
- GitHub integration: Probot + Octokit
- Artifact storage: Convex Storage
- Local infrastructure: Docker

## Functional areas

- Autonomous discovery for web app exploration
- Performance testing with Lighthouse and optional k6 coverage
- Code hygiene classification for PRs
- Unified defect scoring
- Live dashboard and replayable artifacts
- Synthetic data generation for forms and flows
- Secure credential injection without exposing secrets to the model

## Current product assumptions

- The first release focuses on bounded autonomous discovery, not open-ended crawling.
- Browser QA on PRs runs only for likely frontend-impacting changes.
- The LLM is used to summarize and group findings, not as the primary raw issue detector for code hygiene.
- Credentials are managed outside the model and injected securely into browser sessions.
