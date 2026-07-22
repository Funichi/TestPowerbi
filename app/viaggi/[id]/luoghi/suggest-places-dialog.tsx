"use client";

import { useRef, useState } from "react";
import { loadPlacesLibrary } from "@/lib/googleMaps";
import { addPlace } from "../actions";

const CATEGORIE_GOOGLE = {
  visitare: { label: "Da visitare", tipo: "tourist_attraction", icona: "📍" },
  mangiare: { label: "Dove mangiare", tipo: "restaurant", icona: "🍴" },
  dormire: { label: "Dove dormire", tipo: "lodging", icona: "🛏️" },
} as const;

type Categoria = keyof typeof CATEGORIE_GOOGLE;

type Suggerimento = {
  googlePlaceId: string;
  nome: string;
  indirizzo: string;
  lat: number;
  lng: number;
  rating: number | null;
  numeroRecensioni: number | null;
};

async function aggiungiLuogoRapido(formData: FormData) {
  await addPlace(undefined, formData);
}

export function SuggestPlacesDialog({
  viaggioId,
  citta,
  centro,
  placeIdsEsistenti,
}: {
  viaggioId: string;
  citta: string;
  centro: { lat: number; lng: number };
  placeIdsEsistenti: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [categoria, setCategoria] = useState<Categoria>("visitare");
  const [risultati, setRisultati] = useState<Suggerimento[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const esistentiSet = new Set(placeIdsEsistenti);

  async function cerca(categoriaScelta: Categoria) {
    setCategoria(categoriaScelta);
    setCaricamento(true);
    setErrore(null);
    try {
      const places = await loadPlacesLibrary();
      const { places: risultatiGoogle } = await places.Place.searchNearby({
        fields: ["displayName", "formattedAddress", "location", "id", "rating", "userRatingCount"],
        locationRestriction: { center: centro, radius: 5000 },
        includedPrimaryTypes: [CATEGORIE_GOOGLE[categoriaScelta].tipo],
        maxResultCount: 10,
      });
      setRisultati(
        risultatiGoogle
          .filter((p) => p.location)
          .map((p) => ({
            googlePlaceId: p.id,
            nome: p.displayName ?? "",
            indirizzo: p.formattedAddress ?? "",
            lat: p.location!.lat(),
            lng: p.location!.lng(),
            rating: p.rating ?? null,
            numeroRecensioni: p.userRatingCount ?? null,
          })),
      );
    } catch {
      setErrore("Non è stato possibile caricare i suggerimenti. Riprova.");
    } finally {
      setCaricamento(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          if (risultati.length === 0) cerca("visitare");
        }}
        className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
      >
        ✨ Suggerisci luoghi
      </button>

      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-6 text-foreground backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Suggerimenti per {citta}</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Chiudi"
            className="rounded-full px-2 py-1 text-foreground/50 hover:bg-foreground/5"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(CATEGORIE_GOOGLE) as Categoria[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => cerca(key)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                categoria === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-line text-foreground hover:bg-foreground/5"
              }`}
            >
              {CATEGORIE_GOOGLE[key].icona} {CATEGORIE_GOOGLE[key].label}
            </button>
          ))}
        </div>

        {caricamento && <p className="text-sm text-foreground/50">Cerco suggerimenti…</p>}
        {errore && <p className="text-sm text-red-600 dark:text-red-400">{errore}</p>}
        {!caricamento && !errore && risultati.length === 0 && (
          <p className="text-sm text-foreground/50">Nessun suggerimento trovato per questa categoria.</p>
        )}

        <ul className="flex flex-col gap-3">
          {risultati.map((r) => {
            const giaSalvato = esistentiSet.has(r.googlePlaceId);
            return (
              <li
                key={r.googlePlaceId}
                className="flex items-start justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.nome}</p>
                  {r.rating != null && (
                    <p className="text-sm text-foreground/70">
                      ⭐ {r.rating.toFixed(1)}
                      {r.numeroRecensioni != null && ` (${r.numeroRecensioni})`}
                    </p>
                  )}
                  <p className="truncate text-xs text-foreground/50">{r.indirizzo}</p>
                </div>
                {giaSalvato ? (
                  <span className="whitespace-nowrap text-xs text-foreground/40">Già salvato</span>
                ) : (
                  <form action={aggiungiLuogoRapido}>
                    <input type="hidden" name="viaggio_id" value={viaggioId} />
                    <input type="hidden" name="nome" value={r.nome} />
                    <input type="hidden" name="categoria" value={categoria} />
                    <input type="hidden" name="indirizzo" value={r.indirizzo} />
                    <input type="hidden" name="citta" value={citta} />
                    <input type="hidden" name="lat" value={r.lat} />
                    <input type="hidden" name="lng" value={r.lng} />
                    <input type="hidden" name="google_place_id" value={r.googlePlaceId} />
                    <button
                      type="submit"
                      className="whitespace-nowrap rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                      + Aggiungi
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
}
