import type { LoginTask, LoginTaskState } from "./loginProtocol";

const ACTIVE_STATES: LoginTaskState[] = [
  "opening_tab",
  "waiting_page",
  "detecting",
  "filling",
  "submitting",
  "waiting_result",
  "manual_required",
];

export function isActiveLoginTaskState(state: LoginTaskState) {
  return ACTIVE_STATES.includes(state);
}

export function canReuseTaskForEntry(task: LoginTask | null | undefined) {
  return Boolean(task?.tabId && task && isActiveLoginTaskState(task.state));
}

export function shouldAllowPageAction(task: LoginTask, pageKey: string) {
  return !task.actionPageKeys.includes(pageKey);
}

export function appendActionPageKey(task: LoginTask, pageKey: string): LoginTask {
  if (!shouldAllowPageAction(task, pageKey)) return task;
  return {
    ...task,
    actionPageKeys: [...task.actionPageKeys, pageKey],
    updatedAt: task.updatedAt,
  };
}
