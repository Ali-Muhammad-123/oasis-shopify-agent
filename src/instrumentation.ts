/** Runs once per server start: launches the in-process scheduler for daily briefs and weekly reports. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.OASIS_SCHEDULER === 'off') return;
  const { startScheduler } = await import('./lib/scheduler');
  startScheduler();
}
