"use client";

import { useActionState } from "react";
import { addStop } from "../itinerary-actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-foreground";

const SENZA_CITTA = "Altri luoghi";

export type LuogoOpzione = {
  id: string;
  nome: string;
  citta: string | null;
  giaAggiunto: boolean;
};

export function AddStopForm({
  viaggioId,
  giorno,
  luoghi,
}: {
  viaggioId: string;
  giorno: number;
  luoghi: LuogoOpzione[];
}) {
  const [state, formAction, pending] = useActionState(addStop, undefined);

  if (luoghi.length === 0) {
    return (
      <p className="text-sm text-foreground/50">
        Salva prima almeno un luogo nella pagina &quot;Luoghi&quot; per poterlo aggiungere all&apos;itinerario.
      </p>
    );
  }

  const gruppi = new Map<string, LuogoOpzione[]>();
  for (const luogo of luoghi) {
    const chiave = luogo.citta ?? SENZA_CITTA;
    const gruppo = gruppi.get(chiave) ?? [];
    gruppo.push(luogo);
    gruppi.set(chiave, gruppo);
  }
  const gruppiOrdinati = Array.from(gruppi.entries()).sort(([a], [b]) => {
    if (a === SENZA_CITTA) return 1;
    if (b === SENZA_CITTA) return -1;
    return a.localeCompare(b);
  });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <input type="hidden" name="viaggio_id" value={viaggioId} />

      <label className="flex flex-col gap-1 text-sm text-foreground/80">
        Luogo
        <select name="luogo_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Scegli un luogo salvato
          </option>
          {gruppiOrdinati.map(([citta, opzioni]) => (
            <optgroup key={citta} label={citta}>
              {opzioni.map((luogo) => (
                <option key={luogo.id} value={luogo.id} disabled={luogo.giaAggiunto}>
                  {luogo.nome}
                  {luogo.giaAggiunto ? " (già nell'itinerario)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-foreground/80">
        Giorno
        <input
          type="number"
          name="giorno"
          min={1}
          required
          defaultValue={giorno}
          className={`${inputClass} w-24`}
        />
      </label>

      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Aggiunta…" : "Aggiungi all'itinerario"}
      </button>
    </form>
  );
}
