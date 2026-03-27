import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconArrowRight,
  IconBrowser,
  IconCloud,
  IconPlugConnected,
  IconPlugConnectedX,
  IconPlus,
} from "@tabler/icons-react"
import { useMemo, useState, type ReactNode } from "react"
import { api } from "../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createRun } from "@/lib/create-run"
import { validateRunUrl } from "@/lib/run-url"

type BrowserProvider = "local_chrome" | "steel"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const navigate = Route.useNavigate()
  const { data: namespaces } = useQuery(convexQuery(api.credentials.listNamespaces, {}))
  const { data: localHelperOverview } = useQuery(
    convexQuery(api.runtime.getLocalHelperOverview, {}),
  )
  const [prompt, setPrompt] = useState("")
  const [credentialNamespace, setCredentialNamespace] = useState("none")
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider>("steel")
  const [error, setError] = useState<string | null>(null)
  const { mutateAsync, isPending } = useMutation({
    mutationFn: createRun,
  })

  const normalizedPrompt = useMemo(() => prompt.trim(), [prompt])
  const selectedNamespace =
    credentialNamespace !== "none" ? credentialNamespace : undefined
  const helperAvailable = Boolean(localHelperOverview?.available)
  const helperStatus = localHelperOverview?.helper?.status ?? "offline"
  const helperLabel = localHelperOverview?.helper?.machineLabel ?? "No helper connected"
  const isLocalMode = browserProvider === "local_chrome"

  const handleSubmit = async () => {
    if (!validateRunUrl(normalizedPrompt.match(/https?:\/\/\S+/i)?.[0] ?? "")) {
      setError("Enter a prompt that includes a full URL starting with http:// or https://.")
      return
    }

    if (isLocalMode && !helperAvailable) {
      setError("Start the local Chrome helper before creating a local run.")
      return
    }

    setError(null)

    const { runId } = await mutateAsync({
      data: {
        browserProvider,
        credentialNamespace: selectedNamespace,
        prompt: normalizedPrompt,
      },
    })

    void navigate({ to: "/runs/$runId", params: { runId } })
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center">
      <div className="w-full max-w-5xl space-y-5">
        <Tabs
          value={browserProvider}
          onValueChange={(value) => {
            setBrowserProvider((value as BrowserProvider) ?? "steel")
            if (error) {
              setError(null)
            }
          }}
          className="gap-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">QA session mode</p>
              <p className="text-sm text-muted-foreground">
                Choose the browser backend while keeping the same agent and report flow.
              </p>
            </div>
            <TabsList variant="line" className="rounded-full border border-border/70 bg-card/75 p-1">
              <TabsTrigger value="steel" className="rounded-full px-4">
                <IconCloud className="size-4" />
                Cloud
              </TabsTrigger>
              <TabsTrigger value="local_chrome" className="rounded-full px-4">
                <IconBrowser className="size-4" />
                Local
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="steel" className="grid gap-5">
            <ProviderCard
              icon={<IconCloud className="size-4" />}
              title="Cloud mode uses Steel.dev live sessions"
              description="Shard will create and mirror a hosted browser session in the run view while the QA worker explores your site."
              accent="Cloud session"
            />
          </TabsContent>

          <TabsContent value="local_chrome" className="grid gap-5">
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">Local Chrome setup</CardTitle>
                    <CardDescription>
                      The agent will drive your own Chrome window after your local helper attaches
                      through Chrome DevTools MCP.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-sm">
                    {helperAvailable ? (
                      <IconPlugConnected className="size-4 text-emerald-500" />
                    ) : (
                      <IconPlugConnectedX className="size-4 text-amber-500" />
                    )}
                    <span className="font-medium text-foreground">{helperLabel}</span>
                    <span className="text-muted-foreground">{helperStatus.replaceAll("_", " ")}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>Before the first local run on this browser instance:</p>
                  <ol className="list-decimal space-y-2 pl-5">
                    <li>Open <code>chrome://inspect/#remote-debugging</code> in Chrome.</li>
                    <li>Allow incoming debugging connections in Chrome.</li>
                    <li>Keep Chrome open, then start the local helper from this repo.</li>
                    <li>Approve the Chrome permission dialog when the helper attaches.</li>
                  </ol>
                  <p>
                    Local actions happen live in your own browser window. The app will focus on
                    agent progress, findings, and captured screenshots.
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                    Local mode status
                  </p>
                  <p className="mt-3 text-sm text-foreground">
                    {helperAvailable
                      ? "A healthy helper heartbeat is available. You can create a local run now."
                      : helperStatus === "error"
                        ? "The helper is connected but unhealthy. Restart it after checking the required env vars and Chrome debugging access."
                        : "No healthy helper heartbeat yet. Start the helper, then return here to create the run."}
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>
                      Helper runtime: <code>Bun</code> is required for this CLI.
                    </p>
                    <p>
                      Required env vars: <code>APP_BASE_URL</code>,{" "}
                      <code>LOCAL_HELPER_SECRET</code>, <code>GEMINI_API_KEY</code>
                    </p>
                    <p>
                      Start command: <code>bun run local-helper</code>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <PromptInput
          value={prompt}
          onValueChange={(value) => {
            setPrompt(value)
            if (error) {
              setError(null)
            }
          }}
          onSubmit={() => {
            void handleSubmit()
          }}
          isLoading={isPending}
          className="rounded-[2rem] border-border/70 bg-card/80 p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.45)]"
        >
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <Button
              variant="outline"
              size="icon-lg"
              className="rounded-full border-border/70"
              render={<Link to="/credentials" />}
            >
              <IconPlus className="size-4" />
              <span className="sr-only">Add credentials</span>
            </Button>

            <Select
              value={credentialNamespace}
              onValueChange={(value) => {
                setCredentialNamespace(value ?? "none")
              }}
            >
              <SelectTrigger className="h-11 rounded-full border-border/70 bg-background/70 px-4 shadow-none">
                <SelectValue placeholder="Credentials" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="none">No credentials</SelectItem>
                {(namespaces ?? []).map((namespace) => (
                  <SelectItem key={namespace} value={namespace}>
                    {namespace}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedNamespace ? (
              <span className="text-sm text-muted-foreground">
                Using <span className="font-medium text-foreground">{selectedNamespace}</span>
              </span>
            ) : null}
          </div>

          <PromptInputTextarea
            placeholder={"https://app.example.com\nSearch for headphones and add one to cart"}
            className="min-h-[180px] px-1 py-4 text-2xl leading-9 md:text-[2rem] md:leading-[2.75rem]"
            aria-label="Run prompt"
          />

          <PromptInputActions className="justify-between gap-3 border-t border-border/60 pt-3">
            <p className="text-sm text-muted-foreground">
              Paste a URL, then optionally add task instructions. Enter to run.
            </p>
            <Button
              onClick={() => {
                void handleSubmit()
              }}
              disabled={isPending || (isLocalMode && !helperAvailable)}
              size="lg"
              className="rounded-full px-5"
            >
              {isPending ? "Creating..." : isLocalMode ? "Run Local Agent" : "Run Agent"}
              <IconArrowRight className="size-4" />
            </Button>
          </PromptInputActions>
        </PromptInput>

        {error ? (
          <p className="text-center text-sm text-destructive">{error}</p>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          Try `https://shop.example.com` for broad exploration or add a second line with a task.
        </p>
      </div>
    </div>
  )
}

function ProviderCard({
  accent,
  description,
  icon,
  title,
}: {
  accent: string
  description: string
  icon: ReactNode
  title: string
}) {
  return (
    <Card className="border border-border/70 bg-card/80">
      <CardHeader className="gap-3 border-b border-border/70">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          <span>{accent}</span>
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}
