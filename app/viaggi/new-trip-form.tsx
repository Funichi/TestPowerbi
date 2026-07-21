"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTrip } from "./actions";

const inputClass = "rounded-md border border-line bg-surface px-3 py-2 text-foreground";

export function NewTripForm() {
  const [state, formAction, pending] = useActionState(createTrip, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state && !state.error) {
      formRef.current?.reset();
      dialogRef.current?.close();
    }
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        + Crea nuovo viaggio
      </button>

      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto h-fit w-full max-w-md rounded-xl border border-line bg-surface p-6 text-foreground backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Nuovo viaggio</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Chiudi"
            className="rounded-full px-2 py-1 text-foreground/50 hover:bg-foreground/5"
          >
            ✕
          </button>
        </div>

        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Nome viaggio
            <input
              type="text"
              name="nome"
              required
              placeholder="Es. Giappone 2026"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Data inizio (opzionale)
            <input type="date" name="data_inizio" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Data fine (opzionale)
            <input type="date" name="data_fine" className={inputClass} />
          </label>
          {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-1 self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? "Creazione…" : "Crea viaggio"}
          </button>
        </form>
      </dialog>
    </>
  );
}
