"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  IconArrowUp,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconKey,
  IconPlus,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;

      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      );

      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight],
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
      adjustHeight();
    }
  }, [minHeight, adjustHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

/* ─────────────────────────────────────────────
   Credential Dropdown (DropdownMenu-based)
   ───────────────────────────────────────────── */

interface CredentialDropdownProps {
  value?: string;
  options: Array<{
    label: string;
    value: string;
    domain?: string;
    isDefault?: boolean;
  }>;
  disabled?: boolean;
  onChange?: (value: string | null) => void;
}

function CredentialDropdown({
  value,
  options,
  disabled = false,
  onChange,
}: CredentialDropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(0);

  const selected = options.find((o) => o.value === value);

  // Measure trigger width for matching dropdown width
  useLayoutEffect(() => {
    if (triggerRef.current) {
      const measure = () => setTriggerWidth(triggerRef.current!.offsetWidth);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(triggerRef.current);
      return () => ro.disconnect();
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
          }
        }}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3.5 text-sm transition-all duration-200 sm:min-w-40 sm:max-w-44",
          disabled && "cursor-not-allowed opacity-50",
          open
            ? "border-neutral-600 bg-neutral-800 text-neutral-100"
            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center overflow-hidden text-left">
          {selected ? (
            <span className="block min-w-0 flex-1 truncate font-medium tracking-[-0.01em]">
              {selected.label}
            </span>
          ) : (
            <span className="block min-w-0 flex-1 truncate text-neutral-500">
              Select login
            </span>
          )}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="shrink-0 text-neutral-500"
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
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 30,
              mass: 0.8,
            }}
            style={{
              width: triggerWidth > 0 ? Math.max(triggerWidth, 320) : 320,
              transformOrigin: "top",
            }}
            className="absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50"
          >
            <div className="flex flex-col gap-1">
              {options.map((option, idx) => {
                const isSelected = option.value === value;
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
                        onChange?.(isSelected ? null : option.value);
                        setOpen(false);
                      }}
                      title={option.label}
                      className={cn(
                        "group relative mx-auto flex min-h-12 w-full cursor-pointer items-center rounded-xl px-3 py-1.5 pr-10 text-left outline-none transition-all duration-150",
                        isSelected
                          ? "bg-neutral-800/70 text-neutral-100"
                          : "text-neutral-300 hover:bg-neutral-800/50 hover:text-neutral-100",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="truncate text-[15px] font-medium tracking-[-0.01em] text-inherit">
                            {option.label}
                          </div>
                          {option.domain ? (
                            <div className="truncate text-[10px] leading-3.5 text-neutral-500 transition-colors group-hover:text-neutral-400">
                              {option.domain}
                            </div>
                          ) : null}
                        </div>
                        {option.isDefault && (
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-black uppercase">
                            Default
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 25,
                          }}
                          className="absolute right-4 size-2 rounded-full bg-emerald-400"
                        />
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Chat Component
   ───────────────────────────────────────────── */

interface VercelV0ChatProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  browserProvider: "steel" | "local_chrome" | null;
  onBrowserProviderChange: (provider: "steel" | "local_chrome") => void;
  onAddCredentials: () => void;
  helperLabel?: string;
  helperAvailable?: boolean;
  placeholder: string;
  modeDescription: string;
  hasValidUrl: boolean;
  credentialActionMode:
    | "disabled-add"
    | "add"
    | "selected"
    | "select"
    | "loading";
  credentialLabel?: string;
  credentialValue?: string;
  credentialOptions?: Array<{
    label: string;
    value: string;
    domain?: string;
    isDefault?: boolean;
  }>;
  credentialDisabled?: boolean;
  onCredentialChange?: (value: string | null) => void;
  canSubmit: boolean;
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
  credentialActionMode,
  credentialLabel,
  credentialValue,
  credentialOptions,
  credentialDisabled = false,
  onCredentialChange,
}: VercelV0ChatProps) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 60,
    maxHeight: 200,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isPending) {
        onSubmit();
        adjustHeight(true);
      }
    }
  };

  const tabTransition = (
    hasMounted
      ? { type: "spring", stiffness: 300, damping: 30 }
      : { duration: 0 }
  ) as any;

  const renderCredentialControl = () => {
    if (credentialActionMode === "loading") {
      return (
        <div className="h-10 w-full min-w-0 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900 sm:min-w-72" />
      );
    }

    if (credentialActionMode === "select") {
      return (
        <CredentialDropdown
          value={credentialValue}
          options={credentialOptions ?? []}
          disabled={credentialDisabled}
          onChange={onCredentialChange}
        />
      );
    }

    if (credentialActionMode === "selected") {
      return (
        <div className="flex h-10 max-w-56 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-200">
          <IconKey className="h-4 w-4 shrink-0 text-neutral-400" />
          <span className="truncate">{credentialLabel}</span>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={onAddCredentials}
        disabled={credentialActionMode === "disabled-add"}
        className={cn(
          "flex h-10 items-center justify-between gap-1 rounded-lg border border-dashed px-3 text-sm transition-colors",
          credentialActionMode === "add"
            ? "border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:bg-neutral-800"
            : "cursor-not-allowed border-neutral-800 text-neutral-600",
        )}
      >
        <IconPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Add credentials</span>
        <span className="sm:hidden">Add</span>
      </button>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col items-center space-y-4 p-4">
      <div className="relative w-full">
        {helperLabel && (
          <div className="absolute -top-10 right-0 flex items-center justify-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
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
                onChange(e.target.value);
                adjustHeight();
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
                <div className="flex h-10 w-fit items-center rounded-lg border border-neutral-800 bg-neutral-950 p-1">
                  <button
                    type="button"
                    onClick={() => onBrowserProviderChange("steel")}
                    className={cn(
                      "relative flex h-full items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
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
                      "relative flex h-full items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
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
                    disabled={isPending || !value.trim()}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg border text-sm transition-colors",
                      value.trim() && !isPending
                        ? "border-neutral-200 bg-white text-black hover:bg-neutral-100"
                        : "border-neutral-800 bg-neutral-900 text-neutral-600",
                    )}
                  >
                    {isPending ? (
                      <svg
                        className="h-4 w-4 animate-spin text-neutral-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <IconArrowUp
                        className={cn(
                          "h-4 w-4",
                          value.trim() ? "text-black" : "text-neutral-600",
                        )}
                      />
                    )}
                    <span className="sr-only">Send</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {modeDescription ? (
          <div className="space-y-1 p-2">
            <p className="text-xs text-neutral-400">{modeDescription}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
