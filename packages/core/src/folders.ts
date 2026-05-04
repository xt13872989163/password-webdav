import type { PlainVault, VaultEntry } from "./types";
import { nowIso } from "./crypto";

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

function replaceFolderPrefix(value: string, source: string, target: string) {
  if (value === source) return target;
  if (value.startsWith(`${source}/`)) {
    return `${target}${value.slice(source.length)}`;
  }
  return value;
}

function mergeNormalizedFolders(vault: PlainVault, folders: string[]) {
  return mergeVaultFolders(vault, folders.map(normalizeFolderPath).filter(Boolean));
}

export function moveEntryToFolder(vault: PlainVault, entryId: string, folder: string) {
  const nextFolder = normalizeFolderPath(folder);
  const updatedAt = nowIso();
  const nextEntries = vault.entries.map((entry) =>
    entry.id === entryId
      ? {
          ...entry,
          folder: nextFolder,
          updatedAt,
        }
      : entry,
  );

  return {
    ...vault,
    updatedAt,
    folders: mergeNormalizedFolders(vault, [...(vault.folders ?? []), nextFolder, ...nextEntries.map(entryFolder)]),
    entries: nextEntries,
  };
}

export function repathVaultFolder(vault: PlainVault, source: string, target: string) {
  const normalizedSource = normalizeFolderPath(source);
  const normalizedTarget = normalizeFolderPath(target);
  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
    return vault;
  }
  if (normalizedTarget.startsWith(`${normalizedSource}/`)) {
    throw new Error("Cannot move a folder into itself.");
  }

  const updatedAt = nowIso();
  const nextEntries = vault.entries.map((entry) => {
    const currentFolder = entryFolder(entry);
    if (!currentFolder || !entryMatchesFolderTree(entry, normalizedSource)) {
      return entry;
    }
    return {
      ...entry,
      folder: replaceFolderPrefix(currentFolder, normalizedSource, normalizedTarget),
      updatedAt,
    };
  });

  const remappedFolders = (vault.folders ?? [])
    .map(normalizeFolderPath)
    .filter(Boolean)
    .map((folder) => replaceFolderPrefix(folder, normalizedSource, normalizedTarget));

  return {
    ...vault,
    updatedAt,
    folders: mergeNormalizedFolders(
      { ...vault, entries: nextEntries, folders: remappedFolders, updatedAt },
      [...remappedFolders, ...nextEntries.map(entryFolder)],
    ),
    entries: nextEntries,
  };
}

export function moveVaultFolder(vault: PlainVault, source: string, targetParent: string) {
  const normalizedSource = normalizeFolderPath(source);
  if (!normalizedSource) return vault;

  const normalizedTargetParent = normalizeFolderPath(targetParent);
  if (normalizedTargetParent === normalizedSource) {
    return vault;
  }

  const leafName = normalizedSource.split("/").pop() || normalizedSource;
  const target = normalizeFolderPath(
    normalizedTargetParent ? `${normalizedTargetParent}/${leafName}` : leafName,
  );
  return repathVaultFolder(vault, normalizedSource, target);
}

export function renameVaultFolder(vault: PlainVault, source: string, nextName: string) {
  const normalizedSource = normalizeFolderPath(source);
  const normalizedName = normalizeFolderPath(nextName);
  if (!normalizedSource || !normalizedName) {
    return vault;
  }

  const parent = folderAncestors(normalizedSource).slice(0, -1).pop() || "";
  const target = normalizeFolderPath(parent ? `${parent}/${normalizedName}` : normalizedName);
  return repathVaultFolder(vault, normalizedSource, target);
}

export function removeVaultFolder(vault: PlainVault, folder: string) {
  const target = normalizeFolderPath(folder);
  if (!target) return vault;

  const nextFolders = (vault.folders ?? [])
    .map(normalizeFolderPath)
    .filter(Boolean)
    .filter((item) => item !== target && !item.startsWith(`${target}/`));

  const nextEntries = vault.entries.map((entry) => {
    const entryPath = entryFolder(entry);
    if (entryPath === target || entryPath.startsWith(`${target}/`)) {
      return { ...entry, folder: "" };
    }
    return entry;
  });

  return {
    ...vault,
    updatedAt: nowIso(),
    folders: nextFolders,
    entries: nextEntries,
  };
}
