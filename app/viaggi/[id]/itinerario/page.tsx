import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RouteMap } from "@/components/RouteMap";
import { googleMapsDirectionsUrl } from "@/lib/googleMapsLinks";
import { moveStop, removeStop } from "../itinerary-actions";
import { AddStopForm, type LuogoOpzione } from "./add-stop-form";

type Tappa = {
  id: string;
  giorno: number;
  posizione: number;
  luogo: {
    id: string;
    nome: string;
    categoria: string;
    lat: number | null;
    lng: number | null;
    google_place_id: string | null;
  } | null;
};

const ICONA_CATEGORIA: Record<string, string> = {
  visitare: "📍",
  mangiare: "🍴",
  dormire: "🛏️",
};

function DayTabs({
  viaggioId,
  giorni,
  giornoSelezionato,
}: {
  viaggioId: string;
  giorni: number[];
  giornoSelezionato: number;
}) {
  const prossimoGiorno = Math.max(giornoSelezionato, ...giorni, 0) + 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {giorni.map((giorno) => (
        <Link
          key={giorno}
          href={`/viaggi/${viaggioId}/itinerario?giorno=${giorno}`}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            giorno === giornoSelezionato
              ? "border-primary bg-primary text-primary-foreground"
              : "border-line text-foreground hover:bg-foreground/5"
          }`}
        >
          Giorno {giorno}
        </Link>
      ))}
      <Link
        href={`/viaggi/${viaggioId}/itinerario?giorno=${prossimoGiorno}`}
        className="rounded-full border border-dashed border-line px-4 py-1.5 text-sm font-medium text-foreground/50 hover:bg-foreground/5"
      >
        + Aggiungi giorno
      </Link>
    </div>
  );
}

export default async function ItinerarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ giorno?: string }>;
}) {
  const { id } = await params;
  const { giorno: giornoParam } = await searchParams;

  const supabase = await createClient();

  const { data: luoghi } = await supabase
    .from("luoghi")
    .select("id, nome, citta")
    .eq("viaggio_id", id)
    .order("nome", { ascending: true });

  const { data: tappe } = await supabase
    .from("tappe_itinerario")
    .select("id, giorno, posizione, luogo:luoghi(id, nome, categoria, lat, lng, google_place_id)")
    .eq("viaggio_id", id)
    .order("giorno", { ascending: true })
    .order("posizione", { ascending: true })
    .returns<Tappa[]>();

  const giorniConTappe = Array.from(new Set((tappe ?? []).map((t) => t.giorno))).sort((a, b) => a - b);
  const giornoRichiesto = giornoParam ? Number(giornoParam) : NaN;
  const giornoSelezionato =
    Number.isInteger(giornoRichiesto) && giornoRichiesto > 0
      ? giornoRichiesto
      : (giorniConTappe[0] ?? 1);

  const giorniTab = Array.from(new Set([...giorniConTappe, giornoSelezionato])).sort((a, b) => a - b);

  const luoghiGiaAggiunti = new Set((tappe ?? []).map((t) => t.luogo?.id).filter(Boolean));
  const opzioniLuoghi: LuogoOpzione[] = (luoghi ?? []).map((l) => ({
    id: l.id,
    nome: l.nome,
    citta: l.citta,
    giaAggiunto: luoghiGiaAggiunti.has(l.id),
  }));

  const tappeDelGiorno = (tappe ?? []).filter((t) => t.giorno === giornoSelezionato);
  const stopsConCoordinate = tappeDelGiorno
    .filter((t) => t.luogo?.lat != null && t.luogo?.lng != null)
    .map((t) => ({ lat: t.luogo!.lat!, lng: t.luogo!.lng!, nome: t.luogo!.nome }));

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside className="flex w-full flex-col gap-4 border-b border-line p-6 lg:w-80 lg:flex-shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <DayTabs viaggioId={id} giorni={giorniTab} giornoSelezionato={giornoSelezionato} />

        <AddStopForm viaggioId={id} giorno={giornoSelezionato} luoghi={opzioniLuoghi} />

        <div className="flex flex-col gap-3">
          <h2 className="font-medium text-foreground">Giorno {giornoSelezionato}</h2>
          {tappeDelGiorno.length === 0 ? (
            <p className="text-sm text-foreground/50">
              Nessuna tappa per questo giorno. Aggiungine una con il modulo qui sopra.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {tappeDelGiorno.map((tappa, index) => {
                const url = tappa.luogo
                  ? googleMapsDirectionsUrl({
                      lat: tappa.luogo.lat,
                      lng: tappa.luogo.lng,
                      googlePlaceId: tappa.luogo.google_place_id,
                    })
                  : null;
                return (
                  <li
                    key={tappa.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                  >
                    <span className="text-sm text-foreground">
                      {index + 1}.{" "}
                      {tappa.luogo && (
                        <span aria-hidden="true">
                          {ICONA_CATEGORIA[tappa.luogo.categoria] ?? "📍"}{" "}
                        </span>
                      )}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted underline-offset-2"
                        >
                          {tappa.luogo?.nome}
                        </a>
                      ) : (
                        (tappa.luogo?.nome ?? "Luogo eliminato")
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <form action={moveStop.bind(null, tappa.id, id, "up")}>
                        <button
                          type="submit"
                          disabled={index === 0}
                          className="rounded-full border border-line px-2 py-1 text-xs disabled:opacity-30"
                        >
                          ▲
                        </button>
                      </form>
                      <form action={moveStop.bind(null, tappa.id, id, "down")}>
                        <button
                          type="submit"
                          disabled={index === tappeDelGiorno.length - 1}
                          className="rounded-full border border-line px-2 py-1 text-xs disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </form>
                      <form action={removeStop.bind(null, tappa.id, id)}>
                        <button
                          type="submit"
                          className="rounded-full border border-line px-2 py-1 text-xs"
                        >
                          Rimuovi
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>

      <div className="h-96 flex-1 overflow-hidden rounded-lg border border-line bg-surface lg:h-auto">
        {stopsConCoordinate.length > 0 ? (
          <RouteMap stops={stopsConCoordinate} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-foreground/50">
              Aggiungi almeno una tappa con una posizione per vedere la mappa.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
