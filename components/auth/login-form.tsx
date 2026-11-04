"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signIn, type AuthState } from "@/lib/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, null);

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-foreground">
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to manage your registrations and payments.
      </p>

      <form action={action} className="mt-8 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Email" htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {state && !state.ok && (
          <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={pending} withArrow>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to Wissendurst?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
