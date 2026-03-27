import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconArrowRight,
  IconPlus,
} from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { api } from "../../convex/_generated/api"
import { Button } from "@/components/ui/button"
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
import { createRun } from "@/lib/create-run"
import { validateRunUrl } from "@/lib/run-url"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const navigate = Route.useNavigate()
  const { data: namespaces } = useQuery(convexQuery(api.credentials.listNamespaces, {}))
  const [prompt, setPrompt] = useState("")
  const [credentialNamespace, setCredentialNamespace] = useState("none")
  const [error, setError] = useState<string | null>(null)
  const { mutateAsync, isPending } = useMutation({
    mutationFn: createRun,
  })

  const normalizedPrompt = useMemo(() => prompt.trim(), [prompt])
  const selectedNamespace =
    credentialNamespace !== "none" ? credentialNamespace : undefined

  const handleSubmit = async () => {
    if (!validateRunUrl(normalizedPrompt.match(/https?:\/\/\S+/i)?.[0] ?? "")) {
      setError("Enter a prompt that includes a full URL starting with http:// or https://.")
      return
    }

    setError(null)

    const { runId } = await mutateAsync({
      data: {
        credentialNamespace: selectedNamespace,
        prompt: normalizedPrompt,
      },
    })

    void navigate({ to: "/runs/$runId", params: { runId } })
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center">
      <div className="w-full max-w-4xl">
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
              disabled={isPending}
              size="lg"
              className="rounded-full px-5"
            >
              {isPending ? "Creating..." : "Run Agent"}
              <IconArrowRight className="size-4" />
            </Button>
          </PromptInputActions>
        </PromptInput>

        {error ? (
          <p className="mt-3 text-center text-sm text-destructive">{error}</p>
        ) : null}
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Try `https://shop.example.com` for broad exploration or add a second line with a task.
        </p>
      </div>
    </div>
  )
}
