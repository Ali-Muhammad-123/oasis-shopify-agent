import { safeEqual } from '@/lib/crypto';
import { runDueJobs } from '@/lib/scheduler';

export const maxDuration = 300;

/** For deployed setups (e.g. Vercel Cron): runs any due briefs/reports. Requires CRON_SECRET as a Bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ ran: await runDueJobs() });
}
