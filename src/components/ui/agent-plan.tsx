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

type AgentPlanSubtask = {
  artifactUrl?: string;
  createdAt: number;
  description?: string;
  id: string;
  kind: string;
  pageUrl?: string;
  status: TimelineEvent["status"];
  title: string;
};

type AgentPlanTask = {
  createdAt: number;
  description?: string;
  displayStepNumber?: number;
  id: string;
  kind?: string;
  status: TimelineEvent["status"];
  stepIndex?: number;
  subtasks: AgentPlanSubtask[];
  title: string;
};

type PerformanceAudit = {
  _id?: string;
  accessibilityScore: number;
  bestPracticesScore: number;
  pageUrl: string;
  performanceScore: number;
  seoScore: number;
};

function groupAgentPlanTasks(events: TimelineEvent[]) {
  const tasks: AgentPlanTask[] = [];
  const stepMap = new Map<number, AgentPlanTask>();

  for (const event of events) {
    if (typeof event.stepIndex === "number") {
      let task = stepMap.get(event.stepIndex);
      if (!task) {
        task = {
          createdAt: event.createdAt,
          id: `step-${event.stepIndex}`,
          status: event.status ?? "completed",
          stepIndex: event.stepIndex,
          subtasks: [],
          title: `Step ${event.stepIndex}`,
        };
        stepMap.set(event.stepIndex, task);
        tasks.push(task);
      }

      task.subtasks.push({
        artifactUrl: event.artifactUrl,
        createdAt: event.createdAt,
        description: event.body,
        id: event._id,
        kind: event.kind,
        pageUrl: event.pageUrl,
        status: event.status ?? "completed",
        title: event.title,
      });

      if (event.status === "failed" || event.status === "cancelled") {
        task.status = event.status;
      } else if (event.status === "running" || event.status === "starting") {
        task.status = event.status;
      } else if (
        event.status === "completed" &&
        task.status !== "failed" &&
        task.status !== "cancelled"
      ) {
        task.status = "completed";
      }
    } else {
      tasks.push({
        createdAt: event.createdAt,
        description: event.body,
        kind: event.kind,
        id: event._id,
        status: event.status ?? "completed",
        stepIndex: undefined,
        subtasks: [],
        title: event.title,
      });
    }
  }

  let displayStepNumber = 1;
  for (const task of tasks) {
    if (typeof task.stepIndex === "number") {
      task.displayStepNumber = displayStepNumber;
      task.title = buildReadableTaskTitle(task, displayStepNumber);
      displayStepNumber += 1;
    }
  }

  for (const [index, task] of tasks.entries()) {
    const hasLaterTask = index < tasks.length - 1;
    const hasLaterTerminalEvent = tasks
      .slice(index + 1)
      .some((laterTask) => laterTask.kind === "status");
    const shouldMarkCompleted =
      task.status !== "failed" &&
      task.status !== "cancelled" &&
      (hasLaterTask || hasLaterTerminalEvent);

    if (shouldMarkCompleted) {
      task.status = "completed";
      if (task.subtasks.length > 0) {
        task.subtasks = task.subtasks.map((subtask) => ({
          ...subtask,
          status:
            subtask.status === "failed" || subtask.status === "cancelled"
              ? subtask.status
              : "completed",
        }));
      }
    }
  }

  return tasks;
}

function buildReadableTaskTitle(task: AgentPlanTask, displayStepNumber: number) {
  const preferredSubtask = task.subtasks.find(
    (subtask) =>
      subtask.title !== "Agent decision" &&
      subtask.title !== "Fallback action selected" &&
      subtask.title !== "Stored login",
  );

  if (preferredSubtask?.title) {
    return preferredSubtask.title;
  }

  return `Step ${displayStepNumber}`;
}

function getAutoExpandedTaskId(tasks: AgentPlanTask[]) {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const task = tasks[index];
    if (!task) continue;
    if (task.status === "running" || task.status === "starting") {
      return task.id;
    }
  }

  return null;
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

