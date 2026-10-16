"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AgentsResponse } from "@/lib/types";
import { api } from "./api";

/** One shared copy of the agent list, so every tab's picker agrees on the current agent. */
let state: AgentsResponse | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

function set(next: AgentsResponse) {
  state = next;
  for (const fn of subs) fn();
}

export function refreshAgents(): Promise<void> {
  loading ??= api.agents().then(set).finally(() => (loading = null));
  return loading;
}

export const agentsStore = { set };

export function useAgents(): AgentsResponse | null {
  const value = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state,
    () => null,
  );
  useEffect(() => {
    if (!state) refreshAgents().catch(() => {});
  }, []);
  return value;
}

export async function chooseAgent(id: string) {
  set(await api.updateAgent(id, { current: true }));
}
