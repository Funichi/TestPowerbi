"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTrip } from "./actions";

export function NewTripForm() {
  const [state, formAction, pending] = useActionState(createTrip, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && !state.error) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950 sm:flex-row sm:items-end sm:flex-wrap"
    >
      <label className="flex flex-1 min-w-[160px] flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Nome viaggio
        <input
          type="text"
          name="nome"
          required
          placeholder="Es. Giappone 2026"
          className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Data inizio (opzionale)
        <input
          type="date"
          name="data_inizio"
          className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Data fine (opzionale)
        <input
          type="date"
          name="data_fine"
          className="rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
        />
      </label>
      {state?.error && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Creazione…" : "Crea viaggio"}
      </button>
    </form>
  );
}
