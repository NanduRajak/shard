"use client"

import { useEffect, useRef, useState } from "react"
import { buildSteelReplayManifestPath } from "@/lib/steel-replay"

export function SteelReplayPlayer({ sessionId }: { sessionId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    const manifestPath = buildSteelReplayManifestPath(sessionId)
    let hlsInstance: { destroy: () => void } | null = null
    let cancelled = false

    async function attachReplay() {
      const currentVideo = videoRef.current

      if (!currentVideo) {
        return
      }

      if (currentVideo.canPlayType("application/vnd.apple.mpegurl")) {
        currentVideo.src = manifestPath
        return
      }

      try {
        const HlsModule = await import("hls.js")

        if (cancelled) {
          return
        }

        const Hls = HlsModule.default

        if (!Hls.isSupported()) {
          setError("This browser does not support HLS playback.")
          return
        }

        const instance = new Hls({
          enableWorker: true,
        })

        instance.on(Hls.Events.ERROR, (_, event) => {
          if (event.fatal) {
            setError("Replay video is unavailable right now.")
          }
        })

        instance.loadSource(manifestPath)
        instance.attachMedia(currentVideo)
        hlsInstance = instance
      } catch {
        setError("Replay video is unavailable right now.")
      }
    }

    void attachReplay()

    return () => {
      cancelled = true
      hlsInstance?.destroy()
    }
  }, [sessionId])

  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      className="aspect-video w-full rounded-[1.4rem] border border-border/70 bg-black"
    />
  )
}
