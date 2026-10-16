"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, Loader2Icon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackToTickets } from "@/components/gantry/link";
import { SettingsLink } from "@/components/settings-link";
import { OpenInSpace } from "@/components/space/open-in-space";
import { PrStateIcon } from "@/components/pr-state";
import { prStateOf } from "@/lib/pr-state";
import { SpaceStyler } from "@/components/space/space-styler";
import { api, shortLabel, spaceHref, timeAgo, type HomeData } from "@/lib/client/api";
import { spaceStyle } from "@/lib/space-style";
import type { PrListItem, Space, SpacesResponse } from "@/lib/types";

const TAGLINES = [
  "What are we squinting at today?",
  "Pull up a diff, grab a snack.",
  "Let's go poke some code.",
  "Bugs fear this one simple page.",
  "Another day, another diff.",
  "Reviews, but make it fun.",
  "Point at a line. Ask anything.",
];

const noop = () => () => {};

export function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<SpacesResponse | null>(null);

  useEffect(() => {
    api.home().then(setData, (e: Error) => setLoadError(e.message));
    api.spaces().then(setSpaces, (e: Error) => setLoadError(e.message));
  }, []);

  const current = spaces?.spaces.find((s) => s.id === spaces.current);
  // A different line each day; picked in the browser so the prerendered page stays static.
  const tagline = useSyncExternalStore(
    noop,
    () => TAGLINES[new Date().getDate() % TAGLINES.length],
    () => TAGLINES[0],
  );

  /** Open a link or target as a tab in a space: the current one, a given one, or (null) a new one. */
  async function openInSpace(target: string, spaceId?: string | null) {
    const into = spaceId === null ? (await api.createSpace()).id : spaceId;
    const { space } = await api.addToSpace(target, into);
    router.push(spaceHref(space.id));
  }

  const openRow = (target: string, spaceId?: string | null) => openInSpace(target, spaceId).catch((e: Error) => toast.error(e.message));
  // The spaces each target is already open in, for the "in Shopify" chips.
  const inSpaces = (target: string) => spaces?.spaces.filter((s) => s.targets.includes(target)) ?? [];
  const opener = (target: string) =>
    spaces ? <OpenInSpace target={target} spaces={spaces.spaces} current={spaces.current} onOpen={(sp) => openRow(target, sp)} /> : null;

  async function newSpace() {
    try {
      const s = await api.createSpace();
      router.push(spaceHref(s.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function restyle(id: string, patch: { color?: string; emoji?: string }) {
    try {
      const updated = await api.updateSpace(id, patch);
      setSpaces((s) => s && { ...s, spaces: s.spaces.map((x) => (x.id === id ? updated : x)) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function open(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await openInSpace(url);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden">
      {/* Soft colour blobs behind everything. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 size-[28rem] rounded-full bg-pink-400/25 blur-3xl dark:bg-pink-500/15" />
        <div className="absolute -top-24 right-[-8rem] size-[26rem] rounded-full bg-sky-400/25 blur-3xl dark:bg-sky-500/15" />
        <div className="absolute top-[28rem] left-1/3 size-[24rem] rounded-full bg-amber-300/25 blur-3xl dark:bg-violet-500/15" />
      </div>
      {/* No bar on home: just the two buttons, level with the window controls. */}
      <header className="app-bar flex h-12 items-center gap-1 px-4">
        <BackToTickets /><span className="flex-1" /><SettingsLink />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12">
        <section className="flex flex-col gap-3">
          <h1
            className="bg-gradient-to-r from-pink-500 via-violet-500 to-sky-500 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent"
          >
            {tagline}
          </h1>
          <p className="text-sm text-muted-foreground">
            Paste a pull request, commit, compare or branch link. Point at lines in the diff and ask about them right there.
          </p>
          <form onSubmit={open} className="flex gap-2">
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              className="h-11 rounded-xl border-2 bg-background/80 font-mono shadow-sm focus-visible:border-violet-400 focus-visible:ring-violet-400/30"
            />
            <Button
              type="submit"
              size="lg"
              disabled={busy || !url.trim()}
              className="h-11 rounded-xl bg-gradient-to-r from-pink-500 to-violet-500 px-5 text-white shadow-md transition-transform hover:scale-[1.03] hover:from-pink-500 hover:to-violet-600 active:scale-95"
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
              Open
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">😬 {error}</p>}
          {current && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Opens as a tab in <SpaceChip space={current} />
            </p>
          )}
        </section>

        {spaces && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <SectionTitle emoji="🪐">Spaces</SectionTitle>
              <Button variant="ghost" size="sm" onClick={newSpace} className="rounded-full">
                <PlusIcon /> New space
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {spaces.spaces.map((s) => {
                const { cls } = spaceStyle(s);
                const isCurrent = s.id === spaces.current;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group relative flex gap-3 rounded-2xl border-2 p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg has-[[aria-expanded=true]]:z-30",
                      cls.tint,
                      isCurrent ? cls.border : "border-transparent",
                    )}
                  >
                    <SpaceStyler space={s} onChange={(p) => restyle(s.id, p)} />
                    <button
                      onClick={() => router.push(spaceHref(s.id))}
                      className="flex min-w-0 flex-1 flex-col gap-2 text-left after:absolute after:inset-0 after:content-['']"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{s.name}</span>
                        {isCurrent && <Badge className={cn("border-0", cls.chip)}>current</Badge>}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {s.targets.length} {s.targets.length === 1 ? "PR" : "PRs"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {s.targets.length === 0 && <span className="text-xs text-muted-foreground">Empty and ready for action</span>}
                        {s.targets.slice(0, 6).map((t) => (
                          <span key={t} className={cn("rounded-md px-1.5 py-0.5 font-mono text-[11px]", cls.chip)}>
                            {shortLabel(t)}
                          </span>
                        ))}
                        {s.targets.length > 6 && <span className="text-xs text-muted-foreground">+{s.targets.length - 6}</span>}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {loadError && <p className="text-sm text-destructive">😬 {loadError}</p>}
        {!data && !loadError && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        )}
        {data && (
          <>
            {data.recent.length > 0 && (
              <List title="Recent" emoji="🕘">
                {data.recent.map((r) => (
                  <Row key={r.id} onClick={() => openRow(r.id)} title={r.title} meta={`${r.id} · ${timeAgo(r.updatedAt)}`} spaces={inSpaces(r.id)} action={opener(r.id)} lead={r.prState ? <PrStateIcon state={r.prState} /> : undefined}>
                    <Badge variant="secondary"><MessageSquareIcon />{r.questions}</Badge>
                  </Row>
                ))}
              </List>
            )}
            {data.prError ? (
              <p className="text-sm text-muted-foreground">Couldn&apos;t list your pull requests: {data.prError}</p>
            ) : (
              <>
                <PrList title="Waiting on your review" emoji="👀" items={data.review} empty="Nothing waiting on you. Go touch grass 🌱" onOpen={openRow} spacesOf={inSpaces} opener={opener} />
                <PrList title="Your open pull requests" emoji="🛠️" items={data.mine} empty="No open PRs. Suspiciously quiet… 🦗" onOpen={openRow} spacesOf={inSpaces} opener={opener} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SectionTitle({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden className="text-base">{emoji}</span>
      {children}
    </h2>
  );
}

function SpaceChip({ space }: { space: Space }) {
  const { emoji, cls } = spaceStyle(space);
  return (
    <span data-space-chip className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium", cls.chip)}>
      <span aria-hidden>{emoji}</span>
      {space.name}
    </span>
  );
}

function List({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle emoji={emoji}>{title}</SectionTitle>
      <div className="relative flex flex-col divide-y rounded-2xl border bg-background/70 shadow-sm backdrop-blur has-[[aria-expanded=true]]:z-30">{children}</div>
    </section>
  );
}

interface RowProps {
  onClick: () => void;
  title: string;
  meta: string;
  /** The spaces this is already open in. */
  spaces: Space[];
  action: React.ReactNode;
  /** Shown before the title, like the state icon in GitHub's lists. */
  lead?: React.ReactNode;
  children?: React.ReactNode;
}

function Row({ onClick, title, meta, spaces, action, lead, children }: RowProps) {
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-violet-500/5">
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {lead}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{meta}</span>
            {spaces.map((s) => (
              <span key={s.id} className="shrink-0">
                <span className="sr-only">in </span>
                <SpaceChip space={s} />
              </span>
            ))}
          </div>
        </div>
        {children}
      </button>
      {action}
    </div>
  );
}

function PrList({ title, emoji, items, empty, onOpen, spacesOf, opener }: {
  title: string;
  emoji: string;
  items: PrListItem[];
  empty: string;
  onOpen: (id: string) => void;
  spacesOf: (id: string) => Space[];
  opener: (id: string) => React.ReactNode;
}) {
  return (
    <List title={title} emoji={emoji}>
      {items.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">{empty}</div>}
      {items.map((pr) => (
        <Row
          key={pr.id}
          onClick={() => onOpen(pr.id)}
          title={pr.title}
          meta={`${pr.nameWithOwner}#${pr.number} · ${timeAgo(pr.updatedAt)}`}
          spaces={spacesOf(pr.id)}
          action={opener(pr.id)}
          lead={<PrStateIcon state={prStateOf(pr.state, pr.isDraft)} />}
        >
          {pr.hasChat && <MessageSquareIcon className="size-4 text-muted-foreground" />}
        </Row>
      ))}
    </List>
  );
}
