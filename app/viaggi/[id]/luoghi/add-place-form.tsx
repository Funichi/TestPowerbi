"use client";

import { useActionState, useState } from "react";
import { PlaceAutocompleteInput, type SelectedPlace } from "@/components/PlaceAutocompleteInput";
import { addPlace } from "../actions";

const inputClass =
  "rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

export function AddPlaceForm({ viaggioId }: { viaggioId: string }) {
  const [state, formAction, pending] = useActionState(addPlace, undefined);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [nome, setNome] = useState("");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
    >
      <input type="hidden" name="viaggio_id" value={viaggioId} />
      <input type="hidden" name="indirizzo" value={selected?.indirizzo ?? ""} />
      <input type="hidden" name="citta" value={selected?.citta ?? ""} />
      <input type="hidden" name="lat" value={selected?.lat ?? ""} />
      <input type="hidden" name="lng" value={selected?.lng ?? ""} />
      <input type="hidden" name="google_place_id" value={selected?.googlePlaceId ?? ""} />

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Cerca il luogo su Google Maps
        <PlaceAutocompleteInput
          onPlaceSelected={(place) => {
            setSelected(place);
            setNome(place.nome);
          }}
        />
        {selected && (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            Selezionato: {selected.indirizzo}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Nome (compilato automaticamente dalla ricerca, puoi modificarlo)
        <input
          type="text"
          name="nome"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Categoria
        <select name="categoria" required defaultValue="visitare" className={inputClass}>
          <option value="visitare">Visitare</option>
          <option value="mangiare">Mangiare</option>
          <option value="dormire">Dormire</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        Nota (opzionale)
        <textarea name="nota" rows={2} className={inputClass} />
      </label>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Salvataggio…" : "Salva luogo"}
      </button>
    </form>
  );
}
