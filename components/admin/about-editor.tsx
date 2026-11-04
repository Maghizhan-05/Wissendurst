"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import {
  AddButton,
  EditorSection,
  ItemControls,
  LinkField,
  TextField,
  moveItem,
} from "@/components/admin/content-fields";
import { updateAboutContent, type ContentState } from "@/lib/actions/content";
import {
  MAX_ABOUT_FACTS,
  MAX_ABOUT_SECTIONS,
  newAboutFact,
  newAboutSection,
  type AboutContent,
} from "@/lib/content/about";

export function AboutEditor({ initial }: { initial: AboutContent }) {
  const [c, setC] = useState<AboutContent>(initial);
  const [state, action, pending] = useActionState<ContentState, FormData>(
    updateAboutContent,
    null,
  );
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const set = (patch: Partial<AboutContent>) => setC((p) => ({ ...p, ...patch }));
  const facts = c.facts.items;
  const sections = c.sections;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="about" value={JSON.stringify(c)} />

      <EditorSection title="Page header">
        <TextField
          label="Search-engine description"
          hint="Shown in search results and link previews."
          textarea
          rows={2}
          maxLength={300}
          value={c.metaDescription}
          onChange={(v) => set({ metaDescription: v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Eyebrow" maxLength={60} value={c.eyebrow} onChange={(v) => set({ eyebrow: v })} />
          <TextField label="Heading" maxLength={200} value={c.title} onChange={(v) => set({ title: v })} />
        </div>
        <TextField label="Introduction" textarea maxLength={1000} value={c.intro} onChange={(v) => set({ intro: v })} />
      </EditorSection>

      <EditorSection
        title="Facts"
        hint={`Up to ${MAX_ABOUT_FACTS} short figures, e.g. “3 — days of programme”.`}
        visible={c.facts.visible}
        onVisibleChange={(v) => set({ facts: { ...c.facts, visible: v } })}
      >
        <div className="flex justify-end">
          <AddButton
            label="Add fact"
            disabled={facts.length >= MAX_ABOUT_FACTS}
            onClick={() => set({ facts: { ...c.facts, items: [...facts, newAboutFact()] } })}
          />
        </div>
        <ol className="space-y-2">
          {facts.map((f, i) => (
            <li key={f.id} className="flex items-end gap-2">
              <div className="w-28">
                <Label htmlFor={`${f.id}-v`}>Figure</Label>
                <Input
                  id={`${f.id}-v`}
                  maxLength={12}
                  value={f.value}
                  onChange={(e) => {
                    const items = [...facts];
                    items[i] = { ...f, value: e.target.value };
                    set({ facts: { ...c.facts, items } });
                  }}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`${f.id}-l`}>Label</Label>
                <Input
                  id={`${f.id}-l`}
                  maxLength={80}
                  value={f.label}
                  onChange={(e) => {
                    const items = [...facts];
                    items[i] = { ...f, label: e.target.value };
                    set({ facts: { ...c.facts, items } });
                  }}
                />
              </div>
              <ItemControls
                index={i}
                count={facts.length}
                itemLabel={`fact ${i + 1}`}
                onMove={(a, b) => set({ facts: { ...c.facts, items: moveItem(facts, a, b) } })}
                onRemove={() =>
                  set({ facts: { ...c.facts, items: facts.filter((_, j) => j !== i) } })
                }
              />
            </li>
          ))}
        </ol>
      </EditorSection>

      <EditorSection
        title="Sections"
        hint={`Up to ${MAX_ABOUT_SECTIONS} sections, shown in this order. Separate paragraphs with a blank line.`}
      >
        <div className="flex justify-end">
          <AddButton
            label="Add section"
            disabled={sections.length >= MAX_ABOUT_SECTIONS}
            onClick={() => set({ sections: [...sections, newAboutSection()] })}
          />
        </div>
        <ol className="space-y-3">
          {sections.map((s, i) => (
            <li
              key={s.id}
              className={`space-y-3 rounded-xl border border-border p-3 ${s.visible ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">Section {i + 1}</span>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={s.visible}
                      onChange={(e) => {
                        const next = [...sections];
                        next[i] = { ...s, visible: e.target.checked };
                        set({ sections: next });
                      }}
                      className="size-4 accent-[var(--brand)]"
                    />
                    Show on page
                  </label>
                </div>
                <ItemControls
                  index={i}
                  count={sections.length}
                  itemLabel={`section ${i + 1}`}
                  onMove={(a, b) => set({ sections: moveItem(sections, a, b) })}
                  onRemove={() => set({ sections: sections.filter((_, j) => j !== i) })}
                />
              </div>
              <TextField
                label="Heading"
                maxLength={120}
                value={s.heading}
                onChange={(v) => {
                  const next = [...sections];
                  next[i] = { ...s, heading: v };
                  set({ sections: next });
                }}
              />
              <TextField
                label="Text"
                textarea
                rows={5}
                maxLength={3000}
                value={s.body}
                onChange={(v) => {
                  const next = [...sections];
                  next[i] = { ...s, body: v };
                  set({ sections: next });
                }}
              />
            </li>
          ))}
        </ol>
      </EditorSection>

      <EditorSection
        title="Buttons"
        visible={c.cta.visible}
        onVisibleChange={(v) => set({ cta: { ...c.cta, visible: v } })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Primary button" hint="Leave empty to hide." maxLength={40} value={c.cta.primaryLabel} onChange={(v) => set({ cta: { ...c.cta, primaryLabel: v } })} />
          <LinkField label="Primary button link" value={c.cta.primaryHref} onChange={(v) => set({ cta: { ...c.cta, primaryHref: v } })} />
          <TextField label="Secondary button" hint="Leave empty to hide." maxLength={40} value={c.cta.secondaryLabel} onChange={(v) => set({ cta: { ...c.cta, secondaryLabel: v } })} />
          <LinkField label="Secondary button link" value={c.cta.secondaryHref} onChange={(v) => set({ cta: { ...c.cta, secondaryHref: v } })} />
        </div>
      </EditorSection>

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" loading={pending} className="shadow-lg">
          Save About page
        </Button>
      </div>
    </form>
  );
}
