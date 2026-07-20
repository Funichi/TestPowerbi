"use client";

import { useActionState } from "react";
import { addStop } from "./itinerary-actions";

const inputClass =
  "rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

export function AddStopForm({
  viaggioId,
  luoghi,
}: {
  viaggioId: string;
  luoghi: { id: string; nome: string }[];
}) {
  const [state, formAction, pending] = useActionState(addStop, undefined);

  if (luoghi.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Salva prima almeno un luogo per poterlo aggiungere all&apos;itinerario.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950 sm:flex-row sm:items-end sm:flex-wrap"
    >
      <input type="hidden" name="viaggio_id" value={viaggioId} />

      <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Luogo
        <select name="luogo_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Scegli un luogo salvato
          </option>
          {luoghi.map((luogo) => (
            <option key={luogo.id} value={luogo.id}>
              {luogo.nome}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Giorno
        <input
          type="number"
          name="giorno"
          min={1}
          required
          defaultValue={1}
          className={`${inputClass} w-24`}
        />
      </label>

      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Aggiunta…" : "Aggiungi all'itinerario"}
      </button>
    </form>
  );
}
