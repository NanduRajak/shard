import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { VercelV0Chat } from "@/components/ui/v0-ai-chat"
import {
  getStoredHomeBrowserProvider,
  setStoredHomeBrowserProvider,
  type BrowserProvider,
  useHomeBrowserProviderSync,
} from "@/components/home-run-guide"
import { createRun } from "@/lib/create-run"
import { readStoredHomeRunDraft, writeStoredHomeRunDraft } from "@/lib/home-run-drafts"
import { getRunModeCapabilities } from "@/lib/get-run-mode-capabilities"
import { validateRunUrl } from "@/lib/run-url"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const navigate = Route.useNavigate()
  const { data: runModeCapabilities } = useQuery({
    queryKey: ["home-run-mode-capabilities"],
    queryFn: async () => await getRunModeCapabilities(),
  })
  const [prompt, setPrompt] = useState("")
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider>("steel")
  const [error, setError] = useState<string | null>(null)
  const { mutateAsync, isPending } = useMutation({
    mutationFn: createRun,
  })

  useEffect(() => {
    const provider = getStoredHomeBrowserProvider()
    setBrowserProvider(provider)
    setPrompt(readStoredHomeRunDraft(provider, window.localStorage))
  }, [])

  useHomeBrowserProviderSync((provider) => {
    setBrowserProvider(provider)
    setPrompt(readStoredHomeRunDraft(provider, window.localStorage))
    if (error) {
      setError(null)
    }
  })

  const normalizedPrompt = useMemo(() => prompt.trim(), [prompt])
  const selectedCapability = runModeCapabilities?.[browserProvider]
  const submitDisabledReason =
    selectedCapability?.reason ??
    (browserProvider === "local_chrome" && !runModeCapabilities
      ? "Checking local helper availability..."
      : null)
  const canSubmit = selectedCapability ? !selectedCapability.reason : browserProvider === "steel"

  const handleSubmit = async () => {
    if (!validateRunUrl(normalizedPrompt.match(/https?:\/\/\S+/i)?.[0] ?? "")) {
      setError("Enter a prompt that includes a full URL starting with http:// or https://.")
      return
    }

    if (submitDisabledReason) {
      setError(submitDisabledReason)
      return
    }

    setError(null)

    try {
      const { runId } = await mutateAsync({
        data: {
          browserProvider,
          prompt: normalizedPrompt,
        },
      })

      void navigate({ to: "/runs/$runId", params: { runId } })
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create the run.",
      )
    }
  }

  const switchProvider = (provider: BrowserProvider) => {
    setStoredHomeBrowserProvider(provider)
    setBrowserProvider(provider)
    setPrompt(readStoredHomeRunDraft(provider, window.localStorage))
    setError(null)
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center">
      <div className="w-full max-w-3xl space-y-5">
        <div className="pt-2">
          <VercelV0Chat
            value={prompt}
            onChange={(value) => {
              setPrompt(value)
              writeStoredHomeRunDraft(browserProvider, value, window.localStorage)
              if (error) {
                setError(null)
              }
            }}
            onSubmit={() => {
              void handleSubmit()
            }}
            isPending={isPending}
            browserProvider={browserProvider}
            onBrowserProviderChange={switchProvider}
            onAddCredentials={() => {
              void navigate({ to: "/credentials" })
            }}
            helperLabel={
              browserProvider === "local_chrome" 
                ? (!runModeCapabilities ? "Checking..." : selectedCapability?.statusLabel)
                : undefined
            }
            helperAvailable={runModeCapabilities ? selectedCapability?.runnable : false}
            placeholder={
              selectedCapability?.placeholder ??
              "Paste a URL and optional instructions..."
            }
            modeDescription={
              selectedCapability?.detail ??
              "Cloud mode runs in Steel. Local mode runs through your own Chrome helper."
            }
            canSubmit={canSubmit}
          />



          {error ? (
            <p className="text-center text-sm text-destructive mt-4">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
