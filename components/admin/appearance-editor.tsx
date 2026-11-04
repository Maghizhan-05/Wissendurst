"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { updateAppearance, type ContentState } from "@/lib/actions/content";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABELS,
  CONTRAST_PAIRS,
  DEFAULT_COLORS,
  contrastRatio,
  type Appearance,
  type ColorToken,
  type ThemeMode,
} from "@/lib/content/appearance";

const HEX = /^#[0-9a-fA-F]{6}$/;
type Drafts = Record<ThemeMode, Partial<Record<ColorToken, string>>>;

function TokenRow({
  mode,
  token,
  value,
  onChange,
  onReset,
}: {
  mode: ThemeMode;
  token: ColorToken;
  value: string | undefined;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const id = useId();
  const def = DEFAULT_COLORS[mode][token];
  const shown = value ?? def;
  const valid = HEX.test(shown);
  const meta = COLOR_TOKEN_LABELS[token];
  return (
    <div className="grid grid-cols-[2.75rem_1fr_7.5rem_2.25rem] items-center gap-3 py-2">
      <input
        type="color"
        aria-label={`${meta.label} (${mode}) colour picker`}
        value={valid ? shown.toLowerCase() : def}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-11 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {meta.label}
          {value === undefined && <span className="ml-2 text-xs font-normal text-muted">default</span>}
        </label>
        <p className="truncate text-xs text-muted">{meta.hint}</p>
      </div>
      <Input
        id={id}
        value={shown}
        maxLength={7}
        spellCheck={false}
        aria-invalid={!valid || undefined}
        aria-describedby={valid ? undefined : `${id}-err`}
        onChange={(e) => onChange(e.target.value.trim())}
        className="font-mono"
      />
      <button
        type="button"
        onClick={onReset}
        disabled={value === undefined}
        aria-label={`Reset ${meta.label} (${mode}) to default`}
        title="Reset to default"
        className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
      >
        <RotateCcw className="size-4" aria-hidden />
      </button>
      {!valid && (
        <p id={`${id}-err`} role="alert" className="col-span-4 -mt-1 text-xs text-alert">
          Use a six-digit hex colour like #087f78.
        </p>
      )}
    </div>
  );
}

function Preview({ colors }: { colors: Record<ColorToken, string> }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: colors.background, borderColor: colors.border }}
      aria-hidden
    >
      <div className="rounded-lg border p-4" style={{ background: colors.surface, borderColor: colors.border }}>
        <p className="font-display text-lg font-semibold" style={{ color: colors.foreground }}>
          Preview heading
        </p>
        <p className="mt-1 text-sm" style={{ color: colors.muted }}>
          Muted supporting text on a surface.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full px-3 py-1.5" style={{ background: colors.brand, color: colors["brand-contrast"] }}>
            Primary button
          </span>
          <span className="rounded-full px-3 py-1.5" style={{ background: colors["surface-2"], color: colors.foreground }}>
            Secondary
          </span>
          <span className="rounded-full px-3 py-1.5" style={{ color: colors.success, outline: `1px solid ${colors.success}` }}>
            Verified
          </span>
          <span className="rounded-full px-3 py-1.5" style={{ color: colors.warning, outline: `1px solid ${colors.warning}` }}>
            Pending
          </span>
          <span className="rounded-full px-3 py-1.5" style={{ color: colors.alert, outline: `1px solid ${colors.alert}` }}>
            Error
          </span>
          <span className="rounded-full px-3 py-1.5" style={{ color: colors["brand-2"], outline: `2px solid ${colors.ring}` }}>
            Focused
          </span>
        </div>
      </div>
    </div>
  );
}

export function AppearanceEditor({ initial }: { initial: Appearance }) {
  const [drafts, setDrafts] = useState<Drafts>({ light: { ...initial.light }, dark: { ...initial.dark } });
  const [state, action, pending] = useActionState<ContentState, FormData>(updateAppearance, null);
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const setToken = (mode: ThemeMode, token: ColorToken, v: string | undefined) =>
    setDrafts((d) => {
      const next = { ...d[mode] };
      if (v === undefined || v.toLowerCase() === DEFAULT_COLORS[mode][token]) delete next[token];
      else next[token] = v;
      return { ...d, [mode]: next };
    });

  const allValid = (["light", "dark"] as const).every((m) =>
    Object.values(drafts[m]).every((v) => v !== undefined && HEX.test(v)),
  );
  const payload: Appearance = {
    light: Object.fromEntries(Object.entries(drafts.light).map(([k, v]) => [k, v!.toLowerCase()])),
    dark: Object.fromEntries(Object.entries(drafts.dark).map(([k, v]) => [k, v!.toLowerCase()])),
  };

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="appearance" value={JSON.stringify(payload)} />
      <p className="text-sm text-muted">
        Colours apply to the public site, participant dashboard and admin. Only
        changed colours are saved; everything else keeps the original design.
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        {(["light", "dark"] as const).map((mode) => {
          const effective = { ...DEFAULT_COLORS[mode], ...Object.fromEntries(
            Object.entries(drafts[mode]).filter(([, v]) => v && HEX.test(v)),
          ) } as Record<ColorToken, string>;
          const lowContrast = CONTRAST_PAIRS.map((p) => ({
            ...p,
            ratio: contrastRatio(effective[p.fg], effective[p.bg]),
          })).filter((p) => p.ratio < 4.5);
          return (
            <Card key={mode} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  {mode === "light" ? "Light theme" : "Dark theme"}
                </h2>
                <button
                  type="button"
                  onClick={() => setDrafts((d) => ({ ...d, [mode]: {} }))}
                  disabled={Object.keys(drafts[mode]).length === 0}
                  className="text-xs font-medium text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Reset all to default
                </button>
              </div>
              <Preview colors={effective} />
              {lowContrast.length > 0 && (
                <ul role="status" className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
                  {lowContrast.map((p) => (
                    <li key={p.label}>
                      Low contrast: {p.label} is {p.ratio.toFixed(2)}:1 (aim for at least 4.5:1).
                    </li>
                  ))}
                </ul>
              )}
              <div className="divide-y divide-border">
                {COLOR_TOKENS.map((token) => (
                  <TokenRow
                    key={token}
                    mode={mode}
                    token={token}
                    value={drafts[mode][token]}
                    onChange={(v) => setToken(mode, token, v)}
                    onReset={() => setToken(mode, token, undefined)}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" loading={pending} disabled={!allValid} className="shadow-lg">
          Save appearance
        </Button>
      </div>
    </form>
  );
}
