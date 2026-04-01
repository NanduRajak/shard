import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const serverEnv = createEnv({
  server: {
    APP_BASE_URL: z.url().optional(),
    CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
    FIRECRAWL_API_KEY: z.string().min(1).optional(),
    FIRECRAWL_API_URL: z.url().optional(),
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_SLUG: z.string().min(1).optional(),
    GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_TOKEN: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
    INNGEST_BASE_URL: z.url().optional(),
    INNGEST_DEV: z.union([z.literal("0"), z.literal("1")]).default("0"),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SERVE_ORIGIN: z.url().optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    LOCAL_HELPER_SECRET: z.string().min(16).optional(),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().min(1).optional(),
    REVIEW_BOT_SECRET: z.string().min(16).optional(),
    QA_DIRECT_RUN_FALLBACK: z.union([z.literal("0"), z.literal("1")]).default("0"),
    STEEL_API_KEY: z.string().min(1),
    VITE_CONVEX_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
