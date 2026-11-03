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
    tab: "moduli", aperti: {}, root: null, timer: null, seq: 0, catEdit: null, catErr: ""};

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
            <button class="st-ib" data-az="esporta" data-id="${x.id}" title="Esporta Excel">${icona("download")}</button><button class="st-ib" data-az="elimina" data-id="${x.id}" title="Elimina">${icona("trash-2")}</button></td></tr>`).join("")}
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
      else if (az === "esporta") esporta(id);
    } catch (e) { toast(e.message, true); }
  }
  // Excel con formule vive: si scarica solo se la stima non ha errori (il server li ricontrolla e spiega quali)
  async function esporta(id) {
    try {
      const r = await fetch(`/api/stime/${id}/export`);
      if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) {} if (r.status === 401 && j.login) { location.href = "/login"; return; } throw new Error(j.error || r.statusText); }
      const nome = ((r.headers.get("Content-Disposition") || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1] || "Stima.xlsx";
      const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
      a.href = url; a.download = decodeURIComponent(nome); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Excel esportato");
    } catch (e) { toast(e.message, true); }
  }
  async function nuova(prefill = {}) {
    try {
      const corpo = {nome: prefill.nome || "Nuova stima", cliente: prefill.cliente || "", gara: prefill.gara || null};
      const s = await api("/api/stime", {method: "POST", body: corpo});
      ST.vista = "editor"; await apri(s.id, "impostazioni");
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

  // ================================================================ EDITOR (percorso a passi)
  // 1 Impostazioni · 2 Moduli · 3 Attività · 4 Fasi · 5 AM · 6 Riepilogo, più "Parametri avanzati". A destra solo i totali, sempre
  // visibili. Le giornate si mostrano totali: BE e FE restano separati nel calcolo (e negli input che li richiedono).
  const PASSI = [["impostazioni", "Impostazioni"], ["moduli", "Moduli"], ["attivita", "Attività"], ["fasi", "Fasi"], ["am", "AM"], ["riepilogo", "Riepilogo"]];
  const nfIt = new Intl.NumberFormat("it-IT", {maximumFractionDigits: 4});
  async function apri(id, passo) {
    try {
      const precedente = ST.s && ST.s.id, r = await api(`/api/stime/${id}`);
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; ST.vista = "editor";
      if (precedente !== id) ST.aperti = {};
      ST.passo = passo || (precedente === id && ST.passo ? ST.passo : "moduli");          // una stima esistente si apre sui moduli
      disegna();
    } catch (e) { toast(e.message, true); ST.vista = "elenco"; disegna(); }
  }
  const tipo = (snap, c) => snap.tipi.find(t => t.codice === c);
  const vuota = r => (r.quantita == null || +r.quantita === 0) && !r.etichetta && !r.mix && r.gg_be == null && r.gg_fe == null;
  const rigaNuova = (t, contesto) => ({contesto, tipo: t.codice, etichetta: "", quantita: null, mix: null, gg_be: null, gg_fe: null});
  const daSalvare = s => ({...s, righe: s.righe.filter(r => !vuota(r))});   // le righe lasciate vuote non si salvano

  function disegnaEditor(m) {
    const s = ST.s, passo = ST.passo, conTotali = passo !== "riepilogo";
    m.innerHTML = `<div class="st-wrap st-ed">${schede()}
      <div class="card st-testa"><div class="st-testa-r"><input id="st-nome" class="st-nome" value="${E(s.nome)}" aria-label="Nome della stima">
          <span class="st-ver">v${s.versione}${s.corrente ? ` <span class="st-badge ok">corrente</span>` : ` <button class="linkbtn" id="st-corr">Rendi corrente</button>`}</span>
          <span class="st-sp"></span><span class="st-stato" id="st-stato"></span>
          <button id="st-indietro">${icona("arrow-left")}Elenco</button>
          <button class="st-more" id="st-more" aria-label="Altre azioni">${icona("ellipsis")}</button>
          <div class="st-menu" id="st-menu" hidden><button data-m="versione">Nuova versione</button><button data-m="clona">Clona…</button>
            <button data-m="esporta">Esporta Excel</button><hr><button data-m="elimina" class="danger">Elimina…</button></div></div>
        <div class="st-passi">${PASSI.map(([k, l], i) => `<button class="st-passo ${passo === k ? "on" : ""} ${PASSI.findIndex(x => x[0] === passo) > i ? "fatto" : ""}" data-passo="${k}"><span>${i + 1}</span>${l}</button>`).join(`<i class="st-freccia"></i>`)}
          <span class="st-sp"></span><button class="linkbtn ${passo === "parametri" ? "on" : ""}" data-passo="parametri">${icona("sliders-horizontal")}Parametri avanzati</button></div></div>
      <div class="st-corpo ${conTotali ? "" : "st-pieno"}"><div class="st-sx"><div id="st-passoc"></div>${navHtml()}</div>${conTotali ? `<aside class="st-dx" id="st-riep"></aside>` : ""}</div></div>`;
    bindSchede(m);
    qs("#st-indietro", m).onclick = () => vai("elenco");
    qs("#st-nome", m).oninput = e => { s.nome = e.target.value; modificato(false); };
    const c = qs("#st-corr", m); if (c) c.onclick = async () => { if (await salvaSeServe()) { await api(`/api/stime/${s.id}/corrente`, {method: "POST"}); toast("Ora è la versione corrente"); apri(s.id); } };
    const menu = qs("#st-menu", m);
    qs("#st-more", m).onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    qs(".st-ed", m).onclick = e => { if (!e.target.closest("#st-menu, #st-more")) menu.hidden = true; if (!e.target.closest(".st-pop, [data-mixpop], [data-aiuto]")) chiudiPopover(); };
    qsa("[data-m]", menu).forEach(b => b.onclick = async () => {
      menu.hidden = true;
      if (b.dataset.m === "elimina") { if (confirm(`Eliminare questa versione (v${s.versione}) di “${s.nome}”? Non si può annullare.`)) { await api(`/api/stime/${s.id}`, {method: "DELETE"}); ST.sporco = false; toast("Stima eliminata"); vai("elenco"); } return; }
      if (!(await salvaSeServe())) return;
      if (b.dataset.m === "versione") { const n = await api(`/api/stime/${s.id}/versione`, {method: "POST"}); toast(`Creata la versione ${n.versione}`); apri(n.id); }
      if (b.dataset.m === "clona") { ST.elenco = [s]; dialogoClona(s.id); }
      if (b.dataset.m === "esporta") esporta(s.id);
    });
    qsa("[data-passo]", m).forEach(b => b.onclick = () => vaiPasso(b.dataset.passo));
    disegnaPasso(); disegnaRiepilogo(); stato();
  }
  function navHtml() {
    const i = PASSI.findIndex(x => x[0] === ST.passo);
    if (i < 0) return `<div class="st-nav"><button data-passo="moduli">${icona("arrow-left")}Torna al percorso</button></div>`;
    return `<div class="st-nav">${i > 0 ? `<button data-passo="${PASSI[i - 1][0]}">${icona("arrow-left")}${PASSI[i - 1][1]}</button>` : ""}<span class="st-sp"></span>
      ${i < PASSI.length - 1 ? `<button class="primary" data-passo="${PASSI[i + 1][0]}">${PASSI[i + 1][1]}${icona("arrow-right")}</button>` : ""}</div>`;
  }
  function vaiPasso(p) {
    if (p === ST.passo) return;
    ST.passo = p; chiudiPopover();
    disegnaEditor(ST.root);
    window.scrollTo({top: 0, behavior: "smooth"});
  }
  function stato() {
    const el = qs("#st-stato", ST.root); if (!el) return;
    el.innerHTML = ST.sporco ? `<span class="st-badge warn">Modifiche non salvate</span><button class="primary" id="st-salva">Salva</button>`
      : `<span class="st-salvato" title="Salvata ${E((ST.s.modificata_il || "").replace("T", " ").slice(0, 16))}">Tutto salvato ✓</span>`;
    const b = qs("#st-salva", el); if (b) b.onclick = salva;
  }
  function modificato(strutturale) {
    const prima = ST.sporco; ST.sporco = true; if (!prima) stato();
    if (strutturale) disegnaPasso();
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
      const r = await api(`/api/stime/${ST.s.id}`, {method: "PUT", body: daSalvare(ST.s)});
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; toast("Stima salvata"); disegna();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  async function salvaSeServe() { return !ST.sporco || await salva(); }
  window.addEventListener("beforeunload", e => { if (ST.vista === "editor" && ST.sporco) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------------------------------------------------------- campo numerico generico
  // data-k: "s:campo" (stima), "p:sez|cod|campo|idx" (snapshot), "r:i:campo" (riga), "v:i:campo" (attività a corpo), "a:percorso" (AM)
  function campo(k, valore, opz = {}) {
    const pct = opz.pct, v = pct ? inPct(valore) : (opz.it && valore != null && valore !== "" ? nfIt.format(valore) : inNum(valore));
    return `<input class="st-n ${opz.cls || ""}" data-k="${E(k)}" data-f="${pct ? "pct" : "num"}" ${opz.max1 ? "data-max1" : ""} ${opz.it ? "data-it" : ""}
      value="${E(v)}" inputmode="decimal" placeholder="${E(opz.ph == null ? "" : opz.ph)}" ${opz.title ? `title="${E(opz.title)}"` : ""} ${opz.label ? `aria-label="${E(opz.label)}"` : ""} autocomplete="off">`;
  }
  function leggiCampo(el) {
    const n = leggiNum(el.value), pct = el.dataset.f === "pct";
    let ok = !Number.isNaN(n) && (n == null || n >= 0);
    if (ok && pct && el.hasAttribute("data-max1") && n != null && n >= 100) ok = false;
    el.classList.toggle("bad", !ok);
    el.title = ok ? "" : "Valore non accettato";
    return ok ? {ok, v: pct ? pctDaInput(n) : n} : {ok};
  }
  function bindCampi(root, applica) {
    qsa("input.st-n[data-k]", root).forEach(el => {
      el.oninput = () => { const r = leggiCampo(el); if (r.ok) applica(el.dataset.k, r.v, el); };
      el.onfocus = () => el.select();                         // il contenuto si seleziona: si riscrive senza cancellare
      if (el.hasAttribute("data-it")) el.onblur = () => { const n = leggiNum(el.value); if (n != null && !Number.isNaN(n)) el.value = nfIt.format(n); };
    });
    qsa("input:not(.st-n)", root).forEach(el => { if (!el.onfocus && el.type !== "checkbox") el.onfocus = () => el.select(); });
  }
  function applicaCampo(k, v) {
    const s = ST.s, [t, ...r] = k.split(":");
    if (t === "s") s[r[0]] = v;
    else if (t === "p") pset(s.snapshot, r.join(":"), v);
    else if (t === "r") s.righe[+r[0]][r[1]] = v;
    else if (t === "v") s.voci_corpo[+r[0]][r[1]] = v;
    else if (t === "a") { const [modo, ...p] = r[0].split("."); s.am[modo] = s.am[modo] || {}; let o = s.am[modo]; p.slice(0, -1).forEach(x => o = o[x] = o[x] || {}); o[p[p.length - 1]] = v; }
    if (t === "p") segnaDiff(ST.root);
    modificato(false);
  }
  const diffDot = p => ST.cat && !uguali(pget(ST.s.snapshot, p), pget(ST.cat, p)) ? ` <span class="st-diff-i" title="Default corrente: ${E(fmtDef(p))}"></span><button class="st-ib st-rip" data-rip="${E(p)}" title="Ripristina il default" aria-label="Ripristina il default">${icona("undo-2")}</button>` : "";
  function fmtDef(p) { const v = pget(ST.cat, p); return v == null ? "vuoto" : Array.isArray(v) ? v.map(x => /mix|pct/.test(p) ? inPct(x) + "%" : inNum(x)).join(" / ") : typeof v === "number" ? (/pct|margine|decalage|correttiva|presa|\|min\||\|max\|/.test(p) ? inPct(v) + "%" : inNum(v)) : String(v); }
  function segnaDiff(root) {                                    // pallini "diverso dal default" aggiornati senza ridisegnare
    qsa("[data-k^='p:']", root).forEach(el => {
      const p = el.dataset.k.slice(2), base = /\|(mix|gg)\|\d+$/.test(p) ? p.replace(/\d+$/, "") : p;
      if (/\|gg_fissi\|/.test(p)) return;
      const box = el.closest("td, .st-cv"); if (!box) return;
      const diff = !uguali(pget(ST.s.snapshot, base), pget(ST.cat, base)), dot = box.querySelector(".st-diff-i");
      if (diff && !dot) box.insertAdjacentHTML("beforeend", ` <span class="st-diff-i" title="Diverso dal default corrente: si salva con la stima"></span>`);
      if (!diff && dot && !box.querySelector(".st-rip")) dot.remove();
    });
  }
  function bindComuni(box) {
    bindCampi(box, applicaCampo);
    qsa("[data-rip]", box).forEach(b => b.onclick = () => { pset(ST.s.snapshot, b.dataset.rip, copia(pget(ST.cat, b.dataset.rip))); modificato(true); });
  }
  const aiuto = testo => `<button type="button" class="st-aiuto" data-aiuto="${E(testo)}" aria-label="Aiuto">?</button>`;
  function bindAiuto(box) {
    qsa("[data-aiuto]", box).forEach(b => b.onclick = e => { e.stopPropagation(); apriPopover(b, `<div class="st-aiuto-t">${b.dataset.aiuto}</div>`); });
  }

  // ---------------------------------------------------------------- popover (mix e aiuto): uno alla volta, chiuso da clic fuori o Esc
  function chiudiPopover() { const p = document.getElementById("st-pop"); if (p) p.remove(); }
  function apriPopover(ancora, html) {
    chiudiPopover();
    const p = document.createElement("div"); p.id = "st-pop"; p.className = "st-pop"; p.innerHTML = html;
    document.body.appendChild(p);
    const r = ancora.getBoundingClientRect(), w = p.offsetWidth;
    p.style.top = `${window.scrollY + r.bottom + 6}px`;
    p.style.left = `${Math.max(8, Math.min(window.scrollX + r.right - w, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
    p.onclick = e => e.stopPropagation();
    return p;
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape") chiudiPopover(); });

  // ---------------------------------------------------------------- 1. impostazioni
  function passoImpostazioni(s) {
    const g = s.gara, gEsiste = !g || ST.gare.some(x => x.chiave === g.chiave), snap = s.snapshot;
    const P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p)}</div></div>`;
    return `<div class="card"><div class="st-rh"><h3>Impostazioni della stima</h3></div><div class="st-campi st-imp">
      <div class="st-campo st-l2"><label for="st-cli">Cliente</label><input id="st-cli" list="st-cli-dl" value="${E(s.cliente)}" autocomplete="off">
        <datalist id="st-cli-dl">${[...new Set(ST.gare.map(x => x.cliente).filter(Boolean))].sort().map(c => `<option value="${E(c)}">`).join("")}</datalist></div>
      <div class="st-campo st-l2"><label for="st-gara">Gara collegata</label>${campoGara("st-gara", g && gEsiste ? ST.gare.find(x => x.chiave === g.chiave) : null)}
        ${g && !gEsiste ? `<div class="hint warn">Gara ${E(g.ss)} · ${g.anno} (${E(g.cliente || "")}) non trovata tra le gare attuali: il collegamento resta.</div>` : ""}</div>
      <div class="st-campo"><label>Durata del progetto</label><div class="st-cv">${campo("s:durata_mesi", s.durata_mesi, {it: true})}<span class="muted">mesi</span></div></div>
      <div class="st-campo"><label>Prezzo obiettivo (facoltativo)</label><div class="st-cv">${campo("s:prezzo_obiettivo", s.prezzo_obiettivo, {it: true})}<span class="muted">€</span></div></div>
      <div class="st-campo"><label>Margine del progetto</label><div class="st-cv">${campo("p:generali||margine_progetto|", pget(snap, "generali||margine_progetto|"), {pct: true, max1: true})}<span class="muted">%</span>${diffDot("generali||margine_progetto|")}</div></div></div>
      <h3 class="st-h3">Costi e parametri generali</h3><div class="st-campi st-imp">
        ${snap.team.map(t => P(`Costo ${E(t.nome)}`, `team|${t.codice}|costo|`, {suf: "€/gg"})).join("")}
        ${P("Giornate lavorative al mese", "generali||gg_mese|")}${P("Arrotondamento", "generali||passo|", {suf: "gg"})}
        <div class="st-campo st-l4"><label for="st-note">Note</label><textarea id="st-note" rows="2">${E(s.note)}</textarea></div></div></div>`;
  }
  function bindImpostazioni(box) {
    const s = ST.s;
    qs("#st-cli", box).oninput = e => { s.cliente = e.target.value; modificato(false); };
    qs("#st-gara", box).onchange = e => {
      const v = garaDaCampo(e.target.value);
      if (v === undefined) { e.target.classList.add("bad"); toast("Scegli una gara dall'elenco dei suggerimenti, o lascia il campo vuoto", true); return; }
      e.target.classList.remove("bad");
      s.gara = v ? {ss: v.ss, data_ins: v.data_ins, anno: v.anno, cliente: v.cliente, oggetto: v.oggetto, chiave: v.chiave} : null;
      if (v && !s.cliente) { s.cliente = v.cliente; qs("#st-cli", box).value = v.cliente; }
      modificato(false);
    };
  }

  // ---------------------------------------------------------------- disegno del passo corrente
  function disegnaPasso() {
    const box = qs("#st-passoc", ST.root); if (!box) return;
    const s = ST.s, p = ST.passo;
    box.innerHTML = p === "impostazioni" ? passoImpostazioni(s) : p === "moduli" ? passoModuli(s) : p === "attivita" ? passoAttivita(s)
      : p === "fasi" ? passoFasi(s) : p === "am" ? passoAm(s) : p === "riepilogo" ? `<div data-blocco="riep-full"></div>` : passoParametri(s);
    bindComuni(box); bindAiuto(box);
    qsa("[data-passo]", box).forEach(b => b.onclick = () => vaiPasso(b.dataset.passo));
    if (p === "impostazioni") bindImpostazioni(box);
    qsa("[data-et]", box).forEach(el => el.oninput = () => { s.righe[+el.dataset.et].etichetta = el.value; modificato(false); });
    qsa("[data-vn]", box).forEach(el => el.oninput = () => { s.voci_corpo[+el.dataset.vn].nome = el.value; modificato(false); });
    qsa("[data-cat]", box).forEach(b => b.onclick = e => { if (e.target.closest("[data-agg]")) return; ST.aperti[b.dataset.cat] = !apertoModulo(b.dataset.cat); disegnaPasso(); });
    qsa("[data-agg]", box).forEach(b => b.onclick = e => { e.stopPropagation(); aggiungiRiga(b.dataset.agg, b.dataset.ctx || "progetto", null); });
    qsa("[data-del]", box).forEach(b => b.onclick = () => eliminaRiga(+b.dataset.del));
    qsa("[data-mixpop]", box).forEach(b => b.onclick = e => { e.stopPropagation(); popoverMix(b, +b.dataset.mixpop); });
    qsa("input[data-k$=':quantita']", box).forEach(el => el.onkeydown = e => {    // Invio sulla quantità: nuova riga dello stesso tipo
      if (e.key !== "Enter") return;
      e.preventDefault();
      const i = +el.dataset.k.split(":")[1], r = s.righe[i];
      aggiungiRiga(r.tipo, r.contesto || "progetto", i);
    });
    qsa("[data-voce]", box).forEach(b => b.onclick = () => { if (b.dataset.voce === "del") s.voci_corpo.splice(+b.dataset.i, 1); else s.voci_corpo.push({nome: "", gg_be: 0, gg_fe: 0}); modificato(true);
      if (b.dataset.voce === "add") { const el = qsa("[data-vn]", ST.root).pop(); if (el) el.focus(); } });
    qsa("[data-fisso-off]", box).forEach(b => b.onclick = () => { const f = s.snapshot.fasi.find(x => x.codice === b.dataset.fissoOff); if (f) f.gg_fissi = null; modificato(true); });
    qsa("input[data-k$='|gg_fissi|']", box).forEach(el => el.addEventListener("change", () => {     // badge "fisse" e ↺ aggiornati senza perdere il fuoco
      const cod = el.dataset.k.split("|")[1], f = s.snapshot.fasi.find(x => x.codice === cod), tr = el.closest("tr"); if (!f || !tr) return;
      const fisso = f.gg_fissi != null && f.gg_fissi !== "";
      tr.classList.toggle("st-fisso", fisso);
      const badge = tr.querySelector(".st-badge"); if (fisso && !badge) tr.cells[0].insertAdjacentHTML("beforeend", ` <span class="st-badge">fisse</span>`); if (!fisso && badge) badge.remove();
      tr.cells[4].innerHTML = fisso ? `<button type="button" class="st-ib" data-fisso-off="${E(cod)}" title="Torna alla percentuale" aria-label="Torna alla percentuale">${icona("undo-2")}</button>` : "";
      const b = tr.querySelector("[data-fisso-off]"); if (b) b.onclick = () => { f.gg_fissi = null; modificato(true); };
    }));
    qsa("[data-ammodo]", box).forEach(b => b.onclick = () => { s.am.modalita = b.dataset.ammodo || null; if (s.am.modalita === "manuale" && !s.am.manuale) s.am.manuale = {BE: {gg_mese: 0, mesi: 12}, FE: {gg_mese: 0, mesi: 12}};
      if (s.am.modalita === "driver" && !s.am.driver) s.am.driver = {fonte: "progetto", servizio: "H8", anni: 3, evolutiva: 0, presa: null}; modificato(true); });
    qsa("[data-amsel]", box).forEach(el => el.onchange = () => { const d = s.am.driver; d[el.dataset.amsel] = el.dataset.amsel === "anni" ? +el.value : el.value; if (el.dataset.amsel === "fonte") d.presa = null; modificato(true); });
    const presa = qs("#st-presa", box); if (presa) presa.onchange = () => { s.am.driver.presa = presa.checked; modificato(false); };
    const ri = qs("#st-riall", box); if (ri) ri.onclick = riallinea;
    const note = qs("#st-note", box); if (note) note.oninput = () => { s.note = note.value; modificato(false); };
    aggiornaCalcolati();
  }
  function aggiungiRiga(codice, contesto, dopo) {
    const t = tipo(ST.s.snapshot, codice); if (!t) return;
    const r = ST.s.righe, nuova = rigaNuova(t, contesto);
    if (dopo == null) { const ult = r.map((x, j) => x.tipo === codice && (x.contesto || "progetto") === contesto ? j : -1).filter(j => j >= 0).pop(); dopo = ult == null ? r.length - 1 : ult; }
    r.splice(dopo + 1, 0, nuova);
    ST.aperti[(t.modulo) + ":" + contesto] = true;
    modificato(true);
    const el = qs(`[data-et="${dopo + 1}"]`, ST.root); if (el) el.focus();
  }
  function eliminaRiga(i) {
    const x = ST.s.righe[i];
    if (!vuota(x) && !confirm(`Eliminare la riga “${x.etichetta || (tipo(ST.s.snapshot, x.tipo) || {}).nome || x.tipo}”?`)) return;
    ST.s.righe.splice(i, 1); modificato(true);
  }

  // ---------------------------------------------------------------- 2. moduli: categorie a scomparsa, un sottotitolo per tipo oggetto
  const righeDi = (s, contesto) => s.righe.map((r, i) => ({r, i})).filter(x => (x.r.contesto || "progetto") === contesto);
  const piena = r => !vuota(r);
  function apertoModulo(chiave) {
    if (ST.aperti[chiave] != null) return ST.aperti[chiave];
    const [mod, ctx] = chiave.split(":");
    return righeDi(ST.s, ctx).some(x => (tipo(ST.s.snapshot, x.r.tipo) || {}).modulo === mod && piena(x.r));    // aperte solo le categorie compilate
  }
  const mixTesto = m => `S${nfIt.format(Math.round(m[0] * 1000) / 10)} · M${nfIt.format(Math.round(m[1] * 1000) / 10)} · D${nfIt.format(Math.round(m[2] * 1000) / 10)}`;
  function tabellaRighe(s, contesto) {
    const snap = s.snapshot, righe = righeDi(s, contesto), quant = contesto === "am_esercizio";
    const moduli = snap.moduli.filter(m => m.attivo !== false || righe.some(x => (tipo(snap, x.r.tipo) || {}).modulo === m.codice));
    const tipiDi = m => snap.tipi.filter(t => t.modulo === m.codice && (t.attivo !== false || righe.some(x => x.r.tipo === t.codice)) && (!quant || t.modalita === "quantita"));
    const orfane = righe.filter(x => !tipo(snap, x.r.tipo));
    const corpo = moduli.filter(m => tipiDi(m).length).map(m => {
      const chiave = `${m.codice}:${contesto}`, aperto = apertoModulo(chiave), tipi = tipiDi(m);
      const n = righe.filter(x => (tipo(snap, x.r.tipo) || {}).modulo === m.codice && piena(x.r)).length;
      const testa = `<tbody class="st-cat-h"><tr><td colspan="5"><div class="st-cat" data-cat="${E(chiave)}" role="button" tabindex="0" aria-expanded="${aperto}">
          <span class="st-chev">${icona(aperto ? "chevron-down" : "chevron-right")}</span><b>${E(m.nome)}</b>
          ${!aperto && !n ? `<span class="st-cat-vuota">nessun elemento · ${tipi.map(t => `<button type="button" class="linkbtn" data-agg="${E(t.codice)}" data-ctx="${contesto}">+ Aggiungi ${E(t.nome.toLowerCase())}</button>`).join(" ")}</span>` : !aperto ? `<span class="st-cat-vuota">${n} ${n === 1 ? "riga" : "righe"}</span>` : ""}
          <span class="st-sp"></span><span class="st-cat-tot" data-out="mod:${E(m.codice)}:${contesto}"></span></div></td></tr></tbody>`;
      if (!aperto) return testa;
      return testa + `<tbody class="st-cat-b">${tipi.map(t => {
        const mie = righe.filter(x => x.r.tipo === t.codice), q = t.modalita === "quantita";
        return `<tr class="st-tipo-h"><td colspan="5"><b>${E(t.nome)}</b>${t.unita && t.unita !== "a corpo" ? ` · ${E(t.unita)}` : ""}
            <span class="st-tipo-gg">${q ? `gg unitari S/M/D: ${t.gg.map(v => nfIt.format(v)).join(" / ")}` : "a corpo: giornate BE e FE"}</span>${t.attivo === false ? ` <span class="muted">(disattivato)</span>` : ""}</td></tr>`
          + mie.map(({r, i}) => rigaHtml(t, r, i)).join("")
          + `<tr class="st-agg-r"><td colspan="5"><button type="button" class="linkbtn" data-agg="${E(t.codice)}" data-ctx="${contesto}">+ Aggiungi ${E(t.nome.toLowerCase())}</button></td></tr>`;
      }).join("")}</tbody>`;
    }).join("");
    return `<table class="st-righe st-moduli"><thead><tr><th>Etichetta</th><th class="r">Quantità</th><th class="r">Mix</th><th class="r">Giornate</th><th></th></tr></thead>${corpo}
      <tfoot><tr><td colspan="3">${quant ? "Build equivalente" : "Totale moduli"}</td><td class="r" data-out="tot-${contesto}"></td><td></td></tr></tfoot></table>`
      + (orfane.length ? `<div class="hint warn">Righe con un tipo oggetto non presente nei parametri: ${orfane.map(x => E(x.r.tipo)).join(", ")}</div>` : "");
  }
  function rigaHtml(t, r, i) {
    const q = t.modalita === "quantita", mod = !!r.mix, mix = r.mix || t.mix;
    return `<tr data-i="${i}" data-t="${E(t.codice)}"><td><input class="st-et" data-et="${i}" value="${E(r.etichetta)}" placeholder="Etichetta (es. SAP ECC)" aria-label="Etichetta"></td>
      <td class="r">${q ? campo(`r:${i}:quantita`, r.quantita, {cls: "st-n2", ph: "0", it: true, label: "Quantità"})
        : `<span class="st-corpo-in">BE ${campo(`r:${i}:gg_be`, r.gg_be, {cls: "st-n3", ph: inNum(t.corpo_be), it: true, label: "Giornate BE"})} FE ${campo(`r:${i}:gg_fe`, r.gg_fe, {cls: "st-n3", ph: inNum(t.corpo_fe), it: true, label: "Giornate FE"})}</span>`}</td>
      <td class="r">${q ? `<button type="button" class="st-chip-mix ${mod ? "mod" : ""}" data-mixpop="${i}" tabindex="-1" title="Mix di complessità Semplice / Medio / Difficile${mod ? " (personalizzato)" : " (default)"}: clic per modificarlo">${mixTesto(mix)}</button>` : ""}</td>
      <td class="r b st-gg" data-out="riga:${i}" data-formula="${i}"></td>
      <td class="st-azioni"><button type="button" class="st-ib st-cestino" data-del="${i}" tabindex="-1" title="Elimina la riga" aria-label="Elimina la riga">${icona("trash-2")}</button></td></tr>`;
  }
  function popoverMix(chip, i) {
    const r = ST.s.righe[i], t = tipo(ST.s.snapshot, r.tipo), val = [...(r.mix || t.mix)];
    const p = apriPopover(chip, `<div class="st-pop-t">Mix di complessità</div>
      <div class="st-pop-mix">${["S", "M", "D"].map((l, k) => `<label>${l}<span><input class="st-n" data-pm="${k}" value="${inPct(val[k])}" inputmode="decimal" aria-label="Mix ${l} %"> %</span></label>`).join("")}</div>
      <div class="st-pop-msg" id="st-pm-msg"></div>
      <div class="st-pop-a"><button type="button" id="st-pm-def">Ripristina default</button><span class="st-sp"></span><button type="button" class="primary" id="st-pm-ok">Fatto</button></div>
      <div class="hint">Default: ${mixTesto(t.mix)}</div>`);
    const msg = qs("#st-pm-msg", p), ins = qsa("[data-pm]", p);
    const verifica = () => {
      const n = ins.map(x => leggiNum(x.value)), ok = n.every(x => x != null && !Number.isNaN(x) && x >= 0), somma = ok ? n.reduce((a, b) => a + b, 0) : NaN;
      const giusto = ok && Math.abs(somma - 100) < 1e-6;
      msg.textContent = giusto ? "Somma 100% ✓" : `La somma è ${Number.isNaN(somma) ? "non valida" : nfIt.format(somma) + "%"}: deve fare 100%`;
      msg.classList.toggle("bad", !giusto);
      if (giusto) {
        const nuovo = n.map(x => pctDaInput(x));
        r.mix = nuovo.every((x, k) => Math.abs(x - t.mix[k]) < 1e-9) ? null : nuovo;
        chip.textContent = mixTesto(r.mix || t.mix); chip.classList.toggle("mod", !!r.mix);
        modificato(false);
      }
      return giusto;
    };
    ins.forEach(x => { x.oninput = verifica; x.onfocus = () => x.select(); x.onkeydown = e => { if (e.key === "Enter" && verifica()) chiudiPopover(); }; });
    qs("#st-pm-def", p).onclick = () => { ins.forEach((x, k) => x.value = inPct(t.mix[k])); verifica(); };
    qs("#st-pm-ok", p).onclick = () => { if (verifica()) chiudiPopover(); };
    ins[0].focus();
    verifica();
  }
  const AIUTO_MODULI = "Per ogni categoria aggiungi le righe dei tipi oggetto che servono (per esempio una riga per sorgente) e scrivi la quantità. Le giornate di una riga sono quantità × (S% × gg S + M% × gg M + D% × gg D), divise tra BE e FE e arrotondate a mezza giornata: passa sopra le giornate per vedere il conto. Il mix (pastiglia grigia = default, colorata = personalizzato) si cambia con un clic. Con Invio sulla quantità aggiungi un'altra riga dello stesso tipo. Le righe lasciate vuote non si salvano.";
  function passoModuli(s) {
    return `<div class="card st-card-mod"><div class="st-rh"><h3>Moduli</h3><span class="muted st-riga1">Aggiungi i tipi oggetto e scrivi le quantità.</span>${aiuto(AIUTO_MODULI)}</div>
      ${tabellaRighe(s, "progetto")}</div>`;
  }

  // ---------------------------------------------------------------- 3. attività a corpo (training e attività di base)
  function passoAttivita(s) {
    const riga = (nome, kbe, vbe, kfe, vfe, out, del) => `<tr>${nome}<td class="r">${campo(kbe, vbe, {cls: "st-n2", it: true, label: "Giornate BE"})}</td><td class="r">${campo(kfe, vfe, {cls: "st-n2", it: true, label: "Giornate FE"})}</td>
      <td class="r b" data-out="${out}"></td><td class="st-azioni">${del}</td></tr>`;
    return `<div class="card"><div class="st-rh"><h3>Attività a corpo</h3><span class="muted st-riga1">Giornate inserite a mano, divise tra BE e FE.</span>${aiuto("Il training è un blocco a sé. Le altre attività (setup degli ambienti, gestione della sicurezza del dato e quelle che aggiungi) fanno parte dell'implementazione: entrano nella base su cui si calcolano kick-off, test, documentazione e deploy, ma non generano analisi né disegno.")}</div>
      <table class="st-righe st-attivita"><thead><tr><th>Attività</th><th class="r">gg BE</th><th class="r">gg FE</th><th class="r">Giornate</th><th></th></tr></thead><tbody>
      ${riga(`<td><b>Training</b></td>`, "s:training_be", s.training_be, "s:training_fe", s.training_fe, "training", "")}
      ${s.voci_corpo.map((v, i) => riga(`<td><input data-vn="${i}" value="${E(v.nome)}" placeholder="Nome dell'attività" aria-label="Nome dell'attività"></td>`, `v:${i}:gg_be`, v.gg_be, `v:${i}:gg_fe`, v.gg_fe, `voce:${i}`,
        `<button type="button" class="st-ib st-cestino" data-voce="del" data-i="${i}" tabindex="-1" title="Elimina" aria-label="Elimina l'attività">${icona("trash-2")}</button>`)).join("")}
      </tbody><tfoot><tr><td>Totale attività a corpo</td><td></td><td></td><td class="r" data-out="tot-attivita"></td><td></td></tr></tfoot></table>
      <div class="st-add"><button type="button" class="linkbtn" data-voce="add">+ Aggiungi attività</button></div></div>`;
  }

  // ---------------------------------------------------------------- 4. fasi: percentuale oppure giornate fisse
  const BASI = {Moduli_team: "implementazione dei moduli", B: "implementazione", BaseModuli: "somma dei moduli", TP: "totale attività", TP_team: "totale attività"};
  function passoFasi(s) {
    const snap = s.snapshot;
    return `<div class="card"><div class="st-rh"><h3>Fasi</h3><span class="muted st-riga1">Percentuale sulla base, oppure un numero di giornate fisso.</span>${aiuto("Ogni fase si calcola come percentuale della sua base. Se per un caso particolare vuoi un numero preciso, scrivilo in “Giornate”: da quel momento vale quel numero (la fase è marcata “fisse”) e la percentuale non conta; con ↺ torni alla percentuale. Le giornate fisse si dividono tra BE e FE come farebbe la percentuale. Le ripartizioni BE/FE sono nei parametri avanzati.")}</div>
      <table class="st-righe st-fasi"><thead><tr><th>Fase</th><th>Calcolata su</th><th class="r">%</th><th class="r">Giornate</th><th></th></tr></thead><tbody>
      ${snap.fasi.map(f => {
        const fisso = f.gg_fissi != null && f.gg_fissi !== "";
        return `<tr class="${fisso ? "st-fisso" : ""}"><td><b>${E(f.nome)}</b>${fisso ? ` <span class="st-badge">fisse</span>` : ""}</td><td class="muted">${E(BASI[f.base] || f.base)}</td>
          <td class="r"><span class="st-cv st-cvr">${campo(`p:fasi|${f.codice}|pct|`, f.pct, {pct: true, cls: "st-n3", label: `% ${f.nome}`})}${diffDot(`fasi|${f.codice}|pct|`)}</span></td>
          <td class="r">${campo(`p:fasi|${f.codice}|gg_fissi|`, fisso ? f.gg_fissi : null, {cls: "st-n2", it: true, label: `Giornate ${f.nome}`, title: "Scrivi un numero per fissare le giornate"})}</td>
          <td class="st-azioni">${fisso ? `<button type="button" class="st-ib" data-fisso-off="${E(f.codice)}" title="Torna alla percentuale" aria-label="Torna alla percentuale">${icona("undo-2")}</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- 5. AM
  function passoAm(s) {
    const am = s.am || {modalita: null}, snap = s.snapshot, modo = am.modalita || "", A = snap.am, coeff = A.coeff || {};
    const P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p)}</div></div>`;
    let corpo = "";
    if (modo === "manuale") {
      const m = am.manuale || {};
      corpo = `<table class="st-righe"><thead><tr><th>Figura</th><th class="r">gg al mese</th><th class="r">Mesi</th><th class="r">Giornate</th></tr></thead><tbody>
        ${["BE", "FE"].map(t => `<tr><td><b>${E((snap.team.find(x => x.codice === t) || {}).nome || t)}</b></td><td class="r">${campo(`a:manuale.${t}.gg_mese`, (m[t] || {}).gg_mese, {cls: "st-n2", it: true})}</td><td class="r">${campo(`a:manuale.${t}.mesi`, (m[t] || {}).mesi, {cls: "st-n2", it: true})}</td>
          <td class="r b" data-out="am:${t}:gg"></td></tr>`).join("")}</tbody></table>`;
    } else if (modo === "driver") {
      const d = am.driver || {}, presa = d.presa == null ? d.fonte === "esercizio" : d.presa;
      corpo = `<div class="st-campi">
        <div class="st-campo st-l2"><label>Fonte del build equivalente</label><select data-amsel="fonte"><option value="progetto" ${d.fonte !== "esercizio" ? "selected" : ""}>Progetto (implementazione di questa stima)</option><option value="esercizio" ${d.fonte === "esercizio" ? "selected" : ""}>Oggetti in esercizio (sistema esistente)</option></select></div>
        <div class="st-campo"><label>Livello di servizio</label><select data-amsel="servizio">${["H8", "H12", "H24"].map(x => `<option value="${x}" ${d.servizio === x ? "selected" : ""}>${x} (× ${inNum(coeff[x])})</option>`).join("")}</select></div>
        <div class="st-campo"><label>Anni</label><select data-amsel="anni">${Array.from({length: A.anni_max || 5}, (_, k) => k + 1).map(k => `<option ${+d.anni === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="st-campo"><label>Evolutiva</label><div class="st-cv">${campo("a:driver.evolutiva", d.evolutiva, {it: true})}<span class="muted">gg/anno</span></div></div>
        <div class="st-campo"><label>&nbsp;</label><label class="st-chk"><input type="checkbox" id="st-presa" ${presa ? "checked" : ""}> Presa in carico (solo anno 1)</label></div></div>
        ${d.fonte === "esercizio" ? `<h3 class="st-h3">Oggetti in esercizio</h3>${tabellaRighe(s, "am_esercizio")}` : ""}`;
    }
    return `<div class="card"><div class="st-rh"><h3>Application Management</h3></div>
      <div class="st-seg">${[["", "Nessuna"], ["manuale", "Manuale"], ["driver", "Da driver"]].map(([k, l]) => `<button type="button" data-ammodo="${k}" class="${modo === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${corpo}<div data-blocco="am-ris"></div></div>
      <div class="card"><div class="st-rh"><h3>Parametri AM</h3></div><div class="st-campi">
        ${P("Margine dell'AM", "generali||margine_am|", {pct: true, max1: true, suf: "%"})}
        ${P("Correttiva annua sul build equivalente", "am||pct_correttiva|", {pct: true, suf: "%"})}
        ${["H8", "H12", "H24"].map(x => P(`Coefficiente ${x}`, `am||coeff|${x}`)).join("")}
        ${P("Presa in carico (anno 1)", "am||pct_presa|", {pct: true, suf: "%"})}
        ${P("Decalage annuo dal secondo anno", "am||decalage|", {pct: true, suf: "%"})}
        ${P("Anni massimi", "am||anni_max|")}</div></div>`;
  }

  // ---------------------------------------------------------------- parametri avanzati: costi e generali, fasi, moduli e tipi oggetto
  function passoParametri(s) {
    const snap = s.snapshot, usati = new Set(s.righe.filter(r => !vuota(r)).map(r => r.tipo));
    const tipi = snap.tipi.filter(t => t.attivo !== false || usati.has(t.codice));
    const P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p)}</div></div>`;
    const rip = (sez, c, x) => x.pct_be == null ? `<span class="muted">per team</span>` : `${campo(`p:${sez}|${c}|pct_be|`, x.pct_be, {pct: true, cls: "st-n3"})}${campo(`p:${sez}|${c}|pct_fe|`, x.pct_fe, {pct: true, cls: "st-n3"})}${diffDot(`${sez}|${c}|pct_be|`) || diffDot(`${sez}|${c}|pct_fe|`)}`;
    const errRip = x => x.pct_be != null && Math.abs((+x.pct_be || 0) + (+x.pct_fe || 0) - 1) > 1e-9;
    return `<div class="card"><div class="st-rh"><h3>Parametri avanzati della stima</h3><span class="st-sp"></span><button type="button" id="st-riall">${icona("refresh-cw")}Riallinea ai default correnti</button></div>
      <p class="hint" style="margin-top:0">Copia dei parametri congelata in questa stima. Il pallino <span class="st-diff-i"></span> segna i valori diversi dal catalogo corrente; ${icona("undo-2")} li riporta al default. Costi, giornate al mese e arrotondamento sono nelle impostazioni; i parametri AM nel passo AM.</p>
      <h3 class="st-h3">Fasi, PM e contingency</h3><table class="st-righe st-par"><thead><tr><th>Fase</th><th>Calcolata su</th><th class="r">%</th><th class="r">% BE / FE</th></tr></thead><tbody>
      ${snap.fasi.map(f => `<tr><td><b>${E(f.nome)}</b></td><td class="muted">${E(BASI[f.base] || f.base)}</td><td class="r">${campo(`p:fasi|${f.codice}|pct|`, f.pct, {pct: true, cls: "st-n3"})}${diffDot(`fasi|${f.codice}|pct|`)}</td>
        <td class="r ${errRip(f) ? "st-errc" : ""}">${f.codice === "PM" ? `<span class="muted">figura PM</span>` : rip("fasi", f.codice, f)}</td></tr>`).join("")}</tbody></table>
      <h3 class="st-h3">Moduli e tipi oggetto</h3><div class="st-scroll"><table class="st-righe st-par st-tipi"><thead><tr><th>Tipo oggetto</th><th class="r">Mix S / M / D %</th><th class="r">gg unitari S / M / D</th><th class="r">% BE / FE</th></tr></thead><tbody>
      ${snap.moduli.filter(m => tipi.some(t => t.modulo === m.codice)).map(m => `<tr class="st-modrow"><td colspan="4">${E(m.nome)}</td></tr>` + tipi.filter(t => t.modulo === m.codice).map(t => {
        const c = t.codice, q = t.modalita === "quantita", errMix = q && Math.abs((t.mix || []).reduce((a, b) => a + (+b || 0), 0) - 1) > 1e-9;
        return `<tr class="${t.attivo === false ? "spento" : ""}"><td><b>${E(t.nome)}</b>${t.attivo === false ? ` <span class="muted">(disattivato)</span>` : ""}</td>
          ${q ? `<td class="r ${errMix ? "st-errc" : ""}">${[0, 1, 2].map(k => campo(`p:tipi|${c}|mix|${k}`, t.mix[k], {pct: true, cls: "st-n3"})).join("")}${diffDot(`tipi|${c}|mix|`)}</td>
            <td class="r">${[0, 1, 2].map(k => campo(`p:tipi|${c}|gg|${k}`, t.gg[k], {cls: "st-n3"})).join("")}${diffDot(`tipi|${c}|gg|`)}</td><td class="r ${errRip(t) ? "st-errc" : ""}">${rip("tipi", c, t)}</td>`
            : `<td class="r muted">a corpo</td><td class="r">default BE ${campo(`p:tipi|${c}|corpo_be|`, t.corpo_be, {cls: "st-n3"})} FE ${campo(`p:tipi|${c}|corpo_fe|`, t.corpo_fe, {cls: "st-n3"})}</td><td></td>`}</tr>`;
      }).join("")).join("")}</tbody></table></div></div>`;
  }

  async function riallinea() {
    if (!(await salvaSeServe())) return;
    try {
      const r = await api(`/api/stime/${ST.s.id}/riallinea`, {method: "POST", body: {}});
      if (!r.differenze.length) { toast("I parametri sono già allineati al catalogo"); return; }
      const nomeSez = {team: "Figure", moduli: "Moduli", tipi: "Tipi oggetto", fasi: "Fasi", generali: "Generali", am: "AM"};
      const val = v => v == null ? "—" : typeof v === "object" ? E(JSON.stringify(v)) : typeof v === "number" ? inNum(v) : E(v);
      const el = modal(`<h2>Riallinea ai default correnti</h2><p class="muted">Questi valori della stima verranno sostituiti con quelli del catalogo. Le giornate fisse delle fasi restano; i tipi oggetto disattivati ancora usati dalle righe restano con i parametri attuali.</p>
        <div class="st-scroll" style="max-height:50vh"><table class="st-righe"><thead><tr><th>Sezione</th><th>Voce</th><th>Campo</th><th class="r">Stima</th><th class="r">Catalogo</th></tr></thead><tbody>
        ${r.differenze.map(d => `<tr><td>${nomeSez[d.sezione] || d.sezione}</td><td>${E(d.codice || "")}</td><td>${E(d.campo || "")}</td><td class="r">${val(d.stima)}</td><td class="r">${val(d.default)}</td></tr>`).join("")}</tbody></table></div>
        <div class="foot"><button id="ra-x">Annulla</button><button class="primary" id="ra-ok">Riallinea</button></div>`);
      qs("#ra-x", el).onclick = closeModal;
      qs("#ra-ok", el).onclick = async () => { try { await api(`/api/stime/${ST.s.id}/riallinea`, {method: "POST", body: {conferma: true}}); closeModal(); toast("Parametri riallineati"); apri(ST.s.id); } catch (e) { toast(e.message, true); } };
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- valori calcolati (solo totali: BE e FE restano nel calcolo)
  const tot = x => x == null ? null : (x.tot != null ? x.tot : (x.BE || 0) + (x.FE || 0));
  function formulaRiga(i) {
    const res = ST.res; if (!res) return "";
    const r = ST.s.righe[i], t = r && tipo(ST.s.snapshot, r.tipo);
    const calc = [...res.progetto.righe, ...((res.am && res.am.righe) || [])].find(x => x.indice === i);
    if (!t || !calc) return "";
    if (t.modalita !== "quantita") return `A corpo: BE ${F.gg(calc.BE)} + FE ${F.gg(calc.FE)} = ${F.gg(calc.tot)} gg`;
    const mix = r.mix || t.mix, q = +(r.quantita || 0);
    const grezzi = q * (mix[0] * t.gg[0] + mix[1] * t.gg[1] + mix[2] * t.gg[2]);
    const pz = mix.map((m, k) => `${nfIt.format(Math.round(m * 1000) / 10)}%×${nfIt.format(t.gg[k])}`).join(" + ");
    const esatto = Math.abs(grezzi - calc.tot) < 1e-9;
    return `${nfIt.format(q)} × (${pz}) = ${esatto ? "" : nf(2).format(grezzi) + " → "}${F.gg(calc.tot)} gg${esatto ? "" : " (arrotondate a mezza giornata, divise tra BE e FE)"}`;
  }
  function aggiornaCalcolati() {
    const res = ST.res, root = ST.root; if (!res || !root) return;
    const p = res.progetto, out = {};
    p.righe.forEach(r => { out[`riga:${r.indice}`] = F.gg(r.tot); });
    p.moduli.forEach(m => { out[`mod:${m.codice}:progetto`] = F.gg(tot(m.impl)) + " gg"; });
    out["tot-progetto"] = F.gg(p.base_moduli) + " gg";
    p.voci_corpo.forEach((v, i) => { out[`voce:${i}`] = F.gg(tot(v)); });
    out.training = F.gg(tot(p.training));
    out["tot-attivita"] = F.gg(tot(p.training) + p.voci_corpo.reduce((a, v) => a + tot(v), 0)) + " gg";
    const am = res.am;
    if (am && am.modalita === "driver") {
      (am.righe || []).forEach(r => { out[`riga:${r.indice}`] = F.gg(r.tot); });
      const perMod = {}; (am.righe || []).forEach(r => { perMod[r.modulo] = (perMod[r.modulo] || 0) + r.tot; });
      Object.entries(perMod).forEach(([k, v]) => { out[`mod:${k}:am_esercizio`] = F.gg(v) + " gg"; });
      out["tot-am_esercizio"] = F.gg(am.beq.tot) + " gg";
    }
    if (am && am.modalita === "manuale") ["BE", "FE"].forEach(t => { out[`am:${t}:gg`] = F.gg(am.team[t].gg); });
    qsa("[data-out]", root).forEach(el => { el.textContent = out[el.dataset.out] ?? (el.dataset.out.startsWith("mod:") ? "0,0 gg" : ""); });
    qsa("[data-formula]", root).forEach(el => { el.title = formulaRiga(+el.dataset.formula); });
    // fasi: le giornate calcolate come segnaposto del campo (o il valore fisso)
    const valFase = cod => cod === "PM" ? p.PM : cod === "CONT" ? p.contingency.tot : cod === "SEC" ? tot(p.sicurezza) : (p.fasi[cod] ? tot(p.fasi[cod]) : null);
    qsa("input[data-k$='|gg_fissi|']", root).forEach(el => {
      const cod = el.dataset.k.split("|")[1], v = valFase(cod);
      el.placeholder = v == null ? "" : nfIt.format(v);
      if (el.value && v != null && document.activeElement !== el) el.title = `Giornate fisse: ${F.gg(v)} gg dopo l'arrotondamento`;
    });
    const errRighe = new Set(res.messaggi.filter(x => x.livello === "errore" && /^riga:/.test(x.dove || "")).map(x => +x.dove.split(":")[1]));
    qsa("tr[data-i]", root).forEach(tr => tr.classList.toggle("st-err", errRighe.has(+tr.dataset.i)));
    const amb = qs("[data-blocco='am-ris']", root); if (amb) amb.innerHTML = amRisultatiHtml(am);
    const full = qs("[data-blocco='riep-full']", root); if (full) full.innerHTML = riepilogoCompleto();
    disegnaRiepilogo();
  }
  function amRisultatiHtml(am) {
    if (!am) return "";
    if (am.modalita === "manuale") return `<div class="st-amtot">Totale AM: <b>${F.gg(am.gg)} gg</b> · costo ${F.eur(am.costo)} · prezzo <b>${F.eur(am.prezzo)}</b> · media mensile ${F.eur(am.mensile)}</div>`;
    if (!am.calcolabile) return `<div class="hint warn">AM non calcolabile: il build equivalente è zero.</div>`;
    return `<div class="st-amtot">Build equivalente: <b>${F.gg(am.beq.tot)} gg</b></div>
      <div class="st-scroll"><table class="st-righe"><thead><tr><th>Anno</th><th class="r">Correttiva</th><th class="r">Evolutiva</th><th class="r">Presa in carico</th><th class="r">Giornate</th><th class="r">Costo</th><th class="r">Prezzo</th><th class="r">Mensile</th><th class="r">FTE</th></tr></thead><tbody>
      ${am.anni.map(a => `<tr><td>${a.anno}</td><td class="r">${F.gg(tot(a.correttiva))}</td><td class="r">${F.gg(tot(a.evolutiva))}</td><td class="r">${tot(a.presa) ? F.gg(tot(a.presa)) : "—"}</td>
        <td class="r b">${F.gg(a.gg.tot)}</td><td class="r">${F.eur(a.costo)}</td><td class="r">${F.eur(a.prezzo)}</td><td class="r">${F.eur(a.mensile)}</td><td class="r">${F.fte(a.fte)}</td></tr>`).join("")}
      <tr class="tot"><td>Totale</td><td></td><td></td><td></td><td class="r">${F.gg(am.gg)}</td><td class="r">${F.eur(am.costo)}</td><td class="r">${F.eur(am.prezzo)}</td><td></td><td></td></tr></tbody></table></div>`;
  }
  function messaggiHtml(res, soloErrori) {
    let msg = res.messaggi.filter((x, i, a) => a.findIndex(y => y.testo === x.testo) === i).filter(x => !soloErrori || x.livello !== "info");
    const ord = {errore: 0, avviso: 1, info: 2};
    msg.sort((a, b) => ord[a.livello] - ord[b.livello]);
    return msg.length ? `<div class="st-msg">${msg.map(x => `<div class="st-m ${x.livello}">${E(x.testo)}</div>`).join("")}${res.export_bloccato ? `<div class="st-m errore b">Ci sono errori: l'export Excel è bloccato finché non li correggi (il salvataggio è sempre possibile).</div>` : ""}</div>` : "";
  }
  // implementazione = moduli + attività a corpo (+ sicurezza in percentuale, solo nelle stime create prima)
  const altroImpl = p => tot(p.implementazione) - p.base_moduli;
  function righeTotali(p) {
    const r = (lab, v, cls = "", sub = "") => `<tr class="${cls}"><td>${lab}${sub ? `<div class="st-sub">${sub}</div>` : ""}</td><td class="r">${F.gg(v)}</td></tr>`;
    const b = p.blocchi;
    return [
      r("Analisi", b.Analisi.tot), r("Disegno", b.Disegno.tot),
      r("Implementazione", b.Implementazione.tot, "", `moduli ${F.gg(p.base_moduli)} + attività ${F.gg(altroImpl(p))}`),
      b.Architettura.tot ? r("Architettura", b.Architettura.tot) : "",
      r("Training", b.Training.tot), r("Test", b.Test.tot), r("Deploy", b.Deploy.tot),
      r("Totale attività", p.TP.tot, "tot"), r("PM", p.PM), r("Contingency", p.contingency.tot),
      r("Totale con PM e contingency", p.totale, "tot big"),
    ].join("");
  }
  function obiettivoHtml(p, compatto) {
    const o = p.obiettivo;
    if (!o || o.prezzo == null || p.prezzo == null) return compatto ? "" : `<p class="muted">Nessun prezzo obiettivo: puoi indicarlo nelle impostazioni.</p>`;
    const diff = p.prezzo - o.prezzo, perc = o.prezzo ? diff / o.prezzo : null, rapp = o.prezzo ? Math.min(p.prezzo / o.prezzo, 1.5) : 0;
    const sopra = diff > 0.005, testo = Math.abs(diff) < 0.005 ? "In linea con l'obiettivo" : `${sopra ? "Sopra" : "Sotto"} l'obiettivo di ${F.eur0(Math.abs(diff))} (${sopra ? "+" : "−"}${nf(1).format(Math.abs(perc) * 100)}%)`;
    return `<div class="st-obj ${sopra ? "sopra" : "sotto"}"><div class="st-obj-r"><span>Prezzo obiettivo</span><b>${F.eur0(o.prezzo)}</b></div>
      <div class="st-barra" role="img" aria-label="${E(testo)}"><i style="width:${(rapp / 1.5) * 100}%"></i><s style="left:${100 / 1.5}%"></s></div>
      <div class="st-obj-t">${testo}</div>
      ${compatto ? "" : `<div class="st-obj-r ${o.sotto_margine ? "rosso" : ""}"><span>Margine se vendi al prezzo obiettivo</span><b>${F.pct(o.margine)}</b></div>`}</div>`;
  }
  // a destra: i totali, sempre visibili e semplificati (fino al prezzo)
  function disegnaRiepilogo() {
    const el = ST.root && qs("#st-riep", ST.root), res = ST.res; if (!el || !res) return;
    const p = res.progetto;
    el.innerHTML = `${messaggiHtml({...res, messaggi: res.messaggi.filter(x => x.livello === "errore")}, true)}<div class="card st-riep"><div class="st-rh"><h3>Totali</h3><span class="st-sp"></span><span class="muted">giornate</span></div>
      <table class="st-riep-t"><tbody>${righeTotali(p)}</tbody></table>
      <div class="st-eco"><div><span>Costo</span><b>${F.eur0(p.costi.tot)}</b></div><div class="prezzo"><span>Prezzo</span><b>${F.eur0(p.prezzo)}</b></div></div>
      ${obiettivoHtml(p, true)}</div>`;
  }
  // 6. riepilogo: progetto, indicatori, AM, rispetto all'obiettivo
  function riepilogoCompleto() {
    const res = ST.res, p = res.progetto, am = res.am, f = p.fte;
    const sez = (titolo, corpo) => `<div class="card st-sez"><div class="st-rh"><h3>${titolo}</h3></div>${corpo}</div>`;
    const amHtml = !am ? `<p class="muted">Nessuna AM in questa stima.</p>` : am.calcolabile === false ? `<p class="hint warn">AM non calcolabile: il build equivalente è zero.</p>`
      : `<div class="st-eco"><div><span>${am.modalita === "driver" ? `Da driver · ${am.anni_n} ${am.anni_n === 1 ? "anno" : "anni"}` : "Manuale"}</span><b>${F.gg(am.gg)} gg</b></div>
        ${am.modalita === "driver" ? am.anni.map(a => `<div><span>Anno ${a.anno}</span><b>${F.gg(a.gg.tot)} gg · ${F.eur0(a.prezzo)}</b></div>`).join("") : `<div><span>Media mensile</span><b>${F.eur(am.mensile)}</b></div>`}
        <div><span>Costo</span><b>${F.eur(am.costo)}</b></div><div class="prezzo"><span>Prezzo AM</span><b>${F.eur(am.prezzo)}</b></div></div>`;
    return messaggiHtml(res, false) + `<div class="st-riep-grid">
      ${sez("Progetto", `<table class="st-riep-t"><thead><tr><th>Blocco</th><th class="r">Giornate</th></tr></thead><tbody>${righeTotali(p)}</tbody></table>
        <div class="st-eco"><div><span>Costo</span><b>${F.eur(p.costi.tot)}</b></div><div><span>Margine</span><b>${F.pct(p.margine)}</b></div><div class="prezzo"><span>Prezzo progetto</span><b>${F.eur(p.prezzo)}</b></div></div>`)}
      ${sez("Application Management", amHtml)}
      ${sez("Rispetto all'obiettivo", obiettivoHtml(p, false))}
      ${sez("Indicatori", `<div class="st-eco">
          <div><span>Durata del progetto</span><b>${p.durata_mesi ? nf(1).format(p.durata_mesi) + " mesi" : "non indicata"}</b></div>
          <div><span>FTE medi</span><b>${f ? `${F.fte(f.tot)} (di cui PM ${F.fte(f.PM)})` : "inserisci la durata"}</b></div>
          <div><span>Costo medio al giorno</span><b>${F.eur(p.costo_medio)}</b></div><div><span>Prezzo medio al giorno</span><b>${F.eur(p.prezzo_medio)}</b></div></div>`)}</div>`;
  }

  // ================================================================ CATALOGO
  function disegnaCatalogo(m) {
    if (!ST.catEdit) ST.catEdit = copia(ST.cat);
    const k = ST.catEdit, modif = !uguali(JSON.stringify(k), JSON.stringify(ST.cat));
    m.innerHTML = `<div class="st-wrap">${schede()}
      <div class="card"><div class="st-rh"><h3>Catalogo dei parametri di default</h3><span class="st-sp"></span>${modif ? `<span class="st-badge warn">Modifiche non salvate</span><button id="cat-annulla">Annulla</button>` : ""}<button class="primary" id="cat-salva" ${modif ? "" : "disabled"}>Salva catalogo</button></div>
        <p class="hint" style="margin-top:0">Le modifiche valgono per le stime create dopo: quelle esistenti conservano la loro copia dei parametri (si riallineano dall'editor). Moduli e tipi oggetto non si eliminano: si disattivano; i codici non si cambiano dopo la creazione.</p>
        ${ST.catErr ? `<div class="err">${E(ST.catErr)}</div>` : ""}
        ${tabelleCatalogo(k)}</div></div>`;
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
      k.moduli.push({codice, nome, blocco: "Implementazione", attivo: true, _nuovo: true}); ridisegna();
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
  // stesso ordine dell'editor: figure e parametri generali, fasi, moduli e tipi oggetto, AM
  function tabelleCatalogo(k) {
    const C = (p, opz = {}) => `<td class="r">${campo("c:" + p, pget(k, p), opz)}</td>`;
    const att = (sez, x) => `<label class="st-chk"><input type="checkbox" data-att="${sez}|${E(x.codice)}" ${x.attivo !== false ? "checked" : ""}> attivo</label>`;
    const errRip = x => x.pct_be != null && Math.abs((+x.pct_be || 0) + (+x.pct_fe || 0) - 1) > 1e-9;
    return `
      <h3 class="st-h3">Figure e costi giornalieri</h3><table class="st-righe st-par"><tbody>
        ${k.team.map(t => `<tr><td><b>${E(t.nome)}</b> <span class="muted">${t.codice}</span></td>${C(`team|${t.codice}|costo|`)}<td class="muted">€/gg</td></tr>`).join("")}</tbody></table>
      <h3 class="st-h3">Parametri generali</h3><table class="st-righe st-par"><tbody>
        <tr><td>Margine del progetto (%)</td>${C("generali||margine_progetto|", {pct: true, max1: true})}</tr>
        <tr><td>Giornate lavorative al mese</td>${C("generali||gg_mese|")}</tr>
        <tr><td>Arrotondamento (gg)</td>${C("generali||passo|")}</tr>
        <tr><td>Training predefinito BE / FE (gg)</td><td class="r">${campo("c:generali||training_be|", k.generali.training_be, {cls: "st-n3"})}${campo("c:generali||training_fe|", k.generali.training_fe, {cls: "st-n3"})}</td></tr></tbody></table>
      <h3 class="st-h3">Attività a corpo predefinite in una nuova stima</h3><table class="st-righe st-par"><thead><tr><th>Attività</th><th class="r">gg BE</th><th class="r">gg FE</th><th></th></tr></thead><tbody>
        ${(k.generali.voci_corpo || []).map((v, i) => `<tr><td><input data-vcn="${i}" value="${E(v.nome)}"></td><td class="r">${campo(`cv:${i}:gg_be`, v.gg_be, {cls: "st-n2"})}</td><td class="r">${campo(`cv:${i}:gg_fe`, v.gg_fe, {cls: "st-n2"})}</td><td><button class="st-ib" data-vcdel="${i}">${icona("trash-2")}</button></td></tr>`).join("")}
        </tbody></table><div class="st-add"><button id="cv-add">${icona("plus")}Aggiungi</button></div>
      <h3 class="st-h3">Fasi, PM e contingency</h3><table class="st-righe st-par"><thead><tr><th>Fase</th><th>Calcolata su</th><th class="r">%</th><th class="r">% BE / FE</th><th class="r">min / max %</th></tr></thead><tbody>
        ${k.fasi.map(f => `<tr><td><b>${E(f.nome)}</b></td><td class="muted">${E(BASI[f.base] || f.base)}</td>${C(`fasi|${f.codice}|pct|`, {pct: true, cls: "st-n3"})}
          <td class="r ${errRip(f) ? "st-errc" : ""}">${f.pct_be == null ? `<span class="muted">${f.codice === "PM" ? "figura PM" : "per team"}</span>` : campo(`c:fasi|${f.codice}|pct_be|`, f.pct_be, {pct: true, cls: "st-n3"}) + campo(`c:fasi|${f.codice}|pct_fe|`, f.pct_fe, {pct: true, cls: "st-n3"})}</td>
          <td class="r">${campo(`c:fasi|${f.codice}|min|`, f.min, {pct: true, cls: "st-n3"})}${campo(`c:fasi|${f.codice}|max|`, f.max, {pct: true, cls: "st-n3"})}</td></tr>`).join("")}</tbody></table>
      <h3 class="st-h3">Moduli e tipi oggetto</h3><div class="st-scroll"><table class="st-righe st-par st-tipi"><thead><tr><th>Tipo oggetto</th><th>Unità</th><th class="r">Mix S / M / D %</th><th class="r">gg unitari S / M / D</th><th class="r">% BE / FE</th><th></th></tr></thead><tbody>
        ${k.moduli.map(m => `<tr class="st-modrow ${m.attivo === false ? "spento" : ""}"><td colspan="5"><input data-txt="moduli|${E(m.codice)}|nome|" value="${E(m.nome)}" class="st-modnome"> <span class="muted">${E(m.codice)}</span></td><td>${att("moduli", m)}</td></tr>`
          + k.tipi.filter(t => t.modulo === m.codice).map(t => {
            const c = t.codice, q = t.modalita === "quantita", errMix = q && Math.abs((t.mix || []).reduce((a, b) => a + (+b || 0), 0) - 1) > 1e-9;
            return `<tr class="${t.attivo === false || m.attivo === false ? "spento" : ""}"><td><input data-txt="tipi|${E(c)}|nome|" value="${E(t.nome)}"><div class="muted">${E(c)}</div></td>
              <td><input data-txt="tipi|${E(c)}|unita|" value="${E(t.unita || "")}" class="st-unita"></td>
              ${q ? `<td class="r ${errMix ? "st-errc" : ""}" ${errMix ? 'title="Il mix deve fare 100%"' : ""}>${[0, 1, 2].map(j => campo(`c:tipi|${c}|mix|${j}`, t.mix[j], {pct: true, cls: "st-n3"})).join("")}</td>
                <td class="r">${[0, 1, 2].map(j => campo(`c:tipi|${c}|gg|${j}`, t.gg[j], {cls: "st-n3"})).join("")}</td>
                <td class="r ${errRip(t) ? "st-errc" : ""}">${campo(`c:tipi|${c}|pct_be|`, t.pct_be, {pct: true, cls: "st-n3"})}${campo(`c:tipi|${c}|pct_fe|`, t.pct_fe, {pct: true, cls: "st-n3"})}</td>`
                : `<td class="r muted">a corpo</td><td class="r">default BE ${campo(`c:tipi|${c}|corpo_be|`, t.corpo_be, {cls: "st-n3"})} FE ${campo(`c:tipi|${c}|corpo_fe|`, t.corpo_fe, {cls: "st-n3"})}</td><td></td>`}
              <td>${att("tipi", t)}</td></tr>`;
          }).join("")).join("")}</tbody></table></div>
      <div class="st-add"><button id="cat-addmod">${icona("plus")}Aggiungi modulo</button>
        <select id="cat-tmod">${k.moduli.map(m => `<option value="${E(m.codice)}">${E(m.nome)}</option>`).join("")}</select>
        <select id="cat-tmodo"><option value="quantita">a quantità</option><option value="corpo">a corpo</option></select><button id="cat-addtipo">${icona("plus")}Aggiungi tipo oggetto</button></div>
      <h3 class="st-h3">Parametri AM</h3><table class="st-righe st-par"><tbody>
        <tr><td>Margine dell'AM (%)</td>${C("generali||margine_am|", {pct: true, max1: true})}</tr>
        <tr><td>% correttiva annua sul build equivalente</td>${C("am||pct_correttiva|", {pct: true})}</tr>
        ${["H8", "H12", "H24"].map(x => `<tr><td>Coefficiente di servizio ${x}</td>${C(`am||coeff|${x}`)}</tr>`).join("")}
        <tr><td>% presa in carico (solo anno 1)</td>${C("am||pct_presa|", {pct: true})}</tr>
        <tr><td>Decalage annuo dal secondo anno (composto)</td>${C("am||decalage|", {pct: true})}</tr>
        <tr><td>Numero massimo di anni</td>${C("am||anni_max|")}</tr></tbody></table>`;
  }
  function segnaModifiche(m) {
    const b = qs("#cat-salva", m); if (b) b.disabled = false;
    const h = qs(".st-rh", m); if (h && !qs(".st-badge.warn", h)) h.querySelector(".st-sp").insertAdjacentHTML("afterend", `<span class="st-badge warn">Modifiche non salvate</span>`);
  }

  // ================================================================ ingresso
  const R = {
    render(m) {
      ST.root = m;
      m.innerHTML = `<p class="muted pad">Caricamento…</p>`;
      ST.pronto = (async () => {
        try { if (!ST.cat) await caricaCatalogo(); ST.gare = await caricaGare(); }
        catch (e) { m.innerHTML = `<div class="card"><div class="err">${E(e.message)}</div></div>`; return; }
        if (S.view !== "stime") return;
        if (ST.vista === "editor" && ST.s && !ST.sporco) { await apri(ST.s.id); return; }      // al rientro: dati freschi, a meno di modifiche in corso
        disegna();
      })();
      return ST.pronto;
    },
    // azioni chiamate da fuori (finestra della gara) dopo che la vista è pronta
    dopo(azione) { return Promise.resolve(ST.pronto).then(() => azione(R)); },
    async nuovaPerGara(g) {
      if (ST.vista === "editor" && ST.sporco && !confirm("Ci sono modifiche non salvate alla stima aperta. Continuare senza salvarle?")) return;
      ST.sporco = false;
      return nuova({gara: g, cliente: g.cliente, nome: `Stima ${g.ss}${g.oggetto ? " · " + String(g.oggetto).slice(0, 40) : ""}`});
    },
    apri: id => vai("editor", id),
  };
  window.Stime = R;
})();
