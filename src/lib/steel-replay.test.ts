import { describe, expect, it } from "vitest"
import {
  buildSteelReplayManifestPath,
  buildSteelReplayMediaPath,
  isAllowedSteelReplayTarget,
  rewriteSteelHlsPlaylist,
} from "./steel-replay"

describe("steel replay helpers", () => {
  it("builds manifest and media proxy paths", () => {
    expect(buildSteelReplayManifestPath("session-123")).toBe("/api/steel/session-123/hls")
    expect(
      buildSteelReplayMediaPath({
        sessionId: "session-123",
        targetUrl: "https://cdn.steel.dev/video/segment.ts",
      }),
    ).toBe(
      "/api/steel/session-123/media?url=https%3A%2F%2Fcdn.steel.dev%2Fvideo%2Fsegment.ts",
    )
  })

  it("rewrites HLS playlists to local proxy URLs", () => {
    expect(
      rewriteSteelHlsPlaylist({
        playlist: "#EXTM3U\n#EXTINF:4,\nchunk-1.ts\nsub/playlist.m3u8",
        sessionId: "session-123",
        sourceUrl: "https://api.steel.dev/v1/sessions/session-123/hls",
      }),
    ).toBe(
      "#EXTM3U\n#EXTINF:4,\n/api/steel/session-123/media?url=https%3A%2F%2Fapi.steel.dev%2Fv1%2Fsessions%2Fsession-123%2Fchunk-1.ts\n/api/steel/session-123/media?url=https%3A%2F%2Fapi.steel.dev%2Fv1%2Fsessions%2Fsession-123%2Fsub%2Fplaylist.m3u8",
    )
  })

  it("allows only Steel replay assets for the same session", () => {
    expect(
      isAllowedSteelReplayTarget({
        sessionId: "session-123",
        targetUrl: "https://api.steel.dev/v1/sessions/session-123/chunk-1.ts",
      }),
    ).toBe(true)

    expect(
      isAllowedSteelReplayTarget({
        sessionId: "session-123",
        targetUrl: "https://example.com/v1/sessions/session-123/chunk-1.ts",
      }),
    ).toBe(false)

    expect(
      isAllowedSteelReplayTarget({
        sessionId: "session-123",
        targetUrl: "https://api.steel.dev/v1/sessions/session-999/chunk-1.ts",
      }),
    ).toBe(false)
  })
})
