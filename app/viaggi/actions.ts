"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createTrip(_prevState: unknown, formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const dataInizio = String(formData.get("data_inizio") ?? "");
  const dataFine = String(formData.get("data_fine") ?? "");

  if (!nome) {
    return { error: "Il nome del viaggio è obbligatorio." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("viaggi").insert({
    nome,
    data_inizio: dataInizio || null,
    data_fine: dataFine || null,
    user_id: user!.id,
  });

  if (error) {
    return { error: "Non è stato possibile creare il viaggio. Riprova." };
  }

  revalidatePath("/viaggi");
  return { error: null };
}

export async function deleteTrip(id: string) {
  const supabase = await createClient();
  await supabase.from("viaggi").delete().eq("id", id);
  revalidatePath("/viaggi");
}
