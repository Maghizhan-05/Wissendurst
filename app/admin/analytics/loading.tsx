/** Skeleton while the server reads aggregates from PostHog (D-026). */
export default function AnalyticsLoading() {
  const block = "animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none";
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-40 rounded bg-surface-2" />
          <div className="h-8 w-48 rounded bg-surface-2" />
        </div>
        <div className="h-11 w-48 rounded-full bg-surface-2" />
      </div>
      <div className={`${block} h-32`} />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className={`${block} h-96 lg:col-span-8`} />
        <div className={`${block} h-96 lg:col-span-4`} />
        <div className={`${block} h-80 lg:col-span-7`} />
        <div className={`${block} h-80 lg:col-span-5`} />
      </div>
    </div>
  );
}
