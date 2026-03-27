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
        isDefault: credential.isDefault ?? false,
        namespace: credential.namespace,
        origin: credential.origin,
        profileLabel: credential.profileLabel ?? credential.username,
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
    const credentials = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .collect()

    const defaultCredential =
      credentials.find((credential) => credential.isDefault) ??
      (credentials.length === 1 ? credentials[0] : null)

    return defaultCredential ?? null
  },
})

export const getCredentialProfileForRuntime = query({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.credentialId)
  },
})

export const createCredential = mutation({
  args: {
    namespace: v.string(),
    website: v.string(),
    origin: v.string(),
    profileLabel: v.string(),
    isDefault: v.boolean(),
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingProfiles = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin_profile", (q) =>
        q.eq("namespace", args.namespace)
          .eq("origin", args.origin)
          .eq("profileLabel", args.profileLabel),
      )
      .collect()

    if (existingProfiles.length > 0) {
      throw new Error("A credential profile with this name already exists for the website.")
    }

    const now = Date.now()
    const existingCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .collect()

    const shouldBeDefault = args.isDefault || existingCredentials.length === 0

    if (shouldBeDefault) {
      await Promise.all(
        existingCredentials.map((credential) =>
          ctx.db.patch(credential._id, {
            isDefault: false,
            updatedAt: now,
          }),
        ),
      )
    }

    return await ctx.db.insert("credentials", {
      createdAt: now,
      isDefault: shouldBeDefault,
      namespace: args.namespace,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      profileLabel: args.profileLabel,
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
    profileLabel: v.string(),
    isDefault: v.boolean(),
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingCredential = await ctx.db.get(args.credentialId)

    if (!existingCredential) {
      throw new Error("Credential not found.")
    }

    const duplicateProfiles = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin_profile", (q) =>
        q.eq("namespace", args.namespace)
          .eq("origin", args.origin)
          .eq("profileLabel", args.profileLabel),
      )
      .collect()

    if (duplicateProfiles.some((credential) => credential._id !== args.credentialId)) {
      throw new Error("A credential profile with this name already exists for the website.")
    }

    const existingCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", args.namespace).eq("origin", args.origin),
      )
      .collect()
    const previousGroupCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", existingCredential.namespace).eq("origin", existingCredential.origin),
      )
      .collect()
    const now = Date.now()
    const shouldBeDefault =
      args.isDefault ||
      existingCredentials.every(
        (credential) => credential._id === args.credentialId,
      )

    if (shouldBeDefault) {
      await Promise.all(
        existingCredentials
          .filter((credential) => credential._id !== args.credentialId)
          .map((credential) =>
            ctx.db.patch(credential._id, {
              isDefault: false,
              updatedAt: now,
            }),
          ),
      )
    }

    await ctx.db.patch(args.credentialId, {
      isDefault: shouldBeDefault,
      namespace: args.namespace,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      profileLabel: args.profileLabel,
      totpSecretEncrypted: args.totpSecretEncrypted,
      updatedAt: now,
      username: args.username,
      website: args.website,
    })

    const movedGroups =
      existingCredential.namespace !== args.namespace ||
      existingCredential.origin !== args.origin

    const previousGroupRemainingCredentials = previousGroupCredentials.filter(
      (credential) => credential._id !== args.credentialId,
    )
    const previousGroupNeedsDefault =
      movedGroups &&
      previousGroupRemainingCredentials.length > 0 &&
      !previousGroupRemainingCredentials.some((credential) => credential.isDefault)

    if (previousGroupNeedsDefault) {
      const replacement = previousGroupRemainingCredentials[0]

      if (replacement) {
        await ctx.db.patch(replacement._id, {
          isDefault: true,
          updatedAt: now,
        })
      }
    }

    const currentGroupHasOtherDefault = existingCredentials.some(
      (credential) =>
        credential._id !== args.credentialId &&
        credential.isDefault,
    )

    if (!shouldBeDefault && !currentGroupHasOtherDefault) {
      const replacement = existingCredentials.find(
        (credential) => credential._id !== args.credentialId,
      )

      if (replacement) {
        await ctx.db.patch(replacement._id, {
          isDefault: true,
          updatedAt: now,
        })
      } else {
        await ctx.db.patch(args.credentialId, {
          isDefault: true,
          updatedAt: now,
        })
      }
    }
  },
})

export const deleteCredential = mutation({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db.get(args.credentialId)

    if (!credential) {
      return
    }

    await ctx.db.delete(args.credentialId)

    if (!credential.isDefault) {
      return
    }

    const replacement = await ctx.db
      .query("credentials")
      .withIndex("by_namespace_origin", (q) =>
        q.eq("namespace", credential.namespace).eq("origin", credential.origin),
      )
      .first()

    if (!replacement) {
      return
    }

    await ctx.db.patch(replacement._id, {
      isDefault: true,
      updatedAt: Date.now(),
    })
  },
})
