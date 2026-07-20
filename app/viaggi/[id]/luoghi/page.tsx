import { createClient } from "@/lib/supabase/server";
import { googleMapsPlaceUrl } from "@/lib/googleMapsLinks";
import { deletePlace, updatePlace } from "../actions";
import { AddPlaceForm } from "./add-place-form";

const CATEGORIE = [
  { key: "visitare", label: "Da visitare", icona: "📍", colore: "bg-emerald-100 dark:bg-emerald-950" },
  { key: "mangiare", label: "Dove mangiare", icona: "🍴", colore: "bg-orange-100 dark:bg-orange-950" },
  { key: "dormire", label: "Dove dormire", icona: "🛏️", colore: "bg-indigo-100 dark:bg-indigo-950" },
] as const;

const SENZA_CITTA = "Altri luoghi";

type Luogo = {
  id: string;
  nome: string;
  categoria: string;
  indirizzo: string | null;
  citta: string | null;
  nota: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
};

const inputClass =
  "rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

function raggruppaPerCitta(luoghi: Luogo[]) {
  const gruppi = new Map<string, Luogo[]>();
  for (const luogo of luoghi) {
    const chiave = luogo.citta ?? SENZA_CITTA;
    const gruppo = gruppi.get(chiave) ?? [];
    gruppo.push(luogo);
    gruppi.set(chiave, gruppo);
  }
  // Le città con un nome vengono prima, "Altri luoghi" per ultimo.
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
    <li className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-zinc-950 dark:text-zinc-50">{luogo.nome}</p>
          {luogo.indirizzo && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">{luogo.indirizzo}</p>
          )}
          {luogo.nota && (
            <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              &quot;{luogo.nota}&quot;
            </blockquote>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap text-xs font-medium text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Apri su Maps
            </a>
          )}
          <form action={deletePlace.bind(null, luogo.id, viaggioId)}>
            <button
              type="submit"
              className="rounded-full border border-black/[.08] px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
            >
              Elimina
            </button>
          </form>
        </div>
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

export default async function LuoghiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: luoghi } = await supabase
    .from("luoghi")
    .select("id, nome, categoria, indirizzo, citta, nota, lat, lng, google_place_id")
    .eq("viaggio_id", id)
    .order("created_at", { ascending: true });

  const gruppiCitta = raggruppaPerCitta(luoghi ?? []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-8">
      <AddPlaceForm viaggioId={id} />

      {(luoghi ?? []).length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Non hai ancora salvato nessun luogo. Cercane uno con il modulo qui sopra.
        </p>
      ) : (
        gruppiCitta.map(([citta, luoghiCitta]) => (
          <section key={citta} className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{citta}</h2>
            {CATEGORIE.map(({ key, label, icona, colore }) => {
              const luoghiCategoria = luoghiCitta.filter((l) => l.categoria === key);
              if (luoghiCategoria.length === 0) return null;

              return (
                <div key={key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${colore}`}
                      aria-hidden="true"
                    >
                      {icona}
                    </span>
                    <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</h3>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {luoghiCategoria.map((luogo) => (
                      <PlaceCard key={luogo.id} luogo={luogo} viaggioId={id} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))
      )}
    </main>
  );
}
