import { createClient } from "@/lib/supabase/server";
import { AddPlaceForm } from "./add-place-form";
import { LuoghiList } from "./luoghi-list";

export default async function LuoghiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: luoghi } = await supabase
    .from("luoghi")
    .select("id, nome, categoria, indirizzo, citta, nota, lat, lng, google_place_id, foto_url")
    .eq("viaggio_id", id)
    .order("created_at", { ascending: true });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <AddPlaceForm viaggioId={id} />
      <LuoghiList luoghi={luoghi ?? []} viaggioId={id} />
    </main>
  );
}
