import sys
import time

from core import accesso
from test_app import client  # noqa: F401  (fixture)

RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"          # chiave di prova dell'RFC 6238 ("12345678901234567890")
REMOTO = {"environ_overrides": {"REMOTE_ADDR": "192.168.1.50"}}
PW = "una-password-lunga"


def test_totp_vettore_rfc_finestra_e_riuso():
    assert accesso._hotp(RFC, 59 // 30, 8) == "94287082"                       # vettore ufficiale RFC 6238
    assert accesso.codice_totp(RFC, 59) == "287082"
    assert accesso.verifica_totp(RFC, "287082", t=59) == 1
    assert accesso.verifica_totp(RFC, "287082", t=59 + 30) == 1                # un passo di tolleranza per l'orologio del telefono
    assert accesso.verifica_totp(RFC, "287082", t=59 + 90) is None             # troppo vecchio
    assert accesso.verifica_totp(RFC, "287082", t=59, ultimo=1) is None        # già usato: non vale due volte
    assert accesso.verifica_totp(RFC, "28708", t=59) is None and accesso.verifica_totp(RFC, "abcdef", t=59) is None
    assert accesso.verifica_totp(RFC, "287 082", t=59) == 1                    # gli spazi inseriti dall'app si ignorano


def test_codici_di_recupero_monouso():
    codici = accesso.nuovi_codici_recupero()
    assert len(codici) == 8 and all(len(c) == 9 and c[4] == "-" for c in codici)
    hashes = accesso.hash_codici(codici)
    ok, resto = accesso.usa_codice_recupero(hashes, codici[2].lower())          # minuscolo e con trattino va bene
    assert ok and len(resto) == 7
    assert accesso.usa_codice_recupero(resto, codici[2])[0] is False            # usato: sparito
    assert accesso.usa_codice_recupero(resto, "ZZZZ-ZZZZ")[0] is False


def test_blocco_cresce_e_si_azzera():
    b = accesso.Blocco()
    for _ in range(4):
        b.errore(1000)
    assert b.secondi_residui(1000) == 0
    b.errore(1000)
    assert b.secondi_residui(1000) == 61                                        # 5 errori: un minuto
    for _ in range(5):
        b.errore(1000)
    assert b.secondi_residui(1000) == 301                                       # 10 errori: cinque minuti; ogni errore dopo il quinto richiude
    assert b.secondi_residui(1000 + 400) == 0
    b.riuscito()
    assert b.errori == 0 and b.secondi_residui(1000) == 0


def test_indirizzo_del_client_non_si_fida_del_primo_valore():
    assert accesso.ip_cliente({"X-Forwarded-For": "6.6.6.6, 1.2.3.4"}, "127.0.0.1") == "1.2.3.4"
    assert accesso.ip_cliente({}, "10.0.0.1") == "10.0.0.1"


def test_registro_accessi_tiene_gli_ultimi(tmp_path):
    p = str(tmp_path / "accessi.log")
    for i in range(accesso.MAX_RIGHE + 20):
        accesso.registra(p, f"e{i}", "1.1.1.1")
    ult = accesso.ultimi(p, 3)
    assert [x["evento"] for x in ult] == [f"e{accesso.MAX_RIGHE + 19}", f"e{accesso.MAX_RIGHE + 18}", f"e{accesso.MAX_RIGHE + 17}"]
    assert len(open(p, encoding="utf-8").read().splitlines()) == accesso.MAX_RIGHE


def attiva_2fa(c):
    assert c.post("/api/password", json={"password": PW}).status_code == 200
    r = c.post("/api/2fa/avvia").get_json()
    assert r["uri"].startswith("otpauth://totp/") and r["segreto"] in r["uri"]
    a = c.post("/api/2fa/attiva", json={"codice": accesso.codice_totp(r["segreto"])}).get_json()
    return r["segreto"], a["codici_recupero"]


def test_login_in_due_passaggi(client, monkeypatch):  # noqa: F811
    c, x, tmp = client
    monkeypatch.setattr(time, "sleep", lambda s: None)
    assert c.post("/api/2fa/avvia").status_code == 400                           # senza password non si attiva
    segreto, recuperi = attiva_2fa(c)
    assert len(recuperi) == 8 and c.get("/api/state").get_json()["totp_on"] is True
    # solo la password non basta: nessuna sessione valida
    r = c.post("/login", data={"password": PW}, **REMOTO)
    assert r.status_code == 200 and "codice" in r.get_data(as_text=True).lower()
    assert c.get("/api/state", **REMOTO).status_code == 401
    assert c.post("/login", data={"codice": "000000"}, **REMOTO).status_code == 401
    assert c.get("/api/state", **REMOTO).status_code == 401
    # codice giusto del passo successivo (quello dell'attivazione è già stato usato)
    assert c.post("/login", data={"codice": accesso.codice_totp(segreto, time.time() + 30)}, **REMOTO).status_code == 302
    assert c.get("/api/state", **REMOTO).get_json()["local"] is False
    assert c.post("/api/2fa/disattiva", **REMOTO).status_code == 403             # le impostazioni di sicurezza solo dal PC
    assert c.get("/api/accessi", **REMOTO).status_code == 403
    eventi = [e["evento"] for e in c.get("/api/accessi").get_json()["accessi"]]
    assert "password errata" not in eventi and "codice errato" in eventi and "accesso" in eventi


def test_codice_gia_usato_e_recupero_monouso(client, monkeypatch):  # noqa: F811
    c, x, tmp = client
    monkeypatch.setattr(time, "sleep", lambda s: None)
    segreto, recuperi = attiva_2fa(c)
    buono = accesso.codice_totp(segreto, time.time() + 30)
    c.post("/login", data={"password": PW}, **REMOTO)
    assert c.post("/login", data={"codice": buono}, **REMOTO).status_code == 302
    c.get("/logout", **REMOTO)
    c.post("/login", data={"password": PW}, **REMOTO)
    assert c.post("/login", data={"codice": buono}, **REMOTO).status_code == 401  # lo stesso codice non vale due volte
    assert c.post("/login", data={"codice": recuperi[0]}, **REMOTO).status_code == 302
    c.get("/logout", **REMOTO)
    c.post("/login", data={"password": PW}, **REMOTO)
    assert c.post("/login", data={"codice": recuperi[0]}, **REMOTO).status_code == 401   # il codice di recupero è monouso
    assert c.get("/api/state").get_json()["recuperi_rimasti"] == 7


def test_disattivare_la_2fa_chiude_le_sessioni(client, monkeypatch):  # noqa: F811
    c, x, tmp = client                                                           # c = il PC; r = un altro dispositivo (cookie separati)
    r = sys.modules["app"].app.test_client()
    monkeypatch.setattr(time, "sleep", lambda s: None)
    segreto, _ = attiva_2fa(c)
    r.post("/login", data={"password": PW}, **REMOTO)
    r.post("/login", data={"codice": accesso.codice_totp(segreto, time.time() + 30)}, **REMOTO)
    assert r.get("/api/state", **REMOTO).status_code == 200
    assert c.post("/api/2fa/disattiva").status_code == 200
    assert r.get("/api/state", **REMOTO).status_code == 401                       # sessione chiusa
    assert r.post("/login", data={"password": PW}, **REMOTO).status_code == 302   # senza 2FA basta la password, come prima


def test_blocco_tentativi_non_aggirabile_con_indirizzi_falsi(client, monkeypatch):  # noqa: F811
    c, x, tmp = client
    monkeypatch.setattr(time, "sleep", lambda s: None)
    c.post("/api/password", json={"password": PW})
    for i in range(5):
        r = c.post("/login", data={"password": "sbagliata"}, headers={"X-Forwarded-For": f"9.9.9.{i}, 1.2.3.4"}, **REMOTO)
        assert r.status_code == 401
    r = c.post("/login", data={"password": PW}, headers={"X-Forwarded-For": "8.8.8.8, 5.6.7.8"}, **REMOTO)       # anche con la password giusta e un altro indirizzo
    assert r.status_code == 429
    assert c.get("/api/state", **REMOTO).status_code == 401
    sys.modules["app"]._blocco.fino = 0                                           # scaduto il minuto
    assert c.post("/login", data={"password": PW}, **REMOTO).status_code == 302


def test_durata_sessione_configurabile(client):  # noqa: F811
    c, x, tmp = client
    assert c.get("/api/state").get_json()["sessione_giorni"] == 7
    assert c.post("/api/password", json={"sessione_giorni": 0}).status_code == 400
    assert c.post("/api/password", json={"sessione_giorni": 30}).status_code == 200
    assert c.get("/api/state").get_json()["sessione_giorni"] == 30