function normalizeSubtaskTitle(subtask: AgentPlanTask["subtasks"][number]) {
  if (subtask.title.startsWith("Running Lighthouse audit")) {
    return "Lighthouse audit";
  }

  if (subtask.title === "Lighthouse report saved") {
    return "Lighthouse report";
  }

  return subtask.title;
}

function renderRunCompletedBody(body?: string) {
  if (!body) return null;

  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const remainingLines = lines.filter((line) => !line.startsWith("Final quality score:"));
  if (!remainingLines.length) {
    return null;
  }

  return (
    <div className="space-y-2 py-2">
      {remainingLines.map((line, index) => {
        const isOutcome = line.startsWith("Task outcome:");
        return (
          <div
            key={`${line}-${index}`}
            className={
              isOutcome
                ? "inline-flex rounded-md border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400"
                : "text-sm leading-relaxed text-muted-foreground/90"
            }
          >
            {isOutcome ? line.replace("Task outcome:", "").trim() : line}
          </div>
        );
      })}
    </div>
  );
}

function buildLighthouseMetricSubtasks(audit: PerformanceAudit, taskId: string, createdAt: number) {
  const metrics = [
    ["Performance", audit.performanceScore],
    ["Accessibility", audit.accessibilityScore],
    ["Best practices", audit.bestPracticesScore],
    ["SEO", audit.seoScore],
  ] as const;

  return metrics.map(([title, score]) => ({
    artifactUrl: undefined,
    createdAt,
    description: `Score ${Math.round(score * 100)}/100`,
    id: `${taskId}-${title.toLowerCase().replace(/\s+/g, "-")}`,
    kind: "metric",
    pageUrl: audit.pageUrl,
    status: "completed" as const,
    title,
  }));
}

function isLighthouseTask(task: AgentPlanTask) {
  return task.subtasks.some(
    (subtask) =>
      subtask.title.startsWith("Running Lighthouse audit") ||
      subtask.title === "Lighthouse report saved",
  );
}

function consolidateLighthouseTasks(
  tasks: AgentPlanTask[],
  performanceAudits: PerformanceAudit[],
): AgentPlanTask[] {
  const lighthouseTasks = tasks.filter(isLighthouseTask);
  if (!lighthouseTasks.length || !performanceAudits.length) {
    return tasks;
  }

  const firstLighthouseTask = lighthouseTasks[0]!;
  const lighthouseTask: AgentPlanTask = {
    createdAt: firstLighthouseTask.createdAt,
    description: firstLighthouseTask.subtasks[0]?.pageUrl ?? firstLighthouseTask.description,
    displayStepNumber: firstLighthouseTask.displayStepNumber,
    id: firstLighthouseTask.id,
    kind: "audit",
    status: firstLighthouseTask.status,
    stepIndex: firstLighthouseTask.stepIndex,
    subtasks: buildLighthouseMetricSubtasks(
      performanceAudits[0]!,
      firstLighthouseTask.id,
      firstLighthouseTask.createdAt,
    ),
    title: "Lighthouse audit",
  };

  const consolidatedTasks = tasks
    .filter((task) => !isLighthouseTask(task))
    .concat(lighthouseTask)
    .sort((left, right) => left.createdAt - right.createdAt);

  let displayStepNumber = 1;
  for (const task of consolidatedTasks) {
    if (typeof task.stepIndex === "number") {
      task.displayStepNumber = displayStepNumber;
      if (task.id !== lighthouseTask.id) {
        task.title = `Step ${displayStepNumber}`;
      }
      displayStepNumber += 1;
    }
  }

  return consolidatedTasks;
}

function getKindBadgeClasses(kind?: string) {
  if (kind === "finding") {
    return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";
  }

  if (kind === "agent") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }

  return "border-border/40 bg-secondary/40 text-secondary-foreground";
}

function getScoreBadgeClasses(scoreText: string) {
  const scoreValue = Number.parseInt(scoreText, 10);

  if (Number.isNaN(scoreValue)) {
    return "border-border/40 bg-secondary/40 text-secondary-foreground";
  }

  if (scoreValue >= 90) {
    return "border-green-500/20 bg-green-500/10 text-green-300";
  }

  if (scoreValue >= 50) {
    return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";
  }

  return "border-red-500/20 bg-red-500/10 text-red-300";
}

