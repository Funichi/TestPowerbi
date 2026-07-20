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
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          I miei viaggi
        </h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Esci
          </button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Ciao {user?.email}
        </p>

        <NewTripForm />

        {!viaggi || viaggi.length === 0 ? (
          <p className="text-center text-zinc-600 dark:text-zinc-400">
            Non hai ancora nessun viaggio. Creane uno con il modulo qui sopra.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {viaggi.map((viaggio) => (
              <li
                key={viaggio.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
              >
                <Link href={`/viaggi/${viaggio.id}/luoghi`} className="flex flex-1 flex-col">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">
                    {viaggio.nome}
                  </span>
                  {(viaggio.data_inizio || viaggio.data_fine) && (
                    <span className="text-sm text-zinc-500 dark:text-zinc-500">
                      {formatDate(viaggio.data_inizio)} – {formatDate(viaggio.data_fine)}
                    </span>
                  )}
                </Link>
                <form action={deleteTrip.bind(null, viaggio.id)}>
                  <button
                    type="submit"
                    className="rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
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
