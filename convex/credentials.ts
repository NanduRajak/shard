import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const listCredentials = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    return credentials
      .slice()
      .sort((left, right) => {
        const namespaceComparison = left.namespace.localeCompare(right.namespace)

        if (namespaceComparison !== 0) {
          return namespaceComparison
        }

        return left.website.localeCompare(right.website)
      })
      .map((credential) => ({
        _creationTime: credential._creationTime,
        _id: credential._id,
        createdAt: credential.createdAt,
        namespace: credential.namespace,
        origin: credential.origin,
        updatedAt: credential.updatedAt,
        username: credential.username,
        website: credential.website,
        hasTotpSecret: Boolean(credential.totpSecretEncrypted),
      }))
  },
})

export const listNamespaces = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db
      .query("credentials")
      .withIndex("by_namespace")
      .collect()

    return [...new Set(credentials.map((credential) => credential.namespace))]
  },
})

export const getCredentialForServer = query({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.credentialId)
  },
})

export const getCredentialForRuntime = query({
  args: {
    namespace: v.string(),
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .unique()
  },
})

export const createCredential = mutation({
  args: {
    namespace: v.string(),
    website: v.string(),
    origin: v.string(),
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .unique()

    if (existing) {
      throw new Error("A credential for this namespace and website already exists.")
    }

    const now = Date.now()

    return await ctx.db.insert("credentials", {
      createdAt: now,
      namespace: args.namespace,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      totpSecretEncrypted: args.totpSecretEncrypted,
      updatedAt: now,
      username: args.username,
      website: args.website,
    })
  },
})

export const updateCredential = mutation({
  args: {
    credentialId: v.id("credentials"),
    namespace: v.string(),
    website: v.string(),
    origin: v.string(),
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .unique()

    if (existing && existing._id !== args.credentialId) {
      throw new Error("A credential for this namespace and website already exists.")
    }

    await ctx.db.patch(args.credentialId, {
      namespace: args.namespace,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      totpSecretEncrypted: args.totpSecretEncrypted,
      updatedAt: Date.now(),
      username: args.username,
      website: args.website,
    })
  },
})

export const deleteCredential = mutation({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.credentialId)
  },
})
