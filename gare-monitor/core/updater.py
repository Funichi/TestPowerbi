"""Aggiornamento dell'app dall'ultima Release pubblicata su GitHub (repository privato: serve un token di sola lettura)."""
import json
import os
import subprocess
import time
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


# ---------------------------------------------------------------- avvio dello script di sostituzione

def strategie_di_lancio(base_dir, zip_path, pid, script_ps1):
    """Modi per far partire lo script di aggiornamento, dal più affidabile: Windows non dice in anticipo quale funziona (job del processo, console, criteri del PC).
    Ogni voce è (nome, funzione che lancia)."""
    ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script_ps1, "-AppDir", base_dir, "-Zip", zip_path, "-WaitPid", str(pid)]
    out = os.path.join(base_dir, "update", "powershell.txt")

    def con_file(cmd, flags):
        with open(out, "a", encoding="utf-8", errors="replace") as o:
            subprocess.Popen(cmd, creationflags=flags, close_fds=True, stdout=o, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)

    def con_shell():
        # come un doppio clic su Aggiorna.bat in Esplora risorse (ShellExecute): il processo è del tutto indipendente dall'app, non muore con lei
        os.startfile(os.path.join(base_dir, "Aggiorna.bat"), arguments=f'"{zip_path}" {pid}', cwd=base_dir, show_cmd=0)
    return [("shell", con_shell),
            ("start", lambda: con_file(["cmd", "/c", "start", "", "/min"] + ps, 0x08000000)),                       # CREATE_NO_WINDOW
            ("distaccato", lambda: con_file(ps, 0x00000008 | 0x00000200 | 0x01000000)),                              # DETACHED | NEW_PROCESS_GROUP | BREAKAWAY_FROM_JOB
            ("distaccato2", lambda: con_file(ps, 0x00000008 | 0x00000200))]


def lancia(flag, strategie, attesa=8.0, log=None):
    """Prova le strategie in ordine finché lo script non crea il file-segnale `flag`. Ritorna il nome di quella riuscita, o None."""
    for nome, avvia in strategie:
        if os.path.exists(flag):
            os.remove(flag)
        try:
            avvia()
        except (OSError, TypeError, AttributeError) as e:
            if log:
                log(f"Lancio '{nome}' non riuscito: {e}")
            continue
        fine = time.time() + attesa
        while time.time() < fine:
            if os.path.exists(flag):
                if log:
                    log(f"Script di aggiornamento partito con il metodo '{nome}'.")
                return nome
            time.sleep(0.2)
        if log:
            log(f"Il metodo '{nome}' non ha fatto partire lo script entro {attesa:.0f} secondi.")
    return None
