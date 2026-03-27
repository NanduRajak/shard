import type { BrowserProvider } from "./run-mode-capabilities"

const HOME_RUN_DRAFT_STORAGE_PREFIX = "home-run-draft"

type StorageLike = Pick<Storage, "getItem" | "setItem">

export function getHomeRunDraftStorageKey(provider: BrowserProvider) {
  return `${HOME_RUN_DRAFT_STORAGE_PREFIX}:${provider}`
}

export function readStoredHomeRunDraft(
  provider: BrowserProvider,
  storage: StorageLike,
) {
  return storage.getItem(getHomeRunDraftStorageKey(provider)) ?? ""
}

export function writeStoredHomeRunDraft(
  provider: BrowserProvider,
  prompt: string,
  storage: StorageLike,
) {
  storage.setItem(getHomeRunDraftStorageKey(provider), prompt)
}
