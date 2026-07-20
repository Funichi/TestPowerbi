import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RouteMap } from "@/components/RouteMap";
import { deletePlace, deleteTripAndRedirect, updatePlace } from "./actions";
import { AddPlaceForm } from "./add-place-form";
import { AddStopForm } from "./add-stop-form";
import { moveStop, removeStop } from "./itinerary-actions";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("it-IT");
}

const CATEGORIE = [
  { key: "visitare", label: "Da visitare" },
  { key: "mangiare", label: "Dove mangiare" },
  { key: "dormire", label: "Dove dormire" },
] as const;

type Luogo = {
  id: string;
  nome: string;
  categoria: string;
  indirizzo: string | null;
  nota: string | null;
};

const inputClass =
  "rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

function PlaceCard({ luogo, viaggioId }: { luogo: Luogo; viaggioId: string }) {
  return (
    <li className="rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-zinc-950 dark:text-zinc-50">{luogo.nome}</p>
          {luogo.indirizzo && (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">{luogo.indirizzo}</p>
          )}
          {luogo.nota && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{luogo.nota}</p>
          )}
        </div>
        <form action={deletePlace.bind(null, luogo.id, viaggioId)}>
          <button
            type="submit"
            className="rounded-full border border-black/[.08] px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Elimina
          </button>
        </form>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-zinc-500 dark:text-zinc-500">
          Modifica
        </summary>
        <form
          action={updatePlace.bind(null, luogo.id, viaggioId)}
          className="mt-2 flex flex-col gap-2"
        >
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
            className="self-start rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Salva modifiche
          </button>
        </form>
      </details>
    </li>
  );
}

type Tappa = {
  id: string;
  giorno: number;
  posizione: number;
  luogo: { id: string; nome: string; lat: number | null; lng: number | null } | null;
};

function ItineraryDay({
  giorno,
  tappe,
  viaggioId,
}: {
  giorno: number;
  tappe: Tappa[];
  viaggioId: string;
}) {
  const stopsConCoordinate = tappe
    .filter((t) => t.luogo?.lat != null && t.luogo?.lng != null)
    .map((t) => ({ lat: t.luogo!.lat!, lng: t.luogo!.lng!, nome: t.luogo!.nome }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
      <h3 className="font-medium text-zinc-950 dark:text-zinc-50">Giorno {giorno}</h3>
      <ol className="flex flex-col gap-2">
        {tappe.map((tappa, index) => (
          <li
            key={tappa.id}
            className="flex items-center justify-between gap-3 rounded-md border border-black/[.08] px-3 py-2 dark:border-white/[.145]"
          >
            <span className="text-sm text-zinc-950 dark:text-zinc-50">
              {index + 1}. {tappa.luogo?.nome ?? "Luogo eliminato"}
            </span>
            <div className="flex items-center gap-1">
              <form action={moveStop.bind(null, tappa.id, viaggioId, "up")}>
                <button
                  type="submit"
                  disabled={index === 0}
                  className="rounded-full border border-black/[.08] px-2 py-1 text-xs disabled:opacity-30 dark:border-white/[.145]"
                >
                  ▲
                </button>
              </form>
              <form action={moveStop.bind(null, tappa.id, viaggioId, "down")}>
                <button
                  type="submit"
                  disabled={index === tappe.length - 1}
                  className="rounded-full border border-black/[.08] px-2 py-1 text-xs disabled:opacity-30 dark:border-white/[.145]"
                >
                  ▼
                </button>
              </form>
              <form action={removeStop.bind(null, tappa.id, viaggioId)}>
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
      {stopsConCoordinate.length > 0 && <RouteMap stops={stopsConCoordinate} />}
    </div>
  );
}

export default async function ViaggioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: viaggio } = await supabase
    .from("viaggi")
    .select("id, nome, data_inizio, data_fine")
    .eq("id", id)
    .single();

  if (!viaggio) {
    notFound();
  }

  const { data: luoghi } = await supabase
    .from("luoghi")
    .select("id, nome, categoria, indirizzo, nota")
    .eq("viaggio_id", id)
    .order("created_at", { ascending: true });

  const { data: tappe } = await supabase
    .from("tappe_itinerario")
    .select("id, giorno, posizione, luogo:luoghi(id, nome, lat, lng)")
    .eq("viaggio_id", id)
    .order("giorno", { ascending: true })
    .order("posizione", { ascending: true })
    .returns<Tappa[]>();

  const giorni = Array.from(new Set((tappe ?? []).map((t) => t.giorno)));

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <div>
          <Link href="/viaggi" className="text-sm text-zinc-500 dark:text-zinc-500">
            ← I miei viaggi
          </Link>
          <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {viaggio.nome}
          </h1>
          {(viaggio.data_inizio || viaggio.data_fine) && (
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              {formatDate(viaggio.data_inizio)} – {formatDate(viaggio.data_fine)}
            </p>
          )}
        </div>
        <form action={deleteTripAndRedirect.bind(null, viaggio.id)}>
          <button
            type="submit"
            className="rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Elimina viaggio
          </button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-8">
        <AddPlaceForm viaggioId={viaggio.id} />

        {CATEGORIE.map(({ key, label }) => {
          const luoghiCategoria = (luoghi ?? []).filter((l) => l.categoria === key);
          return (
            <section key={key} className="flex flex-col gap-3">
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                {label}
              </h2>
              {luoghiCategoria.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  Nessun luogo salvato in questa categoria.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {luoghiCategoria.map((luogo) => (
                    <PlaceCard key={luogo.id} luogo={luogo} viaggioId={viaggio.id} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Itinerario
          </h2>
          <AddStopForm viaggioId={viaggio.id} luoghi={(luoghi ?? []).map((l) => ({ id: l.id, nome: l.nome }))} />

          {giorni.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              Nessuna tappa pianificata. Aggiungi un luogo salvato a un giorno con il modulo qui sopra.
            </p>
          ) : (
            giorni.map((giorno) => (
              <ItineraryDay
                key={giorno}
                giorno={giorno}
                tappe={(tappe ?? []).filter((t) => t.giorno === giorno)}
                viaggioId={viaggio.id}
              />
            ))
          )}
        </section>
      </main>
    </div>
  );
}
