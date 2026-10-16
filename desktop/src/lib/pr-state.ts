import type { PrState } from "@/lib/types";

/** GitHub's state and draft flag, as one state the way GitHub shows it. */
export function prStateOf(state: string, isDraft: boolean): PrState {
  const s = state.toLowerCase();
  if (s === "merged" || s === "closed") return s;
  return isDraft ? "draft" : "open";
}
