import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const serverEnv = createEnv({
  server: {
    CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().min(1).optional(),
    INNGEST_BASE_URL: z.url().optional(),
    INNGEST_DEV: z.union([z.literal("0"), z.literal("1")]).default("0"),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SERVE_ORIGIN: z.url().optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    QA_DIRECT_RUN_FALLBACK: z.union([z.literal("0"), z.literal("1")]).default("0"),
    STEEL_API_KEY: z.string().min(1),
    VITE_CONVEX_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
