"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import {
  updateBackgrounds,
  uploadBackgroundImage,
  type ContentState,
} from "@/lib/actions/content";
import {
  BACKGROUND_MAX_BYTES,
  BACKGROUND_POSITIONS,
  BACKGROUND_SIZES,
  BACKGROUND_TYPES,
  backgroundUrl,
  type SiteBackgrounds,
} from "@/lib/content/backgrounds";

const selectClass =
  "h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Light / dark background images (0033). Upload stores the image only; the
 * site changes when "Save background" is pressed.
 */
export function BackgroundsEditor({
  initial,
  supabaseUrl,
}: {
  initial: SiteBackgrounds;
  supabaseUrl: string;
}) {
  const [draft, setDraft] = useState<SiteBackgrounds>(initial);
  const [state, action, pending] = useActionState<ContentState, FormData>(updateBackgrounds, null);
  const [uploading, startUpload] = useTransition();
  const inputs = { light: useRef<HTMLInputElement>(null), dark: useRef<HTMLInputElement>(null) };
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const set = <K extends keyof SiteBackgrounds>(k: K, v: SiteBackgrounds[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const upload = (mode: "light" | "dark", file: File | undefined) => {
    if (!file) return;
    if (!BACKGROUND_TYPES.includes(file.type as never)) return void toast.error("Upload a PNG, JPG or WebP image.");
    if (file.size > BACKGROUND_MAX_BYTES) return void toast.error("Image is too large (max 5 MB).");
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("file", file);
    startUpload(async () => {
      const r = await uploadBackgroundImage(fd);
      if (r.ok) {
        set(mode, r.path);
        toast.success("Image uploaded — save to apply it.");
      } else toast.error(r.error);
      if (inputs[mode].current) inputs[mode].current.value = "";
    });
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="backgrounds" value={JSON.stringify(draft)} />
      <Card className="space-y-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Background images</h2>
          <p className="mt-1 text-sm text-muted">
            One image per theme (PNG, JPG or WebP, max 5 MB), shown behind every page. A theme without an
            image keeps the original background.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["light", "dark"] as const).map((mode) => {
            const img = draft[mode];
            return (
              <div key={mode} className="space-y-2">
                <p className="text-sm font-medium text-foreground">{mode === "light" ? "Light theme" : "Dark theme"}</p>
                <div
                  className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border"
                  style={{ background: mode === "light" ? "#f5fbfa" : "#071a1d" }}
                >
                  {img ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of a storage URL */}
                      <img
                        src={backgroundUrl(supabaseUrl, img)}
                        alt=""
                        className="absolute inset-0 size-full"
                        style={{
                          objectFit: draft.size === "auto" ? "none" : draft.size,
                          objectPosition: draft.position,
                          opacity: draft.opacity / 100,
                        }}
                      />
                      <div
                        className="absolute inset-0"
                        style={{ background: draft.overlay_color, opacity: draft.overlay_strength / 100 }}
                      />
                      <span
                        className="relative rounded-md px-2 py-1 text-xs font-medium"
                        style={{ color: mode === "light" ? "#102a2a" : "#f5fffd" }}
                      >
                        Sample text
                      </span>
                    </>
                  ) : (
                    <span className="text-xs" style={{ color: mode === "light" ? "#627775" : "#8ea9a7" }}>
                      No image — original background
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={inputs[mode]}
                    type="file"
                    accept={BACKGROUND_TYPES.join(",")}
                    className="sr-only"
                    id={`bg-${mode}`}
                    onChange={(e) => upload(mode, e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={uploading}
                    onClick={() => inputs[mode].current?.click()}
                  >
                    <ImageUp className="size-4" aria-hidden /> {img ? "Replace" : "Upload"}
                  </Button>
                  {img && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set(mode, null)}>
                      <Trash2 className="size-4" aria-hidden /> Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="bg-opacity">Image opacity: {draft.opacity}%</Label>
            <input
              id="bg-opacity"
              type="range"
              min={5}
              max={100}
              value={draft.opacity}
              onChange={(e) => set("opacity", Number(e.target.value))}
              className="w-full accent-[var(--brand)]"
            />
          </div>
          <div>
            <Label htmlFor="bg-overlay">Overlay strength: {draft.overlay_strength}%</Label>
            <input
              id="bg-overlay"
              type="range"
              min={0}
              max={90}
              value={draft.overlay_strength}
              onChange={(e) => set("overlay_strength", Number(e.target.value))}
              className="w-full accent-[var(--brand)]"
            />
          </div>
          <div>
            <Label htmlFor="bg-overlay-color">Overlay colour</Label>
            <div className="flex gap-2">
              <input
                type="color"
                aria-label="Overlay colour picker"
                value={draft.overlay_color}
                onChange={(e) => set("overlay_color", e.target.value.toLowerCase())}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2"
              />
              <Input
                id="bg-overlay-color"
                value={draft.overlay_color}
                onChange={(e) => set("overlay_color", e.target.value.trim().toLowerCase())}
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="bg-position">Position</Label>
            <select
              id="bg-position"
              value={draft.position}
              onChange={(e) => set("position", e.target.value as SiteBackgrounds["position"])}
              className={selectClass}
            >
              {BACKGROUND_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="bg-size">Size</Label>
            <select
              id="bg-size"
              value={draft.size}
              onChange={(e) => set("size", e.target.value as SiteBackgrounds["size"])}
              className={selectClass}
            >
              {BACKGROUND_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s === "cover" ? "Fill the screen" : s === "contain" ? "Fit whole image" : "Original size"}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.repeat}
              onChange={(e) => set("repeat", e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            Repeat (tile) the image
          </label>
        </div>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={uploading || !/^#[0-9a-f]{6}$/.test(draft.overlay_color)}>
          Save background
        </Button>
      </div>
    </form>
  );
}
