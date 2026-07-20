type PuntoMappa = {
  lat: number | null;
  lng: number | null;
  googlePlaceId?: string | null;
  nome?: string;
};

/** Link alla scheda del luogo su Google Maps (foto, valutazioni, orari…), utile per verificare che sia il posto giusto. */
export function googleMapsPlaceUrl({ lat, lng, googlePlaceId, nome }: PuntoMappa) {
  if (googlePlaceId) {
    const params = new URLSearchParams({
      api: "1",
      query: nome || `${lat},${lng}`,
      query_place_id: googlePlaceId,
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return null;
}

/** Link che avvia la navigazione verso il luogo su Google Maps. */
export function googleMapsDirectionsUrl({ lat, lng, googlePlaceId }: PuntoMappa) {
  if (lat == null || lng == null) return null;
  const params = new URLSearchParams({
    api: "1",
    destination: `${lat},${lng}`,
  });
  if (googlePlaceId) {
    params.set("destination_place_id", googlePlaceId);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
