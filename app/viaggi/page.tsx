import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

export default async function ViaggiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          I miei viaggi
        </h1>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Esci
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">
          Ciao {user?.email}! Non hai ancora nessun viaggio.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          La creazione dei viaggi arriva nella prossima funzionalità.
        </p>
      </main>
    </div>
  );
}
