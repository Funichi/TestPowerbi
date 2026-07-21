import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteTrip, logout } from "./actions";
import { NewTripForm } from "./new-trip-form";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("it-IT");
}

export default async function ViaggiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: viaggi } = await supabase
    .from("viaggi")
    .select("id, nome, data_inizio, data_fine")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">
          I miei viaggi
        </h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            Esci
          </button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <p className="text-sm text-foreground/50">
          Ciao {user?.email}
        </p>

        <NewTripForm />

        {!viaggi || viaggi.length === 0 ? (
          <p className="text-center text-foreground/70">
            Non hai ancora nessun viaggio. Creane uno con il modulo qui sopra.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {viaggi.map((viaggio) => (
              <li
                key={viaggio.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface p-4"
              >
                <Link href={`/viaggi/${viaggio.id}/luoghi`} className="flex flex-1 flex-col">
                  <span className="font-medium text-foreground">
                    {viaggio.nome}
                  </span>
                  {(viaggio.data_inizio || viaggio.data_fine) && (
                    <span className="text-sm text-foreground/50">
                      {formatDate(viaggio.data_inizio)} – {formatDate(viaggio.data_fine)}
                    </span>
                  )}
                </Link>
                <form action={deleteTrip.bind(null, viaggio.id)}>
                  <button
                    type="submit"
                    className="rounded-full border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
                  >
                    Elimina
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
