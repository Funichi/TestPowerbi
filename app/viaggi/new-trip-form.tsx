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
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-end sm:flex-wrap"
    >
      <label className="flex flex-1 min-w-[160px] flex-col gap-1 text-sm text-foreground/80">
        Nome viaggio
        <input
          type="text"
          name="nome"
          required
          placeholder="Es. Giappone 2026"
          className="rounded-md border border-line bg-surface px-3 py-2 text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-foreground/80">
        Data inizio (opzionale)
        <input
          type="date"
          name="data_inizio"
          className="rounded-md border border-line bg-surface px-3 py-2 text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-foreground/80">
        Data fine (opzionale)
        <input
          type="date"
          name="data_fine"
          className="rounded-md border border-line bg-surface px-3 py-2 text-foreground"
        />
      </label>
      {state?.error && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Creazione…" : "Crea viaggio"}
      </button>
    </form>
  );
}
