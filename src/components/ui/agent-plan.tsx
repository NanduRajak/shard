"use client";

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconCircle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconExternalLink,
} from "@tabler/icons-react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { formatDistanceToNowStrict } from "date-fns";

export type TimelineEvent = {
  _id: string;
  artifactUrl?: string;
  body?: string;
  createdAt: number;
  kind: string;
  pageUrl?: string;
  status?: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting";
  stepIndex?: number;
  title: string;
};

interface Subtask {
  id: string;
  title: string;
  description?: string;
  status: TimelineEvent["status"];
  kind: string;
  createdAt: number;
  pageUrl?: string;
  artifactUrl?: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: TimelineEvent["status"];
  stepIndex?: number;
  subtasks: Subtask[];
  createdAt: number;
}

function parseBody(body?: string) {
  if (!body) return null;
  const isSuspiciouslyJson = body.trim().startsWith("{") || body.trim().startsWith("[");
  if (isSuspiciouslyJson) {
    try {
      const parsed = JSON.parse(body);
      return (
        <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-black/20 p-3 text-xs text-muted-foreground/90 font-mono shadow-inner">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      // Not actually JSON, fall through
    }
  }
  return <p className="py-2 text-muted-foreground/90 leading-relaxed whitespace-pre-wrap">{body}</p>;
}

export function AgentPlan({ events }: { events: TimelineEvent[] }) {
  // Group events by stepIndex. 
  // If an event lacks a stepIndex, we treat it as its own distinct step.
  const groupedTasks = useMemo(() => {
    const tasks: Task[] = [];
    const stepMap = new Map<number, Task>();

    for (const event of events) {
      if (typeof event.stepIndex === "number") {
        let task = stepMap.get(event.stepIndex);
        if (!task) {
          task = {
            id: `step-${event.stepIndex}`,
            title: `Step ${event.stepIndex}`,
            status: event.status ?? "completed",
            stepIndex: event.stepIndex,
            subtasks: [],
            createdAt: event.createdAt,
          };
          stepMap.set(event.stepIndex, task);
          tasks.push(task);
        }
        
        // Use the primary visual info from the event
        task.subtasks.push({
          id: event._id,
          title: event.title,
          description: event.body,
          status: event.status ?? "completed",
          kind: event.kind,
          createdAt: event.createdAt,
          pageUrl: event.pageUrl,
          artifactUrl: event.artifactUrl,
        });

        // Update parent task status to worst case scenario or most ongoing
        if (event.status === "failed" || event.status === "cancelled") {
          task.status = event.status;
        } else if (event.status === "running" && task.status !== "failed") {
          task.status = "running";
        }

      } else {
        // Standalone event (e.g. initial navigation)
        tasks.push({
          id: event._id,
          title: event.title,
          description: event.body,
          status: event.status ?? "completed",
          stepIndex: undefined,
          subtasks: [],
          createdAt: event.createdAt,
        });
      }
    }
    
    // Sort tasks primarily by logical order if we want, or just rely on chronology since events are sorted
    return tasks;
  }, [events]);

  const [expandedTasks, setExpandedTasks] = useState<string[]>(
    Array.from(new Set(events.map(e => e.stepIndex !== undefined ? `step-${e.stepIndex}` : e._id)))
  );
  
  const [expandedSubtasks, setExpandedSubtasks] = useState<{ [key: string]: boolean }>({});

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSubtaskExpansion = (taskId: string, subtaskId: string) => {
    const key = `${taskId}-${subtaskId}`;
    setExpandedSubtasks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const getStatusIcon = (status?: string, className?: string) => {
    const classes = className ?? "h-4.5 w-4.5";
    switch (status) {
      case "completed":
        return <IconCircleCheck className={`${classes} text-green-500`} />;
      case "running":
      case "starting":
        return <IconCircleDashed className={`${classes} text-blue-500 animate-[spin_4s_linear_infinite]`} />;
      case "failed":
      case "cancelled":
        return <IconCircleX className={`${classes} text-red-500`} />;
      case "queued":
        return <IconAlertCircle className={`${classes} text-yellow-500`} />;
      default:
        return <IconCircle className={`${classes} text-muted-foreground`} />;
    }
  };

  const getStatusBadgeColors = (status?: string) => {
    if (status === "completed") return "bg-green-500/15 text-green-400 border-green-500/20";
    if (status === "running" || status === "starting") return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    if (status === "failed" || status === "cancelled") return "bg-red-500/15 text-red-500 border-red-500/20";
    if (status === "queued") return "bg-yellow-500/15 text-yellow-400 border-yellow-500/20";
    return "bg-muted text-muted-foreground border-border/50";
  };

  // Animation variants
  const taskVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : -5 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { 
        type: (prefersReducedMotion ? "tween" : "spring") as any, 
        stiffness: 500, 
        damping: 30,
        duration: prefersReducedMotion ? 0.2 : undefined
      }
    },
    exit: { opacity: 0, y: prefersReducedMotion ? 0 : -5, transition: { duration: 0.15 } }
  };

  const subtaskListVariants = {
    hidden: { opacity: 0, height: 0, overflow: "hidden" },
    visible: { 
      height: "auto", 
      opacity: 1,
      overflow: "visible",
      transition: { 
        duration: 0.25, 
        staggerChildren: prefersReducedMotion ? 0 : 0.05,
        when: "beforeChildren",
        ease: [0.2, 0.65, 0.3, 0.9] as const
      }
    },
    exit: {
      height: 0, opacity: 0, overflow: "hidden",
      transition: { duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] as const }
    }
  };

  const subtaskVariants = {
    hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
    visible: { 
      opacity: 1, x: 0,
      transition: { 
        type: (prefersReducedMotion ? "tween" : "spring") as any, 
        stiffness: 500, damping: 25, duration: prefersReducedMotion ? 0.2 : undefined
      }
    },
    exit: { opacity: 0, x: prefersReducedMotion ? 0 : -10, transition: { duration: 0.15 } }
  };

  const subtaskDetailsVariants = {
    hidden: { opacity: 0, height: 0, overflow: "hidden" },
    visible: { 
      opacity: 1, height: "auto", overflow: "visible",
      transition: { duration: 0.25, ease: [0.2, 0.65, 0.3, 0.9] as const }
    }
  };

  const statusBadgeVariants = {
    initial: { scale: 1 },
    animate: { 
      scale: prefersReducedMotion ? 1 : [1, 1.05, 1],
      transition: { duration: 0.35, ease: [0.34, 1.56, 0.64, 1] as const }
    }
  };

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-32 text-center text-muted-foreground p-4">
        <IconCircleDashed className="animate-spin mb-3 text-muted-foreground/50" />
        <p>Waiting for runtime events...</p>
      </div>
    );
  }

  return (
    <div className="text-foreground w-full p-2">
      <LayoutGroup>
        <div>
          <ul className="space-y-1">
            {groupedTasks.map((task, index) => {
              const isExpanded = expandedTasks.includes(task.id);
              const isCompleted = task.status === "completed";

              return (
                <motion.li
                  key={task.id}
                  className={` ${index !== 0 ? "mt-1 pt-2" : ""} `}
                  initial="hidden"
                  animate="visible"
                  variants={taskVariants}
                >
                  {/* Task row */}
                  <motion.div 
                    className="group flex flex-col md:flex-row md:items-center px-3 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => toggleTaskExpansion(task.id)}
                  >
                    <div className="flex flex-1 items-center">
                      <motion.div
                        className="mr-3 flex-shrink-0"
                        whileHover={{ scale: 1.1 }}
                      >
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={task.status}
                            initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
                            transition={{ duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] as const }}
                          >
                            {getStatusIcon(task.status, "h-5 w-5")}
                          </motion.div>
                        </AnimatePresence>
                      </motion.div>

                      <div className="mr-2 flex-1">
                        <span className={`font-medium ${isCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {task.title}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center justify-start mt-2 md:mt-0 space-x-2 text-xs ml-[2.25rem] md:ml-0">
                      {task.stepIndex !== undefined && (
                        <div className="rounded border border-border/40 bg-secondary/40 text-secondary-foreground px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                          Index {task.stepIndex}
                        </div>
                      )}

                      {task.status && (
                        <motion.span
                          className={`rounded px-1.5 py-0.5 border ${getStatusBadgeColors(task.status)} font-medium text-[10px]`}
                          variants={statusBadgeVariants}
                          initial="initial"
                          animate="animate"
                          key={task.status}
                        >
                          {task.status}
                        </motion.span>
                      )}
                    </div>
                  </motion.div>

                  {/* Root single-event expansion (if task has no subtasks) */}
                  <AnimatePresence mode="wait">
                    {isExpanded && task.subtasks.length === 0 && task.description && (
                      <motion.div
                        variants={subtaskListVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        className="relative overflow-hidden"
                        layout
                      >
                        <div className="border-l-2 border-dashed border-muted-foreground/30 mt-1 ml-[1.125rem] pl-4 text-sm text-foreground overflow-hidden">
                          <div className="py-2 pr-2">
                           {parseBody(task.description)}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Subtasks - staggered */}
                  <AnimatePresence mode="wait">
                    {isExpanded && task.subtasks.length > 0 && (
                      <motion.div 
                        className="relative overflow-hidden"
                        variants={subtaskListVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        layout
                      >
                        {/* Vertical connecting line aligned with task icon */}
                        <div className="absolute top-0 bottom-0 left-[1.125rem] border-l-2 border-dashed border-muted-foreground/30" />
                        <ul className="mt-1 mr-2 mb-1.5 ml-3 space-y-0.5 pt-1">
                          {task.subtasks.map((subtask) => {
                            const subtaskKey = `${task.id}-${subtask.id}`;
                            const isSubtaskExpanded = expandedSubtasks[subtaskKey] ?? false;
                            const isSubCompleted = subtask.status === "completed";

                            return (
                              <motion.li
                                key={subtask.id}
                                className="group flex flex-col py-0.5 pl-5 relative z-10"
                                variants={subtaskVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                              >
                                <motion.div 
                                  className="flex flex-1 items-start sm:items-center rounded-md p-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer gap-3 max-w-full"
                                  onClick={() => toggleSubtaskExpansion(task.id, subtask.id)}
                                  layout
                                >
                                  <motion.div
                                    className="flex-shrink-0 mt-0.5 sm:mt-0"
                                    whileTap={{ scale: 0.9 }}
                                    whileHover={{ scale: 1.1 }}
                                    layout
                                  >
                                    <AnimatePresence mode="wait">
                                      <motion.div
                                        key={subtask.status}
                                        initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
                                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                        exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
                                        transition={{ duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] as const }}
                                      >
                                        {getStatusIcon(subtask.status, "h-4 w-4")}
                                      </motion.div>
                                    </AnimatePresence>
                                  </motion.div>

                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className={`text-sm truncate ${isSubCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                      {subtask.title}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground mt-0.5">
                                      {formatDistanceToNowStrict(subtask.createdAt, { addSuffix: true })}
                                    </span>
                                  </div>

                                  <div className="flex shrink-0 items-center justify-end gap-1.5 ml-auto">
                                      {subtask.kind && (
                                        <span className="bg-secondary/40 text-secondary-foreground border border-border/40 rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                                          {subtask.kind}
                                        </span>
                                      )}
                                      {subtask.status && (
                                        <motion.span
                                          className={`rounded px-1.5 py-0.5 border ${getStatusBadgeColors(subtask.status)} font-medium text-[10px]`}
                                          variants={statusBadgeVariants}
                                          initial="initial"
                                          animate="animate"
                                          key={subtask.status}
                                        >
                                          {subtask.status}
                                        </motion.span>
                                      )}
                                  </div>
                                </motion.div>

                                <AnimatePresence mode="wait">
                                  {isSubtaskExpanded && (
                                    <motion.div 
                                      className="border-muted-foreground/30 mt-1 ml-1.5 border-l-2 border-dashed pl-4 text-sm overflow-hidden"
                                      variants={subtaskDetailsVariants}
                                      initial="hidden"
                                      animate="visible"
                                      exit="hidden"
                                      layout
                                    >
                                      <div className="py-1 pr-2">
                                        {parseBody(subtask.description)}
                                        {subtask.artifactUrl && (
                                          <a
                                              href={subtask.artifactUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline hover:text-primary/80 transition-colors"
                                            >
                                              Open saved artifact
                                              <IconExternalLink className="size-3" />
                                          </a>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.li>
                            );
                          })}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </LayoutGroup>
    </div>
  );
}
