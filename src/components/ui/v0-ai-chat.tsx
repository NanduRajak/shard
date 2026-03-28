"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconKey,
  IconPlus,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react"
import { AnimatePresence, motion } from "motion/react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface UseAutoResizeTextareaProps {
  minHeight: number
  maxHeight?: number
}

function useAutoResizeTextarea({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current
      if (!textarea) return

      if (reset) {
        textarea.style.height = `${minHeight}px`
        return
      }

      textarea.style.height = `${minHeight}px`

      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      )

      textarea.style.height = `${newHeight}px`
    },
    [minHeight, maxHeight],
  )

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = `${minHeight}px`
      adjustHeight()
    }
  }, [minHeight, adjustHeight])

  useEffect(() => {
    const handleResize = () => adjustHeight()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [adjustHeight])

  return { textareaRef, adjustHeight }
}

/* ─────────────────────────────────────────────
   Credential Dropdown (DropdownMenu-based)
   ───────────────────────────────────────────── */

interface CredentialDropdownProps {
  value?: string
  options: Array<{
    label: string
    value: string
    domain?: string
    isDefault?: boolean
  }>
  disabled?: boolean
  onChange?: (value: string | null) => void
}

function CredentialDropdown({ value, options, disabled = false, onChange }: CredentialDropdownProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [triggerWidth, setTriggerWidth] = useState(0)

  const selected = options.find((o) => o.value === value)

  // Measure trigger width for matching dropdown width
  useLayoutEffect(() => {
    if (triggerRef.current) {
      const measure = () => setTriggerWidth(triggerRef.current!.offsetWidth)
      measure()
      const ro = new ResizeObserver(measure)
      ro.observe(triggerRef.current)
      return () => ro.disconnect()
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev)
          }
        }}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-sm transition-all duration-200 sm:min-w-72",
          disabled && "cursor-not-allowed opacity-50",
          open
            ? "border-zinc-600 bg-zinc-800 text-zinc-100"
            : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
          {selected ? (
            <>
              <span className="truncate font-medium">{selected.label}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">·</span>
              {selected.domain && (
                <span className="truncate text-xs text-zinc-500">
                  {selected.domain}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-500">Select login</span>
          )}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="shrink-0 text-zinc-500"
        >
          <IconChevronDown className="size-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            style={{ width: triggerWidth > 0 ? triggerWidth : undefined, transformOrigin: "top" }}
            className="absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50"
          >
            <div className="flex flex-col gap-1">
            {options.map((option, idx) => {
              const isSelected = option.value === value
              return (
                <motion.div
                  key={option.value}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 30,
                    delay: idx * 0.03,
                  }}
                  className="px-1"
                >

                  <button
                    type="button"
                    onClick={() => {
                      onChange?.(isSelected ? null : option.value)
                      setOpen(false)
                    }}
                    className={cn(
                      "group relative flex w-full cursor-pointer items-center rounded-lg px-3.5 py-3.5 pr-10 text-left outline-none transition-all duration-150",
                      isSelected
                        ? "bg-zinc-800/70 text-zinc-100"
                        : "text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <span className="truncate text-sm font-medium">
                          {option.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-500">·</span>
                        {option.domain && (
                          <span className="truncate text-xs text-zinc-500 transition-colors group-hover:text-zinc-400">
                            {option.domain}
                          </span>
                        )}
                      </div>
                      {option.isDefault && (
                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-400 uppercase ring-1 ring-emerald-500/20">
                          Default
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                        className="absolute right-3 flex size-4 items-center justify-center text-emerald-400"
                      >
                        <IconCheck className="size-4" />
                      </motion.span>
                    )}
                  </button>
                </motion.div>
              )
            })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Main Chat Component
   ───────────────────────────────────────────── */

interface VercelV0ChatProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isPending: boolean
  browserProvider: "steel" | "local_chrome" | null
  onBrowserProviderChange: (provider: "steel" | "local_chrome") => void
  onAddCredentials: () => void
  helperLabel?: string
  helperAvailable?: boolean
  placeholder: string
  modeDescription: string
  hasValidUrl: boolean
  credentialActionMode: "disabled-add" | "add" | "selected" | "select" | "loading"
  credentialLabel?: string
  credentialValue?: string
  credentialOptions?: Array<{
    label: string
    value: string
    domain?: string
    isDefault?: boolean
  }>
  credentialDisabled?: boolean
  onCredentialChange?: (value: string | null) => void
  canSubmit: boolean
}

export function VercelV0Chat({
  value,
  onChange,
  onSubmit,
  isPending,
  browserProvider,
  onBrowserProviderChange,
  onAddCredentials,
  helperLabel,
  helperAvailable,
  placeholder,
  modeDescription,
  hasValidUrl,
  credentialActionMode,
  credentialLabel,
  credentialValue,
  credentialOptions,
  credentialDisabled = false,
  onCredentialChange,
  canSubmit,
}: VercelV0ChatProps) {
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !isPending && hasValidUrl && canSubmit) {
        onSubmit()
        adjustHeight(true)
      }
    }
  }

  const tabTransition = (hasMounted
    ? { type: "spring", stiffness: 300, damping: 30 }
    : { duration: 0 }) as any

  const renderCredentialControl = () => {
    if (credentialActionMode === "loading") {
      return (
        <div className="h-9 w-full min-w-0 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 sm:min-w-72" />
      )
    }

    if (credentialActionMode === "select") {
      return (
        <CredentialDropdown
          value={credentialValue}
          options={credentialOptions ?? []}
          disabled={credentialDisabled}
          onChange={onCredentialChange}
        />
      )
    }

    if (credentialActionMode === "selected") {
      return (
        <div className="flex h-9 max-w-56 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200">
          <IconKey className="h-4 w-4 shrink-0 text-zinc-400" />
          <span className="truncate">{credentialLabel}</span>
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={onAddCredentials}
        disabled={credentialActionMode === "disabled-add"}
        className={cn(
          "flex h-9 items-center justify-between gap-1 rounded-lg border border-dashed px-3 text-sm transition-colors",
          credentialActionMode === "add"
            ? "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800"
            : "cursor-not-allowed border-zinc-800 text-zinc-600",
        )}
      >
        <IconPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Add credentials</span>
        <span className="sm:hidden">Add</span>
      </button>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center space-y-4 p-4">
      <div className="relative w-full">
        {helperLabel && (
          <div className="absolute -top-10 right-0 flex items-center justify-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-3 py-1 text-xs">
            {helperAvailable ? (
              <IconPlugConnected className="size-3 text-emerald-500" />
            ) : (
              <IconPlugConnectedX className="size-3 text-amber-500" />
            )}
            <span className="font-medium text-foreground">{helperLabel}</span>
          </div>
        )}

        <div className="relative rounded-xl border border-neutral-800 bg-neutral-900">
          <div className="overflow-y-auto">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value)
                adjustHeight()
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={cn(
                "min-h-[60px] w-full resize-none border-none bg-transparent px-4 py-3 text-sm text-white",
                "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                "placeholder:text-sm placeholder:text-neutral-500",
              )}
              style={{
                overflow: "hidden",
                height: "60px",
                transition: "height 0.15s ease-out",
              }}
              disabled={isPending}
            />
          </div>

          <div className="p-3">
            <div className="flex flex-col gap-2 sm:gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex w-fit items-center rounded-lg border border-neutral-800 bg-neutral-950 p-1">
                  <button
                    type="button"
                    onClick={() => onBrowserProviderChange("steel")}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      hasMounted && browserProvider === "steel"
                        ? "text-white"
                        : "text-neutral-500 hover:text-neutral-300",
                    )}
                  >
                    {hasMounted && browserProvider === "steel" && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 rounded-md bg-neutral-800"
                        transition={tabTransition}
                      />
                    )}
                    <IconCloud className="relative z-10 h-3.5 w-3.5" />
                    <span className="relative z-10">Cloud</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onBrowserProviderChange("local_chrome")}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      hasMounted && browserProvider === "local_chrome"
                        ? "text-white"
                        : "text-neutral-500 hover:text-neutral-300",
                    )}
                  >
                    {hasMounted && browserProvider === "local_chrome" && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 rounded-md bg-neutral-800"
                        transition={tabTransition}
                      />
                    )}
                    <IconDeviceDesktop className="relative z-10 h-3.5 w-3.5" />
                    <span className="relative z-10">Local</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {renderCredentialControl()}
                  </motion.div>
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={isPending || !value.trim() || !hasValidUrl || !canSubmit}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg border px-2.5 text-sm transition-colors",
                      value.trim() && !isPending && hasValidUrl && canSubmit
                        ? "border-zinc-200 bg-white text-black hover:bg-zinc-100"
                        : "border-zinc-800 bg-neutral-900 text-zinc-600",
                    )}
                  >
                    {isPending ? (
                      <span className="px-1 text-xs text-zinc-400">...</span>
                    ) : (
                      <IconArrowUp
                        className={cn(
                          "h-4 w-4",
                          value.trim() && hasValidUrl && canSubmit
                            ? "text-black"
                            : "text-zinc-600",
                        )}
                      />
                    )}
                    <span className="sr-only">Send</span>
                  </button>
                </div>
              </div>

              {modeDescription ? (
                <div className="space-y-1">
                  <p className="text-xs text-neutral-400">{modeDescription}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
