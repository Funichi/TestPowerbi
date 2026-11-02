/* Stimometro — interfaccia, caricata solo alla prima apertura della vista "Stime" (vedi loadStime() in app.js).
   Il calcolo non è mai replicato qui: ogni modifica invia la stima al server (/api/stime/calcola), che usa il motore unico. */
(function () {
  "use strict";
  const qs = (s, el = document) => el.querySelector(s), qsa = (s, el = document) => [...el.querySelectorAll(s)];
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const icona = n => (typeof ico === "function" ? ico(n) : "");
  const copia = x => JSON.parse(JSON.stringify(x));
  const BLOCCHI = ["Analisi", "Disegno", "Architettura", "Implementazione", "Training", "Test", "Deploy"];     // il JSON del server ha le chiavi in ordine alfabetico

  // ---------------------------------------------------------------- numeri in formato italiano
  const NF = {};
  const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat("it-IT", {minimumFractionDigits: d, maximumFractionDigits: d}));
  const F = {
    gg: x => x == null ? "n/d" : nf(1).format(x),
    eur: x => x == null ? "n/d" : nf(2).format(x) + " €",
    eur0: x => x == null ? "n/d" : nf(0).format(x) + " €",
    pct: x => x == null ? "n/d" : nf(2).format(x * 100) + "%",
    fte: x => x == null ? "n/d" : nf(1).format(x),
    n: x => x == null ? "" : new Intl.NumberFormat("it-IT", {maximumFractionDigits: 4}).format(x),
  };
  // valore nei campi di input: virgola decimale, senza separatore delle migliaia
  const inNum = x => x == null || x === "" ? "" : String(+(+x).toFixed(6)).replace(".", ",");
  const inPct = x => x == null || x === "" ? "" : String(+(x * 100).toFixed(6)).replace(".", ",");
  // testo digitato -> numero ("6,5" -> 6.5; "750.000" -> 750000); vuoto -> null; non valido -> NaN
  function leggiNum(s) {
    let t = String(s == null ? "" : s).trim().replace(/[\s€%]/g, "");
    if (!t) return null;
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  const pctDaInput = n => n == null ? null : +(n / 100).toFixed(10);
  const uguali = (a, b) => (typeof a === "number" && typeof b === "number") ? Math.abs(a - b) < 1e-9 : JSON.stringify(a) === JSON.stringify(b);

  // ---------------------------------------------------------------- gare dell'app (chiave stabile: SS | anno della Data ins.)
  const chiaveGara = (ss, data) => { const s = String(ss || "").replace(/\s+/g, "").toUpperCase(), a = String(data || "").slice(0, 4); return s && /^\d{4}$/.test(a) ? `${s}|${a}` : null; };
  const etichettaGara = g => `${g.ss} · ${g.anno} · ${g.cliente || ""}${g.oggetto ? " — " + String(g.oggetto).slice(0, 70) : ""}`;
  async function caricaGare() {
    if (!window.S || !S.data) { try { S.data = await api("/api/data"); } catch (e) { return []; } }
    const vist = new Map();
    for (const r of S.data.rows || []) {
      const k = chiaveGara(r.SS, r["Data ins."]);
      if (k && !vist.has(k)) vist.set(k, {chiave: k, ss: k.split("|")[0], anno: +k.split("|")[1], data_ins: r["Data ins."], cliente: r.Cliente || "", oggetto: r.Oggetto || ""});
    }
    return [...vist.values()].sort((a, b) => b.anno - a.anno || a.ss.localeCompare(b.ss));
  }

  const ST = {vista: "elenco", cat: null, gare: [], elenco: [], filtri: {cliente: "", gara: "", q: ""}, s: null, res: null, sporco: false,
    tab: "moduli", root: null, timer: null, seq: 0, catEdit: null, catErr: ""};

  // ---------------------------------------------------------------- percorsi dei parametri: "sezione|codice|campo|indice"
  const contenitore = (obj, sez, cod) => (sez === "generali" || sez === "am") ? obj[sez] : (obj[sez] || []).find(x => x.codice === cod);
  function pget(obj, p) {
    const [sez, cod, campo, idx] = p.split("|"), c = contenitore(obj, sez, cod);
    if (!c) return undefined;
    const v = c[campo];
    return idx === "" || idx == null ? v : (v == null ? undefined : v[idx]);
  }
  function pset(obj, p, val) {
    const [sez, cod, campo, idx] = p.split("|"), c = contenitore(obj, sez, cod);
    if (!c) return;
    if (idx === "" || idx == null) c[campo] = val;
    else { if (c[campo] == null) c[campo] = /^\d+$/.test(idx) ? [0, 0, 0] : {}; c[campo][idx] = val; }
  }

  // ---------------------------------------------------------------- caricamento
  async function caricaCatalogo() { ST.cat = await api("/api/stime/catalogo"); }
  async function caricaElenco() {
    const f = ST.filtri, q = new URLSearchParams();
    if (f.cliente) q.set("cliente", f.cliente); if (f.gara) q.set("gara", f.gara); if (f.q) q.set("q", f.q);
    ST.elenco = (await api("/api/stime?" + q)).stime;
  }

  function schede() {
    return `<div class="st-tabs" role="tablist"><button class="st-tab ${ST.vista !== "catalogo" ? "on" : ""}" data-vai="elenco">Stime</button>
      <button class="st-tab ${ST.vista === "catalogo" ? "on" : ""}" data-vai="catalogo">Catalogo parametri</button></div>`;
  }
  function bindSchede(m) { qsa("[data-vai]", m).forEach(b => b.onclick = () => vai(b.dataset.vai)); }
  async function vai(vista, id) {
    if (ST.vista === "editor" && ST.sporco && !(vista === "editor" && ST.s && ST.s.id === id) && !confirm("Ci sono modifiche non salvate alla stima. Uscire senza salvare?")) return;
    if (vista !== "editor") { ST.s = null; ST.res = null; ST.sporco = false; }
    ST.vista = vista;
    if (vista === "editor") await apri(id); else disegna();
  }
  function disegna() {
    const m = ST.root; if (!m) return;
    if (ST.vista === "catalogo") return disegnaCatalogo(m);
    if (ST.vista === "editor" && ST.s) return disegnaEditor(m);
    disegnaElenco(m);
  }

  // ================================================================ ELENCO
  async function disegnaElenco(m) {
    try { await caricaElenco(); } catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
    const f = ST.filtri, gareUsate = [...new Map(ST.elenco.filter(x => x.gara).map(x => [x.gara.chiave, x.gara])).values()];
    const tutte = ST.filtri.gara && !gareUsate.some(g => g.chiave === ST.filtri.gara);
    m.innerHTML = `<div class="st-wrap">${schede()}
      <div class="st-bar"><input id="st-fq" placeholder="Cerca per nome, cliente, codice SS…" value="${E(f.q)}" autocomplete="off">
        <input id="st-fcl" placeholder="Cliente" value="${E(f.cliente)}" autocomplete="off">
        <select id="st-fga"><option value="">Tutte le gare</option>${tutte ? `<option selected value="${E(f.gara)}">${E(f.gara.replace("|", " · "))}</option>` : ""}${gareUsate.map(g => `<option value="${E(g.chiave)}" ${g.chiave === f.gara ? "selected" : ""}>${E(etichettaGara(g))}</option>`).join("")}</select>
        <span class="st-sp"></span><button class="primary" id="st-nuova">${icona("plus")}Nuova stima</button></div>
      ${ST.elenco.length ? `<div class="card tablecard st-elenco"><table><thead><tr><th>Nome</th><th>Cliente</th><th>Gara</th><th>Versione</th><th class="r">Giornate</th><th class="r">Prezzo</th><th class="r">Margine</th><th class="r">AM</th><th>Modificata</th><th></th></tr></thead><tbody>
        ${ST.elenco.map(x => `<tr data-apri="${x.id}"><td><b>${E(x.nome)}</b></td><td>${E(x.cliente)}</td><td>${x.gara ? `<span title="${E(x.gara.oggetto || "")}">${E(x.gara.ss)} · ${x.gara.anno}</span>` : `<span class="muted">—</span>`}</td>
          <td>v${x.versione}${x.corrente ? ` <span class="st-badge ok">corrente</span>` : ""}</td><td class="r">${F.gg(x.gg)}</td><td class="r">${F.eur0(x.prezzo)}</td><td class="r">${F.pct(x.margine)}</td>
          <td class="r">${x.am_prezzo == null ? `<span class="muted">—</span>` : F.eur0(x.am_prezzo)}</td><td>${E((x.modificata_il || "").replace("T", " ").slice(0, 16))}</td>
          <td class="st-azioni"><button class="st-ib" data-az="versione" data-id="${x.id}" title="Nuova versione">${icona("plus")}</button><button class="st-ib" data-az="clona" data-id="${x.id}" title="Clona">${icona("copy")}</button>
            <button class="st-ib" title="Esporta Excel: arriva con la fase 4" disabled>${icona("download")}</button><button class="st-ib" data-az="elimina" data-id="${x.id}" title="Elimina">${icona("trash-2")}</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="card st-vuoto"><h3>${f.q || f.cliente || f.gara ? "Nessuna stima con questi filtri" : "Ancora nessuna stima"}</h3><p class="muted">Una stima nasce con una copia dei parametri del catalogo: le modifiche al catalogo valgono per le stime create dopo.</p></div>`}</div>`;
    bindSchede(m);
    let t;
    const filtra = () => { clearTimeout(t); t = setTimeout(() => { ST.filtri = {q: qs("#st-fq", m).value.trim(), cliente: qs("#st-fcl", m).value.trim(), gara: qs("#st-fga", m).value}; ridisegnaElenco(m); }, 250); };
    qs("#st-fq", m).oninput = filtra; qs("#st-fcl", m).oninput = filtra; qs("#st-fga", m).onchange = filtra;
    qs("#st-nuova", m).onclick = () => nuova();
    qsa("[data-apri]", m).forEach(tr => tr.onclick = e => { if (!e.target.closest("button")) vai("editor", +tr.dataset.apri); });
    qsa("[data-az]", m).forEach(b => b.onclick = () => azione(b.dataset.az, +b.dataset.id));
  }
  async function ridisegnaElenco(m) {                       // mantiene il cursore nel campo di ricerca
    const att = document.activeElement && document.activeElement.id, pos = att && document.activeElement.selectionStart;
    await disegnaElenco(m);
    const el = att && document.getElementById(att); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
  }
  async function azione(az, id) {
    try {
      if (az === "elimina") {
        const x = ST.elenco.find(s => s.id === id);
        if (!confirm(`Eliminare la stima “${x ? x.nome : id}” (versione ${x ? x.versione : ""})? Non si può annullare.`)) return;
        await api(`/api/stime/${id}`, {method: "DELETE"}); toast("Stima eliminata"); disegna();
      } else if (az === "versione") { const n = await api(`/api/stime/${id}/versione`, {method: "POST"}); toast(`Creata la versione ${n.versione}`); vai("editor", n.id); }
      else if (az === "clona") dialogoClona(id);
    } catch (e) { toast(e.message, true); }
  }
  async function nuova(prefill = {}) {
    try {
      const corpo = {nome: prefill.nome || "Nuova stima", cliente: prefill.cliente || "", gara: prefill.gara || null};
      const s = await api("/api/stime", {method: "POST", body: corpo});
      ST.vista = "editor"; ST.tab = "moduli"; await apri(s.id);
      const n = qs("#st-nome", ST.root); if (n) { n.focus(); n.select(); }
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- scelta della gara (campo con suggerimenti)
  function campoGara(id, g) {
    return `<input id="${id}" list="${id}-dl" value="${g ? E(etichettaGara(g)) : ""}" placeholder="Nessuna gara: scrivi SS o cliente…" autocomplete="off">
      <datalist id="${id}-dl">${ST.gare.map(x => `<option value="${E(etichettaGara(x))}">`).join("")}</datalist>`;
  }
  function garaDaCampo(v) {
    v = String(v || "").trim();
    if (!v) return null;
    return ST.gare.find(g => etichettaGara(g) === v) || undefined;   // undefined = testo che non corrisponde a una gara
  }
  function dialogoClona(id) {
    const x = ST.elenco.find(s => s.id === id) || (ST.s && ST.s.id === id ? ST.s : {});
    const el = modal(`<h2>Clona la stima</h2><p class="muted">Nasce una stima indipendente, in versione 1, con gli stessi parametri e le stesse righe.</p>
      <div class="grid"><div class="full"><label for="cl-n">Nome</label><input id="cl-n" value="${E((x.nome || "") + " (copia)")}"></div>
      <div class="full"><label for="cl-c">Cliente</label><input id="cl-c" value="${E(x.cliente || "")}"></div>
      <div class="full"><label for="cl-g">Gara collegata (facoltativa)</label>${campoGara("cl-g", null)}</div></div>
      <div class="err" id="cl-e"></div><div class="foot"><button id="cl-x">Annulla</button><button class="primary" id="cl-ok">Clona</button></div>`);
    qs("#cl-x", el).onclick = closeModal;
    qs("#cl-g", el).onchange = e => { const g = garaDaCampo(e.target.value); if (g && !qs("#cl-c", el).value) qs("#cl-c", el).value = g.cliente; };
    qs("#cl-ok", el).onclick = async () => {
      const g = garaDaCampo(qs("#cl-g", el).value);
      if (g === undefined) { qs("#cl-e", el).textContent = "Scegli una gara dall'elenco dei suggerimenti, o lascia il campo vuoto."; return; }
      try { const n = await api(`/api/stime/${id}/clona`, {method: "POST", body: {nome: qs("#cl-n", el).value, cliente: qs("#cl-c", el).value, gara: g}}); closeModal(); toast("Stima clonata"); ST.sporco = false; vai("editor", n.id); }
      catch (e) { qs("#cl-e", el).textContent = e.message; }
    };
  }

  // ================================================================ EDITOR
  async function apri(id) {
    try {
      const r = await api(`/api/stime/${id}`);
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; ST.vista = "editor";
      disegna();
    } catch (e) { toast(e.message, true); ST.vista = "elenco"; disegna(); }
  }
  const tipiDi = (snap, contesto) => snap.tipi.filter(t => contesto === "am_esercizio" ? t.modalita === "quantita" : true);
  const nomeModulo = (snap, c) => { const m = snap.moduli.find(x => x.codice === c); return m ? m.nome : c; };
  const tipo = (snap, c) => snap.tipi.find(t => t.codice === c);

  function disegnaEditor(m) {
    const s = ST.s, g = s.gara, gEsiste = !g || ST.gare.some(x => x.chiave === g.chiave);
    m.innerHTML = `<div class="st-wrap st-ed">${schede()}
      <div class="card st-testa">
        <div class="st-testa-r"><input id="st-nome" class="st-nome" value="${E(s.nome)}" aria-label="Nome della stima">
          <span class="st-ver">v${s.versione}${s.corrente ? ` <span class="st-badge ok">corrente</span>` : ` <button class="linkbtn" id="st-corr">Rendi corrente</button>`}</span>
          <span class="st-sp"></span><span class="st-stato" id="st-stato"></span>
          <button id="st-indietro">${icona("arrow-left")}Elenco</button><button class="primary" id="st-salva">Salva</button>
          <button class="rf-ico st-more" id="st-more" aria-label="Altre azioni">${icona("ellipsis")}</button>
          <div class="st-menu" id="st-menu" hidden><button data-m="versione">Nuova versione</button><button data-m="clona">Clona…</button>
            <button data-m="esporta" disabled title="Arriva con la fase 4">Esporta Excel</button><hr><button data-m="elimina" class="danger">Elimina…</button></div></div>
        <div class="st-testa-g"><div><label for="st-cli">Cliente</label><input id="st-cli" list="st-cli-dl" value="${E(s.cliente)}" autocomplete="off">
            <datalist id="st-cli-dl">${[...new Set(ST.gare.map(x => x.cliente).filter(Boolean))].sort().map(c => `<option value="${E(c)}">`).join("")}</datalist></div>
          <div class="st-g2"><label for="st-gara">Gara collegata</label>${campoGara("st-gara", g && gEsiste ? ST.gare.find(x => x.chiave === g.chiave) : null)}
            ${g && !gEsiste ? `<div class="hint warn">Gara ${E(g.ss)} · ${g.anno} (${E(g.cliente || "")}) non trovata tra le gare attuali: il collegamento resta; scegline un'altra per cambiarlo.</div>` : ""}</div>
          <div><label for="st-note">Note</label><input id="st-note" value="${E(s.note)}"></div></div></div>
      <div class="st-corpo"><div class="st-sx">
        <div class="st-ttabs">${[["moduli", "Moduli"], ["corpo", "Attività a corpo e training"], ["economia", "Economia e tempi"], ["am", "AM"], ["parametri", "Parametri della stima"]]
          .map(([k, l]) => `<button class="st-ttab ${ST.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
        <div id="st-tabc"></div></div>
        <aside class="st-dx" id="st-riep"></aside></div></div>`;
    bindSchede(m);
    qs("#st-indietro", m).onclick = () => vai("elenco");
    qs("#st-salva", m).onclick = salva;
    qs("#st-nome", m).oninput = e => { s.nome = e.target.value; modificato(false); };
    qs("#st-cli", m).oninput = e => { s.cliente = e.target.value; modificato(false); };
    qs("#st-note", m).oninput = e => { s.note = e.target.value; modificato(false); };
    qs("#st-gara", m).onchange = e => {
      const v = garaDaCampo(e.target.value);
      if (v === undefined) { e.target.classList.add("bad"); toast("Scegli una gara dall'elenco dei suggerimenti, o lascia il campo vuoto", true); return; }
      e.target.classList.remove("bad");
      s.gara = v ? {ss: v.ss, data_ins: v.data_ins, anno: v.anno, cliente: v.cliente, oggetto: v.oggetto, chiave: v.chiave} : null;
      if (v && !s.cliente) { s.cliente = v.cliente; qs("#st-cli", m).value = v.cliente; }
      modificato(false);
    };
    const c = qs("#st-corr", m); if (c) c.onclick = async () => { if (await salvaSeServe()) { await api(`/api/stime/${s.id}/corrente`, {method: "POST"}); toast("Ora è la versione corrente"); apri(s.id); } };
    const menu = qs("#st-menu", m);
    qs("#st-more", m).onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    qs(".st-ed", m).onclick = e => { if (!e.target.closest("#st-menu, #st-more")) menu.hidden = true; };
    qsa("[data-m]", menu).forEach(b => b.onclick = async () => {
      menu.hidden = true;
      if (b.dataset.m === "elimina") { if (confirm(`Eliminare questa versione (v${s.versione}) di “${s.nome}”? Non si può annullare.`)) { await api(`/api/stime/${s.id}`, {method: "DELETE"}); ST.sporco = false; toast("Stima eliminata"); vai("elenco"); } return; }
      if (!(await salvaSeServe())) return;
      if (b.dataset.m === "versione") { const n = await api(`/api/stime/${s.id}/versione`, {method: "POST"}); toast(`Creata la versione ${n.versione}`); apri(n.id); }
      if (b.dataset.m === "clona") { ST.elenco = [s]; dialogoClona(s.id); }
    });
    qsa("[data-tab]", m).forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; qsa("[data-tab]", m).forEach(x => x.classList.toggle("on", x === b)); disegnaTab(); });
    disegnaTab(); disegnaRiepilogo(); stato();
  }
  function stato() {
    const el = qs("#st-stato", ST.root); if (!el) return;
    el.innerHTML = ST.sporco ? `<span class="st-badge warn">Modifiche non salvate</span>` : `<span class="muted">Salvata ${E((ST.s.modificata_il || "").replace("T", " ").slice(0, 16))}</span>`;
    const b = qs("#st-salva", ST.root); if (b) b.disabled = !ST.sporco;
  }
  function modificato(strutturale) {
    ST.sporco = true; stato();
    if (strutturale) disegnaTab();
    clearTimeout(ST.timer); ST.timer = setTimeout(ricalcola, 180);
  }
  async function ricalcola() {
    const n = ++ST.seq;
    try {
      const r = await api("/api/stime/calcola", {method: "POST", body: ST.s});
      if (n !== ST.seq || !ST.s) return;                          // risposta superata da una modifica più recente
      ST.res = r; aggiornaCalcolati();
    } catch (e) { if (n === ST.seq) toast(e.message, true); }
  }
  async function salva() {
    try {
      const r = await api(`/api/stime/${ST.s.id}`, {method: "PUT", body: ST.s});
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; toast("Stima salvata"); disegna();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  async function salvaSeServe() { return !ST.sporco || await salva(); }
  window.addEventListener("beforeunload", e => { if (ST.vista === "editor" && ST.sporco) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------------------------------------------------------- campo numerico generico
  // data-k: "s:campo" (campo della stima), "p:sez|cod|campo|idx" (snapshot), "r:i:campo[:idx]" (riga), "v:i:campo" (voce a corpo), "a:percorso" (AM)
  // data-f: "pct" (percentuale), "num"; data-min (0 = niente negativi); data-max1 (percentuale < 100%)
  function campo(k, valore, opz = {}) {
    const pct = opz.pct, v = pct ? inPct(valore) : inNum(valore);
    return `<input class="st-n ${opz.cls || ""}" data-k="${E(k)}" data-f="${pct ? "pct" : "num"}" ${opz.max1 ? "data-max1" : ""} ${opz.neg ? "data-neg" : ""}
      value="${E(v)}" inputmode="decimal" placeholder="${E(opz.ph == null ? "" : opz.ph)}" ${opz.title ? `title="${E(opz.title)}"` : ""} autocomplete="off">`;
  }
  function leggiCampo(el) {
    const n = leggiNum(el.value), pct = el.dataset.f === "pct";
    let ok = !Number.isNaN(n) && (n == null || el.hasAttribute("data-neg") || n >= 0);
    if (ok && pct && el.hasAttribute("data-max1") && n != null && n >= 100) ok = false;
    el.classList.toggle("bad", !ok);
    el.title = ok ? (el.dataset.t0 || el.title) : "Valore non accettato";
    return ok ? {ok, v: pct ? pctDaInput(n) : n} : {ok};
  }
  function bindCampi(root, applica) {
    qsa("[data-k]", root).forEach(el => {
      if (el.matches("input.st-n")) el.oninput = () => { const r = leggiCampo(el); if (r.ok) applica(el.dataset.k, r.v, el); };
    });
  }

  // ---------------------------------------------------------------- schede dell'editor
  function disegnaTab() {
    const box = qs("#st-tabc", ST.root); if (!box) return;
    const s = ST.s;
    if (ST.tab === "moduli") box.innerHTML = tabRighe(s, "progetto");
    else if (ST.tab === "corpo") box.innerHTML = tabCorpo(s);
    else if (ST.tab === "economia") box.innerHTML = tabEconomia(s);
    else if (ST.tab === "am") box.innerHTML = tabAm(s);
    else box.innerHTML = `<div class="card"><div class="st-rh"><h3>Parametri della stima</h3><span class="st-sp"></span><button id="st-riall">${icona("refresh-cw")}Riallinea ai default correnti</button></div>
      <p class="hint" style="margin-top:0">Copia dei parametri congelata in questa stima. Il pallino <span class="st-diff-i"></span> segna i valori diversi dal catalogo corrente; ${icona("undo-2")} li riporta al default.</p>
      ${tabelleParametri(s.snapshot, ST.cat, "stima")}</div>`;
    bindTab(box);
    aggiornaCalcolati();
  }
  function bindTab(box) {
    const s = ST.s;
    bindCampi(box, (k, v) => {
      const [t, ...r] = k.split(":");
      if (t === "s") s[r[0]] = v;
      else if (t === "p") { pset(s.snapshot, r.join(":"), v); segnaDiff(box); }
      else if (t === "r") {
        const riga = s.righe[+r[0]], campo = r[1];
        if (campo === "mix") { if (!riga.mix) riga.mix = [...tipo(s.snapshot, riga.tipo).mix]; riga.mix[+r[2]] = v; marcaMix(box, +r[0]); }
        else riga[campo] = v;
      } else if (t === "v") s.voci_corpo[+r[0]][r[1]] = v;
      else if (t === "a") { const [modo, ...p] = r[0].split("."); s.am[modo] = s.am[modo] || {}; let o = s.am[modo]; p.slice(0, -1).forEach(x => o = o[x] = o[x] || {}); o[p[p.length - 1]] = v; }
      modificato(false);
    });
    // campi di testo e scelte
    qsa("[data-et]", box).forEach(el => el.oninput = () => { s.righe[+el.dataset.et].etichetta = el.value; modificato(false); });
    qsa("[data-vn]", box).forEach(el => el.oninput = () => { s.voci_corpo[+el.dataset.vn].nome = el.value; modificato(false); });
    qsa("[data-tipo]", box).forEach(el => el.onchange = () => { const r = s.righe[+el.dataset.tipo]; r.tipo = el.value; r.mix = null; const t = tipo(s.snapshot, el.value); if (t && t.modalita === "corpo") { r.gg_be = t.corpo_be; r.gg_fe = t.corpo_fe; r.quantita = null; } modificato(true); });
    qsa("[data-rip-mix]", box).forEach(b => b.onclick = () => { s.righe[+b.dataset.ripMix].mix = null; modificato(true); });
    qsa("[data-riga]", box).forEach(b => b.onclick = () => azioneRiga(b.dataset.riga, +b.dataset.i));
    qsa("[data-agg]", box).forEach(b => b.onclick = () => { const sel = qs(`#${b.dataset.agg}`, box); if (sel && sel.value) aggiungiRiga(sel.value, b.dataset.ctx); });
    qsa("[data-voce]", box).forEach(b => b.onclick = () => { const i = +b.dataset.i; if (b.dataset.voce === "del") s.voci_corpo.splice(i, 1); else s.voci_corpo.push({nome: "Nuova attività", gg_be: 0, gg_fe: 0}); modificato(true); });
    qsa("[data-rip]", box).forEach(b => b.onclick = () => { pset(s.snapshot, b.dataset.rip, copia(pget(ST.cat, b.dataset.rip))); modificato(true); });
    const ammodo = qsa("[data-ammodo]", box);
    ammodo.forEach(b => b.onclick = () => { s.am.modalita = b.dataset.ammodo || null; if (s.am.modalita === "manuale" && !s.am.manuale) s.am.manuale = {BE: {gg_mese: 0, mesi: 12}, FE: {gg_mese: 0, mesi: 12}};
      if (s.am.modalita === "driver" && !s.am.driver) s.am.driver = {fonte: "progetto", servizio: "H8", anni: 3, evolutiva: 0, presa: null}; modificato(true); });
    qsa("[data-amsel]", box).forEach(el => el.onchange = () => { const d = s.am.driver; d[el.dataset.amsel] = el.dataset.amsel === "anni" ? +el.value : el.value; if (el.dataset.amsel === "fonte") d.presa = null; modificato(true); });
    const presa = qs("#st-presa", box); if (presa) presa.onchange = () => { s.am.driver.presa = presa.checked; modificato(false); };
    const ri = qs("#st-riall", box); if (ri) ri.onclick = riallinea;
  }
  function aggiungiRiga(codice, contesto) {
    const t = tipo(ST.s.snapshot, codice); if (!t) return;
    ST.s.righe.push({contesto, tipo: codice, etichetta: "", quantita: t.modalita === "corpo" ? null : 0, mix: null,
      gg_be: t.modalita === "corpo" ? t.corpo_be : null, gg_fe: t.modalita === "corpo" ? t.corpo_fe : null});
    modificato(true);
    const el = qsa(`[data-et="${ST.s.righe.length - 1}"]`, ST.root)[0]; if (el) el.focus();
  }
  function azioneRiga(az, i) {
    const r = ST.s.righe, x = r[i];
    if (az === "del") { if (!confirm(`Eliminare la riga “${x.etichetta || x.tipo}”?`)) return; r.splice(i, 1); }
    else if (az === "dup") r.splice(i + 1, 0, copia(x));
    else {                                                   // su/giù tra le righe dello stesso modulo e contesto
      const stesso = j => r[j] && r[j].contesto === x.contesto && (tipo(ST.s.snapshot, r[j].tipo) || {}).modulo === (tipo(ST.s.snapshot, x.tipo) || {}).modulo;
      let j = i + (az === "su" ? -1 : 1);
      while (r[j] && !stesso(j)) j += az === "su" ? -1 : 1;
      if (!r[j]) return;
      [r[i], r[j]] = [r[j], r[i]];
    }
    modificato(true);
  }

  // tabella delle righe, raggruppate per modulo (progetto) o semplice (oggetti in esercizio dell'AM)
  function tabRighe(s, contesto) {
    const snap = s.snapshot, righe = s.righe.map((r, i) => ({r, i})).filter(x => (x.r.contesto || "progetto") === contesto);
    const ordine = snap.moduli.map(m => m.codice), perMod = {};
    righe.forEach(x => { const t = tipo(snap, x.r.tipo), c = t ? t.modulo : "?"; (perMod[c] = perMod[c] || []).push(x); });
    const opzTipi = (cur, ctx) => snap.moduli.filter(m => m.attivo !== false || righe.some(x => (tipo(snap, x.r.tipo) || {}).modulo === m.codice)).map(m => {
      const ts = tipiDi(snap, ctx).filter(t => t.modulo === m.codice && (t.attivo !== false || t.codice === cur));
      return ts.length ? `<optgroup label="${E(m.nome)}">${ts.map(t => `<option value="${E(t.codice)}" ${t.codice === cur ? "selected" : ""}>${E(t.nome)}${t.attivo === false ? " (disattivato)" : ""}</option>`).join("")}</optgroup>` : "";
    }).join("");
    const idSel = "st-add-" + contesto;
    const gruppi = [...ordine, ...Object.keys(perMod).filter(c => !ordine.includes(c))].filter(c => perMod[c]).map(c => `
      <div class="st-mod"><div class="st-mod-h"><b>${E(nomeModulo(snap, c))}</b><span class="muted">${E(c)}</span><span class="st-sp"></span>
        ${contesto === "progetto" ? `<span class="st-mod-t" data-out="mod:${E(c)}"></span>` : ""}</div>
      <table class="st-righe"><thead><tr><th>Etichetta</th><th>Tipo oggetto</th><th class="r">Quantità</th><th class="r" title="Mix di complessità Semplice / Medio / Difficile">Mix S / M / D %</th><th class="r">gg BE</th><th class="r">gg FE</th><th class="r">Totale</th><th></th></tr></thead><tbody>
      ${perMod[c].map(({r, i}) => rigaHtml(snap, r, i, opzTipi(r.tipo, contesto))).join("")}</tbody></table></div>`).join("");
    return `<div class="card">${contesto === "progetto" ? `<div class="st-rh"><h3>Moduli</h3></div>` : ""}
      ${gruppi || `<p class="muted">${contesto === "progetto" ? "Nessuna riga: aggiungi un tipo oggetto qui sotto." : "Nessun oggetto in esercizio: aggiungine uno qui sotto."}</p>`}
      <div class="st-add"><select id="${idSel}"><option value="">Aggiungi una riga: scegli il tipo oggetto…</option>${opzTipi(null, contesto)}</select>
        <button data-agg="${idSel}" data-ctx="${contesto}">${icona("plus")}Aggiungi</button></div></div>`;
  }
  function rigaHtml(snap, r, i, opzioni) {
    const t = tipo(snap, r.tipo), corpo = t && t.modalita === "corpo", mixMod = !!r.mix;
    const mix = corpo || !t ? "" : `<span class="st-mix ${mixMod ? "mod" : ""}" data-mix="${i}">${[0, 1, 2].map(k => campo(`r:${i}:mix:${k}`, mixMod ? r.mix[k] : null, {pct: true, ph: inPct(t.mix[k]), cls: "st-n3"})).join("")}
      ${mixMod ? `<button class="st-ib" data-rip-mix="${i}" title="Ripristina il mix di default (${t.mix.map(v => inPct(v)).join(" / ")})">${icona("undo-2")}</button>` : ""}</span>`;
    return `<tr data-i="${i}"><td><input class="st-et" data-et="${i}" value="${E(r.etichetta)}" placeholder="Etichetta (es. SAP ECC)"></td>
      <td><select data-tipo="${i}">${t ? "" : `<option selected>${E(r.tipo)} (non nei parametri)</option>`}${opzioni}</select></td>
      <td class="r">${corpo ? `<span class="muted">a corpo</span>` : campo(`r:${i}:quantita`, r.quantita, {cls: "st-n2"})}</td>
      <td class="r">${corpo ? `<span class="st-corpo-in">BE ${campo(`r:${i}:gg_be`, r.gg_be, {cls: "st-n2"})} FE ${campo(`r:${i}:gg_fe`, r.gg_fe, {cls: "st-n2"})}</span>` : mix}</td>
      <td class="r" data-out="riga:${i}:BE"></td><td class="r" data-out="riga:${i}:FE"></td><td class="r b" data-out="riga:${i}:tot"></td>
      <td class="st-azioni"><button class="st-ib" data-riga="su" data-i="${i}" title="Sposta su">${icona("arrow-up")}</button><button class="st-ib" data-riga="giu" data-i="${i}" title="Sposta giù">${icona("arrow-down")}</button>
        <button class="st-ib" data-riga="dup" data-i="${i}" title="Duplica">${icona("copy")}</button><button class="st-ib" data-riga="del" data-i="${i}" title="Elimina">${icona("trash-2")}</button></td></tr>`;
  }
  function marcaMix(box, i) {                                 // mix modificato: evidenza e pulsante di ripristino, senza ridisegnare (il cursore resta nel campo)
    const el = qs(`[data-mix="${i}"]`, box); if (!el || el.classList.contains("mod")) return;
    el.classList.add("mod");
    const t = tipo(ST.s.snapshot, ST.s.righe[i].tipo);
    el.insertAdjacentHTML("beforeend", `<button class="st-ib" data-rip-mix="${i}" title="Ripristina il mix di default (${t.mix.map(v => inPct(v)).join(" / ")})">${icona("undo-2")}</button>`);
    qs("[data-rip-mix]", el).onclick = () => { ST.s.righe[i].mix = null; modificato(true); };
  }

  function tabCorpo(s) {
    return `<div class="card"><div class="st-rh"><h3>Attività a corpo</h3></div>
      <table class="st-righe"><thead><tr><th>Attività</th><th class="r">gg BE</th><th class="r">gg FE</th><th></th></tr></thead><tbody>
      ${s.voci_corpo.map((v, i) => `<tr><td><input data-vn="${i}" value="${E(v.nome)}"></td><td class="r">${campo(`v:${i}:gg_be`, v.gg_be, {cls: "st-n2"})}</td><td class="r">${campo(`v:${i}:gg_fe`, v.gg_fe, {cls: "st-n2"})}</td>
        <td class="st-azioni"><button class="st-ib" data-voce="del" data-i="${i}" title="Elimina">${icona("trash-2")}</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nessuna attività a corpo.</td></tr>`}</tbody></table>
      <div class="st-add"><button data-voce="add">${icona("plus")}Aggiungi attività</button></div>
      <h3 class="st-h3">Training</h3><div class="st-due"><label>gg BE ${campo("s:training_be", s.training_be, {cls: "st-n2"})}</label><label>gg FE ${campo("s:training_fe", s.training_fe, {cls: "st-n2"})}</label></div>
      <p class="hint">Le attività a corpo, la sicurezza e il training non generano analisi né disegno.</p></div>
      <div class="card"><div class="st-rh"><h3>Sicurezza e fasi trasversali</h3><span class="st-sp"></span><span class="muted" data-out="baseB"></span></div><div data-blocco="fasi"></div></div>`;
  }
  const diffDot = (p, base) => base && !uguali(pget(ST.s.snapshot, p), pget(base, p)) ? ` <span class="st-diff-i" title="Default corrente: ${E(fmtDef(p, base))}"></span><button class="st-ib st-rip" data-rip="${E(p)}" title="Ripristina il default">${icona("undo-2")}</button>` : "";
  function fmtDef(p, base) { const v = pget(base, p); return v == null ? "vuoto" : typeof v === "number" ? (/pct|margine|mix|decalage|correttiva|presa|min|max/.test(p) ? inPct(v) + "%" : inNum(v)) : String(v); }
  function tabEconomia(s) {
    const snap = s.snapshot, P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p, ST.cat)}</div></div>`;
    return `<div class="card"><div class="st-rh"><h3>Economia e tempi</h3></div><div class="st-campi">
      ${P("Margine del progetto", "generali||margine_progetto|", {pct: true, max1: true, suf: "%"})}
      ${P("Margine dell'AM", "generali||margine_am|", {pct: true, max1: true, suf: "%"})}
      <div class="st-campo"><label>Prezzo obiettivo (facoltativo)</label><div class="st-cv">${campo("s:prezzo_obiettivo", s.prezzo_obiettivo)}<span class="muted">€</span></div></div>
      <div class="st-campo"><label>Durata del progetto</label><div class="st-cv">${campo("s:durata_mesi", s.durata_mesi)}<span class="muted">mesi</span></div></div>
      ${snap.team.map(t => P(`Costo ${t.codice} (${E(t.nome)})`, `team|${t.codice}|costo|`, {suf: "€/gg"})).join("")}
      ${P("Giornate lavorative al mese", "generali||gg_mese|")}</div>
      <p class="hint">Prezzo = costo / (1 − margine). Senza durata gli FTE non si calcolano. Margini, costi e giornate al mese sono parametri di questa stima.</p></div>`;
  }
  function tabAm(s) {
    const am = s.am || {modalita: null}, snap = s.snapshot, modo = am.modalita || "";
    let corpo = "";
    if (modo === "manuale") {
      const m = am.manuale || {};
      corpo = `<table class="st-righe"><thead><tr><th>Team</th><th class="r">gg al mese</th><th class="r">Mesi</th><th class="r">Giornate</th><th class="r">Costo</th><th class="r">Prezzo</th><th class="r">FTE</th></tr></thead><tbody>
        ${["BE", "FE"].map(t => `<tr><td><b>${t}</b></td><td class="r">${campo(`a:manuale.${t}.gg_mese`, (m[t] || {}).gg_mese, {cls: "st-n2"})}</td><td class="r">${campo(`a:manuale.${t}.mesi`, (m[t] || {}).mesi, {cls: "st-n2"})}</td>
          <td class="r" data-out="am:${t}:gg"></td><td class="r" data-out="am:${t}:costo"></td><td class="r" data-out="am:${t}:prezzo"></td><td class="r" data-out="am:${t}:fte"></td></tr>`).join("")}</tbody></table>`;
    } else if (modo === "driver") {
      const d = am.driver || {}, presa = d.presa == null ? d.fonte === "esercizio" : d.presa, coeff = snap.am.coeff || {};
      corpo = `<div class="st-campi">
        <div class="st-campo"><label>Fonte del build equivalente</label><select data-amsel="fonte"><option value="progetto" ${d.fonte !== "esercizio" ? "selected" : ""}>Progetto (implementazione di questa stima)</option><option value="esercizio" ${d.fonte === "esercizio" ? "selected" : ""}>Oggetti in esercizio (sistema esistente)</option></select></div>
        <div class="st-campo"><label>Livello di servizio</label><select data-amsel="servizio">${["H8", "H12", "H24"].map(x => `<option value="${x}" ${d.servizio === x ? "selected" : ""}>${x} (coefficiente ${inNum(coeff[x])})</option>`).join("")}</select></div>
        <div class="st-campo"><label>Anni</label><select data-amsel="anni">${Array.from({length: snap.am.anni_max || 5}, (_, k) => k + 1).map(k => `<option ${+d.anni === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="st-campo"><label>Evolutiva</label><div class="st-cv">${campo("a:driver.evolutiva", d.evolutiva)}<span class="muted">gg/anno</span></div></div>
        <div class="st-campo"><label class="st-chk"><input type="checkbox" id="st-presa" ${presa ? "checked" : ""}> Presa in carico (solo anno 1)</label></div></div>
        ${d.fonte === "esercizio" ? `<h3 class="st-h3">Oggetti in esercizio</h3>${tabRighe(s, "am_esercizio")}` : ""}`;
    }
    return `<div class="card"><div class="st-rh"><h3>Application Management</h3></div>
      <div class="st-seg">${[["", "Nessuna"], ["manuale", "Manuale"], ["driver", "Da driver"]].map(([k, l]) => `<button data-ammodo="${k}" class="${modo === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${corpo}<div data-blocco="am-ris"></div></div>`;
  }

  // ---------------------------------------------------------------- tabelle dei parametri (catalogo e snapshot della stima)
  function tabelleParametri(obj, base, modo) {
    const cat = modo === "catalogo";
    const cel = (p, opz = {}) => {
      const v = pget(obj, p);
      return `<td class="r">${campo((cat ? "c:" : "p:") + p, v, opz)}${cat ? "" : diffDotObj(obj, p, base)}</td>`;
    };
    const usati = new Set((ST.s && !cat ? ST.s.righe : []).map(r => r.tipo));
    const tipiV = obj.tipi.filter(t => cat || t.attivo !== false || usati.has(t.codice));
    const moduliV = obj.moduli.filter(m => cat || m.attivo !== false || tipiV.some(t => t.modulo === m.codice));
    const att = (sez, x) => cat ? `<td><label class="st-chk"><input type="checkbox" data-att="${sez}|${E(x.codice)}" ${x.attivo !== false ? "checked" : ""}> attivo</label></td>` : "";
    const nomeIn = (sez, x) => cat ? `<input data-txt="${sez}|${E(x.codice)}|nome|" value="${E(x.nome)}">` : E(x.nome);
    return `
      <h3 class="st-h3">Team e costi giornalieri</h3><table class="st-righe st-par"><thead><tr><th>Team</th><th></th><th class="r">€/gg</th></tr></thead><tbody>
        ${obj.team.map(t => `<tr><td><b>${t.codice}</b></td><td>${E(t.nome)}</td>${cel(`team|${t.codice}|costo|`)}</tr>`).join("")}</tbody></table>
      <h3 class="st-h3">Parametri generali</h3><table class="st-righe st-par"><tbody>
        <tr><td>Margine del progetto (%)</td>${cel("generali||margine_progetto|", {pct: true, max1: true})}</tr>
        <tr><td>Margine dell'AM (%)</td>${cel("generali||margine_am|", {pct: true, max1: true})}</tr>
        <tr><td>Giornate lavorative al mese</td>${cel("generali||gg_mese|")}</tr>
        <tr><td>Passo di arrotondamento (gg)</td>${cel("generali||passo|")}</tr>
        ${cat ? `<tr><td>Training predefinito BE (gg)</td>${cel("generali||training_be|")}</tr><tr><td>Training predefinito FE (gg)</td>${cel("generali||training_fe|")}</tr>` : ""}</tbody></table>
      ${cat ? `<h3 class="st-h3">Attività a corpo predefinite in una nuova stima</h3><table class="st-righe st-par"><thead><tr><th>Attività</th><th class="r">gg BE</th><th class="r">gg FE</th><th></th></tr></thead><tbody>
        ${(obj.generali.voci_corpo || []).map((v, i) => `<tr><td><input data-vcn="${i}" value="${E(v.nome)}"></td><td class="r">${campo(`cv:${i}:gg_be`, v.gg_be, {cls: "st-n2"})}</td><td class="r">${campo(`cv:${i}:gg_fe`, v.gg_fe, {cls: "st-n2"})}</td><td><button class="st-ib" data-vcdel="${i}">${icona("trash-2")}</button></td></tr>`).join("")}
        </tbody></table><div class="st-add"><button id="cv-add">${icona("plus")}Aggiungi</button></div>` : ""}
      <h3 class="st-h3">Moduli</h3><table class="st-righe st-par"><thead><tr><th>Codice</th><th>Modulo</th><th>Blocco</th><th class="r">% analisi</th><th class="r">% disegno</th>${cat ? "<th></th>" : ""}</tr></thead><tbody>
        ${moduliV.map(m => `<tr class="${m.attivo === false ? "spento" : ""}"><td><b>${E(m.codice)}</b></td><td>${nomeIn("moduli", m)}</td>
          <td>${cat && m._nuovo ? `<select data-txt="moduli|${E(m.codice)}|blocco|"><option ${m.blocco === "Implementazione" ? "selected" : ""}>Implementazione</option><option ${m.blocco === "Architettura" ? "selected" : ""}>Architettura</option></select>` : E(m.blocco)}</td>
          ${cel(`moduli|${m.codice}|pct_analisi|`, {pct: true})}${cel(`moduli|${m.codice}|pct_disegno|`, {pct: true})}${att("moduli", m)}</tr>`).join("")}</tbody></table>
      ${cat ? `<div class="st-add"><button id="cat-addmod">${icona("plus")}Aggiungi modulo</button></div>` : ""}
      <h3 class="st-h3">Tipi oggetto</h3><div class="st-scroll"><table class="st-righe st-par st-tipi"><thead><tr><th>Codice</th><th>Tipo oggetto</th><th>Unità</th><th class="r">Mix S / M / D %</th><th class="r">gg unitari S / M / D</th><th class="r">% BE / FE</th>${cat ? "<th></th>" : ""}</tr></thead><tbody>
        ${tipiV.map(t => {
          const c = t.codice, q = t.modalita === "quantita", errMix = q && Math.abs((t.mix || []).reduce((a, b) => a + (+b || 0), 0) - 1) > 1e-9,
            errRip = q && Math.abs((+t.pct_be || 0) + (+t.pct_fe || 0) - 1) > 1e-9;
          return `<tr class="${t.attivo === false ? "spento" : ""}"><td><b>${E(c)}</b><div class="muted">${E(nomeModulo(obj, t.modulo))}</div></td><td>${nomeIn("tipi", t)}</td>
            <td>${cat ? `<input data-txt="tipi|${E(c)}|unita|" value="${E(t.unita || "")}" class="st-unita">` : E(t.unita || "")}</td>
            ${q ? `<td class="r ${errMix ? "st-errc" : ""}" ${errMix ? 'title="Il mix deve fare 100%"' : ""}>${[0, 1, 2].map(k => campo(`${cat ? "c" : "p"}:tipi|${c}|mix|${k}`, t.mix[k], {pct: true, cls: "st-n3"})).join("")}${cat ? "" : diffDotObj(obj, `tipi|${c}|mix|`, base)}</td>
              <td class="r">${[0, 1, 2].map(k => campo(`${cat ? "c" : "p"}:tipi|${c}|gg|${k}`, t.gg[k], {cls: "st-n3"})).join("")}${cat ? "" : diffDotObj(obj, `tipi|${c}|gg|`, base)}</td>
              <td class="r ${errRip ? "st-errc" : ""}" ${errRip ? 'title="%BE + %FE deve fare 100%"' : ""}>${campo(`${cat ? "c" : "p"}:tipi|${c}|pct_be|`, t.pct_be, {pct: true, cls: "st-n3"})}${campo(`${cat ? "c" : "p"}:tipi|${c}|pct_fe|`, t.pct_fe, {pct: true, cls: "st-n3"})}${cat ? "" : diffDotObj(obj, `tipi|${c}|pct_be|`, base) || diffDotObj(obj, `tipi|${c}|pct_fe|`, base)}</td>`
              : `<td class="r muted">a corpo</td><td class="r">default BE ${campo(`${cat ? "c" : "p"}:tipi|${c}|corpo_be|`, t.corpo_be, {cls: "st-n3"})} FE ${campo(`${cat ? "c" : "p"}:tipi|${c}|corpo_fe|`, t.corpo_fe, {cls: "st-n3"})}</td><td></td>`}
            ${att("tipi", t)}</tr>`;
        }).join("")}</tbody></table></div>
      ${cat ? `<div class="st-add">${aggiungiTipoHtml(obj)}</div>` : ""}
      <h3 class="st-h3">Fasi trasversali, PM e contingency</h3><table class="st-righe st-par"><thead><tr><th>Fase</th><th>Blocco</th><th>Base</th><th class="r">%</th><th class="r">% BE / FE</th>${cat ? `<th class="r">min / max %</th>` : ""}</tr></thead><tbody>
        ${obj.fasi.map(f => {
          const rip = f.pct_be != null, errRip = rip && Math.abs((+f.pct_be || 0) + (+f.pct_fe || 0) - 1) > 1e-9;
          return `<tr><td><b>${E(f.nome)}</b></td><td>${E(f.blocco || "—")}</td><td class="muted">${E({B: "Implementazione (B)", BaseModuli: "Moduli", TP: "Totale progetto", TP_team: "TP per team"}[f.base] || f.base)}</td>
          ${cel(`fasi|${f.codice}|pct|`, {pct: true})}<td class="r ${errRip ? "st-errc" : ""}">${rip ? campo(`${cat ? "c" : "p"}:fasi|${f.codice}|pct_be|`, f.pct_be, {pct: true, cls: "st-n3"}) + campo(`${cat ? "c" : "p"}:fasi|${f.codice}|pct_fe|`, f.pct_fe, {pct: true, cls: "st-n3"}) + (cat ? "" : diffDotObj(obj, `fasi|${f.codice}|pct_be|`, base) || diffDotObj(obj, `fasi|${f.codice}|pct_fe|`, base)) : `<span class="muted">${f.codice === "PM" ? "team PM" : "per team"}</span>`}</td>
          ${cat ? `<td class="r">${campo(`c:fasi|${f.codice}|min|`, f.min, {pct: true, cls: "st-n3"})}${campo(`c:fasi|${f.codice}|max|`, f.max, {pct: true, cls: "st-n3"})}</td>` : ""}</tr>`;
        }).join("")}</tbody></table>
      <h3 class="st-h3">Parametri AM</h3><table class="st-righe st-par"><tbody>
        <tr><td>% correttiva annua sul build equivalente</td>${cel("am||pct_correttiva|", {pct: true})}</tr>
        ${["H8", "H12", "H24"].map(x => `<tr><td>Coefficiente di servizio ${x}</td>${cel(`am||coeff|${x}`)}</tr>`).join("")}
        <tr><td>% presa in carico (solo anno 1)</td>${cel("am||pct_presa|", {pct: true})}</tr>
        <tr><td>Decalage annuo dal secondo anno (composto)</td>${cel("am||decalage|", {pct: true})}</tr>
        <tr><td>Numero massimo di anni</td>${cel("am||anni_max|")}</tr></tbody></table>`;
  }
  const diffDotObj = (obj, p, base) => base && !uguali(pget(obj, p), pget(base, p)) ? ` <span class="st-diff-i" title="Default corrente: ${E(fmtDef(p, base))}"></span><button class="st-ib st-rip" data-rip="${E(p)}" title="Ripristina il default">${icona("undo-2")}</button>` : "";
  function segnaDiff(box) {                                     // aggiorna i pallini "diverso dal default" senza ridisegnare (il cursore resta dov'è)
    qsa("[data-k^='p:']", box).forEach(el => {
      const p = el.dataset.k.slice(2), pp = p.replace(/\|\d+$/, "|"), base = pp !== p && /\|(mix|gg)\|/.test(p) ? pp : p;
      const td = el.closest("td, .st-cv"); if (!td) return;
      const diff = !uguali(pget(ST.s.snapshot, base), pget(ST.cat, base));
      let dot = td.querySelector(".st-diff-i");
      if (diff && !dot) td.insertAdjacentHTML("beforeend", ` <span class="st-diff-i" title="Diverso dal default corrente: si salva con la stima"></span>`);
      if (!diff && dot && !td.querySelector(".st-rip")) dot.remove();
    });
  }
  function aggiungiTipoHtml(obj) {
    return `<select id="cat-tmod">${obj.moduli.map(m => `<option value="${E(m.codice)}">${E(m.nome)}</option>`).join("")}</select>
      <select id="cat-tmodo"><option value="quantita">a quantità</option><option value="corpo">a corpo</option></select><button id="cat-addtipo">${icona("plus")}Aggiungi tipo oggetto</button>`;
  }

  async function riallinea() {
    if (!(await salvaSeServe())) return;
    try {
      const r = await api(`/api/stime/${ST.s.id}/riallinea`, {method: "POST", body: {}});
      if (!r.differenze.length) { toast("I parametri sono già allineati al catalogo"); return; }
      const nomeSez = {team: "Team", moduli: "Moduli", tipi: "Tipi oggetto", fasi: "Fasi", generali: "Generali", am: "AM"};
      const val = v => v == null ? "—" : typeof v === "object" ? E(JSON.stringify(v)) : typeof v === "number" ? inNum(v) : E(v);
      const el = modal(`<h2>Riallinea ai default correnti</h2><p class="muted">Questi valori della stima verranno sostituiti con quelli del catalogo. I tipi oggetto disattivati ancora usati dalle righe restano con i parametri attuali.</p>
        <div class="st-scroll" style="max-height:50vh"><table class="st-righe"><thead><tr><th>Sezione</th><th>Voce</th><th>Campo</th><th class="r">Stima</th><th class="r">Catalogo</th></tr></thead><tbody>
        ${r.differenze.map(d => `<tr><td>${nomeSez[d.sezione] || d.sezione}</td><td>${E(d.codice || "")}</td><td>${E(d.campo || "")}</td><td class="r">${val(d.stima)}</td><td class="r">${val(d.default)}</td></tr>`).join("")}</tbody></table></div>
        <div class="foot"><button id="ra-x">Annulla</button><button class="primary" id="ra-ok">Riallinea</button></div>`);
      qs("#ra-x", el).onclick = closeModal;
      qs("#ra-ok", el).onclick = async () => { try { await api(`/api/stime/${ST.s.id}/riallinea`, {method: "POST", body: {conferma: true}}); closeModal(); toast("Parametri riallineati"); apri(ST.s.id); } catch (e) { toast(e.message, true); } };
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- valori calcolati e riepilogo
  function aggiornaCalcolati() {
    const box = ST.root && qs("#st-tabc", ST.root), res = ST.res; if (!box || !res) return;
    const p = res.progetto, out = {};
    p.righe.forEach(r => { out[`riga:${r.indice}:BE`] = F.gg(r.BE); out[`riga:${r.indice}:FE`] = F.gg(r.FE); out[`riga:${r.indice}:tot`] = F.gg(r.tot); });
    p.moduli.forEach(m => { out[`mod:${m.codice}`] = `Impl. ${F.gg(m.impl.BE)} / ${F.gg(m.impl.FE)} · Analisi ${F.gg(m.analisi.BE)} / ${F.gg(m.analisi.FE)} · Disegno ${F.gg(m.disegno.BE)} / ${F.gg(m.disegno.FE)}`; });
    out.baseB = `Base B: ${F.gg(p.B)} gg`;
    if (res.am && res.am.modalita === "driver") (res.am.righe || []).forEach(r => { out[`riga:${r.indice}:BE`] = F.gg(r.BE); out[`riga:${r.indice}:FE`] = F.gg(r.FE); out[`riga:${r.indice}:tot`] = F.gg(r.tot); });
    if (res.am && res.am.modalita === "manuale") ["BE", "FE"].forEach(t => { const x = res.am.team[t]; out[`am:${t}:gg`] = F.gg(x.gg); out[`am:${t}:costo`] = F.eur(x.costo); out[`am:${t}:prezzo`] = F.eur(x.prezzo); out[`am:${t}:fte`] = F.fte(x.fte); });
    qsa("[data-out]", box).forEach(el => { el.textContent = out[el.dataset.out] ?? ""; });
    // righe con errori
    const errRighe = new Set(res.messaggi.filter(x => x.livello === "errore" && /^riga:/.test(x.dove || "")).map(x => +x.dove.split(":")[1]));
    qsa("tr[data-i]", box).forEach(tr => tr.classList.toggle("st-err", errRighe.has(+tr.dataset.i)));
    const fasi = qs("[data-blocco='fasi']", box);
    if (fasi) fasi.innerHTML = `<table class="st-righe"><thead><tr><th>Voce</th><th class="r">Base × %</th><th class="r">gg BE</th><th class="r">gg FE</th></tr></thead><tbody>
      <tr><td>Sicurezza</td><td class="r">${nf(2).format(p.sicurezza.S)}</td><td class="r">${F.gg(p.sicurezza.BE)}</td><td class="r">${F.gg(p.sicurezza.FE)}</td></tr>
      ${ST.s.snapshot.fasi.filter(f => p.fasi[f.codice]).map(f => p.fasi[f.codice]).map(f => `<tr><td>${E(f.nome)}</td><td class="r">${nf(3).format(f.X)}</td><td class="r">${F.gg(f.BE)}</td><td class="r">${F.gg(f.FE)}</td></tr>`).join("")}
      <tr><td>Training</td><td></td><td class="r">${F.gg(p.training.BE)}</td><td class="r">${F.gg(p.training.FE)}</td></tr></tbody></table>`;
    const amb = qs("[data-blocco='am-ris']", box);
    if (amb) amb.innerHTML = amRisultatiHtml(res.am);
    disegnaRiepilogo();
  }
  function amRisultatiHtml(am) {
    if (!am) return "";
    if (am.modalita === "manuale") return `<div class="st-amtot">Totale AM: <b>${F.gg(am.gg)} gg</b> · costo ${F.eur(am.costo)} · prezzo <b>${F.eur(am.prezzo)}</b> · media mensile ${F.eur(am.mensile)}</div>`;
    if (!am.calcolabile) return `<div class="hint warn">AM non calcolabile: il build equivalente è zero.</div>`;
    return `<div class="st-amtot">Build equivalente: BE ${F.gg(am.beq.BE)} · FE ${F.gg(am.beq.FE)} · totale <b>${F.gg(am.beq.tot)}</b> (quota BE ${F.pct(am.quota.BE)})</div>
      <div class="st-scroll"><table class="st-righe"><thead><tr><th>Anno</th><th class="r">Correttiva BE / FE</th><th class="r">Evolutiva BE / FE</th><th class="r">Presa in carico</th><th class="r">Giornate</th><th class="r">Costo</th><th class="r">Prezzo</th><th class="r">Mensile</th><th class="r">FTE</th></tr></thead><tbody>
      ${am.anni.map(a => `<tr><td>${a.anno}</td><td class="r">${F.gg(a.correttiva.BE)} / ${F.gg(a.correttiva.FE)}</td><td class="r">${F.gg(a.evolutiva.BE)} / ${F.gg(a.evolutiva.FE)}</td><td class="r">${a.presa.BE || a.presa.FE ? `${F.gg(a.presa.BE)} / ${F.gg(a.presa.FE)}` : "—"}</td>
        <td class="r b">${F.gg(a.gg.tot)}</td><td class="r">${F.eur(a.costo)}</td><td class="r">${F.eur(a.prezzo)}</td><td class="r">${F.eur(a.mensile)}</td><td class="r">${F.fte(a.fte)}</td></tr>`).join("")}
      <tr class="tot"><td>Totale</td><td></td><td></td><td></td><td class="r">${F.gg(am.gg)}</td><td class="r">${F.eur(am.costo)}</td><td class="r">${F.eur(am.prezzo)}</td><td></td><td></td></tr></tbody></table></div>`;
  }
  function disegnaRiepilogo() {
    const el = ST.root && qs("#st-riep", ST.root), res = ST.res; if (!el || !res) return;
    const p = res.progetto, o = p.obiettivo, f = p.fte, am = res.am;
    const msg = res.messaggi.filter((x, i, a) => a.findIndex(y => y.testo === x.testo) === i);
    const ordineLiv = {errore: 0, avviso: 1, info: 2};
    msg.sort((a, b) => ordineLiv[a.livello] - ordineLiv[b.livello]);
    el.innerHTML = `<div class="card st-riep">
      ${msg.length ? `<div class="st-msg">${msg.map(x => `<div class="st-m ${x.livello}">${E(x.testo)}</div>`).join("")}${res.export_bloccato ? `<div class="st-m errore b">Ci sono errori: l'export Excel è bloccato finché non li correggi (il salvataggio è sempre possibile).</div>` : ""}</div>` : ""}
      <table class="st-riep-t"><thead><tr><th>Blocco</th><th class="r">BE</th><th class="r">FE</th><th class="r">Tot</th><th class="r">Peso</th></tr></thead><tbody>
      ${BLOCCHI.filter(k => p.blocchi[k]).map(k => [k, p.blocchi[k]]).map(([k, b]) => `<tr><td>${k}</td><td class="r">${F.gg(b.BE)}</td><td class="r">${F.gg(b.FE)}</td><td class="r">${F.gg(b.tot)}</td><td class="r muted">${F.pct(b.peso)}</td></tr>`).join("")}
      <tr class="tot"><td>Totale progetto</td><td class="r">${F.gg(p.TP.BE)}</td><td class="r">${F.gg(p.TP.FE)}</td><td class="r">${F.gg(p.TP.tot)}</td><td class="r">${p.TP.tot ? "100,00%" : "n/d"}</td></tr>
      <tr><td>PM</td><td></td><td></td><td class="r">${F.gg(p.PM)}</td><td class="r muted">${F.pct(p.peso_pm)}</td></tr>
      <tr><td>Contingency</td><td class="r">${F.gg(p.contingency.BE)}</td><td class="r">${F.gg(p.contingency.FE)}</td><td class="r">${F.gg(p.contingency.tot)}</td><td class="r muted">${F.pct(p.peso_contingency)}</td></tr>
      <tr class="tot big"><td>Totale complessivo</td><td></td><td></td><td class="r">${F.gg(p.totale)}</td><td></td></tr></tbody></table>
      <div class="st-eco"><div><span>Costo BE / FE / PM</span><b>${F.eur0(p.costi.BE)} · ${F.eur0(p.costi.FE)} · ${F.eur0(p.costi.PM)}</b></div>
        <div><span>Costo</span><b>${F.eur(p.costi.tot)}</b></div><div><span>Margine</span><b>${F.pct(p.margine)}</b></div>
        <div class="prezzo"><span>Prezzo</span><b>${F.eur(p.prezzo)}</b></div>
        <div><span>Costo / prezzo medio al giorno</span><b>${F.eur(p.costo_medio)} · ${F.eur(p.prezzo_medio)}</b></div>
        ${o ? `<div><span>Prezzo obiettivo</span><b>${F.eur(o.prezzo)}</b></div><div class="${o.sotto_margine ? "rosso" : ""}"><span>Margine risultante</span><b>${F.pct(o.margine)}</b></div><div><span>Scostamento dal prezzo</span><b>${F.eur(o.scostamento)}</b></div>` : ""}
        <div><span>FTE${p.durata_mesi ? ` su ${nf(1).format(p.durata_mesi)} mesi` : ""}</span><b>${f ? `BE ${F.fte(f.BE)} · FE ${F.fte(f.FE)} · PM ${F.fte(f.PM)} · tot ${F.fte(f.tot)}` : "inserisci la durata"}</b></div>
        ${am ? `<div class="am"><span>AM ${am.modalita === "driver" ? `da driver, ${am.anni_n} ${am.anni_n === 1 ? "anno" : "anni"}` : "manuale"}</span><b>${am.calcolabile === false ? "non calcolabile" : `${F.gg(am.gg)} gg · ${F.eur0(am.costo)} costo · ${F.eur0(am.prezzo)} prezzo`}</b></div>` : ""}</div></div>`;
  }

  // ================================================================ CATALOGO
  function disegnaCatalogo(m) {
    if (!ST.catEdit) ST.catEdit = copia(ST.cat);
    const k = ST.catEdit, modif = !uguali(JSON.stringify(k), JSON.stringify(ST.cat));
    m.innerHTML = `<div class="st-wrap">${schede()}
      <div class="card"><div class="st-rh"><h3>Catalogo dei parametri di default</h3><span class="st-sp"></span>${modif ? `<span class="st-badge warn">Modifiche non salvate</span><button id="cat-annulla">Annulla</button>` : ""}<button class="primary" id="cat-salva" ${modif ? "" : "disabled"}>Salva catalogo</button></div>
        <p class="hint" style="margin-top:0">Le modifiche valgono per le stime create dopo: quelle esistenti conservano la loro copia dei parametri (si riallineano dall'editor). Moduli e tipi oggetto non si eliminano: si disattivano; i codici non si cambiano dopo la creazione.</p>
        ${ST.catErr ? `<div class="err">${E(ST.catErr)}</div>` : ""}
        ${tabelleParametri(k, null, "catalogo")}</div></div>`;
    bindSchede(m);
    const ridisegna = () => { const y = window.scrollY; disegnaCatalogo(m); window.scrollTo(0, y); };
    bindCampi(m, (key, v) => {
      if (key.startsWith("c:")) pset(k, key.slice(2), v);
      else if (key.startsWith("cv:")) { const [, i, f] = key.split(":"); k.generali.voci_corpo[+i][f] = v; }
      segnaModifiche(m);
    });
    qsa("[data-txt]", m).forEach(el => {
      const evento = el.tagName === "SELECT" ? "onchange" : "oninput";
      el[evento] = () => { pset(k, el.dataset.txt, el.value); segnaModifiche(m); };
    });
    qsa("[data-att]", m).forEach(el => el.onchange = () => { const [sez, cod] = el.dataset.att.split("|"); k[sez].find(x => x.codice === cod).attivo = el.checked; ridisegna(); });
    qsa("[data-vcn]", m).forEach(el => el.oninput = () => { k.generali.voci_corpo[+el.dataset.vcn].nome = el.value; segnaModifiche(m); });
    qsa("[data-vcdel]", m).forEach(b => b.onclick = () => { k.generali.voci_corpo.splice(+b.dataset.vcdel, 1); ridisegna(); });
    const cva = qs("#cv-add", m); if (cva) cva.onclick = () => { (k.generali.voci_corpo = k.generali.voci_corpo || []).push({nome: "Nuova attività", gg_be: 0, gg_fe: 0}); ridisegna(); };
    qs("#cat-addmod", m).onclick = () => {
      const codice = (prompt("Codice del nuovo modulo (lettere maiuscole e numeri, es. ML). Non si potrà cambiare.") || "").trim().toUpperCase();
      if (!codice) return;
      if (k.moduli.some(x => x.codice === codice)) { toast("Codice già usato", true); return; }
      const nome = (prompt("Nome del modulo:") || "").trim(); if (!nome) return;
      k.moduli.push({codice, nome, blocco: "Implementazione", pct_analisi: 0.06, pct_disegno: 0.06, attivo: true, _nuovo: true}); ridisegna();
    };
    qs("#cat-addtipo", m).onclick = () => {
      const mod = qs("#cat-tmod", m).value, modo = qs("#cat-tmodo", m).value;
      const suff = (prompt(`Codice del tipo oggetto: ${mod}.?  (es. MODELLO). Non si potrà cambiare.`) || "").trim().toUpperCase();
      if (!suff) return;
      const codice = `${mod}.${suff}`;
      if (k.tipi.some(x => x.codice === codice)) { toast("Codice già usato", true); return; }
      const nome = (prompt("Nome del tipo oggetto:") || "").trim(); if (!nome) return;
      k.tipi.push(modo === "quantita" ? {codice, modulo: mod, nome, unita: "", modalita: "quantita", mix: [0.4, 0.4, 0.2], gg: [1, 2, 4], pct_be: 1, pct_fe: 0, corpo_be: null, corpo_fe: null, attivo: true}
        : {codice, modulo: mod, nome, unita: "a corpo", modalita: "corpo", mix: null, gg: null, pct_be: null, pct_fe: null, corpo_be: 0, corpo_fe: 0, attivo: true});
      ridisegna();
    };
    const an = qs("#cat-annulla", m); if (an) an.onclick = () => { ST.catEdit = null; ST.catErr = ""; disegnaCatalogo(m); };
    qs("#cat-salva", m).onclick = async () => {
      try {
        const pulito = copia(k); pulito.moduli.forEach(x => delete x._nuovo);
        ST.cat = await api("/api/stime/catalogo", {method: "PUT", body: pulito}); ST.catEdit = null; ST.catErr = ""; toast("Catalogo salvato: vale per le stime nuove"); ridisegna();
      } catch (e) { ST.catErr = e.message; ridisegna(); }
    };
  }
  function segnaModifiche(m) {
    const b = qs("#cat-salva", m); if (b) b.disabled = false;
    const h = qs(".st-rh", m); if (h && !qs(".st-badge.warn", h)) h.querySelector(".st-sp").insertAdjacentHTML("afterend", `<span class="st-badge warn">Modifiche non salvate</span>`);
  }

  // ================================================================ ingresso
  const R = {
    async render(m) {
      ST.root = m;
      m.innerHTML = `<p class="muted pad">Caricamento…</p>`;
      try { if (!ST.cat) await caricaCatalogo(); ST.gare = await caricaGare(); }
      catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
      if (S.view !== "stime") return;
      if (ST.vista === "editor" && ST.s && !ST.sporco) { await apri(ST.s.id); return; }      // al rientro: dati freschi, a meno di modifiche in corso
      disegna();
    },
    // dalla scheda di una gara (fase 5): nuova stima già collegata
    async nuovaPerGara(g) { ST.root = ST.root || document.getElementById("main"); if (!ST.cat) await caricaCatalogo(); ST.gare = await caricaGare(); return nuova({gara: g, cliente: g.cliente, nome: "Stima " + (g.ss || "")}); },
    apri: id => vai("editor", id),
  };
  window.Stime = R;
})();
