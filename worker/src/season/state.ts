import { DAY_SEC } from './time';

export interface Season { id: string; title: string; starts_at: number; ends_at: number }
export type SeasonState = 'before' | 'active' | 'ended';

export interface SeasonView {
  id: string;
  title: string;
  state: SeasonState;
  startsAt: number;
  endsAt: number;
  day: number;
  days: number;
}

const lengthDays = (s: Season): number => Math.round((s.ends_at - s.starts_at) / DAY_SEC);

/** Сезон идёт, пока `starts_at <= now < ends_at`: последний день включается, следующий уже нет. */
export const activeSeason = (now: number, seasons: Season[]): Season | null =>
  seasons.find((s) => s.starts_at <= now && now < s.ends_at) ?? null;

export function yearBounds(seasons: Season[]): { startsAt: number; endsAt: number } | null {
  if (seasons.length === 0) return null;
  return {
    startsAt: Math.min(...seasons.map((s) => s.starts_at)),
    endsAt: Math.max(...seasons.map((s) => s.ends_at)),
  };
}

const view = (s: Season, state: SeasonState, day: number): SeasonView => ({
  id: s.id, title: s.title, state, startsAt: s.starts_at, endsAt: s.ends_at, day, days: lengthDays(s),
});

/** Идёт сезон — он; иначе ближайший будущий; иначе последний закончившийся. */
export function seasonView(now: number, seasons: Season[]): SeasonView | null {
  if (seasons.length === 0) return null;
  const sorted = [...seasons].sort((a, b) => a.starts_at - b.starts_at);

  const current = activeSeason(now, sorted);
  if (current) return view(current, 'active', Math.floor((now - current.starts_at) / DAY_SEC) + 1);

  const next = sorted.find((s) => s.starts_at > now);
  if (next) return view(next, 'before', 0);

  const last = sorted[sorted.length - 1];
  return view(last, 'ended', lengthDays(last));
}
