import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

type CredentialRecord = {
  _creationTime: number
  _id: string
  createdAt: number
  isDefault?: boolean
  login: string
  origin: string
  passwordEncrypted: string
  updatedAt: number
  website: string
}

function isSimplifiedCredentialRecord(value: any): value is CredentialRecord {
  return (
    Boolean(value) &&
    typeof value.origin === "string" &&
    typeof value.website === "string" &&
    typeof value.login === "string" &&
    typeof value.passwordEncrypted === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  )
}

export const listCredentials = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    return credentials
      .filter(isSimplifiedCredentialRecord)
      .slice()
      .sort((left, right) => {
        const websiteComparison = left.website.localeCompare(right.website)

        if (websiteComparison !== 0) {
          return websiteComparison
        }

        return left.login.localeCompare(right.login)
      })
      .map((credential) => ({
        _creationTime: credential._creationTime,
        _id: credential._id,
        createdAt: credential.createdAt,
        isDefault: credential.isDefault ?? false,
        login: credential.login,
        origin: credential.origin,
        updatedAt: credential.updatedAt,
        website: credential.website,
      }))
  },
})

export const getCredentialsRolloutStatus = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    return {
      hasLegacyCredentials: credentials.some(
        (credential) => !isSimplifiedCredentialRecord(credential),
      ),
    }
  },
})

export const getCredentialForServer = query({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db.get(args.credentialId)

    return isSimplifiedCredentialRecord(credential) ? credential : null
  },
})

export const getCredentialForRuntime = query({
  args: {
    credentialId: v.id("credentials"),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db.get(args.credentialId)

    return isSimplifiedCredentialRecord(credential) ? credential : null
  },
})

export const createCredential = mutation({
  args: {
    website: v.string(),
    origin: v.string(),
    isDefault: v.boolean(),
    login: v.string(),
    passwordEncrypted: v.string(),
  },
  handler: async (ctx, args) => {
    const existingCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_origin", (q) => q.eq("origin", args.origin))
      .collect()
    const validCredentials = existingCredentials.filter(isSimplifiedCredentialRecord)

    if (validCredentials.some((credential) => credential.login === args.login)) {
      throw new Error("A credential with this login already exists for the website.")
    }

    const now = Date.now()
    const shouldBeDefault = args.isDefault || validCredentials.length === 0

    if (shouldBeDefault) {
      await Promise.all(
        validCredentials.map((credential) =>
          ctx.db.patch(credential._id as any, {
            isDefault: false,
            updatedAt: now,
          }),
        ),
      )
    }

    return await ctx.db.insert("credentials", {
      createdAt: now,
      isDefault: shouldBeDefault,
      login: args.login,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      updatedAt: now,
      website: args.website,
    })
  },
})

export const updateCredential = mutation({
  args: {
    credentialId: v.id("credentials"),
    website: v.string(),
    origin: v.string(),
    isDefault: v.boolean(),
    login: v.string(),
    passwordEncrypted: v.string(),
  },
  handler: async (ctx, args) => {
    const existingCredential = await ctx.db.get(args.credentialId)

    if (!isSimplifiedCredentialRecord(existingCredential)) {
      throw new Error("Credential not found.")
    }

    const currentOriginCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_origin", (q) => q.eq("origin", args.origin))
      .collect()
    const validCurrentOriginCredentials = currentOriginCredentials.filter(
      isSimplifiedCredentialRecord,
    )

    if (
      validCurrentOriginCredentials.some(
        (credential) =>
          credential._id !== args.credentialId && credential.login === args.login,
      )
    ) {
      throw new Error("A credential with this login already exists for the website.")
    }

    const previousOriginCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_origin", (q) => q.eq("origin", existingCredential.origin))
      .collect()
    const validPreviousOriginCredentials = previousOriginCredentials.filter(
      isSimplifiedCredentialRecord,
    )

    const now = Date.now()
    const shouldBeDefault =
      args.isDefault ||
      validCurrentOriginCredentials.every(
        (credential) => credential._id === args.credentialId,
      )

    if (shouldBeDefault) {
      await Promise.all(
        validCurrentOriginCredentials
          .filter((credential) => credential._id !== args.credentialId)
          .map((credential) =>
            ctx.db.patch(credential._id as any, {
              isDefault: false,
              updatedAt: now,
            }),
          ),
      )
    }

    await ctx.db.patch(args.credentialId, {
      isDefault: shouldBeDefault,
      login: args.login,
      origin: args.origin,
      passwordEncrypted: args.passwordEncrypted,
      updatedAt: now,
      website: args.website,
    })

    const movedOrigins = existingCredential.origin !== args.origin
    const remainingPreviousOriginCredentials = validPreviousOriginCredentials.filter(
      (credential) => credential._id !== args.credentialId,
    )

    if (
      movedOrigins &&
      remainingPreviousOriginCredentials.length > 0 &&
      !remainingPreviousOriginCredentials.some((credential) => credential.isDefault)
    ) {
      await ctx.db.patch(remainingPreviousOriginCredentials[0]!._id as any, {
        isDefault: true,
        updatedAt: now,
      })
    }

    const currentOriginOtherDefaults = validCurrentOriginCredentials.some(
      (credential) =>
        credential._id !== args.credentialId && credential.isDefault,
    )

    if (!shouldBeDefault && !currentOriginOtherDefaults) {
      const replacement = validCurrentOriginCredentials.find(
        (credential) => credential._id !== args.credentialId,
      )

      if (replacement) {
        await ctx.db.patch(replacement._id as any, {
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

    if (!isSimplifiedCredentialRecord(credential)) {
      return
    }

    await ctx.db.delete(args.credentialId)

    if (!credential.isDefault) {
      return
    }

    const replacement = await ctx.db
      .query("credentials")
      .withIndex("by_origin", (q) => q.eq("origin", credential.origin))
      .first()

    if (!isSimplifiedCredentialRecord(replacement)) {
      return
    }

    await ctx.db.patch(replacement._id as any, {
      isDefault: true,
      updatedAt: Date.now(),
    })
  },
})

export const resetCredentials = mutation({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    await Promise.all(credentials.map((credential) => ctx.db.delete(credential._id)))

    return { deletedCount: credentials.length }
  },
})
