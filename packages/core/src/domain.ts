import type { VaultEntry } from "./types";

function normalizeHostCandidate(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

export function extractHost(value: string) {
  return normalizeHostCandidate(value);
}

function hostParts(host: string) {
  return host.split(".").filter(Boolean);
}

export function entryMatchesHost(entry: VaultEntry, activeHost: string) {
  const host = normalizeHostCandidate(activeHost);
  if (!host) return true;
  const candidates = [entry.url, entry.title, ...entry.tags].map(normalizeHostCandidate).filter(Boolean);
  if (candidates.includes(host)) return true;
  return candidates.some((candidate) => {
    if (candidate === host) return true;
    return host.endsWith(`.${candidate}`) || candidate.endsWith(`.${host}`);
  });
}

export function scoreEntryForHost(entry: VaultEntry, activeHost: string) {
  const host = normalizeHostCandidate(activeHost);
  if (!host) return 1;
  const fields = [entry.url, entry.title, ...entry.tags].map(normalizeHostCandidate);
  if (fields.includes(host)) return 100;
  if (fields.some((field) => field.endsWith(`.${host}`))) return 80;
  if (fields.some((field) => host.endsWith(`.${field}`))) return 60;
  return entryMatchesHost(entry, activeHost) ? 20 : 0;
}

export function sortEntriesForHost(entries: VaultEntry[], activeHost: string) {
  return [...entries].sort((left, right) => {
    const rightScore = scoreEntryForHost(right, activeHost);
    const leftScore = scoreEntryForHost(left, activeHost);
    return rightScore - leftScore || right.title.localeCompare(left.title);
  });
}
