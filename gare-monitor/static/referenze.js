/* Modulo Referenze — caricato SOLO quando si apre la vista (vedi loadReferenze() in app.js).
   Parte 1: logica di ricerca pura (si prova anche con node: tests/test_referenze_js.py). Parte 2: interfaccia. */
(function () {
  "use strict";

  // ------------------------------------------------------------ ricerca (pura)
  const normTxt = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ORDINE_MATERIALE = {ricco: 0, medio: 1, scarso: 2};

  // sinonimi: { termine: [espansioni] } con chiavi normalizzate
  function indicizzaSinonimi(sin) {
    const out = {};
    Object.keys(sin || {}).forEach(k => out[normTxt(k).trim()] = sin[k].map(normTxt));
    return out;
  }
  // "forecast" -> [["forecast","previsione",...]]; "RAG sanità" -> [["rag"],["sanita"]] (ogni parola deve comparire, i sinonimi valgono dentro la parola)
  function gruppiDiRicerca(q, SIN) {
    const t = normTxt(q).trim();
    if (!t) return null;
    if (SIN[t]) return [SIN[t]];
    return t.split(/\s+/).map(w => SIN[w] || [w]);
  }
  function pagliaio(r) {
    if (r._h === undefined) r._h = normTxt([r.cliente, r.titolo, r.titolo_excel, r.segmento, r.pitch, (r.tipologie || []).join(" "), (r.temi || []).join(" "), (r.tecnologie || []).join(" "), r.descrizione_excel].join(" "));
    return r._h;
  }
  const contiene = (testo, termini) => { const h = normTxt(testo); return termini.some(x => h.includes(x)); };
  const corrispondeArgomento = (r, gruppi) => !gruppi || gruppi.every(g => g.some(x => pagliaio(r).includes(x)));
  // pertinenza: titolo/temi (4) > pitch (3) > descrizione (2) > tipologie (1), per ogni parola cercata
  function punteggio(r, gruppi) {
    if (!gruppi) return 0;
    return gruppi.reduce((tot, g) => tot + (contiene([r.titolo, r.titolo_excel, (r.temi || []).join(" ")].join(" "), g) ? 4 : 0) + (contiene(r.pitch, g) ? 3 : 0)
      + (contiene(r.descrizione_excel, g) ? 2 : 0) + (contiene((r.tipologie || []).join(" "), g) ? 1 : 0), 0);
  }
  const corrispondeCliente = (r, c) => { const x = normTxt(c).trim(); return !x || normTxt(r.cliente).includes(x); };
  const corrispondeAmbito = (r, f) => (!f.ambito || r.ambito === f.ambito) && (!f.tipologia || (r.tipologie || []).includes(f.tipologia));

  // f = {q, cliente, ambito, tipologia, mercato}
  function cerca(dati, f, SIN) {
    const gruppi = gruppiDiRicerca(f.q, SIN);
    const ris = dati.filter(r => corrispondeArgomento(r, gruppi) && corrispondeCliente(r, f.cliente) && (!f.mercato || r.mercato === f.mercato) && corrispondeAmbito(r, f));
    ris.forEach(r => r._s = punteggio(r, gruppi));
    ris.sort((a, b) => (b._s - a._s) || ((ORDINE_MATERIALE[a.materiale] ?? 3) - (ORDINE_MATERIALE[b.materiale] ?? 3)));
    return ris;
  }
  // base per i conteggi dei filtri: argomento + cliente (+ mercato/ambito se richiesti)
  function conteggi(dati, f, SIN) {
    const gruppi = gruppiDiRicerca(f.q, SIN);
    const baseTC = dati.filter(r => corrispondeArgomento(r, gruppi) && corrispondeCliente(r, f.cliente));
    return {
      gruppi,
      mercato: m => baseTC.filter(r => r.mercato === m && corrispondeAmbito(r, f)).length,
      ambito: a => baseTC.filter(r => (!f.mercato || r.mercato === f.mercato) && (!a || r.ambito === a)).length,
      tipologia: t => baseTC.filter(r => (!f.mercato || r.mercato === f.mercato) && r.ambito === f.ambito && (r.tipologie || []).includes(t)).length,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {normTxt, indicizzaSinonimi, gruppiDiRicerca, punteggio, cerca, conteggi};
    return;
  }

  // ------------------------------------------------------------ interfaccia
  const qs = (s, el = document) => el.querySelector(s);
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const BADGE = {ricco: ["Pronta da raccontare", "ok"], medio: ["Da arricchire", "mid"], scarso: ["Da completare", "low"]};

  const ST = {cfg: null, SIN: null, dati: [], f: {q: "", cliente: "", ambito: "", tipologia: "", mercato: ""}};

  function schedaHtml(r) {
    const ambLab = (ST.cfg.ambito_etichetta || {})[r.ambito] || r.ambito;
    const ext = (r.esteso || []).map(s => `<h4>${E(s.sezione)}</h4>` + (Array.isArray(s.testo)
      ? `<ul class="${/^Spunti/.test(s.sezione) ? "talk" : ""}">${s.testo.map(i => `<li>${E(i)}</li>`).join("")}</ul>` : `<p>${E(s.testo)}</p>`)).join("");
    const [bl, bc] = BADGE[r.materiale] || ["", ""];
    const referenti = [r.referente_aidata, r.referente_progetto].filter(Boolean);
    return `<article class="rf-card">
      <div class="rf-top"><div>
        <div class="rf-cli"><a href="#" data-cli="${E(r.cliente)}" title="Mostra tutte le referenze di questo cliente">${E(r.cliente)}</a> · ${E(r.mercato)}${r.anno ? " · " + E(r.anno) : ""} · <span class="rf-id">${E(r.id)}</span></div>
        <h3 class="rf-tit">${E(r.titolo)}</h3>
        <div class="rf-tags"><span class="rf-tag">${E(ambLab)}</span>${(r.tipologie || []).map(c => `<span class="rf-tag c">${E(c)}</span>`).join("")}${(r.temi || []).map(t => `<span class="rf-tag t">${E(t)}</span>`).join("")}${(r.tecnologie || []).map(t => `<span class="rf-tag">${E(t)}</span>`).join("")}</div>
      </div><div class="rf-badges">${bl ? `<span class="rf-badge ${bc}">${bl}</span>` : ""}${r.da_verificare ? `<span class="rf-badge warn" title="${E(r.note)}">Da verificare</span>` : ""}${r.origine && r.origine !== "Excel master" ? `<span class="rf-badge new">Nuova</span>` : ""}</div></div>
      <div class="rf-pitch"><small>In 30 secondi</small>${E(r.pitch)}</div>
      <details><summary>Racconto esteso</summary><div class="rf-ext">${ext || `<p class="rf-muted">Nessun racconto esteso.</p>`}</div></details>
      <div class="rf-src">${(r.fonti || []).length ? "Fonti: " + E(r.fonti.join(" · ")) : "Fonte: solo Excel master"}${(r.campi_mancanti || []).length ? ` · <b>Manca:</b> ${E(r.campi_mancanti.join(", "))}` : ""}${referenti.length ? " · Referenti: " + E(referenti.join(", ")) : ""}</div></article>`;
  }

  function disegna(m) {
    const f = ST.f, C = conteggi(ST.dati, f, ST.SIN), tipologie = ST.cfg.tipologie;
    // ambito
    qs("#rf-amb", m).innerHTML = [["", "Tutto"], ...ST.cfg.ambiti.map(a => [a, ST.cfg.ambito_etichetta[a] || a])]
      .map(([k, l]) => `<button class="${f.ambito === k ? "on" : ""}" data-a="${E(k)}">${E(l)}<span>${C.ambito(k)}</span></button>`).join("");
    qs("#rf-amb", m).querySelectorAll("button").forEach(b => b.onclick = () => { f.ambito = b.dataset.a; f.tipologia = ""; disegna(m); });
    // tipologie (dopo la scelta dell'ambito; in coda quelle presenti nei dati ma non nel dominio, es. "Da classificare")
    const box = qs("#rf-cat", m);
    if (!f.ambito) box.innerHTML = `<span class="rf-hint">Scegli “Progetti AI” o “Data Management & Reporting” per filtrare per tipologia (chatbot, forecast, RAG, data platform…)</span>`;
    else {
      const note = [...new Set(ST.dati.filter(r => r.ambito === f.ambito).flatMap(r => r.tipologie || []))].filter(t => !(tipologie[f.ambito] || []).includes(t)).sort((a, b) => a.localeCompare(b, "it"));
      box.innerHTML = `<button class="rf-chip k ${f.tipologia ? "" : "on"}" data-c="">Tutte le tipologie</button>` + [...(tipologie[f.ambito] || []), ...note]
        .map(t => `<button class="rf-chip k ${f.tipologia === t ? "on" : ""}" data-c="${E(t)}">${E(t)}<span>${C.tipologia(t)}</span></button>`).join("");
      box.querySelectorAll(".rf-chip").forEach(b => b.onclick = () => { f.tipologia = b.dataset.c; disegna(m); });
    }
    // mercato
    qs("#rf-mk", m).innerHTML = `<button class="rf-chip ${f.mercato ? "" : "on"}" data-m="">Tutti i mercati</button>` + ST.cfg.mercati.map(x => {
      const tot = ST.dati.filter(r => r.mercato === x).length;
      return `<button class="rf-chip ${f.mercato === x ? "on" : ""}" data-m="${E(x)}" ${tot ? "" : 'disabled title="Nessuna referenza in archivio"'}>${E(x)}<span>${C.mercato(x)}</span></button>`;
    }).join("");
    qs("#rf-mk", m).querySelectorAll(".rf-chip").forEach(b => b.onclick = () => { if (b.disabled) return; f.mercato = b.dataset.m; disegna(m); });
    // risultati
    const ris = cerca(ST.dati, f, ST.SIN), pronte = ris.filter(r => r.materiale === "ricco").length;
    const cosa = [f.q.trim() ? `“${E(f.q.trim())}”` : "", f.cliente.trim() ? `cliente <b>${E(f.cliente.trim())}</b>` : "", f.mercato ? `mercato <b>${E(f.mercato)}</b>` : "",
      f.ambito ? `<b>${E(ST.cfg.ambito_etichetta[f.ambito] || f.ambito)}</b>` : "", f.tipologia ? `tipologia <b>${E(f.tipologia)}</b>` : ""].filter(Boolean).join(" · ");
    const sin = ST.SIN[normTxt(f.q).trim()];
    qs("#rf-hint", m).innerHTML = sin ? `Cerco anche: ${sin.map(s => `<b>${E(s)}</b>`).join(" · ")}` : "";
    qs("#rf-rh", m).innerHTML = ris.length ? `Abbiamo <span>${ris.length}</span> referenz${ris.length === 1 ? "a" : "e"}${cosa ? " per " + cosa : ""}${pronte ? ` · <span>${pronte}</span> pronte da raccontare` : ""}` : "";
    qs("#rf-out", m).innerHTML = ris.length ? ris.map(schedaHtml).join("") : `<div class="rf-empty">Nessuna referenza trovata. Prova un sinonimo o togli un filtro.</div>`;
    qs("#rf-out", m).querySelectorAll("[data-cli]").forEach(a => a.onclick = e => {
      e.preventDefault(); ST.f = {q: "", cliente: a.dataset.cli, ambito: "", tipologia: "", mercato: ""}; qs("#rf-q", m).value = ""; qs("#rf-cl", m).value = a.dataset.cli; disegna(m); window.scrollTo(0, 0);
    });
  }

  function schermataVuota(m, info) {
    m.innerHTML = `<div class="rf-wrap"><div class="rf-empty-card"><h2>Archivio delle referenze non ancora caricato</h2>
      <p>Il primo caricamento legge un file <b>referenze.json</b> e crea il database delle referenze (separato da quello delle offerte). Si fa una volta sola: da quel momento il database è l'unica fonte.</p>
      <p class="rf-muted">File atteso: <code>${E(info.percorso_json)}</code> ${info.file_esiste ? "" : "— <b>non trovato</b>"}</p>
      <div class="rf-row">${info.file_esiste ? `<button class="primary" id="rf-load">Carica da questo file</button>` : ""}<button id="rf-pick">Scegli file…</button></div>
      <div class="rf-err" id="rf-err"></div></div></div>`;
    const carica = async path => {
      try { const r = await withBusy(() => api("/api/referenze/carica", {method: "POST", body: path ? {path} : {}}), "Carico le referenze…"); toast(`Caricate ${r.caricate} referenze`); R.render(m); }
      catch (e) { qs("#rf-err", m).textContent = e.message; }
    };
    const l = qs("#rf-load", m); if (l) l.onclick = () => carica(null);
    qs("#rf-pick", m).onclick = async () => {
      try { const r = await api("/api/browse", {method: "POST", body: {tipo: "json"}}); if (r.path) carica(r.path); } catch (e) { qs("#rf-err", m).textContent = e.message; }
    };
  }

  const R = {
    async render(m) {
      m.innerHTML = `<p class="muted pad">Caricamento…</p>`;
      let d;
      try { [ST.cfg, d] = await Promise.all([api("/api/referenze/config"), api("/api/referenze")]); }
      catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
      if (S.view !== "referenze") return;
      if (d.stato !== "ok") { schermataVuota(m, d); return; }
      ST.dati = d.referenze; ST.SIN = indicizzaSinonimi(ST.cfg.sinonimi);
      const clienti = [...new Set(ST.dati.map(r => r.cliente))].sort((a, b) => a.localeCompare(b, "it"));
      m.innerHTML = `<div class="rf-wrap">
        <div class="rf-bar"><div><label for="rf-q">Argomento o tecnologia</label><input id="rf-q" placeholder="es. forecast, chatbot, Databricks…" autocomplete="off" value="${E(ST.f.q)}"></div>
          <div><label for="rf-cl">Cliente</label><input id="rf-cl" list="rf-clienti" placeholder="es. Enel, Poste…" autocomplete="off" value="${E(ST.f.cliente)}"><datalist id="rf-clienti">${clienti.map(c => `<option value="${E(c)}">`).join("")}</datalist></div></div>
        <div class="rf-seg" id="rf-amb"></div><div class="rf-chips" id="rf-cat"></div>
        <div class="rf-lbl">Mercato</div><div class="rf-chips" id="rf-mk"></div>
        <div class="rf-hint" id="rf-hint"></div><div class="rf-result" id="rf-rh"></div><div id="rf-out"></div></div>`;
      qs("#rf-q", m).oninput = e => { ST.f.q = e.target.value; disegna(m); };
      qs("#rf-cl", m).oninput = e => { ST.f.cliente = e.target.value; disegna(m); };
      disegna(m);
    },
    // chiamata dall'esterno (scheda Cliente): apre la ricerca già filtrata per cliente
    filtraPerCliente(nome) { ST.f = {q: "", cliente: nome || "", ambito: "", tipologia: "", mercato: ""}; },
  };
  window.Referenze = R;
})();
