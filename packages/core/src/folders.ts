import type { PlainVault, VaultEntry } from "./types";

export const ROOT_FOLDER = "";

export function normalizeFolderPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function folderAncestors(value: string) {
  const normalized = normalizeFolderPath(value);
  if (!normalized) return [] as string[];
  const parts = normalized.split("/");
  const folders: string[] = [];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    folders.push(current);
  }
  return folders;
}

export function mergeVaultFolders(vault: PlainVault, folders: string[]) {
  const next = new Set((vault.folders ?? []).map(normalizeFolderPath).filter(Boolean));
  for (const folder of folders) {
    for (const ancestor of folderAncestors(folder)) {
      next.add(ancestor);
    }
  }
  return [...next].sort((left, right) => left.localeCompare(right));
}

export function entryFolder(entry: VaultEntry) {
  return normalizeFolderPath(entry.folder || "");
}

export function entryMatchesFolder(entry: VaultEntry, folder: string) {
  return entryFolder(entry) === normalizeFolderPath(folder);
}

export function entryMatchesFolderTree(entry: VaultEntry, folder: string) {
  const normalizedFolder = normalizeFolderPath(folder);
  if (!normalizedFolder) return !entryFolder(entry);
  const entryPath = entryFolder(entry);
  return entryPath === normalizedFolder || entryPath.startsWith(`${normalizedFolder}/`);
}

export function sortFolders(folders: string[]) {
  return [...folders].sort((left, right) => left.localeCompare(right));
}
