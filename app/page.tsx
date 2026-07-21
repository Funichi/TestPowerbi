import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/viaggi");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <h1 className="max-w-md text-3xl font-semibold tracking-tight text-foreground">
        Il tuo diario di viaggio e itinerario, in un&apos;unica app
      </h1>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Inizia
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          Accedi
        </Link>
      </div>
    </div>
  );
}
