"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addStop(_prevState: unknown, formData: FormData) {
  const viaggioId = String(formData.get("viaggio_id") ?? "");
  const luogoId = String(formData.get("luogo_id") ?? "");
  const giorno = Number(formData.get("giorno"));

  if (!luogoId) {
    return { error: "Seleziona un luogo da aggiungere all'itinerario." };
  }
  if (!Number.isInteger(giorno) || giorno < 1) {
    return { error: "Indica un numero di giorno valido (1, 2, 3…)." };
  }

  const supabase = await createClient();

  const { data: ultimaTappa } = await supabase
    .from("tappe_itinerario")
    .select("posizione")
    .eq("viaggio_id", viaggioId)
    .eq("giorno", giorno)
    .order("posizione", { ascending: false })
    .limit(1)
    .maybeSingle();

  const posizione = (ultimaTappa?.posizione ?? 0) + 1;

  const { error } = await supabase.from("tappe_itinerario").insert({
    viaggio_id: viaggioId,
    luogo_id: luogoId,
    giorno,
    posizione,
  });

  if (error) {
    return { error: "Non è stato possibile aggiungere la tappa. Riprova." };
  }

  revalidatePath(`/viaggi/${viaggioId}`);
  return { error: null };
}

export async function removeStop(id: string, viaggioId: string) {
  const supabase = await createClient();
  await supabase.from("tappe_itinerario").delete().eq("id", id);
  revalidatePath(`/viaggi/${viaggioId}`);
}

export async function moveStop(id: string, viaggioId: string, direction: "up" | "down") {
  const supabase = await createClient();

  const { data: tappa } = await supabase
    .from("tappe_itinerario")
    .select("id, giorno, posizione")
    .eq("id", id)
    .single();

  if (!tappa) return;

  let vicinaQuery = supabase
    .from("tappe_itinerario")
    .select("id, posizione")
    .eq("viaggio_id", viaggioId)
    .eq("giorno", tappa.giorno);

  vicinaQuery =
    direction === "up"
      ? vicinaQuery.lt("posizione", tappa.posizione).order("posizione", { ascending: false })
      : vicinaQuery.gt("posizione", tappa.posizione).order("posizione", { ascending: true });

  const { data: vicina } = await vicinaQuery.limit(1).maybeSingle();

  if (!vicina) return;

  await supabase.from("tappe_itinerario").update({ posizione: vicina.posizione }).eq("id", tappa.id);
  await supabase.from("tappe_itinerario").update({ posizione: tappa.posizione }).eq("id", vicina.id);

  revalidatePath(`/viaggi/${viaggioId}`);
}
