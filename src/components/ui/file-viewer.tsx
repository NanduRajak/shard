"use client"

import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileCode,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type FileViewerFile = {
  content: string
  path: string
}

type TreeNode = {
  children?: Array<TreeNode>
  file?: FileViewerFile
  id: string
  lineLabel?: string
  name: string
  type: "directory" | "file"
}

function getLineLabel(file: FileViewerFile) {
  const match = file.content.match(/^\/\/ Lines (\d+)-(\d+)/)

  if (match) {
    const start = Number(match[1])
    const end = Number(match[2])
    return `+${Math.max(1, end - start + 1)}`
  }

  return `+${file.content.split("\n").length}`
}

function buildTree(files: Array<FileViewerFile>) {
  const root: Array<TreeNode> = []

  const getOrCreateDirectory = (nodes: Array<TreeNode>, name: string, id: string) => {
    let node = nodes.find(
      (entry) => entry.type === "directory" && entry.name === name
    )

    if (!node) {
      node = {
        children: [],
        id,
        name,
        type: "directory",
      }
      nodes.push(node)
    }

    return node
  }

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean)
    let level = root

    for (const [index, part] of parts.entries()) {
      const id = parts.slice(0, index + 1).join("/")
      const isFile = index === parts.length - 1

      if (isFile) {
        level.push({
          file,
          id,
          lineLabel: getLineLabel(file),
          name: part,
          type: "file",
        })
      } else {
        const node = getOrCreateDirectory(level, part, id)
        level = node.children ?? []
      }
    }
  }

  const sortNodes = (nodes: Array<TreeNode>): Array<TreeNode> =>
    [...nodes]
      .map((node) =>
        node.type === "directory" && node.children
          ? { ...node, children: sortNodes(node.children) }
          : node
      )
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })

  return sortNodes(root)
}

function getDirectoryIds(nodes: Array<TreeNode>) {
  const ids: Array<string> = []

  for (const node of nodes) {
    if (node.type === "directory") {
      ids.push(node.id)
      if (node.children) ids.push(...getDirectoryIds(node.children))
    }
  }

  return ids
}

function FileTreeNode({
  ancestors,
  expandedIds,
  level = 0,
  node,
  selectedPath,
  setExpandedIds,
  setSelectedPath,
}: {
  ancestors: Array<boolean>
  expandedIds: Set<string>
  level?: number
  node: TreeNode
  selectedPath?: string
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedPath: (path: string) => void
}) {
  if (node.type === "file") {
    const isSelected = selectedPath === node.file?.path

    return (
      <div className="relative">
        {ancestors.map((show, index) =>
          show ? (
            <span
              key={`${node.id}-file-line-${index}`}
              className="absolute top-0 bottom-0 w-0.5 bg-border/90"
              style={{ left: `${index * 14 + 19}px` }}
            />
          ) : null
        )}
        {level > 0 ? (
          <>
            <span
              className="absolute h-0.5 bg-border/90"
              style={{
                left: `${(level - 1) * 14 + 19}px`,
                top: "50%",
                width: "14px",
              }}
            />
            <span
              className="absolute w-0.5 bg-border/90"
              style={{
                left: `${(level - 1) * 14 + 19}px`,
                top: 0,
                height: "50%",
              }}
            />
          </>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (node.file) setSelectedPath(node.file.path)
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
            isSelected
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          )}
          style={{ paddingLeft: `${level * 14 + 12}px` }}
        >
          <IconFileCode className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
      </div>
    )
  }

  const isExpanded = expandedIds.has(node.id)

  return (
    <div className="relative space-y-1">
      {ancestors.map((show, index) =>
        show ? (
          <span
            key={`${node.id}-dir-line-${index}`}
            className="absolute top-0 bottom-0 w-0.5 bg-border/90"
            style={{ left: `${index * 14 + 19}px` }}
          />
        ) : null
      )}
      {level > 0 ? (
        <>
          <span
            className="absolute h-0.5 bg-border/90"
            style={{
              left: `${(level - 1) * 14 + 19}px`,
              top: "18px",
              width: "14px",
            }}
          />
          <span
            className="absolute w-0.5 bg-border/90"
            style={{
              left: `${(level - 1) * 14 + 19}px`,
              top: 0,
              height: "18px",
            }}
          />
        </>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setExpandedIds((current) => {
            const next = new Set(current)

            if (next.has(node.id)) {
              next.delete(node.id)
            } else {
              next.add(node.id)
            }

            return next
          })
        }}
        className="relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted/70"
        style={{ paddingLeft: `${level * 14 + 12}px` }}
      >
        {isExpanded ? (
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        {isExpanded ? (
          <IconFolderOpen className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconFolder className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isExpanded ? (
        <div className="relative space-y-1">
          {node.children?.map((child, index) => (
            <FileTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              ancestors={[...ancestors, index < (node.children?.length ?? 0) - 1]}
              expandedIds={expandedIds}
              selectedPath={selectedPath}
              setExpandedIds={setExpandedIds}
              setSelectedPath={setSelectedPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FileViewer({
  className,
  emptyMessage = "No files available.",
  files,
}: {
  className?: string
  emptyMessage?: string
  files: Array<FileViewerFile>
}) {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(files[0]?.path)
  const [copied, setCopied] = useState(false)
  const tree = useMemo(() => buildTree(files), [files])
  const defaultExpandedIds = useMemo(() => new Set(getDirectoryIds(tree)), [tree])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(defaultExpandedIds)

  useEffect(() => {
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current) ? current : files[0]?.path
    )
  }, [files])

  useEffect(() => {
    setExpandedIds(defaultExpandedIds)
  }, [defaultExpandedIds])

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? files[0],
    [files, selectedPath]
  )

  if (files.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-border/50 p-8 text-sm text-muted-foreground",
          className
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={cn(
        "min-h-[460px] overflow-hidden rounded-2xl border border-border/60 bg-background/70",
        className
      )}
    >
      <ResizablePanel defaultSize={30} minSize={26}>
        <div className="flex h-full flex-col">
          <div className="flex h-[53px] items-center gap-2 border-b px-4 py-3">
            <IconFolderOpen className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Files</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-1 p-2">
              {tree.map((node) => (
                <FileTreeNode
                  key={node.id}
                  node={node}
                  ancestors={[]}
                  expandedIds={expandedIds}
                  selectedPath={selectedPath}
                  setExpandedIds={setExpandedIds}
                  setSelectedPath={setSelectedPath}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={70} minSize={40}>
        <div className="flex h-full flex-col">
          <div className="flex h-[53px] items-center gap-2 border-b px-4 py-3">
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {selectedFile?.path}
            </span>
            {selectedFile ? (
              <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {getLineLabel(selectedFile)}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-8"
              onClick={() => {
                if (!selectedFile) return
                void navigator.clipboard.writeText(selectedFile.content)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <pre className="min-h-full overflow-x-auto p-4 font-mono text-xs leading-6 text-foreground">
              <code>{selectedFile?.content}</code>
            </pre>
          </ScrollArea>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
