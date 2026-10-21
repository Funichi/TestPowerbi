"""Aggiornamento dell'app dall'ultima Release pubblicata su GitHub (repository privato: serve un token di sola lettura)."""
import json
import os
import urllib.error
import urllib.request

API = os.environ.get("GARE_GITHUB_API", "https://api.github.com")
DEFAULT_REPO = "Funichi/TestPowerbi"
TAG = "latest"
UA = {"User-Agent": "GareOfferte-updater", "X-GitHub-Api-Version": "2022-11-28"}


class UpdateError(Exception):
    pass


def current_version(base_dir):
    """Numero di build scritto da GitHub Actions in version.txt accanto all'app (None se non c'è: es. avvio da sorgente)."""
    try:
        with open(os.path.join(base_dir, "version.txt"), encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _open(url, token, accept="application/vnd.github+json", follow=True):
    h = {**UA, "Accept": accept}
    if token:
        h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=h)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        return opener.open(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and follow:
            # il file vero sta su un altro host (con link firmato): lì il token NON va inviato, altrimenti viene rifiutato
            return urllib.request.urlopen(urllib.request.Request(e.headers["Location"], headers=UA), timeout=300)
        if e.code in (401, 403):
            raise UpdateError("GitHub rifiuta il token: controlla che sia valido, non scaduto e con accesso in lettura a questo repository.") from e
        if e.code == 404:
            raise UpdateError("Nessuna versione trovata: o non è ancora stata pubblicata, oppure il token non ha accesso al repository (controlla anche il nome).") from e
        raise UpdateError(f"GitHub ha risposto con errore {e.code}.") from e
    except (urllib.error.URLError, OSError) as e:
        raise UpdateError(f"Connessione a GitHub non riuscita: {getattr(e, 'reason', e)}") from e


def latest(repo, token):
    """{'version': int|None, 'name': str, 'asset_url': str, 'size': int} dell'ultima Release."""
    if not token:
        raise UpdateError("Manca il token GitHub (Impostazioni > Aggiornamenti).")
    with _open(f"{API}/repos/{repo or DEFAULT_REPO}/releases/tags/{TAG}", token) as r:
        rel = json.load(r)
    asset = next((a for a in rel.get("assets", []) if a["name"].startswith("GareOfferte-") and a["name"].endswith(".zip")), None)
    if not asset:
        raise UpdateError("L'ultima versione non contiene il file dell'app.")
    try:
        ver = int(asset["name"][len("GareOfferte-"):-len(".zip")])
    except ValueError:
        ver = None
    return {"version": ver, "name": rel.get("name") or asset["name"], "asset_url": asset["url"], "size": asset.get("size", 0)}


def download(asset_url, token, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with _open(asset_url, token, accept="application/octet-stream") as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if os.path.getsize(dest) < 1000:
        raise UpdateError("Il file scaricato è incompleto.")
    return dest
