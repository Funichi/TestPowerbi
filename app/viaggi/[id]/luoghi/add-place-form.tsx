"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { PlaceAutocompleteInput, type SelectedPlace } from "@/components/PlaceAutocompleteInput";
import { PlaceSummaryCard } from "@/components/PlaceSummaryCard";
import { addPlace } from "../actions";

const inputClass = "rounded-md border border-line bg-surface px-3 py-2 text-foreground";

export function AddPlaceForm({ viaggioId }: { viaggioId: string }) {
  const [state, formAction, pending] = useActionState(addPlace, undefined);
  const [selected, setSelected] = useState<SelectedPlace | null>(null);
  const [nome, setNome] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state && !state.error) {
      dialogRef.current?.close();
    }
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        + Aggiungi luogo
      </button>

      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto h-fit max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 text-foreground backdrop:bg-black/40"
        onClose={() => {
          setSelected(null);
          setNome("");
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Aggiungi un luogo</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Chiudi"
            className="rounded-full px-2 py-1 text-foreground/50 hover:bg-foreground/5"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="viaggio_id" value={viaggioId} />
          <input type="hidden" name="indirizzo" value={selected?.indirizzo ?? ""} />
          <input type="hidden" name="citta" value={selected?.citta ?? ""} />
          <input type="hidden" name="lat" value={selected?.lat ?? ""} />
          <input type="hidden" name="lng" value={selected?.lng ?? ""} />
          <input type="hidden" name="google_place_id" value={selected?.googlePlaceId ?? ""} />

          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Cerca il luogo su Google Maps
            <PlaceAutocompleteInput
              onPlaceSelected={(place) => {
                setSelected(place);
                setNome(place.nome);
              }}
            />
          </label>

          {selected && <PlaceSummaryCard place={selected} />}

          <label className="flex flex-col gap-1 text-sm text-foreground/80">
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

          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Categoria
            <select name="categoria" required defaultValue="visitare" className={inputClass}>
              <option value="visitare">Visitare</option>
              <option value="mangiare">Mangiare</option>
              <option value="dormire">Dormire</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            Nota (opzionale)
            <textarea name="nota" rows={2} className={inputClass} />
          </label>

          {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? "Salvataggio…" : "Salva luogo"}
          </button>
        </form>
      </dialog>
    </>
  );
}
