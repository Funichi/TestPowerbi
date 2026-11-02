"""Stimometro: catalogo dei parametri di default (specifica §5).

È il seed iniziale: i valori dei moduli nuovi sono proposte da calibrare dall'app, non vincoli del motore.
Le percentuali sono frazioni (6% = 0.06). Il motore converte ogni numero con Decimal(str(x)), quindi 0.06 resta esattamente 0,06.
"""
import copy

TEAM_PROGETTO = ("BE", "FE")                      # team a cui si attribuiscono le giornate dei moduli e delle fasi
BLOCCHI = ("Analisi", "Disegno", "Architettura", "Implementazione", "Training", "Test", "Deploy")
BLOCCHI_MODULO = ("Implementazione", "Architettura")
SERVIZI_AM = ("H8", "H12", "H24")

_T = lambda codice, modulo, nome, unita, mix, gg, be, fe: {
    "codice": codice, "modulo": modulo, "nome": nome, "unita": unita, "modalita": "quantita",
    "mix": list(mix), "gg": list(gg), "pct_be": be, "pct_fe": fe, "corpo_be": None, "corpo_fe": None, "attivo": True}

CATALOGO = {
    "team": [
        {"codice": "BE", "nome": "Back-end", "contenuto": "Ingestion, DWH, data engineering", "costo": 335},
        {"codice": "FE", "nome": "Front-end", "contenuto": "Modello semantico, report, BI", "costo": 335},
        {"codice": "PM", "nome": "Project management", "contenuto": "Gestione del progetto", "costo": 468},
    ],
    "generali": {
        "margine_progetto": 0.30,
        "margine_am": 0.26,
        "gg_mese": 20,                             # giornate lavorative al mese (G)
        "passo": 0.5,                              # passo di arrotondamento (P)
        "training_be": 10, "training_fe": 10,      # training predefinito in una nuova stima
        "voci_corpo": [{"nome": "Altre attività", "gg_be": 10, "gg_fe": 10}],
    },
    "moduli": [
        {"codice": "STG", "nome": "Staging (ingestion batch)", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "CDC", "nome": "Ingestion CDC/streaming", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "DWH", "nome": "Data Platform / DWH", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "DQ", "nome": "Data quality", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "GOV", "nome": "Governance e catalogo", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "DM", "nome": "Data model", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "REP", "nome": "Report", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "API", "nome": "API / data product", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "MIG", "nome": "Migrazione", "blocco": "Implementazione", "pct_analisi": 0.06, "pct_disegno": 0.06, "attivo": True},
        {"codice": "ARC", "nome": "Architettura", "blocco": "Architettura", "pct_analisi": 0.0, "pct_disegno": 0.0, "attivo": True},
    ],
    "tipi": [
        _T("STG.FLUSSO", "STG", "Flusso", "1 tabella = 1 flusso", (0.35, 0.40, 0.25), (0.25, 0.5, 1.5), 1, 0),
        _T("CDC.FLUSSO", "CDC", "Flusso in tempo reale", "flusso", (0.40, 0.40, 0.20), (1, 2, 4), 1, 0),
        _T("DWH.OGGETTO", "DWH", "Oggetto fact o dimensione", "oggetto", (0.35, 0.50, 0.15), (3, 5, 8), 1, 0),
        _T("DQ.REGOLA", "DQ", "Regola di controllo", "regola", (0.50, 0.35, 0.15), (0.25, 0.5, 1.5), 1, 0),
        _T("GOV.DOMINIO", "GOV", "Dominio dati", "dominio", (0.40, 0.40, 0.20), (3, 5, 10), 0.7, 0.3),
        _T("DM.OGGETTO", "DM", "Oggetto del modello semantico", "oggetto", (0.35, 0.50, 0.15), (0.5, 1, 3), 0, 1),
        _T("REP.REPORT", "REP", "Report", "report", (0.20, 0.40, 0.40), (4, 7, 12), 0, 1),
        _T("API.ENDPOINT", "API", "Endpoint", "endpoint", (0.40, 0.40, 0.20), (1, 3, 5), 1, 0),
        _T("MIG.REPORT", "MIG", "Report da migrare", "report", (0.40, 0.40, 0.20), (1, 2, 4), 0, 1),
        _T("MIG.STORICO", "MIG", "Tabella di dato storico", "tabella", (0.40, 0.40, 0.20), (0.5, 1, 2), 1, 0),
        {"codice": "ARC.DISEGNO", "modulo": "ARC", "nome": "Disegno architetturale", "unita": "a corpo", "modalita": "corpo",
         "mix": None, "gg": None, "pct_be": None, "pct_fe": None, "corpo_be": 5, "corpo_fe": 0, "attivo": True},
        _T("ARC.AMBIENTE", "ARC", "Ambiente da configurare", "ambiente", (0.40, 0.40, 0.20), (2, 3, 5), 1, 0),
        _T("ARC.PIPELINE", "ARC", "Pipeline CI/CD o template IaC", "pipeline", (0.40, 0.40, 0.20), (1, 2, 4), 1, 0),
    ],
    # base: "B" (implementazione), "BaseModuli" (solo moduli del blocco Implementazione), "TP" (PM), "TP_team" (contingency, per team)
    "fasi": [
        {"codice": "KO", "nome": "Kick-off", "blocco": "Analisi", "base": "B", "pct": 0.002, "pct_be": 0.5, "pct_fe": 0.5, "min": None, "max": None},
        {"codice": "SEC", "nome": "Sicurezza", "blocco": "Implementazione", "base": "BaseModuli", "pct": 0.02, "pct_be": 0.5, "pct_fe": 0.5, "min": None, "max": None},
        {"codice": "SIT", "nome": "System & integration test", "blocco": "Test", "base": "B", "pct": 0.04, "pct_be": 0.9, "pct_fe": 0.1, "min": None, "max": None},
        {"codice": "UAT", "nome": "UAT e fixing", "blocco": "Test", "base": "B", "pct": 0.06, "pct_be": 0.2, "pct_fe": 0.8, "min": None, "max": None},
        {"codice": "DOC", "nome": "Documentazione", "blocco": "Test", "base": "B", "pct": 0.02, "pct_be": 0.5, "pct_fe": 0.5, "min": None, "max": None},
        {"codice": "DEP", "nome": "Deploy", "blocco": "Deploy", "base": "B", "pct": 0.005, "pct_be": 0.5, "pct_fe": 0.5, "min": None, "max": None},
        {"codice": "PGL", "nome": "Supporto post go-live", "blocco": "Deploy", "base": "B", "pct": 0.02, "pct_be": 0.5, "pct_fe": 0.5, "min": None, "max": None},
        {"codice": "PM", "nome": "Project management", "blocco": None, "base": "TP", "pct": 0.12, "pct_be": None, "pct_fe": None, "min": None, "max": None},
        {"codice": "CONT", "nome": "Contingency", "blocco": None, "base": "TP_team", "pct": 0.10, "pct_be": None, "pct_fe": None, "min": None, "max": None},
    ],
    "am": {
        "pct_correttiva": 0.15,                    # % correttiva annua sul build equivalente
        "coeff": {"H8": 1.0, "H12": 1.2, "H24": 1.5},
        "pct_presa": 0.03,                         # presa in carico, solo anno 1
        "decalage": 0.10,                          # composto, dal secondo anno
        "anni_max": 5,
    },
}


def catalogo_default():
    """Copia indipendente del catalogo di default: è anche lo snapshot di una stima nuova."""
    return copy.deepcopy(CATALOGO)


def stima_nuova(snapshot=None):
    """Stima vuota con i default del catalogo (training e voci a corpo predefinite)."""
    snap = copy.deepcopy(snapshot) if snapshot is not None else catalogo_default()
    g = snap["generali"]
    return {
        "snapshot": snap,
        "righe": [],
        "voci_corpo": [dict(v) for v in g.get("voci_corpo", [])],
        "training_be": g.get("training_be", 0), "training_fe": g.get("training_fe", 0),
        "durata_mesi": None, "prezzo_obiettivo": None,
        "am": {"modalita": None},
    }
