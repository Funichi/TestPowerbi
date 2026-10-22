"""Modulo Referenze: UNICO punto dove stanno domini, sezioni standard e sinonimi di ricerca.
Per aggiungere una tipologia, un mercato o un sinonimo basta modificare questo file (l'interfaccia li legge da /api/referenze/config)."""

AMBITI = ["AI", "Data Management & Reporting"]
AMBITO_ETICHETTA = {"AI": "Progetti AI", "Data Management & Reporting": "Data Management & Reporting"}

TIPOLOGIE = {
    "AI": [
        "Chatbot & Assistenti virtuali", "RAG & Knowledge Base", "Agenti AI & Automazione", "Document Intelligence & NLP",
        "Forecasting & Modelli predittivi", "Anomaly detection & Manutenzione predittiva", "Computer Vision", "GenAI per contenuti",
        "Ottimizzazione & Simulazione", "Analisi dati in linguaggio naturale", "Clustering & Segmentazione", "AI Strategy & Assessment",
    ],
    "Data Management & Reporting": [
        "Data Platform & Lakehouse", "Data Warehouse & BI / Reporting", "Data Governance & Data Quality", "Migrazione & Modernizzazione",
        "Real-time & Integrazione dati", "Assessment & Studi di fattibilità",
    ],
}

MERCATI = [
    "Energy & Utilities", "Pubblica Amministrazione", "Sanità", "Finance & Insurance", "Telco & Media", "Industria & Manufacturing",
    "Retail & GDO", "Turismo & Leisure", "Trasporti & Infrastrutture", "Servizi & IT", "Engineering (interno)", "Altro",
]

CAMPI_MANCANTI = ["anno", "tecnologie", "descrizione dettagliata", "risultati/benefici", "referente interno", "mercato", "materiale di presentazione (slide/Word)"]
MATERIALE = ["ricco", "medio", "scarso"]
SEZIONI_STANDARD = ["Il contesto e la sfida", "Il nostro approccio", "La soluzione nel dettaglio", "Dati e tecnologie",
                    "Il valore per il cliente", "Perché è replicabile", "Spunti per la conversazione"]

# Sinonimi di ricerca: chi cerca la parola a sinistra trova anche i termini a destra (senza accenti e maiuscole; i termini sono "contiene").
# L'espansione vale in una sola direzione: es. "genai" include "chatbot", ma "chatbot" non include "genai".
SINONIMI = {
    "forecast": ["forecast", "previsione", "previsioni", "demand planning", "load forecasting", "serie storic"],
    "previsione": ["previsione", "previsioni", "forecast", "demand planning"],
    "chatbot": ["chatbot", "assistente virtuale", "virtual assistant", "virtual agent", "voicebot", "conversazional"],
    "genai": ["genai", "generativ", "llm", "gpt", "rag", "chatbot"],
    "computer vision": ["computer vision", "immagin", "video", "visione"],
    "manutenzione": ["manutenzione", "maintenance", "predittiv"],
    "data platform": ["data platform", "lakehouse", "data lake", "datalake", "dwh", "data warehouse"],
    "governance": ["governance", "data quality", "dama", "catalog"],
    "documenti": ["document", "ocr", "estrazione", "testi"],
}


def config_pubblica():
    return {"ambiti": AMBITI, "ambito_etichetta": AMBITO_ETICHETTA, "tipologie": TIPOLOGIE, "mercati": MERCATI, "campi_mancanti": CAMPI_MANCANTI,
            "materiale": MATERIALE, "sezioni_standard": SEZIONI_STANDARD, "sinonimi": SINONIMI}
