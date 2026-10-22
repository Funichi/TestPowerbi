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

  const ST = {cfg: null, SIN: null, dati: [], vista: "ricerca", mostraArch: false, root: null, nCompletare: null,
    f: {q: "", cliente: "", ambito: "", tipologia: "", mercato: ""}, comp: {mancante: "", daVerificare: false, materiale: "", mostra: 50}};

  async function caricaDati() {
    const d = await api("/api/referenze" + (ST.mostraArch ? "?archiviate=1" : ""));
    if (d.stato !== "ok") return d;
    ST.dati = d.referenze; ST.dati.forEach(r => delete r._h);
    return d;
  }

  function schedaHtml(r) {
    const ambLab = (ST.cfg.ambito_etichetta || {})[r.ambito] || r.ambito;
    const ext = (r.esteso || []).map(s => `<h4>${E(s.sezione)}</h4>` + (Array.isArray(s.testo)
      ? `<ul class="${/^Spunti/.test(s.sezione) ? "talk" : ""}">${s.testo.map(i => `<li>${E(i)}</li>`).join("")}</ul>` : `<p>${E(s.testo)}</p>`)).join("");
    const [bl, bc] = BADGE[r.materiale] || ["", ""];
    const referenti = [r.referente_aidata, r.referente_progetto].filter(Boolean);
    return `<article class="rf-card ${r.archiviata ? "arch" : ""}">
      <div class="rf-top"><div>
        <div class="rf-cli"><a href="#" data-cli="${E(r.cliente)}" title="Mostra tutte le referenze di questo cliente">${E(r.cliente)}</a> · ${E(r.mercato)}${r.anno ? " · " + E(r.anno) : ""} · <span class="rf-id">${E(r.id)}</span></div>
        <h3 class="rf-tit">${E(r.titolo)}</h3>
        <div class="rf-tags"><span class="rf-tag">${E(ambLab)}</span>${(r.tipologie || []).map(c => `<span class="rf-tag c">${E(c)}</span>`).join("")}${(r.temi || []).map(t => `<span class="rf-tag t">${E(t)}</span>`).join("")}${(r.tecnologie || []).map(t => `<span class="rf-tag">${E(t)}</span>`).join("")}</div>
      </div><div class="rf-side"><div class="rf-badges">${r.archiviata ? `<span class="rf-badge low">Archiviata</span>` : ""}${bl ? `<span class="rf-badge ${bc}">${bl}</span>` : ""}${r.da_verificare ? `<span class="rf-badge warn" title="${E(r.note)}">Da verificare</span>` : ""}${r.origine && r.origine !== "Excel master" ? `<span class="rf-badge new">Nuova</span>` : ""}</div>
        <button class="rf-btn" data-edit="${E(r.id)}">${icona("pencil")}Modifica</button></div></div>
      <div class="rf-pitch"><small>In 30 secondi</small>${E(r.pitch)}</div>
      <details><summary>Racconto esteso</summary><div class="rf-ext">${ext || `<p class="rf-muted">Nessun racconto esteso.</p>`}</div></details>
      <div class="rf-src">${(r.fonti || []).length ? "Fonti: " + E(r.fonti.join(" · ")) : "Fonte: solo Excel master"}${(r.campi_mancanti || []).length ? ` · <b>Manca:</b> ${E(r.campi_mancanti.join(", "))}` : ""}${referenti.length ? " · Referenti: " + E(referenti.join(", ")) : ""}</div></article>`;
  }
  const icona = n => (typeof ico === "function" ? ico(n) : "");       // icone dell'app (definite in app.js)

  // ---------------------------------------------------------------- barra comune: Ricerca | Da completare | Nuova referenza
  function barraHtml() {
    const n = ST.nCompletare;
    return `<div class="rf-tabs"><div class="rf-seg"><button class="${ST.vista === "ricerca" ? "on" : ""}" data-v="ricerca">Ricerca</button>
      <button class="${ST.vista === "completare" ? "on" : ""}" data-v="completare">Da completare${n == null ? "" : `<span>${n}</span>`}</button></div>
      <button class="primary" id="rf-nuova">${icona("plus")}Nuova referenza</button></div>`;
  }
  function bindBarra(m) {
    m.querySelectorAll(".rf-tabs [data-v]").forEach(b => b.onclick = () => { ST.vista = b.dataset.v; monta(m); });
    qs("#rf-nuova", m).onclick = () => apriEditor(m, null);
  }
  async function aggiornaConteggioCompletare() {
    try { const d = await api("/api/referenze/da-completare"); ST.nCompletare = d.referenze.length; } catch (e) {}
  }
  function bindModifica(m, box) {
    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => {
      const r = ST.dati.find(x => x.id === b.dataset.edit) || await api("/api/referenze?archiviate=1").then(d => d.referenze.find(x => x.id === b.dataset.edit));
      apriEditor(m, r);
    });
  }

  // ---------------------------------------------------------------- vista Ricerca
  function disegna(m) {
    const f = ST.f, C = conteggi(ST.dati, f, ST.SIN), tipologie = ST.cfg.tipologie;
    qs("#rf-amb", m).innerHTML = [["", "Tutto"], ...ST.cfg.ambiti.map(a => [a, ST.cfg.ambito_etichetta[a] || a])]
      .map(([k, l]) => `<button class="${f.ambito === k ? "on" : ""}" data-a="${E(k)}">${E(l)}<span>${C.ambito(k)}</span></button>`).join("");
    qs("#rf-amb", m).querySelectorAll("button").forEach(b => b.onclick = () => { f.ambito = b.dataset.a; f.tipologia = ""; disegna(m); });
    const box = qs("#rf-cat", m);
    if (!f.ambito) box.innerHTML = `<span class="rf-hint">Scegli “Progetti AI” o “Data Management & Reporting” per filtrare per tipologia (chatbot, forecast, RAG, data platform…)</span>`;
    else {
      const note = [...new Set(ST.dati.filter(r => r.ambito === f.ambito).flatMap(r => r.tipologie || []))].filter(t => !(tipologie[f.ambito] || []).includes(t)).sort((a, b) => a.localeCompare(b, "it"));
      box.innerHTML = `<button class="rf-chip k ${f.tipologia ? "" : "on"}" data-c="">Tutte le tipologie</button>` + [...(tipologie[f.ambito] || []), ...note]
        .map(t => `<button class="rf-chip k ${f.tipologia === t ? "on" : ""}" data-c="${E(t)}">${E(t)}<span>${C.tipologia(t)}</span></button>`).join("");
      box.querySelectorAll(".rf-chip").forEach(b => b.onclick = () => { f.tipologia = b.dataset.c; disegna(m); });
    }
    qs("#rf-mk", m).innerHTML = `<button class="rf-chip ${f.mercato ? "" : "on"}" data-m="">Tutti i mercati</button>` + ST.cfg.mercati.map(x => {
      const tot = ST.dati.filter(r => r.mercato === x).length;
      return `<button class="rf-chip ${f.mercato === x ? "on" : ""}" data-m="${E(x)}" ${tot ? "" : 'disabled title="Nessuna referenza in archivio"'}>${E(x)}<span>${C.mercato(x)}</span></button>`;
    }).join("");
    qs("#rf-mk", m).querySelectorAll(".rf-chip").forEach(b => b.onclick = () => { if (b.disabled) return; f.mercato = b.dataset.m; disegna(m); });
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
    bindModifica(m, qs("#rf-out", m));
  }

  function montaRicerca(m) {
    const clienti = [...new Set(ST.dati.map(r => r.cliente))].sort((a, b) => a.localeCompare(b, "it"));
    m.innerHTML = `<div class="rf-wrap">${barraHtml()}
      <div class="rf-bar"><div><label for="rf-q">Argomento o tecnologia</label><input id="rf-q" placeholder="es. forecast, chatbot, Databricks…" autocomplete="off" value="${E(ST.f.q)}"></div>
        <div><label for="rf-cl">Cliente</label><input id="rf-cl" list="rf-clienti" placeholder="es. Enel, Poste…" autocomplete="off" value="${E(ST.f.cliente)}"><datalist id="rf-clienti">${clienti.map(c => `<option value="${E(c)}">`).join("")}</datalist></div></div>
      <div class="rf-seg" id="rf-amb"></div><div class="rf-chips" id="rf-cat"></div>
      <div class="rf-lbl">Mercato</div><div class="rf-chips" id="rf-mk"></div>
      <label class="rf-chk"><input type="checkbox" id="rf-arch" ${ST.mostraArch ? "checked" : ""}> Mostra archiviate</label>
      <div class="rf-hint" id="rf-hint"></div><div class="rf-result" id="rf-rh"></div><div id="rf-out"></div></div>`;
    bindBarra(m);
    qs("#rf-q", m).oninput = e => { ST.f.q = e.target.value; disegna(m); };
    qs("#rf-cl", m).oninput = e => { ST.f.cliente = e.target.value; disegna(m); };
    qs("#rf-arch", m).onchange = async e => { ST.mostraArch = e.target.checked; await caricaDati(); disegna(m); };
    disegna(m);
  }

  // ---------------------------------------------------------------- vista "Da completare"
  async function montaCompletare(m) {
    m.innerHTML = `<div class="rf-wrap">${barraHtml()}<p class="muted pad">Caricamento…</p></div>`; bindBarra(m);
    const c = ST.comp, qp = new URLSearchParams();
    if (c.mancante) qp.set("mancante", c.mancante); if (c.daVerificare) qp.set("da_verificare", "1"); if (c.materiale) qp.set("materiale", c.materiale);
    let d; try { d = await api("/api/referenze/da-completare?" + qp); } catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
    if (ST.vista !== "completare") return;
    const base = await api("/api/referenze/da-completare"); ST.nCompletare = base.referenze.length;
    const F = base.facce, chip = (attivo, attr, txt, n) => `<button class="rf-chip ${attivo ? "on" : ""}" ${attr}>${E(txt)}<span>${n}</span></button>`;
    const lista = d.referenze.slice(0, c.mostra);
    m.innerHTML = `<div class="rf-wrap">${barraHtml()}
      <p class="rf-hint" style="margin-top:12px">Le schede meno complete per prime. Un campo mancante si toglie compilandolo nella scheda; “Da verificare” si toglie dalla scheda con “Segna come verificata”.</p>
      <div class="rf-lbl">Campo mancante</div><div class="rf-chips">${chip(!c.mancante, 'data-m=""', "Tutti", base.referenze.length)}${ST.cfg.campi_mancanti.map(v => chip(c.mancante === v, `data-m="${E(v)}"`, v, F.mancanti[v] || 0)).join("")}</div>
      <div class="rf-lbl">Materiale</div><div class="rf-chips">${chip(!c.materiale, 'data-mat=""', "Tutti", "")}${ST.cfg.materiale.map(v => chip(c.materiale === v, `data-mat="${v}"`, (BADGE[v] || [v])[0], F.materiale[v] || 0)).join("")}
        ${chip(c.daVerificare, 'data-dv="1"', "Solo da verificare", F.da_verificare)}</div>
      <div class="rf-result"><span>${d.referenze.length}</span> ${d.referenze.length === 1 ? "scheda" : "schede"} da completare o verificare</div>
      <div class="rf-lista">${lista.map(r => `<div class="rf-riga"><div class="rf-riga-t"><div class="rf-cli">${E(r.cliente)} · ${E(r.mercato)} · <span class="rf-id">${E(r.id)}</span></div><div class="rf-tit sm">${E(r.titolo)}</div>
        <div class="rf-tags">${(r.campi_mancanti || []).map(v => `<span class="rf-tag warn">${E(v)}</span>`).join("") || `<span class="rf-muted">Nessun campo mancante</span>`}</div>
        ${r.da_verificare ? `<div class="rf-motivo"><b>Da verificare:</b> ${E(r.note || "motivo non indicato")}</div>` : ""}</div>
        <div class="rf-side"><div class="rf-badges"><span class="rf-badge ${(BADGE[r.materiale] || [, ""])[1]}">${(BADGE[r.materiale] || [r.materiale])[0]}</span></div><button class="rf-btn" data-edit="${E(r.id)}">${icona("pencil")}Modifica</button></div></div>`).join("") || `<div class="rf-empty">Niente da completare con questi filtri.</div>`}</div>
      ${d.referenze.length > lista.length ? `<button class="rf-btn" id="rf-altre">Mostra altre (${d.referenze.length - lista.length})</button>` : ""}</div>`;
    bindBarra(m);
    m.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { c.mancante = b.dataset.m; c.mostra = 50; montaCompletare(m); });
    m.querySelectorAll("[data-mat]").forEach(b => b.onclick = () => { c.materiale = b.dataset.mat; c.mostra = 50; montaCompletare(m); });
    m.querySelectorAll("[data-dv]").forEach(b => b.onclick = () => { c.daVerificare = !c.daVerificare; c.mostra = 50; montaCompletare(m); });
    const al = qs("#rf-altre", m); if (al) al.onclick = () => { c.mostra += 50; montaCompletare(m); };
    bindModifica(m, m);
  }

  // ---------------------------------------------------------------- scheda di modifica / creazione
  const CAMPI_RIL = ["anno", "tecnologie", "esteso", "referente_aidata", "referente_mercato", "referente_progetto", "owner", "mercato", "fonti", "documenti", "descrizione_excel"];
  const confLabel = {alta: "alta", media: "media", nessuno: "nessuna"};

  function apriEditor(m, rec) {
    if (qs("#rf-editor")) return;
    const nuova = !rec;
    const D = nuova ? {cliente: "", titolo: "", titolo_excel: "", ambito: "AI", tipologie: [], mercato: "", segmento: "", anno: "", temi: [], tecnologie: [], pitch: "", fonti: [], documenti: [],
      confidenza: "", materiale: "", da_verificare: false, note: "", descrizione_excel: "", tecnologie_excel: "", referente_aidata: "", referente_mercato: "", referente_progetto: "", owner: ""}
      : JSON.parse(JSON.stringify(rec));
    // racconto esteso: sezioni {sezione, tipo: "p"|"l", testo: testo | un punto per riga}
    let SEZ = (rec ? rec.esteso : ST.cfg.sezioni_standard.map(s => ({sezione: s, testo: ""}))).map(s => ({sezione: s.sezione, tipo: Array.isArray(s.testo) ? "l" : "p", testo: Array.isArray(s.testo) ? s.testo.join("\n") : s.testo}));
    const ED = {auto: new Set(), manuali: new Set(), proposto: "", matManuale: !nuova, sporco: false, rec};
    const ov = document.createElement("div"); ov.id = "rf-editor"; ov.className = "rf-ov";
    const tagsHtml = (k, label, ph) => `<div class="rf-f"><label>${label}</label><div class="rf-tagbox" data-tags="${k}"></div><input class="rf-taginp" data-taginp="${k}" placeholder="${ph} (Invio per aggiungere)"></div>`;
    ov.innerHTML = `<div class="rf-dlg" role="dialog" aria-modal="true" aria-label="${nuova ? "Nuova referenza" : "Modifica referenza"}">
      <header class="rf-dh"><div><h2>${nuova ? "Nuova referenza" : "Modifica referenza"}</h2>${rec ? `<div class="rf-muted">${E(rec.id)} · ${E(rec.origine)}${rec.modificata_il ? " · modificata il " + E(rec.modificata_il.replace("T", " ")) : ""}</div>` : ""}</div><button class="rf-x" id="rf-x" aria-label="Chiudi">${icona("x")}</button></header>
      <div class="rf-db">
        <div class="rf-grid">
          <div class="rf-f"><label>Cliente *</label><input data-k="cliente" list="rf-cli-dl"><datalist id="rf-cli-dl">${[...new Set(ST.dati.map(r => r.cliente))].sort((a, b) => a.localeCompare(b, "it")).map(c => `<option value="${E(c)}">`).join("")}</datalist></div>
          <div class="rf-f"><label>Titolo *</label><input data-k="titolo"></div>
          <div class="rf-f"><label>Ambito *</label><select data-k="ambito">${ST.cfg.ambiti.map(a => `<option value="${E(a)}">${E(ST.cfg.ambito_etichetta[a] || a)}</option>`).join("")}</select></div>
          <div class="rf-f"><label>Mercato *</label><select data-k="mercato"><option value="">— scegli —</option>${ST.cfg.mercati.map(x => `<option>${E(x)}</option>`).join("")}</select></div>
          <div class="rf-f full"><label>Tipologie</label><div class="rf-chips" id="rf-tip"></div></div>
          <div class="rf-f"><label>Segmento</label><input data-k="segmento"></div>
          <div class="rf-f"><label>Anno</label><input data-k="anno" inputmode="numeric" maxlength="4" placeholder="es. 2024"></div>
          ${tagsHtml("temi", "Temi", "es. Forecast")}${tagsHtml("tecnologie", "Tecnologie", "es. Databricks")}
          <div class="rf-f full"><label>Racconto da 30 secondi</label><textarea data-k="pitch" rows="3"></textarea></div>
        </div>
        <h3 class="rf-sh">Racconto esteso</h3>
        <div id="rf-sez"></div>
        <div class="rf-row"><button class="rf-btn" id="rf-addsez">${icona("plus")}Aggiungi sezione</button><button class="rf-btn" id="rf-addstd">Aggiungi le sezioni standard mancanti</button></div>
        <h3 class="rf-sh">Fonti e referenti</h3>
        <div class="rf-grid">
          ${tagsHtml("fonti", "Fonti", "es. Deck AI slide 12")}${tagsHtml("documenti", "Documenti (ID)", "es. AI-32")}
          <div class="rf-f"><label>Referente AI&Data</label><input data-k="referente_aidata"></div><div class="rf-f"><label>Referente mercato</label><input data-k="referente_mercato"></div>
          <div class="rf-f"><label>Referente progetto</label><input data-k="referente_progetto"></div><div class="rf-f"><label>Owner</label><input data-k="owner"></div>
          <div class="rf-f"><label>Confidenza</label><select data-k="confidenza"><option value="">—</option>${ST.cfg.confidenze.map(x => `<option value="${x}">${E(confLabel[x] || x)}</option>`).join("")}</select></div>
          <div class="rf-f"><label>Materiale</label><select data-k="materiale">${ST.cfg.materiale.map(x => `<option value="${x}">${E((BADGE[x] || [x])[0])}</option>`).join("")}</select><div class="rf-hint" id="rf-mat-h"></div></div>
          <div class="rf-f full"><label>Campi mancanti</label><div class="rf-chks" id="rf-mancanti"></div><div class="rf-hint">I campi con il segno “calcolato” si ricavano dai dati della scheda e si tolgono compilandoli; gli altri li gestisci tu.</div></div>
          <div class="rf-f"><label>Descrizione (dall'Excel)</label><textarea data-k="descrizione_excel" rows="3"></textarea></div><div class="rf-f"><label>Tecnologie (dall'Excel)</label><textarea data-k="tecnologie_excel" rows="3"></textarea></div>
          <div class="rf-f full"><label class="rf-chk"><input type="checkbox" data-k="da_verificare"> Da verificare</label><textarea data-k="note" rows="2" placeholder="Note / motivo della verifica"></textarea></div>
        </div>
        <div class="rf-err" id="rf-err"></div><div id="rf-storico"></div>
      </div>
      <footer class="rf-df"><div class="rf-row">${rec ? `<button class="rf-btn" id="rf-st">${icona("clock")}Storico</button>${rec.da_verificare ? `<button class="rf-btn" id="rf-ver">Segna come verificata</button>` : ""}
        <button class="rf-btn" id="rf-arc">${rec.archiviata ? "Ripristina" : "Archivia"}</button><button class="rf-btn danger" id="rf-del">${icona("trash-2")}Elimina</button>` : ""}</div>
        <div class="rf-row"><button id="rf-ann">Annulla</button><button class="primary" id="rf-salva">Salva</button></div></footer></div>`;
    document.body.appendChild(ov); document.body.style.overflow = "hidden";
    const $e = s => qs(s, ov), allE = s => ov.querySelectorAll(s);
    const toccato = () => ED.sporco = true;

    // campi semplici
    allE("[data-k]").forEach(el => {
      const k = el.dataset.k;
      if (el.type === "checkbox") { el.checked = !!D[k]; el.onchange = () => { D[k] = el.checked; toccato(); }; }
      else { el.value = D[k] ?? ""; el.oninput = el.onchange = () => { D[k] = el.value; toccato(); if (CAMPI_RIL.includes(k)) ricalcola(); if (k === "ambito") { D.tipologie = []; disegnaTip(); } }; }
    });
    // tipologie filtrate per ambito
    const disegnaTip = () => {
      const lista = [...(ST.cfg.tipologie[D.ambito] || []), ...D.tipologie.filter(t => !(ST.cfg.tipologie[D.ambito] || []).includes(t))];
      $e("#rf-tip").innerHTML = lista.map(t => `<button type="button" class="rf-chip k ${D.tipologie.includes(t) ? "on" : ""}" data-t="${E(t)}">${E(t)}</button>`).join("");
      allE("#rf-tip [data-t]").forEach(b => b.onclick = () => { const i = D.tipologie.indexOf(b.dataset.t); i >= 0 ? D.tipologie.splice(i, 1) : D.tipologie.push(b.dataset.t); toccato(); disegnaTip(); });
    };
    // etichette (temi, tecnologie, fonti, documenti)
    const disegnaTag = k => {
      const box = $e(`[data-tags="${k}"]`);
      box.innerHTML = (D[k] || []).map((v, i) => `<span class="rf-etic">${E(v)}<button type="button" data-rm="${k}:${i}" aria-label="Rimuovi ${E(v)}">×</button></span>`).join("") || `<span class="rf-muted">nessuno</span>`;
      box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { D[k].splice(+b.dataset.rm.split(":")[1], 1); toccato(); disegnaTag(k); if (CAMPI_RIL.includes(k)) ricalcola(); });
    };
    allE("[data-taginp]").forEach(inp => {
      const k = inp.dataset.taginp, aggiungi = () => { const v = inp.value.replace(/[;,]+$/, "").trim(); if (v && !D[k].includes(v)) { D[k].push(v); toccato(); disegnaTag(k); if (CAMPI_RIL.includes(k)) ricalcola(); } inp.value = ""; };
      inp.onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); aggiungi(); } };
      inp.onblur = aggiungi;
    });
    ["temi", "tecnologie", "fonti", "documenti"].forEach(disegnaTag);

    // racconto esteso a sezioni
    const leggiSez = () => { allE(".rf-sezione").forEach((el, i) => { SEZ[i].sezione = qs(".rf-s-t", el).value; SEZ[i].testo = qs(".rf-s-x", el).value; }); };
    const disegnaSez = () => {
      $e("#rf-sez").innerHTML = SEZ.map((s, i) => `<div class="rf-sezione"><div class="rf-s-h"><input class="rf-s-t" list="rf-std" value="${E(s.sezione)}" placeholder="Titolo della sezione">
        <div class="rf-s-tipo"><button type="button" class="${s.tipo === "p" ? "on" : ""}" data-tipo="${i}:p">Paragrafo</button><button type="button" class="${s.tipo === "l" ? "on" : ""}" data-tipo="${i}:l">Elenco</button></div>
        <button type="button" class="rf-ib" data-su="${i}" aria-label="Sposta su" ${i ? "" : "disabled"}>↑</button><button type="button" class="rf-ib" data-giu="${i}" aria-label="Sposta giù" ${i < SEZ.length - 1 ? "" : "disabled"}>↓</button>
        <button type="button" class="rf-ib" data-del="${i}" aria-label="Rimuovi sezione">✕</button></div>
        <textarea class="rf-s-x" rows="${s.tipo === "l" ? 4 : 3}" placeholder="${s.tipo === "l" ? "Un punto per riga" : "Testo"}">${E(s.testo)}</textarea></div>`).join("") + `<datalist id="rf-std">${ST.cfg.sezioni_standard.map(x => `<option value="${E(x)}">`).join("")}</datalist>`;
      allE(".rf-sezione input,.rf-sezione textarea").forEach(el => el.oninput = () => { toccato(); leggiSez(); ricalcola(); });
      allE("[data-tipo]").forEach(b => b.onclick = () => { leggiSez(); const [i, t] = b.dataset.tipo.split(":"); SEZ[+i].tipo = t; toccato(); disegnaSez(); });
      allE("[data-su]").forEach(b => b.onclick = () => { leggiSez(); const i = +b.dataset.su; [SEZ[i - 1], SEZ[i]] = [SEZ[i], SEZ[i - 1]]; toccato(); disegnaSez(); });
      allE("[data-giu]").forEach(b => b.onclick = () => { leggiSez(); const i = +b.dataset.giu; [SEZ[i + 1], SEZ[i]] = [SEZ[i], SEZ[i + 1]]; toccato(); disegnaSez(); });
      allE("[data-del]").forEach(b => b.onclick = () => { leggiSez(); SEZ.splice(+b.dataset.del, 1); toccato(); disegnaSez(); ricalcola(); });
    };
    $e("#rf-addsez").onclick = () => { leggiSez(); SEZ.push({sezione: "", tipo: "p", testo: ""}); toccato(); disegnaSez(); };
    $e("#rf-addstd").onclick = () => { leggiSez(); const ha = new Set(SEZ.map(s => s.sezione.trim().toLowerCase())); ST.cfg.sezioni_standard.filter(s => !ha.has(s.toLowerCase())).forEach(s => SEZ.push({sezione: s, tipo: s.startsWith("Spunti") ? "l" : "p", testo: ""})); toccato(); disegnaSez(); };
    disegnaSez();
    disegnaTip();

    // campi mancanti e materiale proposto: le regole stanno sul server (una sola definizione)
    const esteso = () => { leggiSez(); return SEZ.filter(s => s.sezione.trim() && s.testo.trim()).map(s => ({sezione: s.sezione.trim(), testo: s.tipo === "l" ? s.testo.split("\n").map(x => x.trim()).filter(Boolean) : s.testo.trim()})); };
    const bozza = () => ({...D, esteso: esteso(), campi_mancanti: [...ED.manuali]});
    const disegnaMancanti = () => {
      $e("#rf-mancanti").innerHTML = ST.cfg.campi_mancanti.map(v => { const auto = ED.auto.has(v), on = auto || ED.manuali.has(v);
        return `<label class="rf-chk ${auto ? "auto" : ""}" ${auto ? 'title="Si ricava dai dati della scheda: compila il campo per toglierlo"' : ""}><input type="checkbox" data-mv="${E(v)}" ${on ? "checked" : ""} ${auto ? "disabled" : ""}> ${E(v)}${auto ? ` <em>calcolato</em>` : ""}</label>`; }).join("");
      allE("[data-mv]").forEach(c => c.onchange = () => { c.checked ? ED.manuali.add(c.dataset.mv) : ED.manuali.delete(c.dataset.mv); toccato(); });
    };
    const disegnaMat = () => {
      const sel = $e('[data-k="materiale"]');
      if (!ED.matManuale && ED.proposto) { D.materiale = ED.proposto; sel.value = ED.proposto; }
      else sel.value = D.materiale;
      $e("#rf-mat-h").innerHTML = ED.proposto ? `Proposto dall'app: <b>${E((BADGE[ED.proposto] || [ED.proposto])[0])}</b> (in base a sezioni del racconto e fonti)${ED.matManuale && D.materiale !== ED.proposto ? ` · <a href="#" id="rf-usa">usa il proposto</a>` : ""}` : "";
      const a = $e("#rf-usa"); if (a) a.onclick = e => { e.preventDefault(); ED.matManuale = false; disegnaMat(); toccato(); };
    };
    $e('[data-k="materiale"]').addEventListener("change", () => { ED.matManuale = true; disegnaMat(); });
    let timer = null, seq = 0;
    const ricalcola = (iniziale) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const mio = ++seq;
        try {
          const r = await api("/api/referenze/calcola", {method: "POST", body: {dati: bozza(), id: rec && rec.id}});
          if (mio !== seq || !qs("#rf-editor")) return;
          ED.auto = new Set(r.automatici); ED.proposto = r.materiale_proposto;
          if (iniziale) ED.manuali = new Set((rec ? rec.campi_mancanti : []).filter(v => !ED.auto.has(v)));     // le voci non calcolate (importate o scritte a mano) restano
          disegnaMancanti(); disegnaMat();
        } catch (e) {}
      }, iniziale ? 0 : 350);
    };
    if (rec) { /* all'apertura: le voci già presenti ma non calcolabili dai dati sono "a mano" */
      api("/api/referenze/calcola", {method: "POST", body: {dati: {...D, esteso: rec.esteso, campi_mancanti: []}, id: rec.id}}).then(r => { ED.auto = new Set(r.automatici); ED.proposto = r.materiale_proposto;
        ED.manuali = new Set(rec.campi_mancanti.filter(v => !ED.auto.has(v))); disegnaMancanti(); disegnaMat(); }).catch(() => {});
    } else ricalcola(true);

    // chiusura e azioni
    const chiudi = (forza) => { if (!forza && ED.sporco && !confirm("Ci sono modifiche non salvate. Chiudere comunque?")) return; ov.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") chiudi(false); };
    document.addEventListener("keydown", esc);
    $e("#rf-x").onclick = $e("#rf-ann").onclick = () => chiudi(false);
    const ricarica = async msg => { await caricaDati(); await aggiornaConteggioCompletare(); chiudi(true); toast(msg); monta(m); };
    const errore = e => { $e("#rf-err").textContent = e.message; $e("#rf-err").scrollIntoView({block: "nearest"}); };
    $e("#rf-salva").onclick = async () => {
      $e("#rf-err").textContent = "";
      const corpo = {...D, esteso: esteso(), campi_mancanti: [...ED.manuali]};
      if (!ED.matManuale && ED.proposto) corpo.materiale = ED.proposto;
      try {
        const r = rec ? await api(`/api/referenze/${encodeURIComponent(rec.id)}`, {method: "PUT", body: corpo}) : await api("/api/referenze", {method: "POST", body: corpo});
        await ricarica(rec ? `Referenza ${r.id} salvata` : `Referenza ${r.id} creata`);
      } catch (e) { errore(e); }
    };
    if (rec) {
      $e("#rf-st").onclick = async () => {
        const box = $e("#rf-storico"); if (box.innerHTML) { box.innerHTML = ""; return; }
        const log = await api(`/api/referenze/${encodeURIComponent(rec.id)}/storico`);
        const val = v => v === null || v === undefined ? "—" : typeof v === "object" ? (Array.isArray(v) ? v.map(x => typeof x === "object" ? x.sezione : x).join(" · ") : "(scheda intera)") : String(v);
        box.innerHTML = `<h3 class="rf-sh">Storico delle modifiche</h3>${log.length ? `<table class="rf-tab"><thead><tr><th>Data e ora</th><th>Campo</th><th>Valore precedente</th></tr></thead><tbody>${log.map(e => `<tr><td>${E(e.data_ora.replace("T", " "))}</td><td>${E(e.campo)}</td><td class="rf-prima" title="${E(val(e.valore_precedente))}">${E(val(e.valore_precedente).slice(0, 160))}</td></tr>`).join("")}</tbody></table>` : `<p class="rf-muted">Nessuna modifica registrata.</p>`}`;
      };
      const v = $e("#rf-ver"); if (v) v.onclick = async () => { try { await api(`/api/referenze/${encodeURIComponent(rec.id)}/verifica`, {method: "POST"}); await ricarica("Segnata come verificata"); } catch (e) { errore(e); } };
      $e("#rf-arc").onclick = async () => { try { await api(`/api/referenze/${encodeURIComponent(rec.id)}/archivia`, {method: "POST", body: {archiviata: !rec.archiviata}}); await ricarica(rec.archiviata ? "Referenza ripristinata" : "Referenza archiviata"); } catch (e) { errore(e); } };
      $e("#rf-del").onclick = async () => {
        if (!confirm(`Eliminare definitivamente la referenza ${rec.id} (${rec.cliente})?\nLa scheda resta nello storico delle modifiche, ma sparisce dall'archivio.`)) return;
        try { await api(`/api/referenze/${encodeURIComponent(rec.id)}`, {method: "DELETE"}); await ricarica("Referenza eliminata"); } catch (e) { errore(e); }
      };
    }
    setTimeout(() => $e('[data-k="cliente"]').focus(), 50);
  }

  // ---------------------------------------------------------------- schermata del primo caricamento
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

  function monta(m) { ST.vista === "completare" ? montaCompletare(m) : montaRicerca(m); }

  const R = {
    async render(m) {
      m.innerHTML = `<p class="muted pad">Caricamento…</p>`;
      let d;
      try { ST.cfg = await api("/api/referenze/config"); d = await caricaDati(); }
      catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
      if (S.view !== "referenze") return;
      if (d.stato !== "ok") { schermataVuota(m, d); return; }
      ST.SIN = indicizzaSinonimi(ST.cfg.sinonimi);
      aggiornaConteggioCompletare().then(() => { const b = qs(".rf-tabs [data-v=completare]", m); if (b && ST.nCompletare != null) b.innerHTML = `Da completare<span>${ST.nCompletare}</span>`; });
      monta(m);
    },
    // chiamata dall'esterno (scheda Cliente): apre la ricerca già filtrata per cliente
    filtraPerCliente(nome) { ST.vista = "ricerca"; ST.f = {q: "", cliente: nome || "", ambito: "", tipologia: "", mercato: ""}; },
  };
  window.Referenze = R;
})();
