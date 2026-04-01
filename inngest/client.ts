import { prReview } from "./pr-review"
import { backgroundQaRun, qaRun } from "./qa-run"
import { siteCrawl } from "./site-crawl"

export const functions = [qaRun, backgroundQaRun, prReview, siteCrawl]
export { inngest } from "./core"
