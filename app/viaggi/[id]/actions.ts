"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchWikipediaImage } from "@/lib/wikipedia";

const CATEGORIE = ["visitare", "mangiare", "dormire"] as const;

export async function deleteTripAndRedirect(id: string) {
  const supabase = await createClient();
  await supabase.from("viaggi").delete().eq("id", id);
  redirect("/viaggi");
}

export async function addPlace(_prevState: unknown, formData: FormData) {
  const viaggioId = String(formData.get("viaggio_id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "");
  const nota = String(formData.get("nota") ?? "").trim();
  const indirizzo = String(formData.get("indirizzo") ?? "");
  const citta = String(formData.get("citta") ?? "").trim();
  const lat = formData.get("lat");
  const lng = formData.get("lng");
  const googlePlaceId = String(formData.get("google_place_id") ?? "");

  if (!nome) {
    return { error: "Il nome del luogo è obbligatorio." };
  }
  if (!CATEGORIE.includes(categoria as (typeof CATEGORIE)[number])) {
    return { error: "Categoria non valida." };
  }
  if (!lat || !lng) {
    return { error: "Cerca il luogo e scegli un suggerimento dalla lista di Google Maps." };
  }

  // Foto solo per "da visitare": Wikipedia copre bene monumenti e attrazioni,
  // quasi mai ristoranti o hotel. È gratuita e non richiede nessuna chiave.
  const fotoUrl =
    categoria === "visitare" ? await fetchWikipediaImage(Number(lat), Number(lng)) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("luoghi").insert({
    viaggio_id: viaggioId,
    nome,
    categoria,
    nota: nota || null,
    indirizzo: indirizzo || null,
    citta: citta || null,
    lat: Number(lat),
    lng: Number(lng),
    google_place_id: googlePlaceId || null,
    foto_url: fotoUrl,
  });

  if (error) {
    return { error: "Non è stato possibile salvare il luogo. Riprova." };
  }

  revalidatePath(`/viaggi/${viaggioId}/luoghi`);
  revalidatePath(`/viaggi/${viaggioId}/itinerario`);
  return { error: null };
}

export async function updatePlace(id: string, viaggioId: string, formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "");
  const nota = String(formData.get("nota") ?? "").trim();

  if (!nome || !CATEGORIE.includes(categoria as (typeof CATEGORIE)[number])) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("luoghi")
    .update({ nome, categoria, nota: nota || null })
    .eq("id", id);

  revalidatePath(`/viaggi/${viaggioId}/luoghi`);
  revalidatePath(`/viaggi/${viaggioId}/itinerario`);
}

export async function deletePlace(id: string, viaggioId: string) {
  const supabase = await createClient();
  await supabase.from("luoghi").delete().eq("id", id);
  revalidatePath(`/viaggi/${viaggioId}/luoghi`);
  revalidatePath(`/viaggi/${viaggioId}/itinerario`);
}
