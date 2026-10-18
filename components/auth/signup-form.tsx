"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { UploadCloud, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Label } from "@/components/ui/field";
import { signUp, type AuthState } from "@/lib/actions/auth";

const YEARS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "Final Year",
  "Intern",
  "Postgraduate",
];

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signUp,
    null,
  );
  const [idCardName, setIdCardName] = useState<string | null>(null);

  if (state?.ok && state.message) {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          ✓
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold text-foreground">
          Signup received
        </h1>
        <p className="mt-2 text-sm text-muted">{state.message}</p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-brand hover:underline"
        >
          Back to home →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-foreground">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted">
        You&rsquo;ll get a unique participant ID to register for events.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <Field label="Full name" htmlFor="full_name" required>
          <Input id="full_name" name="full_name" autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters"
          required
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Phone (WhatsApp)" htmlFor="phone" required>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
          />
        </Field>
        <Field label="College" htmlFor="college" required>
          <Input id="college" name="college" required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Course" htmlFor="course" required>
            <Input id="course" name="course" placeholder="MBBS" required />
          </Field>
          <Field label="Year" htmlFor="year" required>
            <Select id="year" name="year" defaultValue="" required>
              <option value="" disabled>
                Select
              </option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <Label htmlFor="id_card">
            College ID card <span className="ml-0.5 text-alert">*</span>
          </Label>
          <label
            htmlFor="id_card"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-3 transition-colors hover:border-brand/50"
          >
            {idCardName ? (
              <IdCard className="size-5 shrink-0 text-brand" />
            ) : (
              <UploadCloud className="size-5 shrink-0 text-brand" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {idCardName ?? "Upload a photo of your ID card"}
            </span>
            <span className="text-xs text-muted">PNG/JPG · 5 MB</span>
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
            An organizer verifies this before your account is approved.
          </p>
        </div>

        {state && !state.ok && (
          <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={pending} withArrow>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
