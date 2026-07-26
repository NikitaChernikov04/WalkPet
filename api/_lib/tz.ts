/** Everything day-shaped in this app (the step ring, step_logs rows, milestone resets, streaks)
 *  runs on the *player's* calendar day, not UTC. The client sends its current UTC offset on
 *  every request as `x-tz-offset` (minutes east of UTC, e.g. Moscow = 180); it recomputes that
 *  browser-side each time, so DST shifts and travel are picked up for free. The last seen value
 *  is also persisted on the users row so server-side paths without a header still use the right
 *  day boundary. */

const MAX_OFFSET_MINUTES = 14 * 60;

export function parseTzOffset(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || Math.abs(minutes) > MAX_OFFSET_MINUTES) return null;
  return Math.round(minutes);
}

/** The player's local calendar date ("YYYY-MM-DD") at a given instant. */
export function localDate(offsetMinutes: number, at: number = Date.now()): string {
  return new Date(at + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Calendar arithmetic on a "YYYY-MM-DD" string (offset-independent — the date is already local). */
export function shiftDate(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00.000Z`);
  const to = Date.parse(`${toISO}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

/** UTC epoch millis of the moment local midnight starts `dateISO` — i.e. the exact instant the
 *  player's new day begins. Used to window Google Fit queries on the local day. */
export function localDayStartMs(dateISO: string, offsetMinutes: number): number {
  return Date.parse(`${dateISO}T00:00:00.000Z`) - offsetMinutes * 60_000;
}
