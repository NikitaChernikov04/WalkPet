/** The device's local calendar date as "YYYY-MM-DD".
 *  `toISOString()` would give the UTC date instead, which is what previously made the day
 *  roll over at the wrong moment for anyone not sitting on UTC. */
export function localDateString(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Milliseconds until the next local 00:00, plus a small cushion so the timer never fires a
 *  hair early and reads the old date. Lets the app schedule one exact wake-up at midnight
 *  instead of polling the clock. */
export function msUntilLocalMidnight(at: Date = new Date()): number {
  const next = new Date(at);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - at.getTime() + 1000;
}
