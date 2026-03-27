import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
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
  type CredentialFormInput,
  updateCredential,
} from "@/lib/credentials-server"

export const Route = createFileRoute("/credentials")({
  component: CredentialsPage,
})

const EMPTY_FORM: CredentialFormInput = {
  isDefault: true,
  namespace: "",
  password: "",
  profileLabel: "",
  totpSecret: "",
  username: "",
  website: "",
}

function CredentialsPage() {
  const { data: credentials } = useQuery(convexQuery(api.credentials.listCredentials, {}))
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
        namespace: credential.namespace,
        password: credential.password,
        profileLabel: credential.profileLabel,
        totpSecret: credential.totpSecret,
        username: credential.username,
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

  return (
    <div className="grid gap-4">
      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="flex flex-col gap-4 border-b border-border/70 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit tracking-[0.18em] uppercase">
              Credentials
            </Badge>
            <CardTitle className="font-heading text-2xl tracking-tight">
              Store reusable website logins by namespace and profile.
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm/6">
              Secrets are encrypted at rest, never sent to the model, and only
              resolved by the browser runtime when a matching site origin needs
              authentication. You can keep multiple account profiles per site and
              choose one default profile for the Home page flow.
            </CardDescription>
          </div>
          <Button className="rounded-2xl" onClick={openCreateDialog}>
            <IconPlus className="size-4" />
            Add credential
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {!credentials ? (
            <Card className="min-h-72 border border-border/70 bg-card/70" />
          ) : credentials.length === 0 ? (
            <Empty className="min-h-[28rem] border border-dashed border-border/70 bg-background/70">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconKey />
                </EmptyMedia>
                <EmptyTitle>No credentials saved yet.</EmptyTitle>
                <EmptyDescription>
                  Add a namespace and website login so future runs can authenticate
                  without exposing secrets to the model.
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
                  className="rounded-[1.4rem] border border-border/70 bg-background/75 p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.45)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{credential.namespace}</Badge>
                        <Badge variant="outline">{credential.origin}</Badge>
                        <Badge variant="outline">{credential.profileLabel}</Badge>
                        {credential.isDefault ? (
                          <Badge variant="default">Default</Badge>
                        ) : null}
                        {credential.hasTotpSecret ? (
                          <Badge variant="outline">TOTP</Badge>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-medium text-foreground">
                          {credential.website}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {credential.username}
                        </p>
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
                            label: `${credential.namespace} · ${credential.origin}`,
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
              Credentials are matched by exact namespace and website origin.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 pb-6">
            <CredentialField
              label="Namespace"
              value={formData.namespace}
              onChange={(value) => {
                setFormData((current) => ({ ...current, namespace: value }))
              }}
              placeholder="admin"
            />
            <CredentialField
              label="Profile name"
              value={formData.profileLabel}
              onChange={(value) => {
                setFormData((current) => ({ ...current, profileLabel: value }))
              }}
              placeholder="Admin account"
            />
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
                label="Username"
                value={formData.username}
                onChange={(value) => {
                  setFormData((current) => ({ ...current, username: value }))
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
            <CredentialField
              label="TOTP secret"
              value={formData.totpSecret ?? ""}
              onChange={(value) => {
                setFormData((current) => ({ ...current, totpSecret: value }))
              }}
              placeholder="Optional base32 secret"
            />
            <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Default for Home</p>
                <p className="text-sm text-muted-foreground">
                  Namespace-based interactive runs use the default profile for this site.
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
                ? `This removes ${deleteTarget.label}. Future runs will no longer be able to log into that site with this namespace.`
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
