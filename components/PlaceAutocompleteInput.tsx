"use client";

import { useEffect, useRef } from "react";
import { loadPlacesLibrary } from "@/lib/googleMaps";

export type SelectedPlace = {
  nome: string;
  indirizzo: string;
  citta: string | null;
  lat: number;
  lng: number;
  googlePlaceId: string;
};

function estraiCitta(addressComponents: google.maps.places.AddressComponent[] | undefined) {
  if (!addressComponents) return null;
  const componente =
    addressComponents.find((c) => c.types.includes("locality")) ??
    addressComponents.find((c) => c.types.includes("postal_town")) ??
    addressComponents.find((c) => c.types.includes("administrative_area_level_3"));
  return componente?.longText ?? null;
}

export function PlaceAutocompleteInput({
  onPlaceSelected,
  placeholder = "Cerca un luogo su Google Maps",
}: {
  onPlaceSelected: (place: SelectedPlace) => void;
  placeholder?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onPlaceSelected);

  useEffect(() => {
    callbackRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  useEffect(() => {
    let cancelled = false;
    let element: google.maps.places.PlaceAutocompleteElement | undefined;

    const handleSelect = async (event: google.maps.places.PlacePredictionSelectEvent) => {
      const place = event.placePrediction.toPlace();
      await place.fetchFields({
        fields: ["displayName", "formattedAddress", "addressComponents", "location", "id"],
      });
      if (!place.location) return;
      callbackRef.current({
        nome: place.displayName ?? "",
        indirizzo: place.formattedAddress ?? "",
        citta: estraiCitta(place.addressComponents),
        lat: place.location.lat(),
        lng: place.location.lng(),
        googlePlaceId: place.id,
      });
    };

    loadPlacesLibrary().then((places) => {
      if (cancelled || !containerRef.current) return;

      element = new places.PlaceAutocompleteElement();
      element.placeholder = placeholder;
      containerRef.current.appendChild(element);
      element.addEventListener("gmp-select", handleSelect);
    });

    return () => {
      cancelled = true;
      element?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} />;
}
