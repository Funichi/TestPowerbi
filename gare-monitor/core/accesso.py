"""Sicurezza dell'accesso da altre reti: codice a due fattori (TOTP, RFC 6238), codici di recupero, blocco dei tentativi, registro degli accessi.
Solo libreria standard (più werkzeug per gli hash); nessun servizio esterno."""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import quote

from werkzeug.security import check_password_hash, generate_password_hash

EMITTENTE = "Gare e Offerte"
PASSO = 30                                         # secondi di validità di un codice
ALFABETO_RECUPERO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"        # senza caratteri ambigui (0/O, 1/I)
# blocco globale dopo errori consecutivi (qualsiasi indirizzo: l'app ha un solo utente): (errori, secondi)
SCAGLIONI_BLOCCO = [(20, 7200), (15, 1800), (10, 300), (5, 60)]


# ------------------------------------------------------------------ TOTP
def nuovo_segreto():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(segreto, contatore, cifre=6):
    chiave = base64.b32decode(segreto.upper() + "=" * (-len(segreto) % 8))
    d = hmac.new(chiave, struct.pack(">Q", contatore), hashlib.sha1).digest()
    o = d[-1] & 15
    return f"{(struct.unpack('>I', d[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** cifre:0{cifre}d}"


def codice_totp(segreto, t=None, cifre=6):
    return _hotp(segreto, int((time.time() if t is None else t) // PASSO), cifre)


def verifica_totp(segreto, codice, t=None, ultimo=0, finestra=1):
    """Restituisce il contatore del passo che combacia (da salvare come "ultimo usato") oppure None.
    Un codice già usato (contatore <= ultimo) non vale una seconda volta."""
    codice = "".join(ch for ch in str(codice or "") if ch.isdigit())
    if len(codice) != 6:
        return None
    adesso = int((time.time() if t is None else t) // PASSO)
    for c in range(adesso - finestra, adesso + finestra + 1):
        if c > ultimo and hmac.compare_digest(_hotp(segreto, c), codice):
            return c
    return None


def uri_otpauth(segreto, nome="utente"):
    return f"otpauth://totp/{quote(EMITTENTE)}:{quote(nome)}?secret={segreto}&issuer={quote(EMITTENTE)}&digits=6&period={PASSO}"


def qr_svg(testo):
    """QR in SVG (libreria segno); None se non disponibile: in quel caso si inserisce la chiave a mano."""
    try:
        import segno
        return segno.make(testo, error="m").svg_inline(scale=5, border=2, dark="#000000", light="#ffffff")
    except Exception:
        return None


# ------------------------------------------------------------------ codici di recupero (monouso)
def nuovi_codici_recupero(n=8):
    plain = ["".join(secrets.choice(ALFABETO_RECUPERO) for _ in range(8)) for _ in range(n)]
    return [c[:4] + "-" + c[4:] for c in plain]


def hash_codici(codici):
    return [generate_password_hash(c.replace("-", ""), method="pbkdf2:sha256:20000") for c in codici]


def usa_codice_recupero(hashes, inserito):
    """(valido, elenco_aggiornato): il codice usato sparisce dall'elenco."""
    x = "".join(ch for ch in str(inserito or "").upper() if ch.isalnum())
    if len(x) != 8:
        return False, list(hashes)
    for i, h in enumerate(hashes):
        if check_password_hash(h, x):
            return True, hashes[:i] + hashes[i + 1:]
    return False, list(hashes)


# ------------------------------------------------------------------ blocco dei tentativi
class Blocco:
    """Errori consecutivi di accesso: oltre le soglie l'accesso si chiude per un tempo crescente.
    Non dipende dall'indirizzo (l'intestazione X-Forwarded-For si può falsificare); un accesso riuscito azzera il conteggio."""

    def __init__(self):
        self.errori = 0
        self.fino = 0.0

    def secondi_residui(self, ora=None):
        resto = self.fino - (time.time() if ora is None else ora)
        return int(resto) + 1 if resto > 0 else 0

    def errore(self, ora=None):
        ora = time.time() if ora is None else ora
        self.errori += 1
        for soglia, secondi in SCAGLIONI_BLOCCO:               # da 5 errori in poi ogni errore chiude l'accesso, per un tempo che cresce
            if self.errori >= soglia:
                self.fino = ora + secondi
                break
        return self.fino

    def riuscito(self):
        self.errori = 0
        self.fino = 0.0


def ip_cliente(headers, remote_addr):
    """Indirizzo del client: l'ultimo valore di X-Forwarded-For (quello aggiunto dal proxy più vicino), mai il primo (lo scrive il client)."""
    xff = headers.get("X-Forwarded-For", "")
    voci = [v.strip() for v in xff.split(",") if v.strip()]
    return voci[-1] if voci else (remote_addr or "")


# ------------------------------------------------------------------ registro degli accessi
MAX_RIGHE = 200


def registra(percorso, evento, ip, ora=None):
    riga = json.dumps({"t": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() if ora is None else ora)), "evento": evento, "ip": ip}, ensure_ascii=False)
    try:
        try:
            with open(percorso, encoding="utf-8") as f:
                righe = f.read().splitlines()
        except OSError:
            righe = []
        righe.append(riga)
        with open(percorso, "w", encoding="utf-8") as f:
            f.write("\n".join(righe[-MAX_RIGHE:]) + "\n")
    except OSError:
        pass                                           # il registro non deve mai impedire l'accesso


def ultimi(percorso, n=30):
    try:
        with open(percorso, encoding="utf-8") as f:
            righe = f.read().splitlines()
    except OSError:
        return []
    out = []
    for r in reversed(righe[-n:]):
        try:
            out.append(json.loads(r))
        except ValueError:
            continue
    return out
