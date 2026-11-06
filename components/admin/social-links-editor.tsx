"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { SocialGlyph } from "@/components/layout/social-glyph";
import { updateSocialLinks, type ContentState } from "@/lib/actions/content";
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  socialLinkError,
  type SocialLink,
  type SocialPlatform,
  type SocialSettings,
} from "@/lib/content/social";
import { cn } from "@/lib/utils";

type Row = SocialLink & { key: number };

export function SocialLinksEditor({ initial }: { initial: SocialSettings }) {
  const [rows, setRows] = useState<Row[]>(() => initial.links.map((l, i) => ({ ...l, key: i })));
  const [nextKey, setNextKey] = useState(initial.links.length);
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [state, formAction, pending] = useActionState<ContentState, FormData>(updateSocialLinks, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.error);
  }, [state]);

  const errors = new Map(rows.map((r) => [r.key, socialLinkError(r.platform, r.url)]));
  const errorCount = [...errors.values()].filter(Boolean).length;
  const full = rows.length >= MAX_SOCIAL_LINKS;

  function update(key: number, patch: Partial<SocialLink>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function move(i: number, by: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  }

  const payload = JSON.stringify({
    links: rows.map((r) => ({ platform: r.platform, url: r.url.trim(), enabled: r.enabled })),
  });

  return (
    <form
      action={formAction}
      onSubmit={() => setTouched(new Set(rows.map((r) => r.key)))}
    >
      <input type="hidden" name="social" value={payload} />
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Social links ({rows.length}/{MAX_SOCIAL_LINKS})
            </h2>
            <p className="text-sm text-muted">
              Shown in a menu next to the light/dark switch, in this order. Hidden entirely when no link is on.
            </p>
          </div>
          <button
            type="button"
            disabled={full}
            onClick={() => {
              setRows((rs) => [...rs, { platform: "instagram", url: "", enabled: true, key: nextKey }]);
              setNextKey((k) => k + 1);
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-40 sm:min-h-9"
          >
            <Plus className="size-4" aria-hidden /> Add link
          </button>
        </div>
        {full && <p className="text-xs text-muted">Five links is the maximum. Remove one to add another.</p>}
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
            No social links yet — the social menu is hidden.
          </p>
        )}

        <ol className="space-y-3">
          {rows.map((r, i) => {
            const err = touched.has(r.key) ? errors.get(r.key) : null;
            const label = SOCIAL_LABELS[r.platform];
            return (
              <li
                key={r.key}
                className={cn("rounded-xl border p-3", err ? "border-alert/50" : "border-border", !r.enabled && "opacity-75")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand/12 text-brand">
                      <SocialGlyph p={r.platform} />
                    </span>
                    {i + 1}. {label}
                    <label className="ml-2 inline-flex min-h-11 items-center gap-2 text-sm font-normal sm:min-h-0">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => update(r.key, { enabled: e.target.checked })}
                        className="size-4 accent-[var(--brand)]"
                      />
                      Show
                    </label>
                  </div>
                  <div className="flex items-center">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move ${label} up`}
                      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground disabled:opacity-30 sm:size-9"
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move ${label} down`}
                      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground disabled:opacity-30 sm:size-9"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label={`Remove ${label}`}
                      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-alert sm:size-9"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-[12rem_1fr]">
                  <div>
                    <Label htmlFor={`social-platform-${r.key}`}>Platform</Label>
                    <Select
                      id={`social-platform-${r.key}`}
                      value={r.platform}
                      onChange={(e) => update(r.key, { platform: e.target.value as SocialPlatform })}
                    >
                      {SOCIAL_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {SOCIAL_LABELS[p]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`social-url-${r.key}`}>Link</Label>
                    <Input
                      id={`social-url-${r.key}`}
                      value={r.url}
                      onChange={(e) => update(r.key, { url: e.target.value })}
                      onBlur={() => setTouched((t) => new Set(t).add(r.key))}
                      inputMode="url"
                      spellCheck={false}
                      placeholder="https://"
                      maxLength={300}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `social-url-${r.key}-err` : undefined}
                      className={cn("font-mono text-sm", err && "border-alert")}
                    />
                    {err && (
                      <p id={`social-url-${r.key}-err`} className="mt-1 text-xs text-alert">
                        {err}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {errorCount > 0 && touched.size > 0 && (
          <p role="alert" className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
            Fix {errorCount} link{errorCount === 1 ? "" : "s"} before saving.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={pending} disabled={errorCount > 0}>
            Save social links
          </Button>
        </div>
      </Card>
    </form>
  );
}
