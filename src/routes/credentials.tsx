import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconAlertTriangle,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconKey,
  IconLink,
  IconLock,
  IconMail,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import type { ComponentProps } from "react"
import { useMemo, useState } from "react"
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
import { normalizeCredentialWebsite } from "@/lib/credential-url"
import { cn } from "@/lib/utils"
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

type DialogMode = "create" | "add-to-site" | "edit"

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
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CredentialFormInput, string>>>({})
  const [switchingDefaultId, setSwitchingDefaultId] = useState<Id<"credentials"> | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, string | undefined>>({})
  const [expandedWebsite, setExpandedWebsite] = useState<string | null>(null)
  const [dialogMode, setDialogMode] = useState<DialogMode>("create")

  const createMutation = useMutation({ mutationFn: createCredential })
  const updateMutation = useMutation({ mutationFn: updateCredential })
  const deleteMutation = useMutation({ mutationFn: deleteCredential })
  const resetMutation = useMutation({ mutationFn: resetCredentials })
  const getCredentialMutation = useMutation({ mutationFn: getCredentialForEdit })

  const isSaving = createMutation.isPending || updateMutation.isPending

  const groupedCredentials = useMemo(() => {
    if (!credentials) return null
    
    const groups = new Map<string, typeof credentials>()
    for (const cred of credentials) {
      if (!groups.has(cred.origin)) {
        groups.set(cred.origin, [])
      }
      groups.get(cred.origin)!.push(cred)
    }
    
    return Array.from(groups.entries())
      .map(([origin, creds]) => ({
        origin,
        credentials: creds.sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1
          if (!a.isDefault && b.isDefault) return 1
          return a.login.localeCompare(b.login)
        })
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin))
  }, [credentials])

  const openCreateDialog = () => {
    setEditingId(null)
    setDialogMode("create")
    setFormData(EMPTY_FORM)
    setFormErrors({})
    setDialogOpen(true)
  }

  const openEditDialog = async (credentialId: Id<"credentials">) => {
    try {
      const credential = await getCredentialMutation.mutateAsync({
        data: { credentialId },
      })

      setEditingId(credentialId)
      setDialogMode("edit")
      setFormData({
        isDefault: credential.isDefault,
        login: credential.login,
        password: credential.password,
        website: credential.website,
      })
      setFormErrors({})
      setDialogOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open credential.")
    }
  }

  const validateForm = () => {
    const errors: Partial<Record<keyof CredentialFormInput, string>> = {}
    const normalizedWebsite = normalizeCredentialWebsite(formData.website)
    
    if (!formData.website.trim()) {
      errors.website = "Website URL is required"
    } else if (!normalizedWebsite) {
      errors.website = "Please enter a valid URL (e.g. https://example.com/login)"
    } else if (
      dialogMode === "create" &&
      credentials?.some((credential) => credential.origin === normalizedWebsite.origin)
    ) {
      errors.website = "This website already exists. Open it from the list and use Add login."
    }
    
    if (!formData.login.trim()) {
      errors.login = "Email or username is required"
    }
    
    if (!formData.password) {
      errors.password = "Password is required"
    }
    
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

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
      if (error instanceof Error) {
        if (error.message.includes("already exists for the website")) {
          setFormErrors((current) => ({
            ...current,
            login: "This email is already saved for this website.",
          }))
          return
        }

        if (error.message.includes("already exists")) {
          setFormErrors((current) => ({
            ...current,
            website: "This website already exists. Open it from the list and use Add login.",
          }))
          return
        }
      }

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

  const handleMakeDefault = async (credentialId: Id<"credentials">) => {
    try {
      setSwitchingDefaultId(credentialId)
      const credential = await getCredentialMutation.mutateAsync({
        data: { credentialId },
      })

      await updateMutation.mutateAsync({
        data: {
          credentialId,
          isDefault: true,
          login: credential.login,
          password: credential.password,
          website: credential.website,
        },
      })

      toast.success("Default login updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update default login.")
    } finally {
      setSwitchingDefaultId(null)
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden rounded-xl border border-border/70 bg-card/90 shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-border/70 bg-muted/15 md:flex-row md:items-start md:justify-between">
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
          <Button className="rounded-lg md:self-end" onClick={openCreateDialog}>
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
                className="rounded-lg"
                disabled={resetMutation.isPending}
                onClick={() => {
                  void handleReset()
                }}
              >
                {resetMutation.isPending ? "Resetting..." : "Reset saved credentials"}
              </Button>
            </div>
          ) : null}

          {!groupedCredentials ? (
            <div className="rounded-xl border border-border/70 bg-background/85 shadow-sm">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_92px_92px] items-center gap-3 border-b border-border/40 bg-muted/20 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <div>Website</div>
                <div>Default Email</div>
                <div>Logins</div>
                <div className="text-right">Manage</div>
              </div>
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-in fade-in-0 slide-in-from-bottom-2 grid w-full grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_92px_92px] items-center gap-3 border-b border-border/40 px-5 py-3.5 duration-500 last:border-b-0"
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="size-6 shrink-0 animate-pulse rounded-md bg-muted/60" />
                    <div className="h-4 w-40 animate-pulse rounded bg-muted/50" />
                  </div>
                  <div className="h-4 w-32 animate-pulse rounded bg-muted/50" />
                  <div className="h-4 w-8 animate-pulse rounded bg-muted/50" />
                  <div className="flex justify-end">
                    <div className="h-5 w-10 animate-pulse rounded-sm bg-muted/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : groupedCredentials.length === 0 ? (
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
              <Button className="rounded-lg" onClick={openCreateDialog}>
                <IconPlus className="size-4" />
                Create first credential
              </Button>
            </Empty>
          ) : (
            <div className="rounded-xl border border-border/70 bg-background/85 shadow-sm">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_92px_92px] items-center gap-3 border-b border-border/40 bg-muted/20 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <div>Website</div>
                <div>Default Email</div>
                <div>Logins</div>
                <div className="text-right">Manage</div>
              </div>
              {groupedCredentials.map((group, index) => {
                const defaultCredential =
                  group.credentials.find((credential) => credential.isDefault) ?? group.credentials[0]
                const isExpanded =
                  expandedWebsite === null ? index === 0 : expandedWebsite === group.origin

                return (
                  <div
                    key={group.origin}
                    className={cn(
                      "animate-in fade-in-0 slide-in-from-bottom-2 border-b border-border/40 duration-500 last:border-b-0",
                      isExpanded && "bg-muted/5",
                    )}
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <button
                      type="button"
                      className="grid w-full grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_92px_92px] items-center gap-3 px-5 py-3.5 text-left transition-all duration-300 ease-out hover:bg-muted/10"
                      onClick={() => {
                        setExpandedWebsite((current) =>
                          current === group.origin ? null : group.origin,
                        )
                      }}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background text-muted-foreground/70">
                            <IconLock className="size-3" />
                          </div>
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {group.origin}
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0 text-[13px] text-muted-foreground">
                        <span className="truncate">{defaultCredential?.login}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {group.credentials.length}
                      </div>
                      <div className="flex justify-end">
                        <Badge
                          variant="secondary"
                          className="border-transparent bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                        >
                          {isExpanded ? "Hide" : "View"}
                        </Badge>
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            height: { type: "spring", bounce: 0, duration: 0.45 },
                            opacity: { duration: 0.3, ease: "linear" },
                          }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-4">
                            <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/10">
                          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">Saved logins</p>
                              <p className="text-xs text-muted-foreground">
                                Mark one email as the default login for this website.
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg"
                              onClick={() => {
                                setEditingId(null)
                                setDialogMode("add-to-site")
                                setFormErrors({})
                                setFormData({
                                  ...EMPTY_FORM,
                                  isDefault: false,
                                  website: group.origin,
                                })
                                setDialogOpen(true)
                              }}
                            >
                              <IconPlus className="size-4" />
                              Add login
                            </Button>
                          </div>
                          <div className="grid divide-y divide-border/30">
                            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_150px] items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              <div>Email</div>
                              <div className="pl-1.5">Password</div>
                              <div>Priority</div>
                              <div className="text-right">Actions</div>
                            </div>
                            {group.credentials.map((cred) => {
                              const isSwitching = switchingDefaultId === cred._id

                              return (
                                <div
                                  key={cred._id}
                                  className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_150px] items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-background/40"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-medium text-foreground">
                                      {cred.login}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      type="button"
                                      className="flex size-7 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:text-foreground"
                                      onClick={async () => {
                                        if (visiblePasswords[cred._id]) {
                                          setVisiblePasswords((current) => ({
                                            ...current,
                                            [cred._id]: undefined,
                                          }))
                                          return
                                        }

                                        try {
                                          const credential = await getCredentialMutation.mutateAsync({
                                            data: { credentialId: cred._id },
                                          })

                                          setVisiblePasswords((current) => ({
                                            ...current,
                                            [cred._id]: credential.password,
                                          }))
                                        } catch (error) {
                                          toast.error(
                                            error instanceof Error
                                              ? error.message
                                              : "Failed to reveal password.",
                                          )
                                        }
                                      }}
                                    >
                                      {visiblePasswords[cred._id] ? (
                                        <IconEyeOff className="size-4" />
                                      ) : (
                                        <IconEye className="size-4" />
                                      )}
                                      <span className="sr-only">
                                        {visiblePasswords[cred._id] ? "Hide password" : "Show password"}
                                      </span>
                                    </button>
                                    <span className="truncate text-[13px] tracking-[0.15em] text-muted-foreground">
                                      {visiblePasswords[cred._id] ?? "••••••••••"}
                                    </span>
                                  </div>
                                  <div>
                                    {cred.isDefault ? (
                                      <Badge
                                        variant="secondary"
                                        className="border-transparent bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-500 hover:bg-emerald-500/25"
                                      >
                                        Default
                                      </Badge>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 rounded-md px-2 text-xs"
                                        disabled={isSwitching || isSaving}
                                        onClick={() => void handleMakeDefault(cred._id)}
                                      >
                                        {isSwitching ? "Updating..." : "Make default"}
                                      </Button>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                                      onClick={() => void openEditDialog(cred._id)}
                                      title="Edit"
                                    >
                                      <IconEdit className="size-4" />
                                      <span className="sr-only">Edit</span>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => {
                                        setDeleteTarget({
                                          id: cred._id,
                                          label: `${group.origin} · ${cred.login}`,
                                        })
                                      }}
                                      title="Delete"
                                    >
                                      <IconTrash className="size-4" />
                                      <span className="sr-only">Delete</span>
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
                  )
                })}
              
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl overflow-hidden rounded-xl p-0">
          <DialogHeader className="gap-2 border-b border-border/40 px-6 pb-5 pt-6">
            <DialogTitle>
              {editingId ? "Edit credential" : "Add credential"}
            </DialogTitle>
            <DialogDescription>
              Saved logins are matched to the exact website origin from the URL you enter.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 px-6 pb-2 pt-5">
            <CredentialField
              label="Website"
              icon={IconLink}
              error={formErrors.website}
              disabled={dialogMode === "add-to-site"}
              description={
                dialogMode === "add-to-site"
                  ? "This site already exists. Add the extra login under this URL."
                  : dialogMode === "create"
                    ? "Add a new website. If the site already exists, open it and use Add login."
                    : undefined
              }
              value={formData.website}
              onChange={(value) => {
                setFormData((current) => ({ ...current, website: value }))
                if (formErrors.website) setFormErrors((curr) => ({ ...curr, website: undefined }))
              }}
              placeholder="https://app.example.com/login"
            />
            <div className="grid gap-5 md:grid-cols-2">
              <CredentialField
                label="Email or username"
                icon={IconMail}
                error={formErrors.login}
                value={formData.login}
                onChange={(value) => {
                  setFormData((current) => ({ ...current, login: value }))
                  if (formErrors.login) setFormErrors((curr) => ({ ...curr, login: undefined }))
                }}
                placeholder="qa@example.com"
              />
              <CredentialField
                label="Password"
                icon={IconLock}
                type="password"
                error={formErrors.password}
                value={formData.password}
                onChange={(value) => {
                  setFormData((current) => ({ ...current, password: value }))
                  if (formErrors.password) setFormErrors((curr) => ({ ...curr, password: undefined }))
                }}
                placeholder="••••••••"
              />
            </div>
            <div className="flex items-center justify-between px-1 py-2">
              <div className="space-y-0.5">
                <p className="text-[13px] font-medium text-foreground">Default for this site</p>
                <p className="text-xs text-muted-foreground">
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

            <DialogFooter className="gap-3 px-6 pb-6 pt-4 sm:space-x-0" showCloseButton>
              <Button disabled={isSaving} className="rounded-lg" onClick={() => void handleSubmit()}>
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
        <DialogContent className="rounded-xl">
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
              className="rounded-lg"
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
  description,
  disabled,
  error,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
  icon: Icon,
}: {
  description?: string
  disabled?: boolean
  error?: string
  label: string
  onChange: (value: string) => void
  placeholder: string
  type?: ComponentProps<typeof Input>["type"]
  value: string
  icon?: React.ElementType
}) {
  return (
    <div className="grid gap-1.5">
      <Label className={`text-[13px] font-medium ${error ? "text-destructive" : "text-foreground"}`}>
        {label}
      </Label>
      <div className="relative">
        {Icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60">
            <Icon className="size-4.5" />
          </div>
        )}
        <Input
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          className={`h-11 rounded-lg bg-muted/40 border-transparent shadow-none transition-colors hover:bg-muted/60 focus-visible:bg-transparent tracking-wide ${
            Icon ? "pl-10" : ""
          } ${
            error
              ? "border-destructive/50 ring-1 ring-destructive/20 focus-visible:ring-destructive/50"
              : "focus-visible:border-primary/50"
          }`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {description ? <p className="text-[11px] leading-5 text-muted-foreground">{description}</p> : null}
      {error && (
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-destructive">
          <IconAlertTriangle className="size-3.5" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}
