"use client";

import { useEffect, useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    ArrowUpIcon,
    Cloud,
    MonitorIcon,
    PlusIcon,
} from "lucide-react";
import { IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import { motion } from "motion/react";

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

            // Temporarily shrink to get the right scrollHeight
            textarea.style.height = `${minHeight}px`;

            // Calculate new height
            const newHeight = Math.max(
                minHeight,
                Math.min(
                    textarea.scrollHeight,
                    maxHeight ?? Number.POSITIVE_INFINITY
                )
            );

            textarea.style.height = `${newHeight}px`;
        },
        [minHeight, maxHeight]
    );

    useEffect(() => {
        // Set initial height
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = `${minHeight}px`;
        }
    }, [minHeight]);

    // Adjust height on window resize
    useEffect(() => {
        const handleResize = () => adjustHeight();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [adjustHeight]);

    return { textareaRef, adjustHeight };
}

interface VercelV0ChatProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    isPending: boolean;
    browserProvider: "steel" | "local_chrome";
    onBrowserProviderChange: (provider: "steel" | "local_chrome") => void;
    onAddCredentials: () => void;
    helperLabel?: string;
    helperAvailable?: boolean;
    placeholder: string;
    modeDescription: string;
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
    canSubmit,
}: VercelV0ChatProps) {
    const { textareaRef, adjustHeight } = useAutoResizeTextarea({
        minHeight: 60,
        maxHeight: 200,
    });

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !isPending && canSubmit) {
                onSubmit();
                adjustHeight(true);
            }
        }
    };

    return (
        <div className="flex flex-col items-center w-full max-w-4xl mx-auto p-4 space-y-4">
            <div className="w-full relative">
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
                
                <div className="relative bg-neutral-900 rounded-xl border border-neutral-800">
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
                                "w-full px-4 py-3",
                                "resize-none",
                                "bg-transparent",
                                "border-none",
                                "text-white text-sm",
                                "focus:outline-none",
                                "focus-visible:ring-0 focus-visible:ring-offset-0",
                                "placeholder:text-neutral-500 placeholder:text-sm",
                                "min-h-[60px]"
                            )}
                            style={{
                                overflow: "hidden",
                            }}
                            disabled={isPending}
                        />
                    </div>

                    <div className="flex items-center justify-between p-3">
                        <div className="space-y-2">
                            <div className="flex w-fit bg-neutral-950 rounded-lg p-1 border border-neutral-800">
                                <button
                                    type="button"
                                    onClick={() => onBrowserProviderChange("steel")}
                                    className={cn(
                                        "relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                        browserProvider === "steel" ? "text-white" : "text-neutral-500 hover:text-neutral-300"
                                    )}
                                >
                                    {browserProvider === "steel" && (
                                        <motion.div
                                            layoutId="activeTab"
                                            className="absolute inset-0 bg-neutral-800 rounded-md"
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <Cloud className="w-3.5 h-3.5 relative z-10" />
                                    <span className="relative z-10">Cloud</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onBrowserProviderChange("local_chrome")}
                                    className={cn(
                                        "relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                        browserProvider === "local_chrome" ? "text-white" : "text-neutral-500 hover:text-neutral-300"
                                    )}
                                >
                                    {browserProvider === "local_chrome" && (
                                        <motion.div
                                            layoutId="activeTab"
                                            className="absolute inset-0 bg-neutral-800 rounded-md"
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <MonitorIcon className="w-3.5 h-3.5 relative z-10" />
                                    <span className="relative z-10">Local</span>
                                </button>
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs text-neutral-400">{modeDescription}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onAddCredentials}
                                className="px-2 py-1.5 rounded-lg text-sm text-zinc-400 transition-colors border border-dashed border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 flex items-center justify-between gap-1"
                            >
                                <PlusIcon className="w-4 h-4" />
                                <span className="hidden sm:inline">Add credentials</span>
                                <span className="sm:hidden">Add</span>
                            </button>
                            <button
                                type="button"
                                onClick={onSubmit}
                                disabled={isPending || !value.trim() || !canSubmit}
                                className={cn(
                                    "px-1.5 py-1.5 rounded-lg text-sm transition-colors border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 flex items-center justify-between gap-1",
                                    value.trim() && !isPending && canSubmit
                                        ? "bg-white text-black"
                                        : "text-zinc-600 border-zinc-800 bg-neutral-900"
                                )}
                            >
                                {isPending ? (
                                    <span className="text-xs px-1 text-zinc-400">...</span>
                                ) : (
                                    <ArrowUpIcon
                                        className={cn(
                                            "w-4 h-4",
                                            value.trim() && canSubmit
                                                ? "text-black"
                                                : "text-zinc-600"
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
    );
}
