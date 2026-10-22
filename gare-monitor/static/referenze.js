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
  // f.ids (opzionale): elenco esatto di referenze, usato dal collegamento della scheda Cliente (il nome si abbina senza maiuscole, punteggiatura e S.p.A.)
  const corrispondeCl = (r, f) => f.ids ? f.ids.has(r.id) : corrispondeCliente(r, f.cliente);
  const corrispondeAmbito = (r, f) => (!f.ambito || r.ambito === f.ambito) && (!f.tipologia || (r.tipologie || []).includes(f.tipologia));

  // f = {q, cliente, ambito, tipologia, mercato}
  function cerca(dati, f, SIN) {
    const gruppi = gruppiDiRicerca(f.q, SIN);
    const ris = dati.filter(r => corrispondeArgomento(r, gruppi) && corrispondeCl(r, f) && (!f.mercato || r.mercato === f.mercato) && corrispondeAmbito(r, f));
    ris.forEach(r => r._s = punteggio(r, gruppi));
    ris.sort((a, b) => (b._s - a._s) || ((ORDINE_MATERIALE[a.materiale] ?? 3) - (ORDINE_MATERIALE[b.materiale] ?? 3)));
    return ris;
  }
  // base per i conteggi dei filtri: argomento + cliente (+ mercato/ambito se richiesti)
  function conteggi(dati, f, SIN) {
    const gruppi = gruppiDiRicerca(f.q, SIN);
    const baseTC = dati.filter(r => corrispondeArgomento(r, gruppi) && corrispondeCl(r, f));
    return {
      gruppi,
      mercato: m => baseTC.filter(r => r.mercato === m && corrispondeAmbito(r, f)).length,
      ambito: a => baseTC.filter(r => (!f.mercato || r.mercato === f.mercato) && (!a || r.ambito === a)).length,
      tipologia: t => baseTC.filter(r => (!f.mercato || r.mercato === f.mercato) && r.ambito === f.ambito && (r.tipologie || []).includes(t)).length,
    };
  }

  // testo semplice per gli appunti: racconto da 30 secondi + racconto esteso (sezioni con titolo, elenchi con "• ")
  function testoPerCopia(r) {
    const parti = [`${r.titolo} — ${r.cliente}${r.anno ? " (" + r.anno + ")" : ""}`, "", "IN 30 SECONDI", String(r.pitch || "").trim()];
    if ((r.esteso || []).length) parti.push("", "RACCONTO ESTESO");
    (r.esteso || []).forEach(s => { parti.push("", s.sezione, Array.isArray(s.testo) ? s.testo.map(x => "• " + x).join("\n") : String(s.testo || "").trim()); });
    return parti.join("\n").trim() + "\n";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {normTxt, indicizzaSinonimi, gruppiDiRicerca, punteggio, cerca, conteggi, testoPerCopia};
    return;
  }

  // ------------------------------------------------------------ interfaccia
  const qs = (s, el = document) => el.querySelector(s);
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const icona = n => (typeof ico === "function" ? ico(n) : "");       // icone dell'app (definite in app.js)
  const BADGE = {ricco: ["Pronta", "ok", "Materiale ricco: pronta da raccontare"], medio: ["Da arricchire", "mid", "Racconto presente ma con poco materiale di dettaglio"],
    scarso: ["Da completare", "low", "Poco materiale: serve completarla"]};
  const SUGGERIMENTI = ["forecast", "chatbot", "rag", "data platform", "dwh", "governance"];
  const nomeCliente = c => String(c == null ? "" : c).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim() || String(c || "");     // "ACEA (UTILITY OPERATOR)" -> "ACEA"
  const salvata = (k, def) => { try { return localStorage.getItem(k) || def; } catch (e) { return def; } };

  const ST = {cfg: null, SIN: null, dati: [], tab: "cerca", vista: salvata("rf_vista", "cards"), mostraArch: false, root: null, sel: null, io: null, pres: null,
    f: {q: "", cliente: "", ambito: "", tipologia: "", mercato: ""}};

  async function caricaDati() {
    const d = await api("/api/referenze" + (ST.mostraArch ? "?archiviate=1" : ""));
    if (d.stato !== "ok") return d;
    ST.dati = d.referenze; ST.dati.forEach(r => delete r._h);
    return d;
  }
  // le schede Da completare / Da verificare sono sottoinsiemi dell'archivio: i filtri, i conteggi e l'ordinamento lavorano su quello
  const perTab = () => ST.tab === "comp" ? ST.dati.filter(r => r.materiale === "scarso") : ST.tab === "ver" ? ST.dati.filter(r => r.da_verificare) : ST.dati;
  const viva = r => !r.archiviata;

  // ---------------------------------------------------------------- scheda
  const estesoHtml = (r, soloRacconto) => (r.esteso || []).filter(s => !(soloRacconto && /^Spunti/i.test(s.sezione))).map(s => `<h4>${E(s.sezione)}</h4>` + (Array.isArray(s.testo)
    ? `<ul class="${/^Spunti/i.test(s.sezione) ? "talk" : ""}">${s.testo.map(i => `<li>${E(i)}</li>`).join("")}</ul>` : `<p>${E(s.testo)}</p>`)).join("");
  function badgesHtml(r) {
    const [bl, bc, bt] = BADGE[r.materiale] || ["", "", ""];
    return (r.archiviata ? `<span class="rf-badge low">Archiviata</span>` : "") + (bl ? `<span class="rf-badge ${bc}" title="${E(bt)}">${bl}</span>` : "")
      + (r.da_verificare ? `<span class="rf-badge warn" title="${E(r.note || "Da verificare")}">Da verificare</span>` : "")
      + (r.origine && r.origine !== "Excel master" ? `<span class="rf-badge new" title="Non proviene dall'Excel master">Nuova</span>` : "");
  }
  function schedaHtml(r, aperta) {
    const tec = (r.tecnologie || []), tech = tec.slice(0, 6).join(" · ") + (tec.length > 6 ? ` · +${tec.length - 6}` : "");
    const referenti = [r.referente_aidata, r.referente_progetto].filter(Boolean), nome = nomeCliente(r.cliente);
    return `<article class="rf-card ${r.archiviata ? "arch" : ""}" data-id="${E(r.id)}">
      <div class="rf-meta"><div class="rf-who"><a href="#" class="rf-cliname" data-cli="${E(nome)}" title="Tutte le referenze di ${E(nome)}">${E(nome)}</a>
        <span class="rf-dot">·</span>${E(r.mercato)}${r.anno ? `<span class="rf-dot">·</span>${E(r.anno)}` : ""}<span class="rf-dot">·</span><span>${E(r.id)}</span></div>
        <div class="rf-right">${badgesHtml(r)}<button class="rf-ib" data-copia="${E(r.id)}" title="Copia testo" aria-label="Copia testo">${icona("copy")}</button><button class="rf-ib" data-edit="${E(r.id)}" title="Modifica" aria-label="Modifica">${icona("pencil")}</button></div></div>
      <h3 class="rf-tit">${E(r.titolo)}</h3>
      ${ST.tab === "ver" && r.da_verificare ? `<div class="rf-motivo"><b>Da verificare:</b> ${E(r.note || "motivo non indicato")}</div>` : ""}
      <div class="rf-pitch"><span class="rf-lblp">In 30 secondi</span>${E(r.pitch)}</div>
      <div class="rf-facts">${(r.tipologie || []).map(c => `<span class="rf-tag">${E(c)}</span>`).join("")}${tech ? `<span class="rf-tech">${E(tech)}</span>` : ""}</div>
      <details ${aperta ? "open" : ""}><summary>Racconto esteso</summary><div class="rf-ext">${estesoHtml(r) || `<p class="rf-muted">Nessun racconto esteso.</p>`}</div>
        <div class="rf-src">${(r.fonti || []).length ? "<b>Fonti</b> " + E(r.fonti.join(" · ")) : "<b>Fonte</b> solo Excel master"}${(r.campi_mancanti || []).length ? ` · <b>Manca</b> ${E(r.campi_mancanti.join(", "))}` : ""}${referenti.length ? ` · <b>Referenti</b> ${E(referenti.join(", "))}` : ""}</div></details></article>`;
  }

  // ---------------------------------------------------------------- testata (nella barra dell'app) e menu "⋯"
  function disegnaTestata() {
    const box = document.getElementById("rf-actions"); if (!box) return;
    box.innerHTML = `<button class="rf-btn" id="rf-pres" title="Schermo intero, testo grande e solo il racconto: per girare lo schermo verso il cliente">${icona("presentation")}<span class="lab">Modalità presentazione</span></button>
      <button class="primary" id="rf-nuova">${icona("plus")}<span class="lab">Nuova referenza</span></button>
      <button class="rf-btn rf-ico" id="rf-more" aria-label="Altre azioni" aria-haspopup="true" aria-expanded="false">${icona("ellipsis")}</button>
      <div class="rf-menu" id="rf-menu" role="menu" hidden>
        <button id="rf-imps" role="menuitem">${icona("file-spreadsheet")}Importa scheda</button><button id="rf-impx" role="menuitem">${icona("file-spreadsheet")}Importa da Excel</button>
        <button id="rf-exp" role="menuitem">${icona("download")}Esporta in Excel</button><hr>
        <label class="rf-chk"><input type="checkbox" id="rf-arch" ${ST.mostraArch ? "checked" : ""}> Mostra archiviate</label></div>`;
    const menu = qs("#rf-menu", box), apri = on => { menu.hidden = !on; qs("#rf-more", box).setAttribute("aria-expanded", on ? "true" : "false"); };
    qs("#rf-more", box).onclick = e => { e.stopPropagation(); apri(menu.hidden); };
    box.onclick = e => { if (e.target.closest("#rf-menu button")) apri(false); };
    qs("#rf-nuova", box).onclick = () => apriEditor(ST.root, null);
    qs("#rf-pres", box).onclick = () => apriPresentazione();
    qs("#rf-exp", box).onclick = () => { window.location.href = "/api/referenze/export" + (ST.mostraArch ? "?archiviate=1" : ""); };     // formato del file consolidato; con "Mostra archiviate" attivo include anche le archiviate
    qs("#rf-impx", box).onclick = () => caricaModuloDati().then(M => M.importaExcel(ctxDati())).catch(e => toast(e.message, true));
    qs("#rf-imps", box).onclick = () => caricaModuloDati().then(M => M.importaScheda(ctxDati())).catch(e => toast(e.message, true));
    qs("#rf-arch", box).onchange = async e => { ST.mostraArch = e.target.checked; await caricaDati(); aggiorna(); };
    if (!ST.chiusuraMenu) {
      ST.chiusuraMenu = true;
      document.addEventListener("click", e => { const mn = document.getElementById("rf-menu"); if (mn && !mn.hidden && !e.target.closest("#rf-actions")) mn.hidden = true; });
    }
  }
  // importazione da Excel / JSON: modulo separato, caricato solo al primo clic su "Importa…"
  let _modDati = null;
  function caricaModuloDati() {
    if (_modDati) return _modDati;
    const v = encodeURIComponent((S.state && S.state.version) || "0");
    return _modDati = new Promise((ok, ko) => {
      const sc = document.createElement("script"); sc.src = "/static/referenze_dati.js?v=" + v;
      sc.onload = () => ok(window.ReferenzeDati); sc.onerror = () => { _modDati = null; ko(new Error("Non riesco a caricare il modulo di importazione")); };
      document.head.appendChild(sc);
    });
  }
  const ctxDati = () => ({api, toast, ricarica: async () => { await caricaDati(); monta(ST.root); }});

  async function copiaTesto(r) {
    const t = testoPerCopia(r);
    try { await navigator.clipboard.writeText(t); }
    catch (e) {                                           // appunti non disponibili (es. pagina non sicura): ripiego con una selezione temporanea
      const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    toast(`Testo copiato: ${r.cliente}`);
  }
  function bindCopia(m, box) {
    box.querySelectorAll("[data-copia]").forEach(b => b.onclick = () => { const r = ST.dati.find(x => x.id === b.dataset.copia); if (r) copiaTesto(r); });
  }
  function bindModifica(m, box) {
    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => {
      const r = ST.dati.find(x => x.id === b.dataset.edit) || await api("/api/referenze?archiviate=1").then(d => d.referenze.find(x => x.id === b.dataset.edit));
      apriEditor(m, r);
    });
  }

  // ---------------------------------------------------------------- modalità presentazione: schermo intero sopra l'app, solo testi del racconto
  function apriPresentazione() {
    esciPresentazione();
    const el = document.createElement("div"); el.id = "rf-presov"; el.className = "rf-presov"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="rf-pbar"><div class="rf-field">${icona("search")}<input id="rf-pq" placeholder="Cosa vi interessa? es. forecast, chatbot…" autocomplete="off" value="${E(ST.f.q)}"></div>
      <button class="rf-btn" id="rf-pclose">Esci <kbd>Esc</kbd></button></div><div class="rf-pbody" id="rf-pbody"></div>`;
    document.body.appendChild(el);
    ST.pres = {el, lista: [], i: -1};
    qs("#rf-pclose", el).onclick = esciPresentazione;
    qs("#rf-pq", el).oninput = () => { ST.pres.i = -1; disegnaPresentazione(); };
    if (!ST.tastiPres) {
      ST.tastiPres = true;
      document.addEventListener("keydown", e => {
        const P = ST.pres; if (!P) return;
        if (e.key === "Escape") { if (P.i >= 0) { P.i = -1; disegnaPresentazione(); } else esciPresentazione(); }
        else if (P.i >= 0 && e.target.id !== "rf-pq") {
          if (e.key === "ArrowRight" && P.i < P.lista.length - 1) { P.i++; disegnaPresentazione(); }
          else if (e.key === "ArrowLeft" && P.i > 0) { P.i--; disegnaPresentazione(); }
        }
      });
    }
    disegnaPresentazione();
    setTimeout(() => { const i = qs("#rf-pq", el); if (i) i.focus(); }, 50);
  }
  function esciPresentazione() { if (ST.pres) { ST.pres.el.remove(); ST.pres = null; } }
  function disegnaPresentazione() {
    const P = ST.pres, b = qs("#rf-pbody", P.el);
    if (P.i < 0) {
      const q = qs("#rf-pq", P.el).value, vive = ST.dati.filter(viva);
      const ris = cerca(vive, {q, cliente: "", ambito: "", tipologia: "", mercato: ""}, ST.SIN);
      P.lista = q.trim() ? ris.slice(0, 24) : ris.filter(r => r.materiale === "ricco").slice(0, 24);
      b.innerHTML = `<div class="rf-pinfo">${q.trim() ? `${ris.length} ${ris.length === 1 ? "referenza" : "referenze"} · mostrate le più pertinenti` : "Scrivi un argomento, oppure scegli una referenza"}</div>
        <div class="rf-pgrid">${P.lista.map((r, i) => `<button class="rf-ptile" data-pi="${i}"><div class="c">${E(nomeCliente(r.cliente))} · ${E(r.mercato)}</div><div class="t">${E(r.titolo)}</div></button>`).join("")}</div>`;
      b.querySelectorAll("[data-pi]").forEach(x => x.onclick = () => { P.i = +x.dataset.pi; disegnaPresentazione(); });
      return;
    }
    const r = P.lista[P.i];
    b.innerHTML = `<div class="rf-pview"><div class="c"><b>${E(nomeCliente(r.cliente))}</b> · ${E(r.mercato)}${r.anno ? " · " + E(r.anno) : ""}</div><h2>${E(r.titolo)}</h2>
      <div class="rf-pitch">${E(r.pitch)}</div><div class="rf-ext">${estesoHtml(r, true)}</div>
      <div class="rf-pnav"><button class="rf-btn" id="rf-pback">← Tutti i risultati</button><span><kbd>←</kbd> <kbd>→</kbd> ${P.i + 1} di ${P.lista.length}</span></div></div>`;
    qs("#rf-pback", b).onclick = () => { P.i = -1; disegnaPresentazione(); };
    b.scrollTop = 0;
  }

  // ---------------------------------------------------------------- vista unica (Ricerca / Da completare / Da verificare)
  const filtriAttivi = () => !!(ST.f.q.trim() || ST.f.cliente.trim() || ST.f.ids || ST.f.ambito || ST.f.tipologia || ST.f.mercato);
  const azzera = () => { ST.f = {q: "", cliente: "", ambito: "", tipologia: "", mercato: ""}; qs("#rf-q").value = ""; qs("#rf-cl").value = ""; };

  function disegnaFiltri() {
    const f = ST.f, base = perTab(), C = conteggi(base, f, ST.SIN), tipologie = ST.cfg.tipologie, etic = ST.cfg.ambito_etichetta || {};
    const nA = C.ambito("");
    qs("#rf-amb").innerHTML = `<option value="">Ambito: tutti (${nA})</option>` + ST.cfg.ambiti.map(a => `<option value="${E(a)}" ${f.ambito === a ? "selected" : ""}>${E(etic[a] || a)} (${C.ambito(a)})</option>`).join("");
    const sTip = qs("#rf-tip");
    sTip.disabled = !f.ambito;
    if (!f.ambito) sTip.innerHTML = `<option>Tipologia: prima scegli l'ambito</option>`;
    else {
      const note = [...new Set(ST.dati.filter(r => r.ambito === f.ambito).flatMap(r => r.tipologie || []))].filter(t => !(tipologie[f.ambito] || []).includes(t)).sort((a, b) => a.localeCompare(b, "it"));
      sTip.innerHTML = `<option value="">Tipologia: tutte</option>` + [...(tipologie[f.ambito] || []), ...note].map(t => { const n = C.tipologia(t);
        return n || f.tipologia === t ? `<option value="${E(t)}" ${f.tipologia === t ? "selected" : ""}>${E(t)} (${n})</option>` : ""; }).join("");
    }
    qs("#rf-mk").innerHTML = `<option value="">Mercato: tutti</option>` + ST.cfg.mercati.map(x => { const n = C.mercato(x);
      return n || f.mercato === x ? `<option value="${E(x)}" ${f.mercato === x ? "selected" : ""}>${E(x)} (${n})</option>` : ""; }).join("");
    [["#rf-ambw", f.ambito], ["#rf-tipw", f.tipologia], ["#rf-mkw", f.mercato]].forEach(([s, v]) => qs(s).classList.toggle("active", !!v));
    qs("#rf-view").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === ST.vista));
  }
  function disegnaChip() {
    const f = ST.f, c = [];
    if (f.q.trim()) c.push(["q", `“${f.q.trim()}”`]);
    if (f.ids) c.push(["cl", `Cliente: ${nomeCliente(f.cliente)} (${f.ids.size})`]); else if (f.cliente.trim()) c.push(["cl", "Cliente: " + f.cliente.trim()]);
    if (f.ambito) c.push(["amb", (ST.cfg.ambito_etichetta || {})[f.ambito] || f.ambito]);
    if (f.tipologia) c.push(["tip", f.tipologia]);
    if (f.mercato) c.push(["mk", f.mercato]);
    const sin = (ST.SIN[normTxt(f.q).trim()] || []).filter(s => s !== normTxt(f.q).trim());
    const box = qs("#rf-chips");
    box.innerHTML = c.map(([k, l]) => `<span class="rf-fchip">${E(l)}<button type="button" data-k="${k}" aria-label="Rimuovi filtro">${icona("x")}</button></span>`).join("")
      + (c.length > 1 ? `<button type="button" class="rf-link" id="rf-reset">Azzera filtri</button>` : "") + (sin.length ? `<small class="rf-syn">cerco anche: ${E(sin.join(", "))}</small>` : "");
    box.hidden = !c.length;
    box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === "q") { f.q = ""; qs("#rf-q").value = ""; } else if (k === "cl") { f.cliente = ""; f.ids = null; qs("#rf-cl").value = ""; }
      else if (k === "amb") { f.ambito = ""; f.tipologia = ""; } else if (k === "tip") f.tipologia = ""; else f.mercato = "";
      aggiorna();
    });
    const r = qs("#rf-reset", box); if (r) r.onclick = () => { azzera(); aggiorna(); };
  }
  function disegnaRisultati() {
    const m = ST.root, f = ST.f, ris = cerca(perTab(), f, ST.SIN), pronte = ris.filter(r => r.materiale === "ricco").length, n = ris.length;
    const plur = `referenz${n === 1 ? "a" : "e"}`;
    const testa = ST.tab === "comp" ? `<h2><b>${n}</b> ${plur} da completare</h2><small>Poco materiale nel master: aggiungi dettagli per renderle raccontabili</small>`
      : ST.tab === "ver" ? `<h2><b>${n}</b> ${plur} da verificare</h2><small>Abbinamenti incerti, doppioni o dati incoerenti: il motivo è sotto il titolo</small>`
      : `<h2>${filtriAttivi() ? "Abbiamo " : ""}<b>${n}</b> ${plur}${filtriAttivi() ? "" : " in libreria"}</h2><small>${pronte} pronte da raccontare</small>`;
    let corpo;
    if (!n) corpo = `<div class="rf-empty">Nessuna referenza trovata. Prova un sinonimo o togli un filtro.<div class="rf-try">${SUGGERIMENTI.map(t => `<button data-try="${E(t)}">${E(t)}</button>`).join("")}</div></div>`;
    else if (ST.vista === "list") {
      if (!ST.sel || !ris.some(r => r.id === ST.sel)) ST.sel = ris[0].id;
      const sel = ris.find(r => r.id === ST.sel), pallino = {ricco: "var(--st-won)", medio: "var(--text-3)", scarso: "var(--border)"};
      corpo = `<div class="rf-split"><div class="rf-list" role="listbox">${ris.map(r => `<button class="rf-li ${r.id === ST.sel ? "on" : ""}" data-sel="${E(r.id)}" role="option" aria-selected="${r.id === ST.sel}">
        <div class="t">${E(r.titolo)}</div><div class="m"><i style="background:${pallino[r.materiale] || "var(--border)"}" title="${E((BADGE[r.materiale] || [""])[0])}"></i>${E(nomeCliente(r.cliente))}${(r.tipologie || [])[0] ? " · " + E(r.tipologie[0]) : ""}</div></button>`).join("")}</div>
        <div class="rf-detail">${schedaHtml(sel, true)}</div></div>`;
    } else corpo = `<div class="rf-results">${ris.map(r => schedaHtml(r, false)).join("")}</div>`;
    const out = qs("#rf-out", m), scorri = (qs(".rf-list", out) || {}).scrollTop || 0;
    out.innerHTML = `<div class="${ST.vista === "list" ? "" : "rf-results"}"><div class="rf-rh">${testa}</div></div>` + corpo;
    const lista = qs(".rf-list", out); if (lista) lista.scrollTop = scorri;
    out.querySelectorAll("[data-cli]").forEach(a => a.onclick = e => {
      e.preventDefault(); azzera(); ST.f.cliente = a.dataset.cli; qs("#rf-cl").value = a.dataset.cli; aggiorna(); window.scrollTo({top: 0, behavior: "smooth"});
    });
    out.querySelectorAll("[data-try]").forEach(b => b.onclick = () => { azzera(); ST.f.q = b.dataset.try; qs("#rf-q").value = b.dataset.try; aggiorna(); });
    out.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => { ST.sel = b.dataset.sel; disegnaRisultati(); });
    bindModifica(m, out); bindCopia(m, out);
  }
  function aggiorna() {
    const m = ST.root; if (!m || !qs("#rf-out", m)) return;
    disegnaFiltri(); disegnaChip(); disegnaRisultati();
    const n = {comp: ST.dati.filter(r => viva(r) && r.materiale === "scarso").length, ver: ST.dati.filter(r => viva(r) && r.da_verificare).length};
    qs("#rf-ncomp", m).textContent = n.comp; qs("#rf-nver", m).textContent = n.ver;
    m.querySelectorAll(".rf-navtab").forEach(b => b.classList.toggle("on", b.dataset.tab === ST.tab));
    qs(".rf-wrap", m).style.setProperty("--rf-fh", qs("#rf-filters", m).offsetHeight + "px");       // la lista della vista Elenco si aggancia sotto la barra
  }

  function monta(m) {
    ST.root = m;
    if (ST.io) { ST.io.disconnect(); ST.io = null; }
    const clienti = [...new Set(ST.dati.map(r => nomeCliente(r.cliente)))].sort((a, b) => a.localeCompare(b, "it"));
    m.innerHTML = `<div class="rf-wrap">
      <div class="rf-navtabs" role="tablist"><button class="rf-navtab" data-tab="cerca" role="tab">Ricerca</button>
        <button class="rf-navtab" data-tab="comp" role="tab">Da completare<span class="rf-n" id="rf-ncomp"></span></button>
        <button class="rf-navtab" data-tab="ver" role="tab">Da verificare<span class="rf-n" id="rf-nver"></span></button></div>
      <div class="rf-filters" id="rf-filters">
        <div class="rf-frow"><div class="rf-field">${icona("search")}<input id="rf-q" placeholder="Cerca argomento o tecnologia: forecast, chatbot, Databricks…" autocomplete="off" value="${E(ST.f.q)}"></div>
          <div class="rf-field">${icona("building-2")}<input id="rf-cl" list="rf-clienti" placeholder="Cliente" autocomplete="off" value="${E(ST.f.cliente)}"><datalist id="rf-clienti">${clienti.map(c => `<option value="${E(c)}">`).join("")}</datalist></div></div>
        <div class="rf-frow2"><div class="rf-sel" id="rf-ambw"><select id="rf-amb" aria-label="Ambito"></select></div><div class="rf-sel" id="rf-tipw"><select id="rf-tip" aria-label="Tipologia"></select></div>
          <div class="rf-sel" id="rf-mkw"><select id="rf-mk" aria-label="Mercato"></select></div><div class="rf-spacer"></div>
          <div class="rf-segv" id="rf-view" role="group" aria-label="Vista"><button data-v="cards">${icona("rows-3")}Schede</button><button data-v="list">${icona("list")}Elenco</button></div></div>
        <div class="rf-chipsrow" id="rf-chips" hidden></div></div>
      <div id="rf-out"></div></div>`;
    disegnaTestata();
    m.querySelectorAll(".rf-navtab").forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.sel = null; aggiorna(); });
    qs("#rf-q", m).oninput = e => { ST.f.q = e.target.value; aggiorna(); };
    qs("#rf-cl", m).oninput = e => { ST.f.cliente = e.target.value; ST.f.ids = null; aggiorna(); };
    qs("#rf-amb", m).onchange = e => { ST.f.ambito = e.target.value; ST.f.tipologia = ""; aggiorna(); };
    qs("#rf-tip", m).onchange = e => { ST.f.tipologia = e.target.value; aggiorna(); };
    qs("#rf-mk", m).onchange = e => { ST.f.mercato = e.target.value; aggiorna(); };
    m.querySelectorAll("#rf-view button").forEach(b => b.onclick = () => { ST.vista = b.dataset.v; try { localStorage.setItem("rf_vista", ST.vista); } catch (e) {} aggiorna(); });
    if (window.IntersectionObserver) {                       // linea sottile sotto la barra quando si stacca dall'alto
      ST.io = new IntersectionObserver(([e]) => e.target.classList.toggle("stuck", e.intersectionRatio < 1), {threshold: [1], rootMargin: "-1px 0px 0px 0px"});
      ST.io.observe(qs("#rf-filters", m));
    }
    aggiorna();
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
    const ricarica = async msg => { await caricaDati(); chiudi(true); toast(msg); monta(m); };
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
    const ta = document.getElementById("rf-actions"); if (ta) ta.innerHTML = "";
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
      try { ST.cfg = await api("/api/referenze/config"); d = await caricaDati(); }
      catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
      if (S.view !== "referenze") return;
      if (d.stato !== "ok") { schermataVuota(m, d); return; }
      ST.SIN = indicizzaSinonimi(ST.cfg.sinonimi);
      monta(m);
    },
    // chiamata dall'esterno (scheda Cliente): apre la ricerca già filtrata per cliente
    filtraPerCliente(nome, ids) { ST.tab = "cerca"; ST.f = {q: "", cliente: nome || "", ambito: "", tipologia: "", mercato: "", ids: ids && ids.length ? new Set(ids) : null}; },
  };
  R.esci = () => { esciPresentazione(); const mn = document.getElementById("rf-menu"); if (mn) mn.hidden = true; };      // chiamata da app.js quando si lascia la vista
  window.Referenze = R;
})();
