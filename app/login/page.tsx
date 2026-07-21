"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-6 text-2xl font-semibold text-foreground">
          Accedi
        </h1>
        <form action={formAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Email
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="rounded-md border border-line bg-surface px-3 py-2 text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="rounded-md border border-line bg-surface px-3 py-2 text-foreground"
            />
          </label>
          {state?.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? "Accesso in corso…" : "Accedi"}
          </button>
        </form>
        <p className="mt-6 text-sm text-foreground/70">
          Non hai un account?{" "}
          <Link href="/signup" className="font-medium text-foreground">
            Registrati
          </Link>
        </p>
      </div>
    </div>
  );
}
