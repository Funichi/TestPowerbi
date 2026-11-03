"""Stimometro: il motore deve dare esattamente i valori attesi dei casi di test (specifica, capitolo 11)."""
import copy
from decimal import ROUND_HALF_UP, Decimal

import pytest

from core.stime_catalogo import catalogo_default, stima_nuova
from core.stime_motore import arrotonda, calcola, in_json, normalizza


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


def blocchi(res):
    return {k: (v["BE"], v["FE"], v["tot"], v["peso"]) for k, v in res["progetto"]["blocchi"].items()}


# ------------------------------------------------------------------ TC1
# Adattato alle regole concordate dopo la specifica v1.0: niente modulo Architettura (in TC1 c'erano Disegno 5 BE e 3 Ambienti),
# analisi e disegno con una percentuale unica (6%) sull'implementazione di tutti i moduli, calcolata per team.

def tc1():
    s = stima_nuova()
    s["righe"] = [
        riga("STG.FLUSSO", "Sorgente 1", 35),
        riga("DWH.OGGETTO", "Modello 1", 80),
        riga("DM.OGGETTO", "Data Platform", 100),
        riga("REP.REPORT", "Data Platform", 50),
        riga("MIG.STORICO", "Dato storico", 20),
    ]
    # la sicurezza non è più una percentuale sui moduli: è un'attività a corpo (qui con le stesse giornate di prima, 2% di 955,5)
    s["voci_corpo"] = [{"nome": "Altre attività", "gg_be": 10, "gg_fe": 10}, {"nome": "Gestione della sicurezza del dato", "gg_be": 9.5, "gg_fe": 9.5}]
    s["prezzo_obiettivo"] = 750000
    s["durata_mesi"] = 10
    s["am"] = {"modalita": "manuale", "manuale": {"BE": {"gg_mese": 20, "mesi": 12}, "FE": {"gg_mese": 20, "mesi": 12}}}
    return s


def test_tc1_moduli_analisi_e_disegno_a_percentuale_unica():
    p = calcola(tc1())["progetto"]
    impl = {m["codice"]: (m["impl"]["BE"], m["impl"]["FE"]) for m in p["moduli"]}
    assert impl == {"STG": (g(23), g(0)), "DWH": (g(380), g(0)), "DM": (g(0), g("112,5")), "REP": (g(0), g(420)), "MIG": (g(20), g(0))}
    # analisi = R(Σ Impl BE × 6%) = R(25,38) = 25,5 · R(Σ Impl FE × 6%) = R(31,95) = 32,0; disegno uguale
    assert (p["fasi"]["ANA"]["BE"], p["fasi"]["ANA"]["FE"]) == (g("25,5"), g(32)) and (p["fasi"]["DIS"]["BE"], p["fasi"]["DIS"]["FE"]) == (g("25,5"), g(32))
    assert p["fasi"]["ANA"]["X"] == g("57,33")                                       # 955,5 × 6%
    r0 = p["righe"][0]
    assert r0["n"] == [g("12,25"), g("14"), g("8,75")] and r0["gg_grezzi"] == g("23,1875")      # esempio del §4.2


def test_tc1_sicurezza_fasi_blocchi_e_totali():
    p = calcola(tc1())["progetto"]
    assert p["sicurezza"]["S"] == 0 and [(v["BE"], v["FE"]) for v in p["voci_corpo"]] == [(g(10), g(10)), (g("9,5"), g("9,5"))]
    assert p["B"] == g("994,5")
    fasi = {k: (v["BE"], v["FE"]) for k, v in p["fasi"].items() if k not in ("ANA", "DIS")}
    assert fasi == {"KO": (g(1), g(1)), "SIT": (g(36), g(4)), "UAT": (g(12), g("47,5")), "DOC": (g(10), g(10)),
                    "DEP": (g("2,5"), g("2,5")), "PGL": (g(10), g(10))}
    b = blocchi({"progetto": p})
    attesi = {"Analisi": ("26,5", "33,0", "59,5", "4,66"), "Disegno": ("25,5", "32,0", "57,5", "4,51"),
              "Architettura": ("0", "0", "0", "0,00"), "Implementazione": ("442,5", "552,0", "994,5", "77,94"),
              "Training": ("10,0", "10,0", "20,0", "1,57"), "Test": ("58,0", "61,5", "119,5", "9,37"), "Deploy": ("12,5", "12,5", "25,0", "1,96")}
    for k, (be, fe, tot, peso) in attesi.items():
        assert b[k][:3] == (g(be), g(fe), g(tot)), k
        assert pct2(b[k][3]) == g(peso), k
    assert normalizza(sum(v[3] for v in b.values())) == 1                          # i pesi sommano al 100%
    assert (p["TP"]["BE"], p["TP"]["FE"], p["TP"]["tot"]) == (g(575), g(701), g(1276))
    assert p["PM"] == g(153) and pct2(p["peso_pm"]) == g("11,99")
    assert (p["contingency"]["BE"], p["contingency"]["FE"], p["contingency"]["tot"]) == (g("57,5"), g(70), g("127,5"))
    assert p["totale"] == g("1556,5")


