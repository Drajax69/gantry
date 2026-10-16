export type TargetKind = "pull" | "commit" | "compare" | "tree";

export type FileStatus = "A" | "M" | "D" | "R";

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** A pull request's state, as GitHub shows it. */
export type PrState = "open" | "draft" | "merged" | "closed";

export interface TargetInfo {
  id: string; // e.g. "acme/api/pull/42", mirrors the github.com path
  kind: TargetKind;
  owner: string;
  repo: string;
  title: string;
  subtitle: string;
  /** Pull requests only. */
  prState?: PrState;
  url: string; // github.com link
  headBranch?: string;
  headSha: string;
  baseSha: string | null; // null for plain tree browsing (no diff)
}

export interface Anchor {
  file: string;
  start: number;
  end: number;
  side: "new" | "old";
  snippet: string;
}

export interface ToolUse {
  name: string;
  detail: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  anchor: Anchor | null;
  text: string;
  ts: number;
  replyTo?: string;
  tools?: ToolUse[];
  error?: string;
  costUsd?: number;
  /** Which agent wrote this answer (its name at the time). */
  agent?: string;
  /** The id of the question that started this thread; a thread's root has its own id. */
  thread?: string;
  /** GitHub comments this question is about. */
  quote?: Quote[];
}

export interface TargetResponse {
  target: TargetInfo;
  files: ChangedFile[];
  messages: ChatMessage[];
  pending: ChatMessage | null;
  /** Questions waiting for the current answer to finish, oldest first. */
  queued: string[];
}

/** One highlighted token: [text, lightColor, darkColor] */
export type Tok = [string, string?, string?];

export type DiffRow =
  | { k: "hunk"; text: string; oldStart: number; newStart: number }
  | { k: "ctx" | "add" | "del"; o?: number; n?: number; toks: Tok[]; text: string };

export interface FileResponse {
  path: string;
  file: ChangedFile | null;
  /** Diff rows (when the file changed and mode=diff) */
  rows: DiffRow[] | null;
  /** Full head file, highlighted, one entry per line (mode=full, or unchanged files) */
  lines: Tok[][] | null;
  /** New-side line numbers added by this change, for highlighting in full mode */
  added: number[];
  tooLarge?: boolean;
}

export type ChatEvent =
  | { type: "user"; msg: ChatMessage }
  | { type: "start"; msg: ChatMessage }
  | { type: "delta"; id: string; text: string }
  | { type: "tool"; id: string; tool: ToolUse }
  | { type: "done"; msg: ChatMessage }
  | { type: "deleted"; id: string };

export interface PrListItem {
  id: string;
  number: number;
  title: string;
  nameWithOwner: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  state: string;
  hasChat: boolean;
}

export interface RecentItem {
  id: string;
  title: string;
  updatedAt: number;
  questions: number;
  prState?: PrState;
}

/** A named group of review targets, shown as tabs. */
export interface Space {
  gantry?: { projectId: string; workspace: string; ticketId: string; completed?: boolean };
  id: string;
  name: string;
  /** Target ids, in tab order. */
  targets: string[];
  /** The open tab. */
  active: string | null;
  /** Last open file per target, so tabs come back where you left them. */
  files: Record<string, string>;
  /** One of SPACE_COLORS and an emoji; spaces made before these existed get stable defaults. */
  color?: string;
  emoji?: string;
  updatedAt: number;
}

export interface SpacesResponse {
  spaces: Space[];
  current: string;
}

/** A chat event tagged with the target it belongs to (one stream carries every target). */
export type TargetChatEvent = ChatEvent & { target: string };

/** How an agent is reached: a local CLI (Claude Code, Codex) or an OpenAI-compatible API. */
export type AgentKind = "claude" | "codex" | "openai";

/** An agent as the client sees it. The API key never leaves the server. */
export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  /** Model override; empty means the CLI's or provider's default. */
  model: string;
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1 (openai kind only). */
  baseUrl?: string;
  hasKey?: boolean;
}

export interface AgentStatus {
  ok: boolean;
  detail: string;
}

export interface AgentsResponse {
  agents: (Agent & { status: AgentStatus })[];
  current: string;
}

export interface AgentInput {
  kind: AgentKind;
  name?: string;
  model?: string;
  baseUrl?: string;
  /** Set to replace the stored key; omit to keep it. */
  apiKey?: string;
}

/** A comment someone left on the pull request on GitHub. */
export interface ReviewComment {
  id: number;
  author: string;
  avatar?: string;
  body: string;
  createdAt: string;
  url: string;
}

/** A GitHub review thread on some lines of a file. */
export interface ReviewThread {
  id: string;
  file: string;
  side: "new" | "old";
  start: number;
  end: number;
  /** The lines changed after the comment was left; positions are where they were then. */
  outdated: boolean;
  comments: ReviewComment[];
}

export interface CommentsResponse {
  threads: ReviewThread[];
  /** Comments on the PR as a whole, and review summaries. */
  general: ReviewComment[];
  error?: string;
}

/** A reviewer's comment quoted into a question, so the agent knows what's being asked about. */
export interface Quote {
  author: string;
  body: string;
  url?: string;
}

export interface LocalChanges { revision: string; tree: string; head: string; commits: number; files: ChangedFile[]; branch: string | null; }
