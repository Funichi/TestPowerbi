"use client";

import { useMemo, useState } from "react";
import { googleMapsPlaceUrl } from "@/lib/googleMapsLinks";
import { deletePlace, updatePlace } from "../actions";
import { SuggestPlacesDialog } from "./suggest-places-dialog";

const CATEGORIE = [
  { key: "visitare", label: "Da visitare", icona: "📍", badgeBg: "bg-badge-visit-bg", badgeFg: "text-badge-visit-fg" },
  { key: "mangiare", label: "Dove mangiare", icona: "🍴", badgeBg: "bg-badge-eat-bg", badgeFg: "text-badge-eat-fg" },
  { key: "dormire", label: "Dove dormire", icona: "🛏️", badgeBg: "bg-badge-sleep-bg", badgeFg: "text-badge-sleep-fg" },
] as const;

const SENZA_CITTA = "Altri luoghi";

const inputClass = "rounded-md border border-line bg-surface px-3 py-2 text-foreground";

export type Luogo = {
  id: string;
  nome: string;
  categoria: string;
  indirizzo: string | null;
  citta: string | null;
  nota: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  foto_url: string | null;
};

function raggruppaPerCitta(luoghi: Luogo[]) {
  const gruppi = new Map<string, Luogo[]>();
  for (const luogo of luoghi) {
    const chiave = luogo.citta ?? SENZA_CITTA;
    const gruppo = gruppi.get(chiave) ?? [];
    gruppo.push(luogo);
    gruppi.set(chiave, gruppo);
  }
  return Array.from(gruppi.entries()).sort(([a], [b]) => {
    if (a === SENZA_CITTA) return 1;
    if (b === SENZA_CITTA) return -1;
    return a.localeCompare(b);
  });
}

function PlaceCard({ luogo, viaggioId }: { luogo: Luogo; viaggioId: string }) {
  const mapsUrl = googleMapsPlaceUrl({
    lat: luogo.lat,
    lng: luogo.lng,
    googlePlaceId: luogo.google_place_id,
    nome: luogo.nome,
  });

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          {luogo.foto_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={luogo.foto_url}
              alt={luogo.nome}
              className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{luogo.nome}</p>
            {luogo.indirizzo && <p className="truncate text-xs text-foreground/50">{luogo.indirizzo}</p>}
            {luogo.nota && (
              <blockquote className="mt-2 border-l-2 border-primary/30 pl-3 text-sm italic text-foreground/70">
                &quot;{luogo.nota}&quot;
              </blockquote>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap text-xs font-medium text-foreground/50 underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              Apri su Maps
            </a>
          )}
          <form action={deletePlace.bind(null, luogo.id, viaggioId)}>
            <button
              type="submit"
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
            >
              Elimina
            </button>
          </form>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-foreground/50">Modifica</summary>
        <form action={updatePlace.bind(null, luogo.id, viaggioId)} className="mt-2 flex flex-col gap-2">
          <input type="text" name="nome" required defaultValue={luogo.nome} className={inputClass} />
          <select name="categoria" required defaultValue={luogo.categoria} className={inputClass}>
            {CATEGORIE.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea name="nota" rows={2} defaultValue={luogo.nota ?? ""} className={inputClass} />
          <button
            type="submit"
            className="self-start rounded-full border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            Salva modifiche
          </button>
        </form>
      </details>
    </li>
  );
}

function centroCitta(luoghi: Luogo[]) {
  const conCoordinate = luoghi.filter((l) => l.lat != null && l.lng != null);
  if (conCoordinate.length === 0) return null;
  const lat = conCoordinate.reduce((tot, l) => tot + l.lat!, 0) / conCoordinate.length;
  const lng = conCoordinate.reduce((tot, l) => tot + l.lng!, 0) / conCoordinate.length;
  return { lat, lng };
}

export function LuoghiList({ luoghi, viaggioId }: { luoghi: Luogo[]; viaggioId: string }) {
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("tutte");
  const [cittaFiltro, setCittaFiltro] = useState<string>("tutte");

  const placeIdsEsistenti = useMemo(
    () => luoghi.map((l) => l.google_place_id).filter((id): id is string => id != null),
    [luoghi],
  );

  const citta = useMemo(() => {
    const insieme = new Set(luoghi.map((l) => l.citta ?? SENZA_CITTA));
    return Array.from(insieme).sort((a, b) => {
      if (a === SENZA_CITTA) return 1;
      if (b === SENZA_CITTA) return -1;
      return a.localeCompare(b);
    });
  }, [luoghi]);

  const luoghiFiltrati = useMemo(() => {
    return luoghi.filter((l) => {
      if (categoriaFiltro !== "tutte" && l.categoria !== categoriaFiltro) return false;
      if (cittaFiltro !== "tutte" && (l.citta ?? SENZA_CITTA) !== cittaFiltro) return false;
      return true;
    });
  }, [luoghi, categoriaFiltro, cittaFiltro]);

  const gruppiCitta = useMemo(() => raggruppaPerCitta(luoghiFiltrati), [luoghiFiltrati]);

  if (luoghi.length === 0) {
    return (
      <p className="text-sm text-foreground/50">
        Non hai ancora salvato nessun luogo. Aggiungine uno con il pulsante qui sopra.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoriaFiltro("tutte")}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              categoriaFiltro === "tutte"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-line text-foreground hover:bg-foreground/5"
            }`}
          >
            Tutti
          </button>
          {CATEGORIE.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategoriaFiltro(c.key)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                categoriaFiltro === c.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-line text-foreground hover:bg-foreground/5"
              }`}
            >
              {c.icona} {c.label}
            </button>
          ))}
        </div>

        {citta.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-foreground/70">
            Città
            <select
              value={cittaFiltro}
              onChange={(e) => setCittaFiltro(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-foreground"
            >
              <option value="tutte">Tutte le città</option>
              {citta.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {luoghiFiltrati.length === 0 ? (
        <p className="text-sm text-foreground/50">Nessun luogo corrisponde ai filtri scelti.</p>
      ) : (
        gruppiCitta.map(([citta, luoghiCitta]) => {
          const centro = centroCitta(luoghiCitta);
          return (
          <section key={citta} className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground">{citta}</h2>
              {citta !== SENZA_CITTA && centro && (
                <SuggestPlacesDialog
                  viaggioId={viaggioId}
                  citta={citta}
                  centro={centro}
                  placeIdsEsistenti={placeIdsEsistenti}
                />
              )}
            </div>
            {CATEGORIE.map(({ key, label, icona, badgeBg, badgeFg }) => {
              const luoghiCategoria = luoghiCitta.filter((l) => l.categoria === key);
              if (luoghiCategoria.length === 0) return null;

              return (
                <div key={key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${badgeBg} ${badgeFg}`}
                      aria-hidden="true"
                    >
                      {icona}
                    </span>
                    <h3 className="text-sm font-medium text-foreground/80">{label}</h3>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {luoghiCategoria.map((luogo) => (
                      <PlaceCard key={luogo.id} luogo={luogo} viaggioId={viaggioId} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
          );
        })
      )}
    </div>
  );
}
