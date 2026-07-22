"use client";

import { useEffect, useRef } from "react";
import { loadMapsLibrary, loadMarkerLibrary, loadRoutesLibrary } from "@/lib/googleMaps";

export type MapStop = {
  lat: number;
  lng: number;
  nome: string;
};

function haDimensioniValide(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function aspettaDimensioni(el: HTMLElement): Promise<void> {
  if (haDimensioniValide(el)) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      if (haDimensioniValide(el)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(el);
  });
}

export function RouteMap({ stops, className }: { stops: MapStop[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    const markers: google.maps.Marker[] = [];
    let directionsRenderer: google.maps.DirectionsRenderer | undefined;
    let polyline: google.maps.Polyline | undefined;

    Promise.all([loadMapsLibrary(), loadMarkerLibrary(), loadRoutesLibrary()])
      .then(async ([mapsLib, markerLib, routesLib]) => {
        if (cancelled || !containerRef.current || stops.length === 0) return;

        // Se il contenitore non ha ancora una dimensione reale (layout
        // flessibile non ancora stabile, tipico su mobile), la mappa di
        // Google può restare vuota se creata troppo presto: si aspetta che
        // abbia una larghezza/altezza misurabile prima di crearla.
        await aspettaDimensioni(containerRef.current);
        if (cancelled || !containerRef.current) return;

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

        const disegnaLineaRetta = () => {
          polyline = new mapsLib.Polyline({
            map,
            path: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
            strokeColor: "#111827",
            strokeOpacity: 0.8,
            strokeWeight: 3,
          });
        };

        if (stops.length >= 2) {
          try {
            const directionsService = new routesLib.DirectionsService();
            const risultato = await directionsService.route({
              origin: { lat: stops[0].lat, lng: stops[0].lng },
              destination: {
                lat: stops[stops.length - 1].lat,
                lng: stops[stops.length - 1].lng,
              },
              waypoints: stops.slice(1, -1).map((stop) => ({
                location: { lat: stop.lat, lng: stop.lng },
                stopover: true,
              })),
              // Rispetta l'ordine scelto dall'utente nell'itinerario: non
              // lasciare che Google riordini le tappe per "ottimizzare".
              optimizeWaypoints: false,
              travelMode: "DRIVING" as google.maps.TravelModeString,
            });

            if (cancelled) return;

            directionsRenderer = new routesLib.DirectionsRenderer({
              map,
              directions: risultato,
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: "#111827",
                strokeOpacity: 0.8,
                strokeWeight: 4,
              },
            });
          } catch {
            // Nessun percorso stradale disponibile (es. tappe su isole
            // diverse, o troppo lontane): mostra almeno la linea retta.
            if (!cancelled) disegnaLineaRetta();
          }
        }

        resizeObserver = new ResizeObserver(() => {
          google.maps.event.trigger(map, "resize");
        });
        resizeObserver.observe(containerRef.current);
      })
      .catch((err) => {
        if (cancelled || !containerRef.current) return;
        const messaggio = err instanceof Error ? err.message : String(err);
        containerRef.current.textContent = `Errore nel caricamento della mappa: ${messaggio}`;
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      markers.forEach((marker) => marker.setMap(null));
      directionsRenderer?.setMap(null);
      polyline?.setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stops)]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-64 w-full rounded-lg border border-line"}
    />
  );
}
