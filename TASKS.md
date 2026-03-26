# Build Tasks

## 1. Schema and Convex setup

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

## 2. Run creation flow

- Build the first simple UI: one input for URL and one `Run Agent` button.
- On submit, create a new Convex run with status like `queued`.
- Show a basic live run page that reads run status from Convex.
- Do not build a full dashboard yet. Just make sure a user can start a run and watch it update.
- Use TanStack Start for the app shell and routing.
- This is the first user-visible proof that the product loop works.

## 3. Browser runtime with Steel.dev Cloud

- Use Steel.dev Cloud for browser sessions.
- Create a session for each QA run and connect Playwright to Steel over CDP.
- Save session id, replay link, and browser status in Convex.
- Verify these flows work:
  - open browser session
  - connect Playwright
  - navigate
  - capture screenshot
  - close session cleanly
- Use `steel-sdk` and `playwright`.
- Do this before the autonomous agent so browser/runtime issues are solved before AI starts making decisions.

## 4. Background workflows with Inngest

- Move the QA flow out of the request cycle and into an Inngest function.
- When a run is created, fire an event to Inngest.
- Inngest should execute the long-running steps:
  - create Steel session
  - run the agent or smoke workflow
  - save artifacts
  - mark run complete or failed
- Add retries for transient browser failures.
- Add step-by-step status updates so the UI can show exactly what the system is doing.
- Use `inngest` and run a local `inngest/inngest` dev server in Docker.
- This should happen before the real agent loop so execution is already durable and backgrounded.

## 5. Autonomous QA agent

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
- Keep this bounded and simple. Do not jump into open-ended crawling.

## 6. Live run UI

- Build the actual run screen after the backend loop works.
- Show:
  - current status
  - current step
  - screenshots as they arrive
  - list of findings
  - final score when complete
- Use Convex realtime subscriptions so the page updates without refresh.
- Keep the first version simple and functional.
- The point here is visibility, not a polished analytics dashboard.

## 7. Performance checks

- After autonomous exploration finishes, choose the important pages discovered during the run.
- Run `lighthouse` on those pages.
- Save metrics like performance score, accessibility score, best-practices score, and SEO score.
- Turn bad Lighthouse results into findings in the same shared schema.
- Optionally add a very small `k6` scenario later for critical endpoints, but do not block the first version on this.
- This is a second scan stage, not part of the first browser/runtime proof.

## 8. Scoring and report generation

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

## 9. Synthetic data for forms

- Add fake data generation for common form fields using `@faker-js/faker`.
- Use generated values when the agent encounters signup, login, search, checkout, or profile-style forms.
- Keep secrets and real credentials outside the LLM.
- Start with simple presets before trying schema-driven generation.
- This is later because v1 has no auth and the first milestone is anonymous exploration.

## 10. GitHub PR review foundation

Build a Probot app that receives PR webhooks.
Store PR metadata in Convex.
For each PR, save:

repo
PR number
changed files
diff summary
nearby code (surrounding context around changed lines, not just the diff hunks themselves)
file summaries (short per-file descriptions of what each changed file does in the codebase)
review status


Use probot and octokit.
The nearby code and file summaries are critical — they are what the LLM uses to understand impact and give accurate review comments. Store them at PR intake time, not lazily later.
Start this after the standalone scan engine works, because PR browser QA will reuse that same system.

## 11. Hygiene checks for PRs

Run automated code checks on PRs:

semgrep
eslint
tsc --noEmit
project test command if present


Normalize all results into the shared finding schema, and explicitly tag each finding with one of these four categories:

Security
Maintainability
Test hygiene
Performance smell


Do not use the LLM to detect raw code issues. Use the LLM only after deterministic checks are done.
Once hygiene checks finish, pass the full context pack (changed files, diffs, nearby code, file summaries) plus the normalized findings to the LLM and ask it to produce:

a PR summary (what this PR does, in plain language)
a risk summary (what could go wrong or deserves scrutiny)
test suggestions (what scenarios are not covered or worth adding)
a small set of high-confidence inline comments (specific line-level feedback, only where the LLM is confident)


Store all four LLM outputs in Convex on the prReviews table alongside the raw findings.
This should come before PR browser QA because it is deterministic and easier to debug. The LLM summarization step runs after hygiene checks complete within the same Inngest workflow step.

## 12. Browser QA for frontend PRs

- Add a simple rule for deciding whether browser QA should run on a PR.
- Start with path-based rules like:
  - `src/routes`
  - `src/components`
  - styles
  - frontend contracts
- If the PR touches those areas, trigger the autonomous browser QA flow against the preview or target environment.
- If not, skip browser QA and state that clearly in the PR result.
- Reuse the same scan flow and schema instead of creating a separate PR browser system.

## 13. GitHub output

- Publish the PR result as a GitHub Check Run.
- Add annotations for the highest-confidence issues.
- Post one compact summary that includes:
  - what was checked
  - top risks
  - whether browser QA ran
  - link back to the app report

## 14. Credentials and secrets

- Build a small credential manager layer before adding any authenticated browser flows.
- The agent should request a credential by name, but never receive the raw secret in the prompt.
- Only the browser automation layer should inject credentials into the page.
- Keep this simple in v1: local env vars or a local secret store is enough.
- This is intentionally later because the initial app has no auth.

## 15. Docker and local infrastructure

- Run Inngest locally with Docker Compose.
- Keep Convex and the app running in the normal dev flow for now.
- Once the core flow works, decide whether the app itself should also move into Docker for local development.
- Steel is cloud-hosted for this project, so Docker is only needed for local infrastructure like Inngest.
