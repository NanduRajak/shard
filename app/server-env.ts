import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const serverEnv = createEnv({
  server: {
    INNGEST_BASE_URL: z.url().optional(),
    INNGEST_DEV: z.union([z.literal("0"), z.literal("1")]).default("0"),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().min(1).optional(),
    STEEL_API_KEY: z.string().min(1),
    VITE_CONVEX_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
