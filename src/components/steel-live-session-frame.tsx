import { useMemo, useState } from "react"
import { IconExternalLink, IconRefresh } from "@tabler/icons-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function SteelLiveSessionFrame({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const [reloadCount, setReloadCount] = useState(0)

  const frameSrc = useMemo(() => {
    if (reloadCount === 0) {
      return src
    }

    const url = new URL(src)
    url.searchParams.set("embedReload", String(reloadCount))
    return url.toString()
  }, [reloadCount, src])

  return (
    <div className="flex h-full min-h-[26rem] flex-col gap-3 xl:min-h-0">
      <iframe
        title="Steel live session"
        src={frameSrc}
        allow="clipboard-read; clipboard-write"
        className={cn(
          "h-full min-h-[22rem] w-full rounded-[1.6rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)] xl:min-h-0",
          className,
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[1rem] border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <p className="max-w-2xl">
          Steel serves this viewer. If the embed says the browser disconnected while the run is
          still moving, reload the viewer or open the native Steel page.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => {
              setReloadCount((current) => current + 1)
            }}
          >
            Reload viewer
            <IconRefresh className="size-3.5" />
          </Button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "rounded-xl",
            })}
          >
            Open in Steel
            <IconExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}
