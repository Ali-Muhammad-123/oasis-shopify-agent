import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {}, schema: {} }));
vi.mock('./insights', () => ({ generateBrief: vi.fn() }));
vi.mock('./reports', () => ({ generateWeeklyReport: vi.fn() }));
const { localParts } = await import('./scheduler');

describe('localParts', () => {
  it('converts to the store timezone with ISO weekday and week', () => {
    // 2026-10-30 03:30 UTC is Thursday 23:30 in New York and Friday 08:30 in Karachi.
    const now = new Date('2026-10-30T03:30:00Z');
    expect(localParts(now, 'America/New_York')).toEqual({ date: '2026-10-29', hour: 23, weekday: 4, isoWeek: '2026-W44' });
    expect(localParts(now, 'Asia/Karachi')).toEqual({ date: '2026-10-30', hour: 8, weekday: 5, isoWeek: '2026-W44' });
  });
  it('handles ISO week-year boundaries', () => {
    expect(localParts(new Date('2027-01-01T12:00:00Z'), 'UTC').isoWeek).toBe('2026-W53');
    expect(localParts(new Date('2026-01-01T12:00:00Z'), 'UTC').isoWeek).toBe('2026-W01');
  });
});
