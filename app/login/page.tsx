"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          Accedi
        </h1>
        <form action={formAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Email
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
            />
          </label>
          {state?.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {pending ? "Accesso in corso…" : "Accedi"}
          </button>
        </form>
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Non hai un account?{" "}
          <Link href="/signup" className="font-medium text-zinc-950 dark:text-zinc-50">
            Registrati
          </Link>
        </p>
      </div>
    </div>
  );
}
