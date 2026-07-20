"use client";

import { useEffect, useRef } from "react";
import { loadMapsLibrary, loadMarkerLibrary } from "@/lib/googleMaps";

export type MapStop = {
  lat: number;
  lng: number;
  nome: string;
};

export function RouteMap({ stops, className }: { stops: MapStop[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.Marker[] = [];

    Promise.all([loadMapsLibrary(), loadMarkerLibrary()]).then(([mapsLib, markerLib]) => {
      if (cancelled || !containerRef.current || stops.length === 0) return;

      const bounds = new google.maps.LatLngBounds();
      stops.forEach((stop) => bounds.extend({ lat: stop.lat, lng: stop.lng }));

      const map = new mapsLib.Map(containerRef.current, {
        center: bounds.getCenter(),
        zoom: 13,
      });
      map.fitBounds(bounds, 40);

      stops.forEach((stop, index) => {
        markers.push(
          new markerLib.Marker({
            map,
            position: { lat: stop.lat, lng: stop.lng },
            label: String(index + 1),
            title: stop.nome,
          }),
        );
      });

      new mapsLib.Polyline({
        map,
        path: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        strokeColor: "#111827",
        strokeOpacity: 0.8,
        strokeWeight: 3,
      });
    });

    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stops)]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-64 w-full rounded-lg border border-black/[.08] dark:border-white/[.145]"}
    />
  );
}
