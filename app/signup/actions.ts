"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(_prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) {
    return { error: "Non è stato possibile completare la registrazione. Riprova." };
  }

  if (!data.session) {
    return {
      error: null,
      info: "Registrazione ricevuta! Controlla la tua email per confermare l'account prima di accedere.",
    };
  }

  redirect("/viaggi");
}
