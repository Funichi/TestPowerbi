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
    <nav className="flex gap-1 border-b border-line px-6">
      {tabs.map((tab) => {
        const attivo = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              attivo
                ? "border-primary text-primary"
                : "border-transparent text-foreground/50 hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
