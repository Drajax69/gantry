/** Every space gets a colour and an emoji, so they're easy to tell apart (and a bit silly). */
export const SPACE_COLORS = ["pink", "orange", "lime", "sky", "violet", "amber", "teal", "rose"] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];

export const SPACE_EMOJI = ["🦊", "🐙", "🌮", "🚀", "🍕", "🦄", "🐸", "🌈", "🧃", "🪐", "🎈", "🐝", "🍩", "🦖", "🌵", "🐳"];

/** Tailwind classes per colour, spelled out so the build keeps them. */
export const COLOR_CLASSES: Record<SpaceColor, { dot: string; tint: string; border: string; text: string; chip: string }> = {
  pink: { dot: "bg-pink-500", tint: "bg-pink-500/10 dark:bg-pink-500/15", border: "border-pink-400/60", text: "text-pink-700 dark:text-pink-300", chip: "bg-pink-500/15 text-pink-800 dark:text-pink-200" },
  orange: { dot: "bg-orange-500", tint: "bg-orange-500/10 dark:bg-orange-500/15", border: "border-orange-400/60", text: "text-orange-700 dark:text-orange-300", chip: "bg-orange-500/15 text-orange-800 dark:text-orange-200" },
  lime: { dot: "bg-lime-500", tint: "bg-lime-500/10 dark:bg-lime-500/15", border: "border-lime-500/60", text: "text-lime-700 dark:text-lime-300", chip: "bg-lime-500/20 text-lime-800 dark:text-lime-200" },
  sky: { dot: "bg-sky-500", tint: "bg-sky-500/10 dark:bg-sky-500/15", border: "border-sky-400/60", text: "text-sky-700 dark:text-sky-300", chip: "bg-sky-500/15 text-sky-800 dark:text-sky-200" },
  violet: { dot: "bg-violet-500", tint: "bg-violet-500/10 dark:bg-violet-500/15", border: "border-violet-400/60", text: "text-violet-700 dark:text-violet-300", chip: "bg-violet-500/15 text-violet-800 dark:text-violet-200" },
  amber: { dot: "bg-amber-500", tint: "bg-amber-500/10 dark:bg-amber-500/15", border: "border-amber-400/60", text: "text-amber-700 dark:text-amber-300", chip: "bg-amber-500/20 text-amber-800 dark:text-amber-200" },
  teal: { dot: "bg-teal-500", tint: "bg-teal-500/10 dark:bg-teal-500/15", border: "border-teal-400/60", text: "text-teal-700 dark:text-teal-300", chip: "bg-teal-500/15 text-teal-800 dark:text-teal-200" },
  rose: { dot: "bg-rose-500", tint: "bg-rose-500/10 dark:bg-rose-500/15", border: "border-rose-400/60", text: "text-rose-700 dark:text-rose-300", chip: "bg-rose-500/15 text-rose-800 dark:text-rose-200" },
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A space's look: what it picked, or a stable default from its id. */
export function spaceStyle(s: { id: string; color?: string; emoji?: string }) {
  const color = (SPACE_COLORS as readonly string[]).includes(s.color ?? "") ? (s.color as SpaceColor) : SPACE_COLORS[hash(s.id) % SPACE_COLORS.length];
  const emoji = s.emoji || SPACE_EMOJI[hash(s.id + "e") % SPACE_EMOJI.length];
  return { color, emoji, cls: COLOR_CLASSES[color] };
}
