import "server-only";
import type { PrListItem } from "@/lib/types";
import { gh } from "./exec";
import { hasChat } from "./chats";

interface SearchRow {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  state: string;
  repository: { nameWithOwner: string };
}

async function search(filter: string): Promise<SearchRow[]> {
  const out = await gh("search", "prs", filter, "--state=open", "--limit=30",
    "--json", "number,title,url,updatedAt,isDraft,state,repository");
  return JSON.parse(out) as SearchRow[];
}

/** Open PRs waiting on your review, and your own open PRs. */
export async function listPrs(): Promise<{ review: PrListItem[]; mine: PrListItem[] }> {
  const toItem = (r: SearchRow): PrListItem => {
    const id = `${r.repository.nameWithOwner}/pull/${r.number}`;
    return {
      id, number: r.number, title: r.title, nameWithOwner: r.repository.nameWithOwner,
      url: r.url, updatedAt: r.updatedAt, isDraft: r.isDraft, state: r.state, hasChat: hasChat(id),
    };
  };
  const [review, mine] = await Promise.all([search("--review-requested=@me"), search("--author=@me")]);
  const byDate = (a: PrListItem, b: PrListItem) => b.updatedAt.localeCompare(a.updatedAt);
  return { review: review.map(toItem).sort(byDate), mine: mine.map(toItem).sort(byDate) };
}
