import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconAlertTriangle,
  IconEdit,
  IconKey,
  IconLock,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  createCredential,
  deleteCredential,
  getCredentialForEdit,
  getCredentialsRolloutStatus,
  resetCredentials,
  type CredentialFormInput,
  updateCredential,
} from "@/lib/credentials-server"

export const Route = createFileRoute("/credentials")({
  component: CredentialsPage,
})

const EMPTY_FORM: CredentialFormInput = {
  isDefault: true,
  login: "",
  password: "",
  website: "",
}

function CredentialsPage() {
  const { data: credentials } = useQuery(convexQuery(api.credentials.listCredentials, {}))
  const { data: rolloutStatus } = useQuery({
    queryKey: ["credentials-rollout-status"],
    queryFn: async () => await getCredentialsRolloutStatus({ data: {} }),
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"credentials">
    label: string
  } | null>(null)
  const [editingId, setEditingId] = useState<Id<"credentials"> | null>(null)
  const [formData, setFormData] = useState<CredentialFormInput>(EMPTY_FORM)

  const createMutation = useMutation({ mutationFn: createCredential })
  const updateMutation = useMutation({ mutationFn: updateCredential })
  const deleteMutation = useMutation({ mutationFn: deleteCredential })
  const resetMutation = useMutation({ mutationFn: resetCredentials })
  const getCredentialMutation = useMutation({ mutationFn: getCredentialForEdit })

  const isSaving = createMutation.isPending || updateMutation.isPending

  const openCreateDialog = () => {
    setEditingId(null)
    setFormData(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEditDialog = async (credentialId: Id<"credentials">) => {
    try {
      const credential = await getCredentialMutation.mutateAsync({
        data: { credentialId },
      })

      setEditingId(credentialId)
      setFormData({
        isDefault: credential.isDefault,
        login: credential.login,
        password: credential.password,
        website: credential.website,
      })
      setDialogOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open credential.")
    }
  }

  const handleSubmit = async () => {
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          data: {
            credentialId: editingId,
            ...formData,
          },
        })
        toast.success("Credential updated.")
      } else {
        await createMutation.mutateAsync({
          data: formData,
        })
        toast.success("Credential created.")
      }

      setDialogOpen(false)
      setEditingId(null)
      setFormData(EMPTY_FORM)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save credential.")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) {
      return
    }

    try {
      await deleteMutation.mutateAsync({
        data: { credentialId: deleteTarget.id },
      })
      toast.success("Credential deleted.")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete credential.")
    }
  }

  const handleReset = async () => {
    try {
      const result = await resetMutation.mutateAsync({ data: {} })
      toast.success(
        result.deletedCount > 0
          ? `Cleared ${result.deletedCount} saved credential${result.deletedCount === 1 ? "" : "s"}.`
          : "Saved credentials were already clear.",
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset saved credentials.")
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden border border-border/70 bg-card/90 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)]">
        <CardHeader className="flex flex-col gap-4 border-b border-border/70 bg-muted/15 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit tracking-[0.18em] uppercase">
              Credentials
            </Badge>
            <CardTitle className="font-heading text-2xl tracking-tight">
              Save website logins once and reuse them when a run needs sign-in.
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm/6">
              Keep this simple: one saved login is just a website, an email or username,
              and a password. You can keep multiple logins for the same site and mark one
              default.
            </CardDescription>
          </div>
          <Button className="rounded-2xl" onClick={openCreateDialog}>
            <IconPlus className="size-4" />
            Add credential
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          {rolloutStatus?.hasLegacyCredentials ? (
            <div className="flex flex-col gap-3 rounded-[1.5rem] border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <IconAlertTriangle className="size-4 text-amber-600" />
                  Old saved credentials need a reset
                </div>
                <p className="text-sm text-muted-foreground">
                  The credential model was simplified. Clear the old saved entries once,
                  then recreate only the logins you still want to use.
                </p>
              </div>
              <Button
                variant="outline"
                className="rounded-2xl"
                disabled={resetMutation.isPending}
                onClick={() => {
                  void handleReset()
                }}
              >
                {resetMutation.isPending ? "Resetting..." : "Reset saved credentials"}
              </Button>
            </div>
          ) : null}

          {!credentials ? (
            <Card className="min-h-72 border border-border/70 bg-card/70" />
          ) : credentials.length === 0 ? (
            <Empty className="min-h-[24rem] border border-dashed border-border/70 bg-background/70">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconKey />
                </EmptyMedia>
                <EmptyTitle>No saved logins yet.</EmptyTitle>
                <EmptyDescription>
                  Add a website login so background agents can sign in without exposing the
                  secret to the model.
                </EmptyDescription>
              </EmptyHeader>
              <Button className="rounded-2xl" onClick={openCreateDialog}>
                <IconPlus className="size-4" />
                Create first credential
              </Button>
            </Empty>
          ) : (
            <div className="grid gap-3">
              {credentials.map((credential) => (
                <article
                  key={credential._id}
                  className="rounded-[1.45rem] border border-border/70 bg-background/85 p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.4)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {credential.isDefault ? (
                          <Badge variant="default">Default</Badge>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-medium text-foreground">
                          {credential.website}
                        </p>
                        <p className="text-sm text-muted-foreground">{credential.login}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <IconLock className="size-4" />
                        <span>••••••••••••</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => {
                          void openEditDialog(credential._id)
                        }}
                      >
                        <IconEdit className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        className="rounded-2xl"
                        onClick={() => {
                          setDeleteTarget({
                            id: credential._id,
                            label: `${credential.website} · ${credential.login}`,
                          })
                        }}
                      >
                        <IconTrash className="size-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl rounded-[1.6rem] p-0">
          <DialogHeader className="gap-3 px-6 pt-6">
            <DialogTitle>
              {editingId ? "Edit credential" : "Add credential"}
            </DialogTitle>
            <DialogDescription>
              Saved logins are matched to the exact website origin from the URL you enter.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 pb-6">
            <CredentialField
              label="Website"
              value={formData.website}
              onChange={(value) => {
                setFormData((current) => ({ ...current, website: value }))
              }}
              placeholder="https://app.example.com/login"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <CredentialField
                label="Email or username"
                value={formData.login}
                onChange={(value) => {
                  setFormData((current) => ({ ...current, login: value }))
                }}
                placeholder="qa@example.com"
              />
              <CredentialField
                label="Password"
                type="password"
                value={formData.password}
                onChange={(value) => {
                  setFormData((current) => ({ ...current, password: value }))
                }}
                placeholder="••••••••"
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Default for this site</p>
                <p className="text-sm text-muted-foreground">
                  Use this as the primary saved login when the site has more than one account.
                </p>
              </div>
              <Switch
                checked={formData.isDefault}
                onCheckedChange={(checked) => {
                  setFormData((current) => ({
                    ...current,
                    isDefault: Boolean(checked),
                  }))
                }}
              />
            </div>
          </div>

          <DialogFooter className="rounded-b-[1.6rem]" showCloseButton>
            <Button disabled={isSaving} onClick={() => void handleSubmit()}>
              {isSaving ? "Saving..." : editingId ? "Save changes" : "Create credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent className="rounded-[1.4rem]">
          <DialogHeader>
            <DialogTitle>Delete credential</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This removes ${deleteTarget.label}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CredentialField({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  type?: ComponentProps<typeof Input>["type"]
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        className="h-11 rounded-2xl"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
