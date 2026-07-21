"use client";

import { useEffect, useRef } from "react";
import { loadPlacesLibrary } from "@/lib/googleMaps";

export function PlaceDetailsCard({ placeId }: { placeId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let element: HTMLElement | undefined;

    loadPlacesLibrary().then((places) => {
      if (cancelled || !containerRef.current) return;

      const compact = new places.PlaceDetailsCompactElement();
      const request = new places.PlaceDetailsPlaceRequestElement({ place: placeId });
      const contentConfig = new places.PlaceContentConfigElement();
      contentConfig.appendChild(new places.PlaceStandardContentElement());
      compact.appendChild(request);
      compact.appendChild(contentConfig);

      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(compact);
      element = compact;
    });

    return () => {
      cancelled = true;
      element?.remove();
    };
  }, [placeId]);

  return <div ref={containerRef} className="overflow-hidden rounded-lg border border-line" />;
}
