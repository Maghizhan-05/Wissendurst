"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { ContentIcon } from "@/components/content/content-icon";
import {
  AddButton,
  EditorSection,
  ItemControls,
  LinkField,
  TextField,
  moveItem,
} from "@/components/admin/content-fields";
import { updateLandingContent, type ContentState } from "@/lib/actions/content";
import {
  MAX_HOME_BOXES,
  newHomeBox,
  type HomeBox,
  type LabelValue,
  type LandingContent,
  type TitledBody,
} from "@/lib/content/landing";
import { ICON_KEYS, ICON_LABELS, type IconKey } from "@/lib/content/validation";

/* ── list editors ──────────────────────────────────────────── */

function ParagraphList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="mb-0">Paragraphs</Label>
        <AddButton label="Add" onClick={() => onChange([...items, ""])} disabled={items.length >= 6} />
      </div>
      {items.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            aria-label={`Paragraph ${i + 1}`}
            value={p}
            rows={2}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <ItemControls
            index={i}
            count={items.length}
            itemLabel={`paragraph ${i + 1}`}
            onMove={(a, b) => onChange(moveItem(items, a, b))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

function TitledBodyList({
  label,
  items,
  max,
  onChange,
}: {
  label: string;
  items: TitledBody[];
  max: number;
  onChange: (v: TitledBody[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="mb-0">{label}</Label>
        <AddButton
          label="Add"
          onClick={() => onChange([...items, { title: "", body: "" }])}
          disabled={items.length >= max}
        />
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 rounded-xl border border-border p-3">
          <div className="flex-1 space-y-2">
            <Input
              aria-label={`${label} ${i + 1} title`}
              placeholder="Title"
              value={it.title}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, title: e.target.value };
                onChange(next);
              }}
            />
            <Textarea
              aria-label={`${label} ${i + 1} text`}
              placeholder="Text"
              rows={2}
              value={it.body}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...it, body: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <ItemControls
            index={i}
            count={items.length}
            itemLabel={`${label.toLowerCase()} ${i + 1}`}
            onMove={(a, b) => onChange(moveItem(items, a, b))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

function LabelValueList({
  items,
  onChange,
}: {
  items: LabelValue[];
  onChange: (v: LabelValue[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="mb-0">Items</Label>
        <AddButton
          label="Add"
          onClick={() => onChange([...items, { label: "", value: "" }])}
          disabled={items.length >= 10}
        />
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Item ${i + 1} label`}
            placeholder="Label"
            className="max-w-[40%]"
            value={it.label}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...it, label: e.target.value };
              onChange(next);
            }}
          />
          <Input
            aria-label={`Item ${i + 1} value`}
            placeholder="Value"
            value={it.value}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...it, value: e.target.value };
              onChange(next);
            }}
          />
          <ItemControls
            index={i}
            count={items.length}
            itemLabel={`item ${i + 1}`}
            onMove={(a, b) => onChange(moveItem(items, a, b))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

function HomeBoxesEditor({
  boxes,
  onChange,
}: {
  boxes: HomeBox[];
  onChange: (v: HomeBox[]) => void;
}) {
  const set = (i: number, patch: Partial<HomeBox>) => {
    const next = [...boxes];
    next[i] = { ...boxes[i], ...patch };
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="mb-0">
          Boxes ({boxes.length}/{MAX_HOME_BOXES})
        </Label>
        <AddButton
          label="Add box"
          onClick={() => onChange([...boxes, newHomeBox()])}
          disabled={boxes.length >= MAX_HOME_BOXES}
        />
      </div>
      {boxes.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          No boxes — this section is hidden on the home page.
        </p>
      )}
      <ol className="space-y-3">
        {boxes.map((b, i) => (
          <li key={b.id} className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <ContentIcon name={b.icon} className="size-5" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  Box {i + 1}
                  {b.title ? ` — ${b.title}` : ""}
                </span>
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={b.enabled}
                    onChange={(e) => set(i, { enabled: e.target.checked })}
                    className="size-4 accent-[var(--brand)]"
                  />
                  Enabled
                </label>
              </div>
              <ItemControls
                index={i}
                count={boxes.length}
                itemLabel={`box ${i + 1}`}
                onMove={(a, c) => onChange(moveItem(boxes, a, c))}
                onRemove={() => onChange(boxes.filter((_, j) => j !== i))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Title" value={b.title} maxLength={80} onChange={(v) => set(i, { title: v })} />
              <div>
                <Label htmlFor={`${b.id}-icon`}>Icon</Label>
                <Select
                  id={`${b.id}-icon`}
                  value={b.icon}
                  onChange={(e) => set(i, { icon: e.target.value as IconKey })}
                >
                  {ICON_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {ICON_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <TextField
              label="Description"
              textarea
              rows={2}
              maxLength={240}
              value={b.description}
              onChange={(v) => set(i, { description: v })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Link label" value={b.linkLabel} maxLength={40} onChange={(v) => set(i, { linkLabel: v })} />
              <LinkField label="Link destination" value={b.href} onChange={(v) => set(i, { href: v })} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── main editor ───────────────────────────────────────────── */

export function LandingEditor({ initial }: { initial: LandingContent }) {
  const [c, setC] = useState<LandingContent>(initial);
  const [state, action, pending] = useActionState<ContentState, FormData>(
    updateLandingContent,
    null,
  );

  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  // typed section updaters
  const up = <K extends keyof LandingContent>(
    key: K,
    patch: Partial<LandingContent[K]>,
  ) => setC((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="content" value={JSON.stringify(c)} />

      <EditorSection title="Hero" hint="The first thing visitors see.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Eyebrow" value={c.hero.eyebrow} onChange={(v) => up("hero", { eyebrow: v })} />
          <TextField label="Date" value={c.hero.date} onChange={(v) => up("hero", { date: v })} />
          <TextField label="Title" value={c.hero.titleLine1} onChange={(v) => up("hero", { titleLine1: v })} />
          <TextField label="Title accent (brand colour)" value={c.hero.titleAccent} onChange={(v) => up("hero", { titleAccent: v })} />
          <TextField label="Tagline line 1" value={c.hero.taglineLine1} onChange={(v) => up("hero", { taglineLine1: v })} />
          <TextField label="Tagline line 2" value={c.hero.taglineLine2} onChange={(v) => up("hero", { taglineLine2: v })} />
          <TextField label="Venue" value={c.hero.venue} onChange={(v) => up("hero", { venue: v })} />
        </div>
        <TextField label="Description" textarea value={c.hero.description} onChange={(v) => up("hero", { description: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Primary button" hint="Leave empty to hide." value={c.hero.ctaPrimary} onChange={(v) => up("hero", { ctaPrimary: v })} />
          <LinkField label="Primary button link" value={c.hero.ctaPrimaryHref} onChange={(v) => up("hero", { ctaPrimaryHref: v })} />
          <TextField label="Secondary button" hint="Leave empty to hide." value={c.hero.ctaSecondary} onChange={(v) => up("hero", { ctaSecondary: v })} />
          <LinkField label="Secondary button link" value={c.hero.ctaSecondaryHref} onChange={(v) => up("hero", { ctaSecondaryHref: v })} />
        </div>
      </EditorSection>

      <EditorSection title="Introduction" visible={c.intro.visible} onVisibleChange={(v) => up("intro", { visible: v })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.intro.index} onChange={(v) => up("intro", { index: v })} />
          <TextField label="Eyebrow" value={c.intro.eyebrow} onChange={(v) => up("intro", { eyebrow: v })} />
          <div className="sm:col-span-3">
            <TextField label="Title" value={c.intro.title} onChange={(v) => up("intro", { title: v })} />
          </div>
        </div>
        <ParagraphList items={c.intro.paragraphs} onChange={(v) => up("intro", { paragraphs: v })} />
      </EditorSection>

      <EditorSection
        title="Homepage boxes"
        hint="Up to six boxes. Order, icon, text and link are all yours; disabled boxes stay saved but hidden."
        visible={c.categories.visible}
        onVisibleChange={(v) => up("categories", { visible: v })}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.categories.index} onChange={(v) => up("categories", { index: v })} />
          <TextField label="Eyebrow" value={c.categories.eyebrow} onChange={(v) => up("categories", { eyebrow: v })} />
          <TextField label="Title" value={c.categories.title} onChange={(v) => up("categories", { title: v })} />
        </div>
        <TextField label="Description" textarea value={c.categories.description} onChange={(v) => up("categories", { description: v })} />
        <HomeBoxesEditor boxes={c.categories.boxes} onChange={(v) => up("categories", { boxes: v })} />
      </EditorSection>

      <EditorSection
        title="Featured events"
        hint="Shows events marked “Featured”; hidden automatically when none are."
        visible={c.featured.visible}
        onVisibleChange={(v) => up("featured", { visible: v })}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.featured.index} onChange={(v) => up("featured", { index: v })} />
          <TextField label="Eyebrow" value={c.featured.eyebrow} onChange={(v) => up("featured", { eyebrow: v })} />
          <TextField label="Title" value={c.featured.title} onChange={(v) => up("featured", { title: v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Button label" hint="Leave empty to hide." value={c.featured.ctaLabel} onChange={(v) => up("featured", { ctaLabel: v })} />
          <LinkField label="Button link" value={c.featured.ctaHref} onChange={(v) => up("featured", { ctaHref: v })} />
        </div>
      </EditorSection>

      <EditorSection title="Why participate" visible={c.why.visible} onVisibleChange={(v) => up("why", { visible: v })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.why.index} onChange={(v) => up("why", { index: v })} />
          <TextField label="Eyebrow" value={c.why.eyebrow} onChange={(v) => up("why", { eyebrow: v })} />
          <TextField label="Title" value={c.why.title} onChange={(v) => up("why", { title: v })} />
        </div>
        <TitledBodyList label="Reasons" max={9} items={c.why.points} onChange={(v) => up("why", { points: v })} />
      </EditorSection>

      <EditorSection title="The experience (journey)" visible={c.journey.visible} onVisibleChange={(v) => up("journey", { visible: v })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.journey.index} onChange={(v) => up("journey", { index: v })} />
          <TextField label="Eyebrow" value={c.journey.eyebrow} onChange={(v) => up("journey", { eyebrow: v })} />
          <TextField label="Title" value={c.journey.title} onChange={(v) => up("journey", { title: v })} />
        </div>
        <TitledBodyList label="Steps" max={9} items={c.journey.steps} onChange={(v) => up("journey", { steps: v })} />
      </EditorSection>

      <EditorSection title="Important information" visible={c.info.visible} onVisibleChange={(v) => up("info", { visible: v })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Number" value={c.info.index} onChange={(v) => up("info", { index: v })} />
          <TextField label="Eyebrow" value={c.info.eyebrow} onChange={(v) => up("info", { eyebrow: v })} />
          <TextField label="Title" value={c.info.title} onChange={(v) => up("info", { title: v })} />
        </div>
        <LabelValueList items={c.info.items} onChange={(v) => up("info", { items: v })} />
      </EditorSection>

      <EditorSection title="Final call-to-action" visible={c.finalCta.visible} onVisibleChange={(v) => up("finalCta", { visible: v })}>
        <TextField label="Title" value={c.finalCta.title} onChange={(v) => up("finalCta", { title: v })} />
        <TextField label="Description" textarea value={c.finalCta.description} onChange={(v) => up("finalCta", { description: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Primary button" hint="Leave empty to hide." value={c.finalCta.ctaPrimary} onChange={(v) => up("finalCta", { ctaPrimary: v })} />
          <LinkField label="Primary button link" value={c.finalCta.ctaPrimaryHref} onChange={(v) => up("finalCta", { ctaPrimaryHref: v })} />
          <TextField label="Secondary button" hint="Leave empty to hide." value={c.finalCta.ctaSecondary} onChange={(v) => up("finalCta", { ctaSecondary: v })} />
          <LinkField label="Secondary button link" value={c.finalCta.ctaSecondaryHref} onChange={(v) => up("finalCta", { ctaSecondaryHref: v })} />
        </div>
      </EditorSection>

      <EditorSection title="Footer" hint="Shown on every public page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Tagline" value={c.footer.tagline} onChange={(v) => up("footer", { tagline: v })} />
          <TextField label="Dates" value={c.footer.dates} onChange={(v) => up("footer", { dates: v })} />
        </div>
        <TextField label="Description" textarea rows={2} value={c.footer.description} onChange={(v) => up("footer", { description: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Links heading" value={c.footer.exploreHeading} onChange={(v) => up("footer", { exploreHeading: v })} />
          <TextField label="Contact heading" value={c.footer.contactHeading} onChange={(v) => up("footer", { contactHeading: v })} />
          <TextField label="Contact name" value={c.footer.contactName} onChange={(v) => up("footer", { contactName: v })} />
          <TextField label="Contact email" value={c.footer.contactEmail} onChange={(v) => up("footer", { contactEmail: v })} />
        </div>
        <TextField label="Bottom note" value={c.footer.bottomNote} onChange={(v) => up("footer", { bottomNote: v })} />
      </EditorSection>

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" loading={pending} className="shadow-lg">
          Save home page
        </Button>
      </div>
    </form>
  );
}
