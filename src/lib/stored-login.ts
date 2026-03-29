import type { Page } from "playwright"

const INPUT_TIMEOUT_MS = 5_000

export type StoredLoginCredential = {
  login: string
  origin: string
  password: string
}

export async function applyStoredLoginToPage(
  page: Page,
  credential: StoredLoginCredential,
) {
  const usernameField = await findFirstVisibleLocator(page, [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="login" i]',
    'input[id*="login" i]',
    'input[type="text"]',
  ])
  const passwordField = await findFirstVisibleLocator(page, [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
  ])

  if (!usernameField || !passwordField) {
    return false
  }

  await usernameField.fill(credential.login, { timeout: INPUT_TIMEOUT_MS })
  await passwordField.fill(credential.password, { timeout: INPUT_TIMEOUT_MS })

  const submitButton = await findFirstVisibleLocator(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
    'button:has-text("Verify")',
  ])

  if (submitButton) {
    await submitButton.click({ timeout: INPUT_TIMEOUT_MS }).catch(() => undefined)
  }

  await settleStoredLoginPage(page)

  return true
}

async function findFirstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      const isVisible = await candidate.isVisible().catch(() => false)

      if (isVisible) {
        return candidate
      }
    }
  }

  return null
}

async function settleStoredLoginPage(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: INPUT_TIMEOUT_MS }).catch(
    () => undefined,
  )
  await page.waitForLoadState("networkidle", { timeout: INPUT_TIMEOUT_MS }).catch(
    () => undefined,
  )
  await page.waitForTimeout(500).catch(() => undefined)
}
