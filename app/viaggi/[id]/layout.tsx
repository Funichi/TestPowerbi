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
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <Link href="/viaggi" className="text-sm text-foreground/50">
            ← I miei viaggi
          </Link>
          <h1 className="text-lg font-semibold text-foreground">
            {viaggio.nome}
          </h1>
          {(viaggio.data_inizio || viaggio.data_fine) && (
            <p className="text-sm text-foreground/50">
              {formatDate(viaggio.data_inizio)} – {formatDate(viaggio.data_fine)}
            </p>
          )}
        </div>
        <form action={deleteTripAndRedirect.bind(null, viaggio.id)}>
          <button
            type="submit"
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
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
