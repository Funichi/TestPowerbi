import type { SelectedPlace } from "./PlaceAutocompleteInput";

export function PlaceSummaryCard({ place }: { place: SelectedPlace }) {
  return (
    <div className="flex gap-3 overflow-hidden rounded-lg border border-line bg-surface p-3">
      {place.fotoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={place.fotoUrl}
          alt={place.nome}
          className="h-20 w-20 flex-shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{place.nome}</p>
        {place.tipo && <p className="text-xs text-foreground/50">{place.tipo}</p>}
        {place.rating != null && (
          <p className="text-sm text-foreground/70">
            ⭐ {place.rating.toFixed(1)}
            {place.numeroRecensioni != null && ` (${place.numeroRecensioni})`}
          </p>
        )}
        <p className="truncate text-xs text-foreground/50">{place.indirizzo}</p>
      </div>
    </div>
  );
}
