"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabNav({ viaggioId }: { viaggioId: string }) {
  const pathname = usePathname();

  const tabs = [
    { href: `/viaggi/${viaggioId}/luoghi`, label: "Luoghi" },
    { href: `/viaggi/${viaggioId}/itinerario`, label: "Itinerario" },
  ];

  return (
    <nav className="flex gap-1 border-b border-black/[.08] px-6 dark:border-white/[.145]">
      {tabs.map((tab) => {
        const attivo = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              attivo
                ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-950 dark:text-zinc-500 dark:hover:text-zinc-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
