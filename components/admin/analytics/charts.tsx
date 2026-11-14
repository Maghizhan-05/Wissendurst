"use client";

/**
 * Wissendurst analytics charts (D-026). Recharts 3 with fully authored
 * styling: semantic CSS tokens only (no stock palette), hairline grids,
 * mono tick labels, custom tooltips/legends. Data is aggregate-only and
 * arrives serialized from the server page; nothing here fetches or polls.
 */
import { useId, useState, useSyncExternalStore } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { cn } from "@/lib/utils";

type TipProps = TooltipContentProps<TooltipValueType, string | number>;

const nf = new Intl.NumberFormat("en-IN");
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const dayShort = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
export const fmtDay = (d: string) => dayShort.format(asDate(d));

const TICK = { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" } as const;

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** Respect prefers-reduced-motion (animations off on the server render too). */
function useAnimate(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function TipShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-44 rounded-xl border border-border bg-surface-2/95 px-3.5 py-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function TipRow({ swatch, label, value, dashed }: { swatch: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 text-sm">
      <span className="flex items-center gap-2 text-muted">
        <span
          aria-hidden
          className={cn("inline-block h-0.5 w-3.5 rounded-full", dashed && "bg-transparent")}
          style={dashed ? { borderTop: `2px dashed ${swatch}` } : { background: swatch }}
        />
        {label}
      </span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Series toggle chip (keyboard accessible, aria-pressed). */
function LegendToggle({
  on,
  onToggle,
  color,
  label,
  dashed,
}: {
  on: boolean;
  onToggle: () => void;
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-border bg-surface-2 text-foreground" : "border-dashed border-border text-muted line-through",
      )}
    >
      <span
        aria-hidden
        className="inline-block h-0.5 w-4 rounded-full"
        style={dashed ? { borderTop: `2px dashed ${color}` } : { background: color }}
      />
      {label}
    </button>
  );
}

// ── traffic ──────────────────────────────────────────────────────────────────
export type TrafficPoint = { day: string; pageviews: number; sessions: number | null };

export function TrafficChart({ points }: { points: TrafficPoint[] }) {
  const animate = useAnimate();
  const gid = useId().replace(/:/g, "");
  const hasSessions = points.some((p) => p.sessions !== null);
  const [show, setShow] = useState({ pageviews: true, sessions: true });
  const total = points.reduce((a, p) => a + p.pageviews, 0);

  return (
    <figure className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Series">
        <LegendToggle
          on={show.pageviews}
          onToggle={() => setShow((s) => ({ ...s, pageviews: !s.pageviews }))}
          color="var(--brand)"
          label="Page views"
        />
        {hasSessions && (
          <LegendToggle
            on={show.sessions}
            onToggle={() => setShow((s) => ({ ...s, sessions: !s.sessions }))}
            color="var(--warning)"
            label="Sessions"
            dashed
          />
        )}
      </div>
      <div className="mt-4 h-64 sm:h-72" aria-hidden>
        {total === 0 ? (
          <EmptyPlot label="No page views in this range yet" />
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 288 }}>
            <ComposedChart data={points} margin={{ top: 8, right: 20, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id={`pv-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="day"
                tickFormatter={fmtDay}
                tick={TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tickMargin={10}
              />
              <YAxis
                tick={TICK}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={44}
                tickFormatter={(v: number) => compact.format(v)}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
                content={(p: TipProps) =>
                  p.active && p.payload?.length ? (
                    <TipShell title={dayLong.format(asDate(String(p.label)))}>
                      {p.payload.map((e) => (
                        <TipRow
                          key={String(e.dataKey)}
                          swatch={e.dataKey === "sessions" ? "var(--warning)" : "var(--brand)"}
                          dashed={e.dataKey === "sessions"}
                          label={e.dataKey === "sessions" ? "Sessions" : "Page views"}
                          value={nf.format(Number(e.value ?? 0))}
                        />
                      ))}
                    </TipShell>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="pageviews"
                hide={!show.pageviews}
                stroke="var(--brand)"
                strokeWidth={1.75}
                fill={`url(#pv-${gid})`}
                dot={false}
                activeDot={{ r: 4, fill: "var(--brand)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={animate}
                animationDuration={450}
              />
              {hasSessions && (
                <Line
                  type="monotone"
                  dataKey="sessions"
                  hide={!show.sessions}
                  stroke="var(--warning)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 3.5, fill: "var(--warning)", stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={animate}
                  animationDuration={450}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <figcaption className="sr-only">
        Daily page views{hasSessions ? " and sessions" : ""}.
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Page views</th>
              {hasSessions && <th>Sessions</th>}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td>{p.pageviews}</td>
                {hasSessions && <td>{p.sessions ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

// ── funnel ───────────────────────────────────────────────────────────────────
export function FunnelChart({ started, confirmed }: { started: number; confirmed: number }) {
  const animate = useAnimate();
  const pid = useId().replace(/:/g, "");
  const data = [
    { stage: "Started", kept: started, lost: 0 },
    { stage: "Confirmed", kept: confirmed, lost: Math.max(started - confirmed, 0) },
  ];
  if (started === 0) return <EmptyPlot label="No registrations started yet" className="h-44" />;
  return (
    <div className="h-44" aria-hidden>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 176 }}>
        <BarChart data={data} layout="vertical" barCategoryGap={18} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <pattern id={`lost-${pid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface-2)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--alert)" strokeOpacity={0.55} strokeWidth={2} />
            </pattern>
          </defs>
          <XAxis type="number" hide domain={[0, started]} />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ ...TICK, fill: "var(--foreground)" }}
            axisLine={false}
            tickLine={false}
            width={78}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", fillOpacity: 0.6 }}
            content={(p: TipProps) => {
              if (!p.active || !p.payload?.length) return null;
              const row = p.payload[0]?.payload as (typeof data)[number] | undefined;
              if (!row) return null;
              return (
                <TipShell title={row.stage === "Started" ? "registration_started" : "free_registration_confirmed"}>
                  <TipRow swatch="var(--brand)" label="Reached" value={nf.format(row.kept)} />
                  {row.lost > 0 && <TipRow swatch="var(--alert)" label="Dropped" value={nf.format(row.lost)} />}
                  {row.stage === "Confirmed" && (
                    <TipRow swatch="var(--success)" label="Conversion" value={`${((confirmed / started) * 100).toFixed(1)}%`} />
                  )}
                </TipShell>
              );
            }}
          />
          <Bar dataKey="kept" stackId="f" fill="var(--brand)" radius={[6, 0, 0, 6]} isAnimationActive={animate} animationDuration={450} />
          <Bar dataKey="lost" stackId="f" fill={`url(#lost-${pid})`} radius={[0, 6, 6, 0]} isAnimationActive={animate} animationDuration={450} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── exceptions ───────────────────────────────────────────────────────────────
export function ExceptionsChart({ points }: { points: { day: string; count: number }[] }) {
  const animate = useAnimate();
  const total = points.reduce((a, p) => a + p.count, 0);
  return (
    <figure>
      <div className="h-40" aria-hidden>
        {total === 0 ? (
          <EmptyPlot label="No errors reported in this range" tone="success" />
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 160 }}>
            <BarChart data={points} margin={{ top: 6, right: 20, bottom: 0, left: -12 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickFormatter={fmtDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={28} tickMargin={8} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)", fillOpacity: 0.7 }}
                content={(p: TipProps) =>
                  p.active && p.payload?.length ? (
                    <TipShell title={dayLong.format(asDate(String(p.label)))}>
                      <TipRow swatch="var(--alert)" label="Errors" value={nf.format(Number(p.payload[0].value ?? 0))} />
                    </TipShell>
                  ) : null
                }
              />
              <Bar dataKey="count" fill="var(--alert)" fillOpacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={animate} animationDuration={450} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <figcaption className="sr-only">
        Daily errors.
        <table>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

// ── sparkline ────────────────────────────────────────────────────────────────
export function Sparkline({ values, color = "var(--brand)" }: { values: number[]; color?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  return (
    <div className="h-8 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 120, height: 32 }}>
        <LineChart data={values.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyPlot({ label, className, tone }: { label: string; className?: string; tone?: "success" }) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm",
        tone === "success" ? "text-success" : "text-muted",
        className,
      )}
    >
      {label}
    </div>
  );
}
