type PaginaWikipedia = {
  thumbnail?: { source: string };
};

/**
 * Cerca una voce Wikipedia vicino alle coordinate date e ne restituisce la
 * miniatura, se esiste. Gratuito e senza chiave API: usato per le foto dei
 * luoghi "da visitare", che Wikipedia copre bene (a differenza di ristoranti
 * e hotel, quasi mai presenti).
 */
export async function fetchWikipediaImage(lat: number, lng: number): Promise<string | null> {
  try {
    const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=300&gslimit=1&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(5000) });
    if (!geoRes.ok) return null;

    const geoData = await geoRes.json();
    const title = geoData?.query?.geosearch?.[0]?.title;
    if (!title) return null;

    const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&pithumbsize=300&format=json`;
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return null;

    const imgData = await imgRes.json();
    const pages = imgData?.query?.pages ?? {};
    const pagina = Object.values(pages)[0] as PaginaWikipedia | undefined;
    return pagina?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}
