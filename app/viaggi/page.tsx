import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteTrip, logout } from "./actions";
import { NewTripForm } from "./new-trip-form";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("it-IT");
}

function statoViaggio(dataInizio: string | null, dataFine: string | null) {
  if (!dataInizio && !dataFine) return null;
  const oggi = new Date().toISOString().slice(0, 10);
  if (dataInizio && dataInizio > oggi) {
    return { label: "In programma", className: "bg-badge-sleep-bg text-badge-sleep-fg" };
  }
  if (dataFine && dataFine < oggi) {
    return { label: "Concluso", className: "bg-foreground/10 text-foreground/60" };
  }
  return { label: "In corso", className: "bg-badge-visit-bg text-badge-visit-fg" };
}

function tempoFa(dataIso: string) {
  const giorni = Math.floor((Date.now() - new Date(dataIso).getTime()) / 86400000);
  if (giorni <= 0) return "Oggi";
  if (giorni === 1) return "Ieri";
  if (giorni < 7) return `${giorni} giorni fa`;
  return new Date(dataIso).toLocaleDateString("it-IT");
}

type Viaggio = {
  id: string;
  nome: string;
  data_inizio: string | null;
  data_fine: string | null;
};

function TripCard({ viaggio }: { viaggio: Viaggio }) {
  const stato = statoViaggio(viaggio.data_inizio, viaggio.data_fine);
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <Link href={`/viaggi/${viaggio.id}/luoghi`} className="flex flex-1 flex-col gap-2 p-4">
        {stato && (
          <span className={`self-start rounded-full px-2.5 py-1 text-xs font-medium ${stato.className}`}>
            {stato.label}
          </span>
        )}
        <span className="font-medium text-foreground">{viaggio.nome}</span>
        {(viaggio.data_inizio || viaggio.data_fine) && (
          <span className="text-sm text-foreground/50">
            📅 {formatDate(viaggio.data_inizio)} – {formatDate(viaggio.data_fine)}
          </span>
        )}
      </Link>
      <form action={deleteTrip.bind(null, viaggio.id)} className="border-t border-line px-4 py-2">
        <button type="submit" className="text-xs font-medium text-foreground/50 hover:text-foreground">
          Elimina
        </button>
      </form>
    </li>
  );
}

export default async function ViaggiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const nomeUtente = user?.email?.split("@")[0] ?? "";

  const { data: viaggi } = await supabase
    .from("viaggi")
    .select("id, nome, data_inizio, data_fine")
    .order("created_at", { ascending: false });

  const [{ data: viaggiRecenti }, { data: luoghiRecenti }, { data: tappeRecenti }] = await Promise.all([
    supabase.from("viaggi").select("id, nome, created_at").order("created_at", { ascending: false }).limit(5),
    supabase
      .from("luoghi")
      .select("id, nome, created_at, viaggio:viaggi(nome)")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<{ id: string; nome: string; created_at: string; viaggio: { nome: string } | null }[]>(),
    supabase
      .from("tappe_itinerario")
      .select("id, giorno, created_at, luogo:luoghi(nome), viaggio:viaggi(nome)")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<
        {
          id: string;
          giorno: number;
          created_at: string;
          luogo: { nome: string } | null;
          viaggio: { nome: string } | null;
        }[]
      >(),
  ]);

  const attivita = [
    ...(viaggiRecenti ?? []).map((v) => ({
      id: `viaggio-${v.id}`,
      data: v.created_at as string,
      testo: `Hai creato il viaggio "${v.nome}"`,
    })),
    ...(luoghiRecenti ?? []).map((l) => ({
      id: `luogo-${l.id}`,
      data: l.created_at as string,
      testo: `Hai aggiunto "${l.nome}" al viaggio "${l.viaggio?.nome ?? ""}"`,
    })),
    ...(tappeRecenti ?? []).map((t) => ({
      id: `tappa-${t.id}`,
      data: t.created_at as string,
      testo: `Hai aggiunto "${t.luogo?.nome ?? ""}" all'itinerario di "${t.viaggio?.nome ?? ""}" (Giorno ${t.giorno})`,
    })),
  ]
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">I miei viaggi</h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            Esci
          </button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">Ciao, {nomeUtente}.</h2>
              <p className="text-sm text-foreground/60">Dove ti porta il prossimo viaggio?</p>
            </div>
            <NewTripForm />
          </div>

          {!viaggi || viaggi.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-foreground/60">
              Non hai ancora nessun viaggio. Creane uno con il pulsante qui sopra.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {viaggi.map((viaggio) => (
                <TripCard key={viaggio.id} viaggio={viaggio} />
              ))}
            </ul>
          )}
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-72 lg:flex-shrink-0">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Suggerimenti</h3>
            <ul className="flex flex-col gap-3 text-sm text-foreground/70">
              <li>Aggiungi le date al viaggio per vedere se è in programma, in corso o concluso.</li>
              <li>Salva prima i luoghi, poi assegnali a un giorno nella pagina Itinerario.</li>
              <li>Tocca il nome di una tappa nell&apos;itinerario per aprire la navigazione su Google Maps.</li>
            </ul>
          </div>

          {attivita.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Attività recente</h3>
              <ul className="flex flex-col gap-3">
                {attivita.map((a) => (
                  <li key={a.id} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-foreground/40">{tempoFa(a.data)}</p>
                      <p className="text-foreground/80">{a.testo}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
