"""Stimometro: il motore deve dare esattamente i valori attesi dei casi di test (specifica, capitolo 11)."""
import copy
from decimal import ROUND_HALF_UP, Decimal

import pytest

from core.stime_catalogo import catalogo_default, stima_nuova
from core.stime_motore import arrotonda, calcola, in_json


def g(x):
    """Giornate attese, scritte come nella specifica ("23,0")."""
    return Decimal(str(x).replace(",", "."))


def eur(x):
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def r3(x):
    """Come Excel e come la specifica: la metà si arrotonda in su (1,6625 -> 1,663), non al pari come round() di Python."""
    return x.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def pct2(x):
    return (x * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def riga(tipo, etichetta, q=None, mix=None, be=None, fe=None, contesto="progetto"):
    return {"contesto": contesto, "tipo": tipo, "etichetta": etichetta, "quantita": q, "mix": mix, "gg_be": be, "gg_fe": fe}


def per_modulo(res, codice):
    return next(m for m in res["progetto"]["moduli"] if m["codice"] == codice)


def blocchi(res):
    return {k: (v["BE"], v["FE"], v["tot"], v["peso"]) for k, v in res["progetto"]["blocchi"].items()}


# ------------------------------------------------------------------ TC1

def tc1():
    s = stima_nuova()
    s["righe"] = [
        riga("STG.FLUSSO", "Sorgente 1", 35),
        riga("DWH.OGGETTO", "Modello 1", 80),
        riga("DM.OGGETTO", "Data Platform", 100),
        riga("REP.REPORT", "Data Platform", 50),
        riga("MIG.STORICO", "Dato storico", 20),
        riga("ARC.DISEGNO", "Disegno", be=5, fe=0),
        riga("ARC.AMBIENTE", "Ambienti", 3),
    ]
    s["prezzo_obiettivo"] = 750000
    s["durata_mesi"] = 10
    s["am"] = {"modalita": "manuale", "manuale": {"BE": {"gg_mese": 20, "mesi": 12}, "FE": {"gg_mese": 20, "mesi": 12}}}
    return s


def test_tc1_moduli_e_caso_limite_di_arrotondamento():
    res = calcola(tc1())
    attesi = {  # Impl BE, Impl FE, Analisi BE/FE, Disegno BE/FE
        "STG": ("23,0", "0,0", "1,5", "0,0", "1,5", "0,0"),
        "DWH": ("380,0", "0,0", "23,0", "0,0", "23,0", "0,0"),
        "DM": ("0,0", "112,5", "0,0", "7,0", "0,0", "7,0"),        # 112,5 × 6% = 6,75 -> 7,0
        "REP": ("0,0", "420,0", "0,0", "25,0", "0,0", "25,0"),
        "MIG": ("20,0", "0,0", "1,0", "0,0", "1,0", "0,0"),
        "ARC": ("14,0", "0,0", "0,0", "0,0", "0,0", "0,0"),
    }
    for c, v in attesi.items():
        m = per_modulo(res, c)
        assert (m["impl"]["BE"], m["impl"]["FE"], m["analisi"]["BE"], m["analisi"]["FE"], m["disegno"]["BE"], m["disegno"]["FE"]) == tuple(map(g, v)), c
    r0 = res["progetto"]["righe"][0]
    assert r0["n"] == [g("12,25"), g("14"), g("8,75")] and r0["gg_grezzi"] == g("23,1875")      # esempio del §4.2


def test_tc1_sicurezza_fasi_blocchi_e_totali():
    p = calcola(tc1())["progetto"]
    assert p["sicurezza"]["S"] == g("19,11") and (p["sicurezza"]["BE"], p["sicurezza"]["FE"]) == (g("9,5"), g("9,5"))
    assert p["B"] == g("994,5")
    fasi = {k: (v["BE"], v["FE"]) for k, v in p["fasi"].items()}
    assert fasi == {"KO": (g(1), g(1)), "SIT": (g(36), g(4)), "UAT": (g(12), g("47,5")), "DOC": (g(10), g(10)),
                    "DEP": (g("2,5"), g("2,5")), "PGL": (g(10), g(10))}
    b = blocchi({"progetto": p})
    attesi = {"Analisi": ("26,5", "33,0", "59,5", "4,61"), "Disegno": ("25,5", "32,0", "57,5", "4,46"),
              "Architettura": ("14,0", "0,0", "14,0", "1,09"), "Implementazione": ("442,5", "552,0", "994,5", "77,09"),
              "Training": ("10,0", "10,0", "20,0", "1,55"), "Test": ("58,0", "61,5", "119,5", "9,26"), "Deploy": ("12,5", "12,5", "25,0", "1,94")}
    for k, (be, fe, tot, peso) in attesi.items():
        assert b[k][:3] == (g(be), g(fe), g(tot)), k
        assert pct2(b[k][3]) == g(peso), k
    assert sum(v[3] for v in b.values()) == 1                                      # i pesi sommano al 100% (non al 111% del file originale)
    assert (p["TP"]["BE"], p["TP"]["FE"], p["TP"]["tot"]) == (g(589), g(701), g(1290))
    assert p["PM"] == g(155) and pct2(p["peso_pm"]) == g("12,02")
    assert (p["contingency"]["BE"], p["contingency"]["FE"], p["contingency"]["tot"]) == (g(59), g(70), g(129))
    assert p["totale"] == g(1574)


def test_tc1_costi_prezzo_obiettivo_fte_e_am_manuale():
    res = calcola(tc1())
    p = res["progetto"]
    assert [eur(p["costi"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("217080.00"), g("258285.00"), g("72540.00"), g("547905.00")]
    assert eur(p["prezzo"]) == g("782721.43")
    assert eur(p["costo_medio"]) == g("348.10") and eur(p["prezzo_medio"]) == g("497.28")
    o = p["obiettivo"]
    assert pct2(o["margine"]) == g("26.95") and o["sotto_margine"] is True and eur(o["scostamento"]) == g("-32721.43")
    assert any(x["codice"] == "margine_risultante" and x["livello"] == "avviso" for x in res["messaggi"])
    f = p["fte"]
    assert [r3(f[t]) for t in ("BE", "FE", "PM", "tot")] == [g("3.240"), g("3.855"), g("0.775"), g("7.870")]
    am = res["am"]
    assert am["gg"] == g(480) and eur(am["costo"]) == g("160800.00") and eur(am["prezzo"]) == g("217297.30")
    assert res["export_bloccato"] is False


# ------------------------------------------------------------------ TC2

def tc2():
    snap = catalogo_default()
    next(m for m in snap["moduli"] if m["codice"] == "DQ")["pct_analisi"] = 0.03
    next(f for f in snap["fasi"] if f["codice"] == "UAT")["pct"] = 0.08
    snap["generali"]["margine_progetto"] = 0.28
    s = stima_nuova(snap)
    s["righe"] = [
        riga("CDC.FLUSSO", "Sorgenti IoT", 10),
        riga("DQ.REGOLA", "Regole anagrafiche", 80),
        riga("GOV.DOMINIO", "Domini", 3),
        riga("API.ENDPOINT", "Data product", 8),
        riga("MIG.REPORT", "Report legacy", 40, mix=[0.6, 0.3, 0.1]),
        riga("MIG.STORICO", "Storico 5 anni", 30),
        riga("ARC.DISEGNO", "Disegno", be=8, fe=2),
        riga("ARC.AMBIENTE", "Ambienti", 2),
        riga("ARC.PIPELINE", "Pipeline", 4),
    ]
    s["voci_corpo"] = []                                   # la voce predefinita "Altre attività" è stata eliminata
    s["training_be"], s["training_fe"] = 5, 5
    s["durata_mesi"] = 6
    s["am"] = {"modalita": "driver", "driver": {"fonte": "progetto", "servizio": "H12", "anni": 3, "evolutiva": 50, "presa": False}}
    return s


def test_tc2_righe_moduli_e_fasi():
    p = calcola(tc2())["progetto"]
    righe = {r["etichetta"]: (r["BE"], r["FE"]) for r in p["righe"]}
    assert righe == {"Sorgenti IoT": (g(20), g(0)), "Regole anagrafiche": (g(42), g(0)), "Domini": (g(11), g("4,5")),
                     "Data product": (g(21), g(0)), "Report legacy": (g(0), g(64)), "Storico 5 anni": (g(30), g(0)),
                     "Disegno": (g(8), g(2)), "Ambienti": (g(6), g(0)), "Pipeline": (g(8), g(0))}
    attesi = {"CDC": ("1,0", "0,0", "1,0", "0,0"), "DQ": ("1,5", "0,0", "2,5", "0,0"), "GOV": ("0,5", "0,5", "0,5", "0,5"),
              "API": ("1,5", "0,0", "1,5", "0,0"), "MIG": ("2,0", "4,0", "2,0", "4,0"), "ARC": ("0,0", "0,0", "0,0", "0,0")}
    for c, v in attesi.items():
        m = per_modulo({"progetto": p}, c)
        assert (m["analisi"]["BE"], m["analisi"]["FE"], m["disegno"]["BE"], m["disegno"]["FE"]) == tuple(map(g, v)), c
    assert p["sicurezza"]["S"] == g("3,85") and (p["sicurezza"]["BE"], p["sicurezza"]["FE"]) == (g(2), g(2))
    assert p["B"] == g("196,5")
    assert p["fasi"]["KO"]["X"] == g("0,393") and (p["fasi"]["KO"]["BE"], p["fasi"]["KO"]["FE"]) == (0, 0)     # arrotondato a zero
    fasi = {k: (v["BE"], v["FE"]) for k, v in p["fasi"].items() if k != "KO"}
    assert fasi == {"SIT": (g(7), g(1)), "UAT": (g(3), g("12,5")), "DOC": (g(2), g(2)), "DEP": (g("0,5"), g("0,5")), "PGL": (g(2), g(2))}


def test_tc2_blocchi_totali_e_costi():
    p = calcola(tc2())["progetto"]
    b = blocchi({"progetto": p})
    attesi = {"Analisi": ("6,5", "4,5", "11,0", "3,85"), "Disegno": ("7,5", "4,5", "12,0", "4,20"),
              "Architettura": ("22,0", "2,0", "24,0", "8,39"), "Implementazione": ("126,0", "70,5", "196,5", "68,71"),
              "Training": ("5,0", "5,0", "10,0", "3,50"), "Test": ("12,0", "15,5", "27,5", "9,62"), "Deploy": ("2,5", "2,5", "5,0", "1,75")}
    for k, (be, fe, tot, peso) in attesi.items():
        assert b[k][:3] == (g(be), g(fe), g(tot)), k
        assert pct2(b[k][3]) == g(peso), k
    assert (p["TP"]["BE"], p["TP"]["FE"], p["TP"]["tot"]) == (g("181,5"), g("104,5"), g(286))
    assert p["PM"] == g("34,5")
    assert (p["contingency"]["BE"], p["contingency"]["FE"], p["contingency"]["tot"]) == (g(18), g("10,5"), g("28,5"))
    assert p["totale"] == g(349)
    assert [eur(p["costi"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("66832.50"), g("38525.00"), g("16146.00"), g("121503.50")]
    assert eur(p["prezzo"]) == g("168754.86")
    assert [r3(p["fte"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("1.663"), g("0.958"), g("0.288"), g("2.908")]


def test_tc2_am_da_driver():
    am = calcola(tc2())["am"]
    assert (am["beq"]["BE"], am["beq"]["FE"], am["beq"]["tot"]) == (g(126), g("70,5"), g("196,5"))
    assert pct2(am["quota"]["BE"]) == g("64.12")
    attesi = [  # correttiva BE/FE, evolutiva BE/FE, gg BE/FE/tot, costo, prezzo, mensile, FTE
        ("22,5", "12,5", "32,0", "18,0", "54,5", "30,5", "85,0", "28475.00", "38479.73", "3206.64", "0.354"),
        ("20,5", "11,5", "32,0", "18,0", "52,5", "29,5", "82,0", "27470.00", "37121.62", "3093.47", "0.342"),
        ("18,5", "10,5", "32,0", "18,0", "50,5", "28,5", "79,0", "26465.00", "35763.51", "2980.29", "0.329"),
    ]
    for a, v in zip(am["anni"], attesi):
        got = (a["correttiva"]["BE"], a["correttiva"]["FE"], a["evolutiva"]["BE"], a["evolutiva"]["FE"],
               a["gg"]["BE"], a["gg"]["FE"], a["gg"]["tot"], eur(a["costo"]), eur(a["prezzo"]), eur(a["mensile"]), r3(a["fte"]))
        assert got == tuple(map(g, v)), a["anno"]
        assert a["presa"] == {"BE": 0, "FE": 0}
    assert am["gg"] == g(246) and eur(am["costo"]) == g("82410.00") and eur(am["prezzo"]) == g("111364.86")


# ------------------------------------------------------------------ TC3

def tc3():
    s = stima_nuova()
    s["voci_corpo"] = []
    s["training_be"], s["training_fe"] = 0, 0
    s["righe"] = [riga("STG.FLUSSO", "Staging", 120, contesto="am_esercizio"),
                  riga("DWH.OGGETTO", "DWH", 60, contesto="am_esercizio"),
                  riga("REP.REPORT", "Report", 30, contesto="am_esercizio")]
    s["am"] = {"modalita": "driver", "driver": {"fonte": "esercizio", "servizio": "H24", "anni": 2, "evolutiva": 0, "presa": True}}
    return s


def test_tc3_progetto_vuoto_senza_divisioni_per_zero():
    res = calcola(tc3())
    p = res["progetto"]
    assert p["TP"]["tot"] == 0 and p["PM"] == 0 and p["contingency"]["tot"] == 0 and p["costi"]["tot"] == 0 and p["prezzo"] == 0
    assert all(b["peso"] is None for b in p["blocchi"].values()) and p["peso_pm"] is None     # pesi "n/d"
    assert p["fte"] is None and p["costo_medio"] is None
    assert not [x for x in res["messaggi"] if x["livello"] == "errore"]
    assert any(x["codice"] == "durata" and x["livello"] == "info" for x in res["messaggi"])
    assert p["righe"] == []                                                       # le righe in esercizio non entrano nel progetto


def test_tc3_am_su_oggetti_in_esercizio():
    am = calcola(tc3())["am"]
    righe = {r["etichetta"]: (r["BE"], r["FE"]) for r in am["righe"]}
    assert righe == {"Staging": (g("79,5"), g(0)), "DWH": (g(285), g(0)), "Report": (g(0), g(252))}
    assert (am["beq"]["BE"], am["beq"]["FE"], am["beq"]["tot"]) == (g("364,5"), g(252), g("616,5"))
    attesi = [  # correttiva BE/FE, presa BE/FE, gg BE/FE/tot, costo, prezzo, mensile, FTE
        ("82,0", "56,5", "11,0", "7,5", "93,0", "64,0", "157,0", "52595.00", "71074.32", "5922.86", "0.654"),
        ("74,0", "51,0", "0", "0", "74,0", "51,0", "125,0", "41875.00", "56587.84", "4715.65", "0.521"),
    ]
    for a, v in zip(am["anni"], attesi):
        got = (a["correttiva"]["BE"], a["correttiva"]["FE"], a["presa"]["BE"], a["presa"]["FE"],
               a["gg"]["BE"], a["gg"]["FE"], a["gg"]["tot"], eur(a["costo"]), eur(a["prezzo"]), eur(a["mensile"]), r3(a["fte"]))
        assert got == tuple(map(g, v)), a["anno"]
    assert am["gg"] == g(282) and eur(am["costo"]) == g("94470.00") and eur(am["prezzo"]) == g("127662.16")


# ------------------------------------------------------------------ regole generali e validazioni

@pytest.mark.parametrize("x,atteso", [("6.75", "7.0"), ("6.7499999999", "7.0"), ("6.74", "6.5"), ("0.25", "0.5"), ("0.2", "0.0"),
                                       ("23.1875", "23.0"), ("0.393", "0.5"), (0.1 + 0.2, "0.5"), ("0", "0")])
def test_arrotondamento_a_mezza_giornata(x, atteso):
    assert arrotonda(x, Decimal("0.5")) == Decimal(atteso)


def test_il_motore_non_modifica_l_ingresso_e_usa_solo_lo_snapshot():
    s = tc1()
    prima = copy.deepcopy(s)
    calcola(s)
    assert s == prima
    s2 = tc1()
    next(t for t in s2["snapshot"]["team"] if t["codice"] == "BE")["costo"] = 400      # lo snapshot della stima, non il catalogo
    assert calcola(s2)["progetto"]["costi"]["BE"] == (g(589) + g(59)) * 400


def test_validazioni_bloccano_l_export_ma_non_il_calcolo():
    s = tc1()
    s["righe"][0]["mix"] = [0.5, 0.3, 0.1]                                         # 90%
    res = calcola(s)
    assert res["export_bloccato"] is True and any(x["codice"] == "mix_riga" for x in res["messaggi"])
    s = tc1()
    next(f for f in s["snapshot"]["fasi"] if f["codice"] == "SIT")["pct_be"] = 0.8   # 80 + 10
    assert any(x["codice"] == "ripartizione_fase" for x in calcola(s)["messaggi"])
    s = tc1()
    s["snapshot"]["generali"]["margine_progetto"] = 1
    res = calcola(s)
    assert res["progetto"]["prezzo"] is None and res["export_bloccato"] is True
    s = tc1()
    next(f for f in s["snapshot"]["fasi"] if f["codice"] == "UAT")["max"] = 0.05     # intervallo del catalogo: solo avviso
    res = calcola(s)
    assert any(x["codice"] == "pct_fuori_intervallo" for x in res["messaggi"]) and res["export_bloccato"] is False


def test_am_da_driver_con_build_zero_e_risultati_in_json():
    s = stima_nuova()
    s["voci_corpo"] = []
    s["am"] = {"modalita": "driver", "driver": {"fonte": "esercizio", "servizio": "H8", "anni": 1, "evolutiva": 10}}
    res = calcola(s)
    assert res["am"]["calcolabile"] is False and any(x["codice"] == "beq_zero" for x in res["messaggi"])
    j = in_json(calcola(tc1()))
    assert j["progetto"]["TP"]["tot"] == 1290.0 and j["progetto"]["blocchi"]["Analisi"]["peso"] > 0