def test_tc1_costi_prezzo_obiettivo_fte_e_am_manuale():
    res = calcola(tc1())
    p = res["progetto"]
    assert [eur(p["costi"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("211887.50"), g("258285.00"), g("71604.00"), g("541776.50")]
    assert eur(p["prezzo"]) == g("773966.43")
    assert eur(p["costo_medio"]) == g("348.07") and eur(p["prezzo_medio"]) == g("497.25")
    o = p["obiettivo"]
    assert pct2(o["margine"]) == g("27.76") and o["sotto_margine"] is True and eur(o["scostamento"]) == g("-23966.43")
    assert any(x["codice"] == "margine_risultante" and x["livello"] == "avviso" for x in res["messaggi"])
    f = p["fte"]
    assert [r3(f[t]) for t in ("BE", "FE", "PM", "tot")] == [g("3.163"), g("3.855"), g("0.765"), g("7.783")]
    am = res["am"]
    assert am["gg"] == g(480) and eur(am["costo"]) == g("160800.00") and eur(am["prezzo"]) == g("217297.30")
    assert res["export_bloccato"] is False


# ------------------------------------------------------------------ TC2
# Adattato: niente Architettura (Disegno 8/2, 2 Ambienti, 4 Pipeline) e analisi al 6% per tutti i moduli (non più DQ al 3%).

def tc2():
    snap = catalogo_default()
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
    ]
    s["voci_corpo"] = [{"nome": "Gestione della sicurezza del dato", "gg_be": 2, "gg_fe": 2}]    # al posto della sicurezza al 2%
    s["training_be"], s["training_fe"] = 5, 5
    s["durata_mesi"] = 6
    s["am"] = {"modalita": "driver", "driver": {"fonte": "progetto", "servizio": "H12", "anni": 3, "evolutiva": 50, "presa": False}}
    return s


def test_tc2_righe_e_fasi():
    p = calcola(tc2())["progetto"]
    righe = {r["etichetta"]: (r["BE"], r["FE"]) for r in p["righe"]}
    assert righe == {"Sorgenti IoT": (g(20), g(0)), "Regole anagrafiche": (g(42), g(0)), "Domini": (g(11), g("4,5")),
                     "Data product": (g(21), g(0)), "Report legacy": (g(0), g(64)), "Storico 5 anni": (g(30), g(0))}
    assert [(v["BE"], v["FE"]) for v in p["voci_corpo"]] == [(g(2), g(2))]
    assert p["B"] == g("196,5")
    assert p["fasi"]["KO"]["X"] == g("0,393") and (p["fasi"]["KO"]["BE"], p["fasi"]["KO"]["FE"]) == (0, 0)     # arrotondato a zero
    fasi = {k: (v["BE"], v["FE"]) for k, v in p["fasi"].items() if k != "KO"}
    assert fasi == {"ANA": (g("7,5"), g(4)), "DIS": (g("7,5"), g(4)), "SIT": (g(7), g(1)), "UAT": (g(3), g("12,5")),
                    "DOC": (g(2), g(2)), "DEP": (g("0,5"), g("0,5")), "PGL": (g(2), g(2))}


def test_tc2_blocchi_totali_e_costi():
    p = calcola(tc2())["progetto"]
    b = blocchi({"progetto": p})
    attesi = {"Analisi": ("7,5", "4,0", "11,5", "4,39"), "Disegno": ("7,5", "4,0", "11,5", "4,39"),
              "Architettura": ("0", "0", "0", "0,00"), "Implementazione": ("126,0", "70,5", "196,5", "75,00"),
              "Training": ("5,0", "5,0", "10,0", "3,82"), "Test": ("12,0", "15,5", "27,5", "10,50"), "Deploy": ("2,5", "2,5", "5,0", "1,91")}
    for k, (be, fe, tot, peso) in attesi.items():
        assert b[k][:3] == (g(be), g(fe), g(tot)), k
        assert pct2(b[k][3]) == g(peso), k
    assert (p["TP"]["BE"], p["TP"]["FE"], p["TP"]["tot"]) == (g("160,5"), g("101,5"), g(262))
    assert p["PM"] == g("31,5")
    assert (p["contingency"]["BE"], p["contingency"]["FE"], p["contingency"]["tot"]) == (g(16), g(10), g(26))
    assert p["totale"] == g("319,5")
    assert [eur(p["costi"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("59127.50"), g("37352.50"), g("14742.00"), g("111222.00")]
    assert eur(p["prezzo"]) == g("154475.00")
    assert [r3(p["fte"][t]) for t in ("BE", "FE", "PM", "tot")] == [g("1.471"), g("0.929"), g("0.263"), g("2.663")]


def test_tc2_am_da_driver():
    # build equivalente = implementazione (126,0 BE · 70,5 FE): invariato rispetto alla specifica, quindi anche l'AM
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
    assert calcola(s2)["progetto"]["costi"]["BE"] == (g(575) + g("57,5")) * 400


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
    assert j["progetto"]["TP"]["tot"] == 1276.0 and j["progetto"]["blocchi"]["Analisi"]["peso"] > 0


def test_snapshot_vecchi_con_analisi_per_modulo_si_adeguano():
    from core.stime_catalogo import migra_snapshot
    vecchio = catalogo_default()
    vecchio["fasi"] = [f for f in vecchio["fasi"] if f["codice"] not in ("ANA", "DIS")]
    for m in vecchio["moduli"]:
        m["pct_analisi"], m["pct_disegno"] = 0.05, 0.04
    assert migra_snapshot(vecchio) is True and migra_snapshot(vecchio) is False
    ana, dis = vecchio["fasi"][0], vecchio["fasi"][1]
    assert (ana["codice"], ana["pct"], dis["codice"], dis["pct"], ana["base"]) == ("ANA", 0.05, "DIS", 0.04, "Moduli_team")
    s = tc1()
    s["snapshot"] = vecchio
    p = calcola(s)["progetto"]
    assert (p["fasi"]["ANA"]["BE"], p["fasi"]["DIS"]["FE"]) == (g("21,0"), g("21,5"))   # R(423 × 5%) = R(21,15) · R(532,5 × 4%) = R(21,3)


def test_giornate_fisse_al_posto_della_percentuale():
    """Su una fase (anche PM e contingency) si può scrivere un numero di giornate: vale quello, ripartito per team in modo che
    BE + FE dia esattamente il numero arrotondato."""
    s = tc1()
    fasi = {f["codice"]: f for f in s["snapshot"]["fasi"]}
    fasi["UAT"]["gg_fissi"] = 40.3            # 20/80: BE = R(8,06) = 8,0 · FE = 40,5 − 8,0 = 32,5
    fasi["ANA"]["gg_fissi"] = 30              # quota BE dell'implementazione dei moduli: 423 / 955,5 → R(13,28) = 13,5 · FE 16,5
    fasi["PM"]["gg_fissi"] = 100.2            # R(100,2) = 100,0
    fasi["CONT"]["gg_fissi"] = 50             # quota BE del TP
    p = calcola(s)["progetto"]
    assert (p["fasi"]["UAT"]["BE"], p["fasi"]["UAT"]["FE"], p["fasi"]["UAT"]["fisso"]) == (g(8), g("32,5"), True)
    assert (p["fasi"]["ANA"]["BE"], p["fasi"]["ANA"]["FE"]) == (g("13,5"), g("16,5"))
    assert p["fasi"]["DIS"]["fisso"] is False and p["fasi"]["DIS"]["BE"] == g("25,5")
    assert p["PM"] == g(100)
    tp = p["TP"]
    be = arrotonda(Decimal(50) * tp["BE"] / tp["tot"], Decimal("0.5"))
    assert (p["contingency"]["BE"], p["contingency"]["FE"], p["contingency"]["tot"]) == (be, g(50) - be, g(50))
    fasi["UAT"]["gg_fissi"] = -1
    assert calcola(s)["export_bloccato"] is True
    fasi["UAT"]["gg_fissi"] = None                                                   # vuoto: torna la percentuale
    assert calcola(s)["progetto"]["fasi"]["UAT"]["fisso"] is False
