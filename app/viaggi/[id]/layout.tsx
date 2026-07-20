import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteTripAndRedirect } from "./actions";
import { TabNav } from "./tab-nav";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("it-IT");
}

export default async function ViaggioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
      <TabNav viaggioId={viaggio.id} />
      {children}
    </div>
  );
}
