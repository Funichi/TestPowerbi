"use client";

import { useEffect, useRef } from "react";
import { loadPlacesLibrary } from "@/lib/googleMaps";

export type SelectedPlace = {
  nome: string;
  indirizzo: string;
  lat: number;
  lng: number;
  googlePlaceId: string;
};

export function PlaceAutocompleteInput({
  onPlaceSelected,
  placeholder = "Cerca un luogo su Google Maps",
  className,
}: {
  onPlaceSelected: (place: SelectedPlace) => void;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const callbackRef = useRef(onPlaceSelected);

  useEffect(() => {
    callbackRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  useEffect(() => {
    let listener: google.maps.MapsEventListener | undefined;
    let cancelled = false;

    loadPlacesLibrary().then((places) => {
      if (cancelled || !inputRef.current) return;

      const autocomplete = new places.Autocomplete(inputRef.current, {
        fields: ["place_id", "name", "formatted_address", "geometry"],
      });

      listener = autocomplete.addListener("place_changed", () => {
        const result = autocomplete.getPlace();
        if (!result.geometry?.location) return;
        callbackRef.current({
          nome: result.name ?? "",
          indirizzo: result.formatted_address ?? "",
          lat: result.geometry.location.lat(),
          lng: result.geometry.location.lng(),
          googlePlaceId: result.place_id ?? "",
        });
      });
    });

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={placeholder}
      className={
        className ??
        "rounded-md border border-black/[.08] bg-white px-3 py-2 text-zinc-950 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
      }
    />
  );
}
