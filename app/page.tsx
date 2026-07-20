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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 text-center dark:bg-black">
      <h1 className="max-w-md text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Il tuo diario di viaggio e itinerario, in un&apos;unica app
      </h1>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Inizia
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
        >
          Accedi
        </Link>
      </div>
    </div>
  );
}
