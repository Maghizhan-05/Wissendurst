/**
 * Deterministic ordering of events within one schedule day: start time
 * (events without one first, as before), then title, then id. Never relies on
 * database row order. Plain module so it runs under `node --test`.
 */
export interface ScheduleSortable {
  id: string;
  title: string;
  start_time: string | null;
}

export function compareScheduleEvents(a: ScheduleSortable, b: ScheduleSortable): number {
  return (
    (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
    a.title.localeCompare(b.title, "en") ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
