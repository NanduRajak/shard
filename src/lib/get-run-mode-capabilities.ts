import { createServerFn } from "@tanstack/react-start"
import { api } from "../../convex/_generated/api"
import { resolveRunModeCapabilities } from "./run-mode-capabilities"

export async function loadRunModeCapabilities() {
  const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
    import("~/server/convex"),
    import("~/server-env"),
  ])

  const convex = createConvexServerClient()
  const rawCapabilities = await convex.query(api.runtime.getRunModeCapabilities, {})

  return resolveRunModeCapabilities(rawCapabilities, {
    hasLocalHelperSecret: Boolean(serverEnv.LOCAL_HELPER_SECRET),
  })
}

export const getRunModeCapabilities = createServerFn({ method: "GET" }).handler(
  async () => await loadRunModeCapabilities(),
)

