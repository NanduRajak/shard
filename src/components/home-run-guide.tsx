"use client"

import {
  IconBrowser,
  IconCloud,
  IconHelpCircle,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export type BrowserProvider = "local_chrome" | "steel"

export const LOCAL_SETUP_COMPLETE_KEY = "home-local-setup-complete"
export const HOME_BROWSER_PROVIDER_KEY = "home-browser-provider"
const HOME_PROVIDER_CHANGE_EVENT = "home-browser-provider-change"

export function getStoredHomeBrowserProvider(): BrowserProvider {
  if (typeof window === "undefined") {
    return "steel"
  }

  return window.localStorage.getItem(HOME_BROWSER_PROVIDER_KEY) === "local_chrome"
    ? "local_chrome"
    : "steel"
}

export function setStoredHomeBrowserProvider(provider: BrowserProvider) {
  window.localStorage.setItem(HOME_BROWSER_PROVIDER_KEY, provider)
  window.dispatchEvent(new CustomEvent(HOME_PROVIDER_CHANGE_EVENT, { detail: provider }))
}

export function useHomeBrowserProviderSync(
  onChange: (provider: BrowserProvider) => void,
) {
  useEffect(() => {
    const handleProviderChange = (event: Event) => {
      const provider = (event as CustomEvent<BrowserProvider>).detail
      onChange(provider)
    }

    window.addEventListener(HOME_PROVIDER_CHANGE_EVENT, handleProviderChange)
    return () => {
      window.removeEventListener(HOME_PROVIDER_CHANGE_EVENT, handleProviderChange)
    }
  }, [onChange])
}

export function HomeRunGuide() {
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider>("steel")
  const [hasLoadedLocalSetupState, setHasLoadedLocalSetupState] = useState(false)
  const [hasCompletedLocalSetup, setHasCompletedLocalSetup] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setBrowserProvider(getStoredHomeBrowserProvider())
    setHasCompletedLocalSetup(window.localStorage.getItem(LOCAL_SETUP_COMPLETE_KEY) === "true")
    setHasLoadedLocalSetupState(true)
  }, [])

  const selectProvider = (provider: BrowserProvider) => {
    setBrowserProvider(provider)
    setStoredHomeBrowserProvider(provider)
  }

  const completeLocalSetup = () => {
    window.localStorage.setItem(LOCAL_SETUP_COMPLETE_KEY, "true")
    setHasCompletedLocalSetup(true)
    setIsOpen(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-border/70 bg-card/80 px-3"
          />
        }
      >
        <IconHelpCircle className="size-4" />
        {hasLoadedLocalSetupState && !hasCompletedLocalSetup ? "Setup" : "Run guide"}
      </DialogTrigger>
      <DialogContent className="top-3 left-3 right-3 w-auto max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-0 shadow-2xl sm:top-20 sm:left-auto sm:right-6 sm:w-[28rem]">
        <DialogHeader className="border-b border-border/70 p-5">
          <DialogTitle>Run mode guide</DialogTitle>
          <DialogDescription>
            Pick the browser backend here. Home stays focused on the input box.
          </DialogDescription>
        </DialogHeader>
        <div className="no-scrollbar max-h-[calc(100svh-10rem)] space-y-4 overflow-y-auto p-4 sm:max-h-[calc(100svh-12rem)]">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                selectProvider("steel")
              }}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                browserProvider === "steel"
                  ? "border-foreground/20 bg-foreground/[0.04]"
                  : "border-border/70 bg-background/60"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <IconCloud className="size-4" />
                Cloud
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Hosted Steel session
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                selectProvider("local_chrome")
              }}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                browserProvider === "local_chrome"
                  ? "border-foreground/20 bg-foreground/[0.04]"
                  : "border-border/70 bg-background/60"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <IconBrowser className="size-4" />
                Local
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Your own Chrome window
              </p>
            </button>
          </div>

          {browserProvider === "steel" ? (
            <div className="rounded-xl border border-border/70 bg-background/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <IconCloud className="size-4" />
                Cloud mode
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Cloud mode uses Steel.dev live sessions. Shard creates and mirrors a hosted
                browser session in the run view while the QA worker explores your site.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70 bg-background/60 p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <IconBrowser className="size-4" />
                  Local Chrome setup
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The agent will drive a visible local Chrome window from your machine while the
                  run view streams progress, findings, and screenshots.
                </p>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Start command: <code>pnpm run local-helper</code>
              </p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>Start the helper from this repo with <code>pnpm run local-helper</code>.</li>
                <li>Kick off a local run from Home.</li>
                <li>Shard will open a dedicated visible Chrome window when the run starts.</li>
                <li>Keep that Chrome window open until the run finishes.</li>
              </ol>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                If you specifically want Shard to reuse an already-running debug Chrome session,
                use an explicit debugging port instead:
                <code className="ml-1">
                  LOCAL_CHROME_BROWSER_URL=http://127.0.0.1:9222 pnpm run local-helper
                </code>
                . Start Chrome yourself with
                <code className="ml-1">
                  --remote-debugging-port=9222 --user-data-dir=/tmp/shard-chrome-profile
                </code>
                , then open at least one normal tab before starting the helper.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The default flow is simpler and more reliable because the helper launches Chrome
                itself instead of depending on a pre-existing remote debugging port.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Local actions happen live in that browser window. The app stays focused on agent
                progress, findings, and captured screenshots.
              </p>
              {!hasCompletedLocalSetup ? (
                <div className="mt-3 flex justify-end">
                  <Button onClick={completeLocalSetup} className="rounded-full">
                    I completed setup
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
