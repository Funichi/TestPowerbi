import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RouteMap } from "@/components/RouteMap";
import { moveStop, removeStop } from "../itinerary-actions";
import { AddStopForm, type LuogoOpzione } from "./add-stop-form";

type Tappa = {
  id: string;
  giorno: number;
  posizione: number;
  luogo: { id: string; nome: string; lat: number | null; lng: number | null } | null;
};

function DayTabs({ viaggioId, giorni, giornoSelezionato }: { viaggioId: string; giorni: number[]; giornoSelezionato: number }) {
  const prossimoGiorno = Math.max(giornoSelezionato, ...giorni, 0) + 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {giorni.map((giorno) => (
        <Link
          key={giorno}
          href={`/viaggi/${viaggioId}/itinerario?giorno=${giorno}`}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            giorno === giornoSelezionato
              ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-black"
              : "border-black/[.08] text-zinc-950 hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          }`}
        >
          Giorno {giorno}
        </Link>
      ))}
      <Link
        href={`/viaggi/${viaggioId}/itinerario?giorno=${prossimoGiorno}`}
        className="rounded-full border border-dashed border-black/[.2] px-4 py-1.5 text-sm font-medium text-zinc-500 hover:bg-black/[.04] dark:border-white/[.3] dark:text-zinc-400 dark:hover:bg-[#1a1a1a]"
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
    .select("id, giorno, posizione, luogo:luoghi(id, nome, lat, lng)")
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <DayTabs viaggioId={id} giorni={giorniTab} giornoSelezionato={giornoSelezionato} />

      <AddStopForm viaggioId={id} giorno={giornoSelezionato} luoghi={opzioniLuoghi} />

      <div className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
        <h2 className="font-medium text-zinc-950 dark:text-zinc-50">Giorno {giornoSelezionato}</h2>
        {tappeDelGiorno.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            Nessuna tappa per questo giorno. Aggiungine una con il modulo qui sopra.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {tappeDelGiorno.map((tappa, index) => (
              <li
                key={tappa.id}
                className="flex items-center justify-between gap-3 rounded-md border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
              >
                <span className="text-sm text-zinc-950 dark:text-zinc-50">
                  {index + 1}. {tappa.luogo?.nome ?? "Luogo eliminato"}
                </span>
                <div className="flex items-center gap-1">
                  <form action={moveStop.bind(null, tappa.id, id, "up")}>
                    <button
                      type="submit"
                      disabled={index === 0}
                      className="rounded-full border border-black/[.08] px-2 py-1 text-xs disabled:opacity-30 dark:border-white/[.145]"
                    >
                      ▲
                    </button>
                  </form>
                  <form action={moveStop.bind(null, tappa.id, id, "down")}>
                    <button
                      type="submit"
                      disabled={index === tappeDelGiorno.length - 1}
                      className="rounded-full border border-black/[.08] px-2 py-1 text-xs disabled:opacity-30 dark:border-white/[.145]"
                    >
                      ▼
                    </button>
                  </form>
                  <form action={removeStop.bind(null, tappa.id, id)}>
                    <button
                      type="submit"
                      className="rounded-full border border-black/[.08] px-2 py-1 text-xs dark:border-white/[.145]"
                    >
                      Rimuovi
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        )}
        {stopsConCoordinate.length > 0 && <RouteMap stops={stopsConCoordinate} />}
      </div>
    </main>
  );
}
