import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { VercelV0Chat } from "@/components/ui/v0-ai-chat"
import {
  getStoredHomeBrowserProvider,
  setStoredHomeBrowserProvider,
  type BrowserProvider,
  useHomeBrowserProviderSync,
} from "@/components/home-run-guide"
import { createRun } from "@/lib/create-run"
import { normalizeCredentialWebsite } from "@/lib/credential-url"
import { makeCredentialDefault } from "@/lib/credentials-server"
import { getRunModeCapabilities } from "@/lib/get-run-mode-capabilities"
import { validateRunUrl } from "@/lib/run-url"

export const Route = createFileRoute("/")({ component: App })

const RUN_URL_PATTERN = /https?:\/\/\S+/i
const LAST_SELECTED_CREDENTIAL_KEY = "last-selected-credential-id"
const NO_CREDENTIAL_SELECTED = "__none__"

function App() {
  const navigate = Route.useNavigate()
  const { data: runModeCapabilities } = useQuery({
    queryKey: ["home-run-mode-capabilities"],
    queryFn: async () => await getRunModeCapabilities(),
  })
  const { data: credentials } = useQuery(convexQuery(api.credentials.listCredentials, {}))
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider | null>(
    () => (typeof window !== "undefined" ? getStoredHomeBrowserProvider() : null),
  )
  const [prompt, setPrompt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [selectedCredentialId, setSelectedCredentialId] = useState<Id<"credentials"> | null>(null)
  const createRunMutation = useMutation({
    mutationFn: createRun,
  })
  const makeDefaultMutation = useMutation({
    mutationFn: makeCredentialDefault,
  })

  useLayoutEffect(() => {
    const provider = getStoredHomeBrowserProvider()
    setBrowserProvider(provider)
  }, [])

  useHomeBrowserProviderSync((provider) => {
    setBrowserProvider(provider)
    if (error) {
      setError(null)
    }
  })

  const normalizedPrompt = useMemo(() => prompt.trim(), [prompt])
  const matchedUrl = useMemo(() => normalizedPrompt.match(RUN_URL_PATTERN)?.[0] ?? "", [normalizedPrompt])
  const validUrl = useMemo(() => validateRunUrl(matchedUrl), [matchedUrl])
  const normalizedWebsite = useMemo(
    () => (validUrl ? normalizeCredentialWebsite(validUrl) : null),
    [validUrl],
  )
  const hasValidUrl = Boolean(validUrl)
  const siteOrigin = normalizedWebsite?.origin ?? null
  const availableCredentials = credentials ?? []
  const selectedCredential = useMemo(
    () =>
      availableCredentials.find((credential) => credential._id === selectedCredentialId) ?? null,
    [availableCredentials, selectedCredentialId],
  )
  const matchingCredentials = useMemo(
    () =>
      siteOrigin
        ? availableCredentials.filter((credential) => credential.origin === siteOrigin)
        : [],
    [availableCredentials, siteOrigin],
  )
  const credentialOptions = useMemo(
    () =>
      matchingCredentials.map((credential) => ({
        label: credential.login,
        value: credential._id,
        domain: credential.origin.replace(/^https?:\/\//, ""),
        isDefault: credential.isDefault,
      })),
    [matchingCredentials],
  )
  const selectedCapability = browserProvider ? runModeCapabilities?.[browserProvider] : null
  const submitDisabledReason =
    selectedCapability?.reason ??
    (browserProvider === "local_chrome" && !runModeCapabilities
      ? "Checking local helper availability..."
      : null)
  const credentialDisabled = !hasValidUrl
  const canSubmit =
    browserProvider === "steel" || (selectedCapability ? !selectedCapability.reason : false)
  const selectedCredentialMatchesPrompt =
    Boolean(selectedCredential && siteOrigin && selectedCredential.origin === siteOrigin)
  const credentialActionMode =
    credentials === undefined
      ? ("loading" as const)
      : !hasValidUrl
        ? ("disabled-add" as const)
        : matchingCredentials.length > 0
        ? ("select" as const)
        : ("add" as const)

  useEffect(() => {
    if (!availableCredentials.length) {
      setSelectedCredentialId(null)
      return
    }

    const storedId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_SELECTED_CREDENTIAL_KEY)
        : null

    if (storedId === NO_CREDENTIAL_SELECTED) {
      setSelectedCredentialId(null)
      return
    }

    const restoredCredential = storedId
      ? availableCredentials.find((credential) => credential._id === storedId)
      : null

    if (restoredCredential) {
      setSelectedCredentialId(restoredCredential._id)
    } else {
      const nextDefault =
        availableCredentials.find((credential) => credential.isDefault) ??
        availableCredentials[0] ??
        null
      setSelectedCredentialId(nextDefault?._id ?? null)
    }
  }, [availableCredentials])

  useEffect(() => {
    if (!hasValidUrl) {
      setSelectedCredentialId(null)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, NO_CREDENTIAL_SELECTED)
      }
      return
    }

    if (!siteOrigin || !availableCredentials.length) {
      return
    }

    if (!matchingCredentials.length) {
      if (selectedCredentialId !== null) {
        setSelectedCredentialId(null)
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, NO_CREDENTIAL_SELECTED)
        }
      }
      return
    }

    const nextCredential =
      matchingCredentials.find((credential) => credential.isDefault) ?? matchingCredentials[0]

    if (!nextCredential || nextCredential._id === selectedCredentialId) {
      return
    }

    setSelectedCredentialId(nextCredential._id)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, nextCredential._id)
    }
  }, [hasValidUrl, matchingCredentials, selectedCredentialId, siteOrigin])

  const handleSubmit = async () => {
    if (!browserProvider) {
      return
    }

    if (!validUrl) {
      setError("Enter a prompt that includes a full URL starting with http:// or https://.")
      return
    }

    if (submitDisabledReason) {
      setError(submitDisabledReason)
      return
    }

    setError(null)

    try {
      const { runId } = await createRunMutation.mutateAsync({
        data: {
          browserProvider,
          credentialId: selectedCredentialMatchesPrompt ? selectedCredential?._id : undefined,
          prompt: normalizedPrompt,
        },
      })

      void navigate({ to: "/runs/$runId", params: { runId } })
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to create the run.",
      )
    }
  }

  const handleCredentialChange = async (credentialId: string | null) => {
    if (!credentialId) {
      setSelectedCredentialId(null)
      setPrompt("")
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, NO_CREDENTIAL_SELECTED)
      }
      return
    }

    const nextCredential =
      availableCredentials.find((credential) => credential._id === credentialId) ?? null

    if (!nextCredential || nextCredential._id === selectedCredentialId) {
      return
    }

    const previousCredentialId = selectedCredentialId
    const nextPrompt = nextCredential.website
    setSelectedCredentialId(nextCredential._id)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, nextCredential._id)
    }
    setPrompt(nextPrompt)

    try {
      await makeDefaultMutation.mutateAsync({
        data: {
          credentialId: nextCredential._id,
        },
      })
      if (error) {
        setError(null)
      }
    } catch (credentialError) {
      setSelectedCredentialId(previousCredentialId)
      setPrompt(normalizedPrompt)
      setError(
        credentialError instanceof Error
          ? credentialError.message
          : "Failed to update the default credential.",
      )
    }
  }

  const switchProvider = (provider: BrowserProvider) => {
    setStoredHomeBrowserProvider(provider)
    setBrowserProvider(provider)
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
              if (error) {
                setError(null)
              }
            }}
            onSubmit={() => {
              void handleSubmit()
            }}
            isPending={createRunMutation.isPending}
            browserProvider={browserProvider}
            onBrowserProviderChange={switchProvider}
            onAddCredentials={() => {
              if (hasValidUrl) {
                void navigate({ to: "/credentials" })
              }
            }}
            helperLabel={
              browserProvider === "local_chrome"
                ? !runModeCapabilities
                  ? "Checking..."
                  : selectedCapability?.statusLabel
                : undefined
            }
            helperAvailable={runModeCapabilities ? selectedCapability?.runnable : false}
            placeholder={
              selectedCapability?.placeholder ??
              (browserProvider === "steel"
                ? "Paste a URL for a hosted Steel run, then add optional instructions..."
                : browserProvider === "local_chrome"
                  ? "Paste a URL for your own Chrome window, then add optional instructions..."
                  : "Paste a URL for your website, then add optional instructions...")
            }
            modeDescription={
              selectedCapability?.detail ??
              (browserProvider === "steel"
                ? "Cloud mode runs in a hosted Steel browser session with live replay in the run view."
                : browserProvider === "local_chrome"
                  ? "Local mode uses your own Chrome through the local helper."
                  : "Select a browser provider to begin.")
            }
            hasValidUrl={hasValidUrl}
            credentialActionMode={credentialActionMode}
            credentialValue={selectedCredential?._id}
            credentialOptions={credentialOptions}
            credentialDisabled={credentialDisabled}
            onCredentialChange={(value) => {
              void handleCredentialChange(value)
            }}
            canSubmit={canSubmit}
          />

          {error ? (
            <p className="mt-4 text-center text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