export function AgentPlan({
  events,
  finalScore,
  performanceAudits = [],
}: {
  events: TimelineEvent[];
  finalScore?: number | null;
  performanceAudits?: PerformanceAudit[];
}) {
  const groupedTasks = useMemo(() => {
    return consolidateLighthouseTasks(groupAgentPlanTasks(events), performanceAudits);
  }, [events, performanceAudits]);
  const autoExpandedTaskId = useMemo(() => getAutoExpandedTaskId(groupedTasks), [groupedTasks]);
  const [expandedTasks, setExpandedTasks] = useState<{ [key: string]: boolean }>({});
  const [expandedSubtasks, setExpandedSubtasks] = useState<{ [key: string]: boolean }>({});

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const toggleSubtaskExpansion = (taskId: string, subtaskId: string) => {
    const key = `${taskId}-${subtaskId}`;
    setExpandedSubtasks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks((prev) => ({
      ...prev,
      [taskId]: !(prev[taskId] ?? (autoExpandedTaskId === taskId)),
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
              const isExpanded = expandedTasks[task.id] ?? (autoExpandedTaskId === task.id);
              const isCompleted = task.status === "completed";
              const taskTitle = task.title;

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
                    className="group flex cursor-pointer flex-col rounded-md px-3 py-1.5 transition-colors md:flex-row md:items-center"
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
                          {taskTitle}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center justify-start mt-2 md:mt-0 space-x-2 text-xs ml-[2.25rem] md:ml-0">
                      {task.title === "Run completed" && typeof finalScore === "number" && (
                        <div className="rounded border border-border/40 bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                          {Math.round(finalScore)}/100
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
                           {task.title === "Run completed"
                             ? renderRunCompletedBody(task.description)
                             : parseBody(task.description)}
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
                            const isMetricSubtask = subtask.kind === "metric";
                            const metricScore = isMetricSubtask ? subtask.description?.replace("Score ", "") : null;
                            const canExpandSubtask = !isMetricSubtask && Boolean(subtask.description || subtask.artifactUrl);

                            return (
                              <motion.li
                                key={subtask.id}
                                className="group relative z-10 flex flex-col py-0.5 pl-5"
                                variants={subtaskVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                              >
                                <motion.div 
                                  className={`flex max-w-full flex-1 items-start gap-3 rounded-md p-1.5 transition-colors sm:items-center ${
                                    canExpandSubtask
                                      ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                                      : ""
                                  }`}
                                  onClick={
                                    canExpandSubtask
                                      ? () => toggleSubtaskExpansion(task.id, subtask.id)
                                      : undefined
                                  }
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
                                      {isMetricSubtask ? subtask.title : normalizeSubtaskTitle(subtask)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground mt-0.5">
                                      {formatDistanceToNowStrict(subtask.createdAt, { addSuffix: true })}
                                    </span>
                                  </div>

                                  <div className="flex shrink-0 items-center justify-end gap-1.5 ml-auto">
                                      {metricScore && (
                                        <span
                                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-sm ${getScoreBadgeClasses(metricScore)}`}
                                        >
                                          {metricScore}
                                        </span>
                                      )}
                                      {subtask.kind && !isMetricSubtask && (
                                        <span
                                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-sm ${getKindBadgeClasses(subtask.kind)}`}
                                        >
                                          {subtask.kind === "finding" ? "issue" : subtask.kind}
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
                                  {canExpandSubtask && isSubtaskExpanded && (
                                    <motion.div 
                                      className="border-muted-foreground/30 mt-1 ml-1.5 border-l-2 border-dashed pl-4 text-sm overflow-hidden"
                                      variants={subtaskDetailsVariants}
                                      initial="hidden"
                                      animate="visible"
                                      exit="hidden"
                                      layout
                                    >
                                      <div className="py-1 pr-2">
                                        {!isMetricSubtask ? parseBody(subtask.description) : null}
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
