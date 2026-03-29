import { readFile, writeFile } from "node:fs/promises"
import { execSync } from "node:child_process"

const root = process.cwd()

const candidates = execSync(
  `find ${root}/node_modules -path "*/playwright-core/lib/server/chromium/crBrowser.js" 2>/dev/null`,
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)

if (candidates.length === 0) {
  console.log("[patch-playwright] No crBrowser.js found, skipping.")
  process.exit(0)
}

const target = `eventsEnabled: true
      }))`
const replacement = `eventsEnabled: true
      }).catch(() => {}))`

let patched = 0

for (const filePath of candidates) {
  const src = await readFile(filePath, "utf8")

  if (src.includes(".catch(() => {})")) {
    console.log(`[patch-playwright] Already patched: ${filePath}`)
    continue
  }

  if (!src.includes(target)) {
    console.log(
      `[patch-playwright] Skipping (code shape changed): ${filePath}`,
    )
    continue
  }

  await writeFile(filePath, src.replace(target, replacement), "utf8")
  console.log(`[patch-playwright] Patched: ${filePath}`)
  patched++
}

console.log(
  `[patch-playwright] Done. ${patched} file(s) patched, ${candidates.length - patched} already ok.`,
)
