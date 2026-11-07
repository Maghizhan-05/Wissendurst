"use client";

import { useActionState, useState } from "react";
import { IdCard, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/field";
import { resubmitApplication, type AuthState } from "@/lib/actions/auth";
import { YEARS } from "@/components/auth/signup-form";
import type { ProfileRow } from "@/types/database";

/** Same-account correction of a rejected sign-up (email can't change). */
export function ResubmitApplicationForm({
  profile,
}: {
  profile: Pick<ProfileRow, "full_name" | "email" | "phone" | "college" | "course" | "year">;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(resubmitApplication, null);
  const [idCardName, setIdCardName] = useState<string | null>(null);
  const years = profile.year && !YEARS.includes(profile.year) ? [profile.year, ...YEARS] : YEARS;

  return (
    <form action={action} className="space-y-4">
      <Field label="Email" htmlFor="email" hint="Your sign-in email can't be changed here.">
        <Input id="email" value={profile.email} readOnly disabled />
      </Field>
      <Field label="Full name" htmlFor="full_name" required>
        <Input id="full_name" name="full_name" defaultValue={profile.full_name} autoComplete="name" required maxLength={80} />
      </Field>
      <Field label="Phone (WhatsApp)" htmlFor="phone" required>
        <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" required />
      </Field>
      <Field label="College" htmlFor="college" required>
        <Input id="college" name="college" defaultValue={profile.college ?? ""} required maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Course" htmlFor="course" required>
          <Input id="course" name="course" defaultValue={profile.course ?? ""} placeholder="MBBS" required maxLength={80} />
        </Field>
        <Field label="Year" htmlFor="year" required>
          <Select id="year" name="year" defaultValue={profile.year ?? ""} required>
            <option value="" disabled>
              Select
            </option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <Label htmlFor="id_card">
          New college ID card <span className="ml-0.5 text-alert">*</span>
        </Label>
        <label
          htmlFor="id_card"
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-3 transition-colors hover:border-brand/50"
        >
          {idCardName ? (
            <IdCard className="size-5 shrink-0 text-brand" aria-hidden />
          ) : (
            <UploadCloud className="size-5 shrink-0 text-brand" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {idCardName ?? "Upload a clear photo of your ID card"}
          </span>
          <span className="shrink-0 text-xs text-muted">PNG/JPG · 5 MB</span>
          <input
            id="id_card"
            name="id_card"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="sr-only"
            onChange={(e) => setIdCardName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <p className="mt-1 text-xs text-muted">
          Make sure your name, college and the card&rsquo;s validity are readable.
        </p>
      </div>

      {state && !state.ok && (
        <p role="alert" className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" loading={pending} withArrow>
        Resubmit application
      </Button>
    </form>
  );
}
