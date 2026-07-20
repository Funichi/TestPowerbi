"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function deleteTripAndRedirect(id: string) {
  const supabase = await createClient();
  await supabase.from("viaggi").delete().eq("id", id);
  redirect("/viaggi");
}
