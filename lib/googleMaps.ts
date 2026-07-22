import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let initialized = false;

function ensureInitialized() {
  if (!initialized) {
    setOptions({
      key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      v: "weekly",
    });
    initialized = true;
  }
}

export function loadPlacesLibrary() {
  ensureInitialized();
  return importLibrary("places");
}

export function loadMapsLibrary() {
  ensureInitialized();
  return importLibrary("maps");
}

export function loadMarkerLibrary() {
  ensureInitialized();
  return importLibrary("marker");
}
