# Build Tasks

## Schema and Convex setup

- Create Convex tables for `runs`, `findings`, `artifacts`, `prReviews`, and `sessions`.
- For a run, store: URL, status, current step, started time, finished time, and final score.
- For a finding, store: source (`browser`, `perf`, `hygiene`, `test`), title, description, severity, confidence, page or flow, screenshot or artifact link, and suggested fix.
- For an artifact, store: type (`screenshot`, `trace`, `html-report`, `replay`), file location, run id, and timestamp.
- Add Convex queries and mutations for:
  - creating a new run
  - updating run progress live
  - saving findings during a run
  - fetching a full run report
- Use `convex` and `@convex-dev/react-query`.

## Run creation flow

- Build the first simple UI: one input for URL and one `Run Agent` button.
- On submit, create a new Convex run with status like `queued`.
- Show a basic live run page that reads run status from Convex.
- Do not build a full dashboard yet. Just make sure a user can start a run and watch it update.
- Use TanStack Start for the app shell and routing.

## Autonomous QA agent

- Build the first agent loop using `ai` (AI SDK).
- Give the model a very small toolset at first:
  - inspect current page
  - list clickable or input elements
  - click an element
  - fill an input
  - navigate to a URL
  - capture screenshot
- Implement those tools with `playwright`.
- Keep the loop bounded:
  - max number of steps
  - same-domain only
  - stop if the agent starts repeating actions
- After every useful step, save progress and findings back into Convex.
- Goal of this module: user enters a URL, the agent explores a few pages, and screenshots plus findings appear live.

## Browser runtime with Steel.dev

- Run Steel locally in Docker so browser sessions are near the app and faster than the hosted region for India-based usage.
- Create a session for each QA run and connect Playwright to Steel over CDP.
- Save session id, replay link, and browser status in Convex.
- Verify these flows work:
  - open browser session
  - connect Playwright
  - navigate
  - capture screenshot
  - close session cleanly
- Use Steel.dev local server and `playwright`.

## Background workflows with Inngest

- Move the autonomous QA flow out of the request cycle and into an Inngest function.
- When a run is created, fire an event to Inngest.
- Inngest should execute the long-running steps:
  - create Steel session
  - run the AI agent loop
  - save artifacts
  - mark run complete or failed
- Add retries for transient browser failures.
- Add step-by-step status updates so the UI can show exactly what the system is doing.
- Use `inngest` and run a local `inngest/inngest` dev server in Docker.

## Live run UI

- Build the actual run screen after the backend loop works.
- Show:
  - current status
  - current step
  - screenshots as they arrive
  - list of findings
  - final score when complete
- Use Convex realtime subscriptions so the page updates without refresh.
- Keep the first version simple and functional.

## Performance checks

- After autonomous exploration finishes, choose the important pages discovered during the run.
- Run `lighthouse` on those pages.
- Save metrics like performance score, accessibility score, best-practices score, and SEO score.
- Turn bad Lighthouse results into findings in the same shared schema.
- Optionally add a very small `k6` scenario later for critical endpoints, but do not block the first version on this.

## Scoring and report generation

- Create one simple scoring formula that combines severity, confidence, and impact.
- Compute:
  - per-finding score
  - grouped score by source
  - final overall quality score
- Build a completed run report page with:
  - summary
  - top findings
  - screenshots
  - Lighthouse results
  - replay or artifact links

## Synthetic data for forms

- Add fake data generation for common form fields using `@faker-js/faker`.
- Use generated values when the agent encounters signup, login, search, checkout, or profile-style forms.
- Keep secrets and real credentials outside the LLM.
- Start with simple presets before trying schema-driven generation.

## GitHub PR review foundation

- Build a Probot app that receives PR webhooks.
- Store PR metadata in Convex.
- For each PR, save:
  - repo
  - PR number
  - changed files
  - diff summary
  - review status
- Use `probot` and `octokit`.

## Hygiene checks for PRs

- Run automated code checks on PRs:
  - `semgrep`
  - `eslint`
  - `tsc --noEmit`
  - project test command if present
- Normalize all results into the same shared finding schema.
- Do not use the LLM to detect raw code issues here.
- Use the LLM only to summarize, group, and rewrite the output into reviewer-friendly language.

## Browser QA for frontend PRs

- Add a simple rule for deciding whether browser QA should run on a PR.
- Start with path-based rules like:
  - `src/routes`
  - `src/components`
  - styles
  - frontend contracts
- If the PR touches those areas, trigger the autonomous browser QA flow against the preview or target environment.
- If not, skip browser QA and state that clearly in the PR result.

## GitHub output

- Publish the PR result as a GitHub Check Run.
- Add annotations for the highest-confidence issues.
- Post one compact summary that includes:
  - what was checked
  - top risks
  - whether browser QA ran
  - link back to the app report

## Credentials and secrets

- Build a small credential manager layer before adding any authenticated browser flows.
- The agent should request a credential by name, but never receive the raw secret in the prompt.
- Only the browser automation layer should inject credentials into the page.
- Keep this simple in v1: local env vars or a local secret store is enough.

## Docker and local infrastructure

- Run Steel locally with Docker Compose.
- Run Inngest locally with Docker Compose.
- Keep Convex and the app running in the normal dev flow for now.
- Once the core flow works, decide whether the app itself should also move into Docker for local development.
