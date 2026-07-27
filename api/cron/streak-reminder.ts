import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runStreakReminders } from "../_lib/notifications.js";

/** Evening streak nudges, driven by an hourly scheduler.
 *
 *  It has to run hourly because the window is 19:00–21:00 in each player's *own* timezone, and
 *  Vercel's built-in cron is capped at one run per day on the Hobby plan — so the trigger lives
 *  in a GitHub Actions schedule (see .github/workflows/streak-reminder.yml) that calls this. The
 *  Bearer-token shape matches what Vercel's own cron sends, so moving the trigger back in-house
 *  after a plan upgrade is a vercel.json entry and nothing else.
 *
 *  Safe to call more often than needed: each player can be claimed at most once per local day. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });

  const result = await runStreakReminders();
  console.log("streak reminders", result);
  res.status(200).json(result);
}
