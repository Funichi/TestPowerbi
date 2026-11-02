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
  // 1 Impostazioni · 2 Moduli · 3 Fasi e attività · 4 AM · 5 Riepilogo, più "Parametri avanzati". Dal passo 2 le impostazioni
  // stanno a destra con i totali a scomparsa. Le giornate si mostrano totali: BE e FE restano separati nel calcolo (e negli input
  // che li richiedono: attività a corpo, training, AM manuale, ripartizioni nei parametri avanzati).
  const PASSI = [["impostazioni", "Impostazioni"], ["moduli", "Moduli"], ["fasi", "Fasi e attività"], ["am", "AM"], ["riepilogo", "Riepilogo"]];
  async function apri(id, passo) {
    try {
      const precedente = ST.s && ST.s.id, r = await api(`/api/stime/${id}`);
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; ST.vista = "editor";
      ST.passo = passo || (precedente === id && ST.passo ? ST.passo : "moduli");          // una stima esistente si apre sui moduli
      assicuraRighe(ST.s);
      disegna();
    } catch (e) { toast(e.message, true); ST.vista = "elenco"; disegna(); }
  }
  const tipo = (snap, c) => snap.tipi.find(t => t.codice === c);
  const nomeModulo = (snap, c) => { const m = snap.moduli.find(x => x.codice === c); return m ? m.nome : c; };
  const vuota = r => (r.quantita == null || +r.quantita === 0) && !r.etichetta && !r.mix && r.gg_be == null && r.gg_fe == null;

  // tutti i moduli e i tipi oggetto attivi già pronti: una riga vuota per ogni tipo che non ne ha (le righe vuote non si salvano)
  function assicuraRighe(s) {
    const snap = s.snapshot, usati = new Set(s.righe.filter(r => (r.contesto || "progetto") === "progetto").map(r => r.tipo));
    snap.moduli.filter(m => m.attivo !== false).forEach(m => snap.tipi.filter(t => t.modulo === m.codice && t.attivo !== false && !usati.has(t.codice)).forEach(t =>
      s.righe.push(rigaNuova(t, "progetto"))));
  }
  const rigaNuova = (t, contesto) => ({contesto, tipo: t.codice, etichetta: "", quantita: null, mix: null,
    gg_be: t.modalita === "corpo" ? null : null, gg_fe: null});
  const daSalvare = s => ({...s, righe: s.righe.filter(r => !vuota(r))});

  function disegnaEditor(m) {
    const s = ST.s, passo = ST.passo;
    m.innerHTML = `<div class="st-wrap st-ed">${schede()}
      <div class="card st-testa"><div class="st-testa-r"><input id="st-nome" class="st-nome" value="${E(s.nome)}" aria-label="Nome della stima">
          <span class="st-ver">v${s.versione}${s.corrente ? ` <span class="st-badge ok">corrente</span>` : ` <button class="linkbtn" id="st-corr">Rendi corrente</button>`}</span>
          <span class="st-sp"></span><span class="st-stato" id="st-stato"></span>
          <button id="st-indietro">${icona("arrow-left")}Elenco</button><button class="primary" id="st-salva">Salva</button>
          <button class="st-more" id="st-more" aria-label="Altre azioni">${icona("ellipsis")}</button>
          <div class="st-menu" id="st-menu" hidden><button data-m="versione">Nuova versione</button><button data-m="clona">Clona…</button>
            <button data-m="esporta">Esporta Excel</button><hr><button data-m="elimina" class="danger">Elimina…</button></div></div>
        <div class="st-passi">${PASSI.map(([k, l], i) => `<button class="st-passo ${passo === k ? "on" : ""} ${PASSI.findIndex(x => x[0] === passo) > i ? "fatto" : ""}" data-passo="${k}"><span>${i + 1}</span>${l}</button>`).join(`<i class="st-freccia"></i>`)}
          <span class="st-sp"></span><button class="linkbtn ${passo === "parametri" ? "on" : ""}" data-passo="parametri">${icona("sliders-horizontal")}Parametri avanzati</button></div></div>
      ${passo === "impostazioni" ? `<div class="card st-imp-full"><div class="st-rh"><h3>Impostazioni della stima</h3></div>${impostazioniHtml(s, false)}${navHtml()}</div>`
        : `<div class="st-corpo"><div class="st-sx"><div id="st-passoc"></div>${navHtml()}</div><aside class="st-dx"><div class="card st-imp-dx">${impostazioniHtml(s, true)}</div><div id="st-riep"></div></aside></div>`}</div>`;
    bindSchede(m);
    qs("#st-indietro", m).onclick = () => vai("elenco");
    qs("#st-salva", m).onclick = salva;
    qs("#st-nome", m).oninput = e => { s.nome = e.target.value; modificato(false); };
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
      if (b.dataset.m === "esporta") esporta(s.id);
    });
    qsa("[data-passo]", m).forEach(b => b.onclick = () => vaiPasso(b.dataset.passo));
    bindImpostazioni(qs(passo === "impostazioni" ? ".st-imp-full" : ".st-imp-dx", m));
    if (passo !== "impostazioni") disegnaPasso();
    disegnaRiepilogo(); stato();
  }
  function navHtml() {
    const i = PASSI.findIndex(x => x[0] === ST.passo);
    if (i < 0) return `<div class="st-nav"><button data-passo="moduli">${icona("arrow-left")}Torna al percorso</button></div>`;
    return `<div class="st-nav">${i > 0 ? `<button data-passo="${PASSI[i - 1][0]}">${icona("arrow-left")}${PASSI[i - 1][1]}</button>` : ""}<span class="st-sp"></span>
      ${i < PASSI.length - 1 ? `<button class="primary" data-passo="${PASSI[i + 1][0]}">${PASSI[i + 1][1]}${icona("arrow-right")}</button>` : ""}</div>`;
  }
  function vaiPasso(p) {
    if (p === ST.passo) return;
    const prima = ST.passo; ST.passo = p;
    if (prima === "impostazioni" || p === "impostazioni") { disegnaEditor(ST.root); }
    else {
      qsa(".st-passo, [data-passo='parametri']", ST.root).forEach(b => b.classList.toggle("on", b.dataset.passo === p));
      const i = PASSI.findIndex(x => x[0] === p);
      qsa(".st-passo", ST.root).forEach((b, k) => b.classList.toggle("fatto", k < i));
      qs(".st-sx .st-nav", ST.root).outerHTML = navHtml();
      qsa(".st-sx .st-nav [data-passo]", ST.root).forEach(b => b.onclick = () => vaiPasso(b.dataset.passo));
      disegnaPasso(); disegnaRiepilogo();
    }
    window.scrollTo({top: 0, behavior: "smooth"});
  }
  function stato() {
    const el = qs("#st-stato", ST.root); if (!el) return;
    el.innerHTML = ST.sporco ? `<span class="st-badge warn">Modifiche non salvate</span>` : `<span class="muted">Salvata ${E((ST.s.modificata_il || "").replace("T", " ").slice(0, 16))}</span>`;
    const b = qs("#st-salva", ST.root); if (b) b.disabled = !ST.sporco;
  }
  function modificato(strutturale) {
    ST.sporco = true; stato();
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
      ST.s = r.stima; ST.res = r.risultati; ST.sporco = false; assicuraRighe(ST.s); toast("Stima salvata"); disegna();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  async function salvaSeServe() { return !ST.sporco || await salva(); }
  window.addEventListener("beforeunload", e => { if (ST.vista === "editor" && ST.sporco) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------------------------------------------------------- campo numerico generico
  // data-k: "s:campo" (stima), "p:sez|cod|campo|idx" (snapshot), "r:i:campo[:idx]" (riga), "v:i:campo" (attività a corpo), "a:percorso" (AM)
  function campo(k, valore, opz = {}) {
    const pct = opz.pct, v = pct ? inPct(valore) : inNum(valore);
    return `<input class="st-n ${opz.cls || ""}" data-k="${E(k)}" data-f="${pct ? "pct" : "num"}" ${opz.max1 ? "data-max1" : ""}
      value="${E(v)}" inputmode="decimal" placeholder="${E(opz.ph == null ? "" : opz.ph)}" ${opz.title ? `title="${E(opz.title)}"` : ""} autocomplete="off">`;
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
    qsa("input.st-n[data-k]", root).forEach(el => el.oninput = () => { const r = leggiCampo(el); if (r.ok) applica(el.dataset.k, r.v, el); });
  }
  function applicaCampo(k, v) {
    const s = ST.s, [t, ...r] = k.split(":");
    if (t === "s") s[r[0]] = v;
    else if (t === "p") pset(s.snapshot, r.join(":"), v);
    else if (t === "r") {
      const riga = s.righe[+r[0]], campo = r[1];
      if (campo === "mix") { if (!riga.mix) riga.mix = [...tipo(s.snapshot, riga.tipo).mix]; riga.mix[+r[2]] = v; marcaMix(+r[0]); }
      else riga[campo] = v;
    } else if (t === "v") s.voci_corpo[+r[0]][r[1]] = v;
    else if (t === "a") { const [modo, ...p] = r[0].split("."); s.am[modo] = s.am[modo] || {}; let o = s.am[modo]; p.slice(0, -1).forEach(x => o = o[x] = o[x] || {}); o[p[p.length - 1]] = v; }
    if (t === "p") segnaDiff(ST.root);
    modificato(false);
  }
  const diffDot = p => ST.cat && !uguali(pget(ST.s.snapshot, p), pget(ST.cat, p)) ? ` <span class="st-diff-i" title="Default corrente: ${E(fmtDef(p))}"></span><button class="st-ib st-rip" data-rip="${E(p)}" title="Ripristina il default">${icona("undo-2")}</button>` : "";
  function fmtDef(p) { const v = pget(ST.cat, p); return v == null ? "vuoto" : Array.isArray(v) ? v.map(x => /mix|pct/.test(p) ? inPct(x) + "%" : inNum(x)).join(" / ") : typeof v === "number" ? (/pct|margine|decalage|correttiva|presa|\|min\||\|max\|/.test(p) ? inPct(v) + "%" : inNum(v)) : String(v); }
  function segnaDiff(root) {                                    // pallini "diverso dal default" aggiornati senza ridisegnare
    qsa("[data-k^='p:']", root).forEach(el => {
      const p = el.dataset.k.slice(2), base = /\|(mix|gg)\|\d+$/.test(p) ? p.replace(/\d+$/, "") : p;
      const box = el.closest("td, .st-cv"); if (!box) return;
      const diff = !uguali(pget(ST.s.snapshot, base), pget(ST.cat, base)), dot = box.querySelector(".st-diff-i");
      if (diff && !dot) box.insertAdjacentHTML("beforeend", ` <span class="st-diff-i" title="Diverso dal default corrente: si salva con la stima"></span>`);
      if (!diff && dot && !box.querySelector(".st-rip")) dot.remove();
    });
  }
  function bindComuni(box) {
    bindCampi(box, applicaCampo);
    qsa("[data-rip]", box).forEach(b => b.onclick = () => { pset(ST.s.snapshot, b.dataset.rip, copia(pget(ST.cat, b.dataset.rip))); ST.sporco = true; disegnaEditor(ST.root); clearTimeout(ST.timer); ST.timer = setTimeout(ricalcola, 50); });
  }

  // ---------------------------------------------------------------- 1. impostazioni (passo iniziale, poi a destra)
  function impostazioniHtml(s, compatto) {
    const g = s.gara, gEsiste = !g || ST.gare.some(x => x.chiave === g.chiave), snap = s.snapshot;
    const P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p)}</div></div>`;
    const S_ = (lab, k, suf) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("s:" + k, s[k])}<span class="muted">${suf}</span></div></div>`;
    return `${compatto ? `<div class="st-rh"><h3>Impostazioni</h3></div>` : ""}<div class="${compatto ? "st-campi1" : "st-campi"}">
      <div class="st-campo ${compatto ? "" : "st-l2"}"><label for="st-cli">Cliente</label><input id="st-cli" list="st-cli-dl" value="${E(s.cliente)}" autocomplete="off">
        <datalist id="st-cli-dl">${[...new Set(ST.gare.map(x => x.cliente).filter(Boolean))].sort().map(c => `<option value="${E(c)}">`).join("")}</datalist></div>
      <div class="st-campo ${compatto ? "" : "st-l2"}"><label for="st-gara">Gara collegata</label>${campoGara("st-gara", g && gEsiste ? ST.gare.find(x => x.chiave === g.chiave) : null)}
        ${g && !gEsiste ? `<div class="hint warn">Gara ${E(g.ss)} · ${g.anno} (${E(g.cliente || "")}) non trovata tra le gare attuali: il collegamento resta.</div>` : ""}</div>
      ${S_("Durata del progetto", "durata_mesi", "mesi")}${S_("Prezzo obiettivo (facoltativo)", "prezzo_obiettivo", "€")}
      ${P("Margine del progetto", "generali||margine_progetto|", {pct: true, max1: true, suf: "%"})}
      ${snap.team.map(t => P(`Costo ${E(t.nome)}`, `team|${t.codice}|costo|`, {suf: "€/gg"})).join("")}
      ${P("Giornate lavorative al mese", "generali||gg_mese|")}${P("Arrotondamento", "generali||passo|", {suf: "gg"})}
      <div class="st-campo ${compatto ? "" : "st-l4"}"><label for="st-note">Note</label><input id="st-note" value="${E(s.note)}"></div></div>`;
  }
  function bindImpostazioni(box) {
    if (!box) return;
    const s = ST.s;
    bindComuni(box);
    qs("#st-cli", box).oninput = e => { s.cliente = e.target.value; modificato(false); };
    qs("#st-note", box).oninput = e => { s.note = e.target.value; modificato(false); };
    qs("#st-gara", box).onchange = e => {
      const v = garaDaCampo(e.target.value);
      if (v === undefined) { e.target.classList.add("bad"); toast("Scegli una gara dall'elenco dei suggerimenti, o lascia il campo vuoto", true); return; }
      e.target.classList.remove("bad");
      s.gara = v ? {ss: v.ss, data_ins: v.data_ins, anno: v.anno, cliente: v.cliente, oggetto: v.oggetto, chiave: v.chiave} : null;
      if (v && !s.cliente) { s.cliente = v.cliente; qs("#st-cli", box).value = v.cliente; }
      modificato(false);
    };
  }

  // ---------------------------------------------------------------- passi 2-5 e parametri avanzati
  function disegnaPasso() {
    const box = qs("#st-passoc", ST.root); if (!box) return;
    const s = ST.s, p = ST.passo;
    box.innerHTML = p === "moduli" ? passoModuli(s) : p === "fasi" ? passoFasi(s) : p === "am" ? passoAm(s) : p === "riepilogo" ? `<div class="card" data-blocco="riep-full"></div>` : passoParametri(s);
    bindComuni(box);
    qsa("[data-et]", box).forEach(el => el.oninput = () => { s.righe[+el.dataset.et].etichetta = el.value; modificato(false); });
    qsa("[data-vn]", box).forEach(el => el.oninput = () => { s.voci_corpo[+el.dataset.vn].nome = el.value; modificato(false); });
    qsa("[data-rip-mix]", box).forEach(b => b.onclick = () => { s.righe[+b.dataset.ripMix].mix = null; modificato(true); });
    qsa("[data-riga]", box).forEach(b => b.onclick = () => azioneRiga(b.dataset.riga, +b.dataset.i));
    qsa("[data-voce]", box).forEach(b => b.onclick = () => { if (b.dataset.voce === "del") s.voci_corpo.splice(+b.dataset.i, 1); else s.voci_corpo.push({nome: "Nuova attività", gg_be: 0, gg_fe: 0}); modificato(true); });
    qsa("[data-ammodo]", box).forEach(b => b.onclick = () => { s.am.modalita = b.dataset.ammodo || null; if (s.am.modalita === "manuale" && !s.am.manuale) s.am.manuale = {BE: {gg_mese: 0, mesi: 12}, FE: {gg_mese: 0, mesi: 12}};
      if (s.am.modalita === "driver" && !s.am.driver) s.am.driver = {fonte: "progetto", servizio: "H8", anni: 3, evolutiva: 0, presa: null};
      if (s.am.modalita === "driver" && s.am.driver.fonte === "esercizio") assicuraRigheEsercizio(s); modificato(true); });
    qsa("[data-amsel]", box).forEach(el => el.onchange = () => { const d = s.am.driver; d[el.dataset.amsel] = el.dataset.amsel === "anni" ? +el.value : el.value; if (el.dataset.amsel === "fonte") { d.presa = null; if (el.value === "esercizio") assicuraRigheEsercizio(s); } modificato(true); });
    const presa = qs("#st-presa", box); if (presa) presa.onchange = () => { s.am.driver.presa = presa.checked; modificato(false); };
    const ri = qs("#st-riall", box); if (ri) ri.onclick = riallinea;
    aggiornaCalcolati();
  }
  function assicuraRigheEsercizio(s) {
    if (s.righe.some(r => r.contesto === "am_esercizio")) return;
    s.snapshot.moduli.filter(m => m.attivo !== false).forEach(m => s.snapshot.tipi.filter(t => t.modulo === m.codice && t.attivo !== false && t.modalita === "quantita")
      .forEach(t => s.righe.push(rigaNuova(t, "am_esercizio"))));
  }
  function azioneRiga(az, i) {
    const r = ST.s.righe, x = r[i];
    if (az === "add") r.splice(i + 1, 0, rigaNuova(tipo(ST.s.snapshot, x.tipo) || {codice: x.tipo}, x.contesto || "progetto"));
    else {
      const altre = r.filter((y, j) => j !== i && y.tipo === x.tipo && (y.contesto || "progetto") === (x.contesto || "progetto")).length;
      if (!vuota(x) && !confirm(`Eliminare la riga “${x.etichetta || (tipo(ST.s.snapshot, x.tipo) || {}).nome || x.tipo}”?`)) return;
      if (altre) r.splice(i, 1); else Object.assign(x, {etichetta: "", quantita: null, mix: null, gg_be: null, gg_fe: null});   // l'ultima riga di un tipo resta, vuota
    }
    modificato(true);
  }

  // 2. moduli: tutti visibili, ogni tipo oggetto con le sue righe; "+" aggiunge un'altra riga dello stesso tipo
  function tabellaRighe(s, contesto) {
    const snap = s.snapshot, righe = s.righe.map((r, i) => ({r, i})).filter(x => (x.r.contesto || "progetto") === contesto);
    const moduli = snap.moduli.filter(m => righe.some(x => (tipo(snap, x.r.tipo) || {}).modulo === m.codice));
    const orfane = righe.filter(x => !tipo(snap, x.r.tipo));
    return `<div class="st-scroll"><table class="st-righe st-moduli"><thead><tr><th>Tipo oggetto</th><th>Etichetta</th><th class="r">Quantità</th><th class="r" title="Mix di complessità Semplice / Medio / Difficile">Mix S / M / D %</th><th class="r">Giornate</th><th></th></tr></thead><tbody>
      ${moduli.map(m => `<tr class="st-modrow"><td colspan="4">${E(m.nome)}</td><td class="r" data-out="mod:${E(m.codice)}:${contesto}"></td><td></td></tr>`
        + snap.tipi.filter(t => t.modulo === m.codice).map(t => righe.filter(x => x.r.tipo === t.codice).map(({r, i}, k) => rigaHtml(snap, t, r, i, k)).join("")).join("")).join("")}
      </tbody></table></div>` + (orfane.length ? `<div class="hint warn">Righe con un tipo oggetto non presente nei parametri: ${orfane.map(x => E(x.r.tipo)).join(", ")}</div>` : "");
  }
  function rigaHtml(snap, t, r, i, k) {
    const corpo = t.modalita === "corpo", mixMod = !!r.mix;
    const mix = corpo ? `<span class="st-corpo-in">BE ${campo(`r:${i}:gg_be`, r.gg_be, {cls: "st-n3", ph: inNum(t.corpo_be)})} FE ${campo(`r:${i}:gg_fe`, r.gg_fe, {cls: "st-n3", ph: inNum(t.corpo_fe)})}</span>`
      : `<span class="st-mix ${mixMod ? "mod" : ""}" data-mix="${i}">${[0, 1, 2].map(j => campo(`r:${i}:mix:${j}`, mixMod ? r.mix[j] : null, {pct: true, ph: inPct(t.mix[j]), cls: "st-n3"})).join("")}${mixMod ? ripMixHtml(t, i) : ""}</span>`;
    return `<tr data-i="${i}" data-t="${E(t.codice)}" class="${k ? "st-agg" : ""} ${t.attivo === false ? "spento" : ""}"><td>${k ? `<span class="muted">↳</span>` : `<b>${E(t.nome)}</b>${t.unita && t.unita !== "a corpo" ? `<div class="muted st-unita-t">${E(t.unita)}</div>` : ""}${t.attivo === false ? `<div class="muted">disattivato</div>` : ""}`}</td>
      <td><input class="st-et" data-et="${i}" value="${E(r.etichetta)}" placeholder="${k ? "Etichetta" : "Etichetta (es. SAP ECC)"}"></td>
      <td class="r">${corpo ? `<span class="muted">a corpo</span>` : campo(`r:${i}:quantita`, r.quantita, {cls: "st-n2", ph: "0"})}</td><td class="r">${mix}</td>
      <td class="r b" data-out="riga:${i}"></td>
      <td class="st-azioni"><button class="st-ib" data-riga="add" data-i="${i}" title="Aggiungi un'altra riga di ${E(t.nome)}">${icona("plus")}</button><button class="st-ib" data-riga="del" data-i="${i}" title="${k ? "Elimina la riga" : "Svuota la riga"}">${icona("trash-2")}</button></td></tr>`;
  }
  const ripMixHtml = (t, i) => `<button class="st-ib" data-rip-mix="${i}" title="Ripristina il mix di default (${t.mix.map(v => inPct(v)).join(" / ")})">${icona("undo-2")}</button>`;
  function marcaMix(i) {                                    // mix modificato: evidenza e ripristino, senza ridisegnare (il cursore resta nel campo)
    const el = qs(`[data-mix="${i}"]`, ST.root); if (!el || el.classList.contains("mod")) return;
    el.classList.add("mod");
    el.insertAdjacentHTML("beforeend", ripMixHtml(tipo(ST.s.snapshot, ST.s.righe[i].tipo), i));
    qs("[data-rip-mix]", el).onclick = () => { ST.s.righe[i].mix = null; modificato(true); };
  }
  function passoModuli(s) {
    return `<div class="card"><div class="st-rh"><h3>Moduli</h3><span class="st-sp"></span><span class="muted" data-out="tot-moduli"></span></div>
      <p class="hint" style="margin-top:0">Scrivi le quantità dei tipi oggetto che servono: le righe vuote non contano e non si salvano. Con ${icona("plus")} aggiungi un'altra riga dello stesso tipo (per esempio una per sorgente). Il mix S/M/D in grigio è quello di default: se lo cambi resta evidenziato e si ripristina con ${icona("undo-2")}.</p>
      ${tabellaRighe(s, "progetto")}</div>`;
  }

  // 3. fasi e attività
  const BASI = {Moduli_team: "implementazione dei moduli", B: "implementazione (B)", BaseModuli: "somma dei moduli", TP: "totale progetto", TP_team: "totale progetto"};
  function passoFasi(s) {
    const snap = s.snapshot;
    return `<div class="card"><div class="st-rh"><h3>Fasi</h3></div>
      <table class="st-righe st-fasi"><thead><tr><th>Fase</th><th>Calcolata su</th><th class="r">%</th><th class="r">Giornate</th></tr></thead><tbody>
      ${snap.fasi.map(f => `<tr><td><b>${E(f.nome)}</b></td><td class="muted">${E(BASI[f.base] || f.base)}</td><td class="r"><span class="st-cv st-cvr">${campo(`p:fasi|${f.codice}|pct|`, f.pct, {pct: true, cls: "st-n3"})}${diffDot(`fasi|${f.codice}|pct|`)}</span></td><td class="r b" data-out="fase:${f.codice}"></td></tr>`).join("")}
      </tbody></table><p class="hint">Analisi e disegno sono una percentuale unica sull'implementazione di tutti i moduli. Le ripartizioni BE/FE delle fasi si trovano nei parametri avanzati.</p></div>
      <div class="card"><div class="st-rh"><h3>Attività a corpo</h3></div>
      <table class="st-righe"><thead><tr><th>Attività</th><th class="r">gg BE</th><th class="r">gg FE</th><th class="r">Giornate</th><th></th></tr></thead><tbody>
      ${s.voci_corpo.map((v, i) => `<tr><td><input data-vn="${i}" value="${E(v.nome)}"></td><td class="r">${campo(`v:${i}:gg_be`, v.gg_be, {cls: "st-n2"})}</td><td class="r">${campo(`v:${i}:gg_fe`, v.gg_fe, {cls: "st-n2"})}</td>
        <td class="r b" data-out="voce:${i}"></td><td class="st-azioni"><button class="st-ib" data-voce="del" data-i="${i}" title="Elimina">${icona("trash-2")}</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nessuna attività a corpo.</td></tr>`}</tbody></table>
      <div class="st-add"><button data-voce="add">${icona("plus")}Aggiungi attività</button><span class="hint">Es. architettura, setup ambienti, attività particolari.</span></div>
      <h3 class="st-h3">Training</h3><div class="st-due"><label>gg BE ${campo("s:training_be", s.training_be, {cls: "st-n2"})}</label><label>gg FE ${campo("s:training_fe", s.training_fe, {cls: "st-n2"})}</label><span class="muted" data-out="training"></span></div></div>`;
  }

  // 4. AM: tutto quello che riguarda l'AM, parametri compresi
  function passoAm(s) {
    const am = s.am || {modalita: null}, snap = s.snapshot, modo = am.modalita || "", A = snap.am, coeff = A.coeff || {};
    const P = (lab, p, opz = {}) => `<div class="st-campo"><label>${lab}</label><div class="st-cv">${campo("p:" + p, pget(snap, p), opz)}${opz.suf ? `<span class="muted">${opz.suf}</span>` : ""}${diffDot(p)}</div></div>`;
    let corpo = "";
    if (modo === "manuale") {
      const m = am.manuale || {};
      corpo = `<table class="st-righe"><thead><tr><th>Figura</th><th class="r">gg al mese</th><th class="r">Mesi</th><th class="r">Giornate</th></tr></thead><tbody>
        ${["BE", "FE"].map(t => `<tr><td><b>${E((snap.team.find(x => x.codice === t) || {}).nome || t)}</b></td><td class="r">${campo(`a:manuale.${t}.gg_mese`, (m[t] || {}).gg_mese, {cls: "st-n2"})}</td><td class="r">${campo(`a:manuale.${t}.mesi`, (m[t] || {}).mesi, {cls: "st-n2"})}</td>
          <td class="r b" data-out="am:${t}:gg"></td></tr>`).join("")}</tbody></table>`;
    } else if (modo === "driver") {
      const d = am.driver || {}, presa = d.presa == null ? d.fonte === "esercizio" : d.presa;
      corpo = `<div class="st-campi">
        <div class="st-campo st-l2"><label>Fonte del build equivalente</label><select data-amsel="fonte"><option value="progetto" ${d.fonte !== "esercizio" ? "selected" : ""}>Progetto (implementazione di questa stima)</option><option value="esercizio" ${d.fonte === "esercizio" ? "selected" : ""}>Oggetti in esercizio (sistema esistente)</option></select></div>
        <div class="st-campo"><label>Livello di servizio</label><select data-amsel="servizio">${["H8", "H12", "H24"].map(x => `<option value="${x}" ${d.servizio === x ? "selected" : ""}>${x} (× ${inNum(coeff[x])})</option>`).join("")}</select></div>
        <div class="st-campo"><label>Anni</label><select data-amsel="anni">${Array.from({length: A.anni_max || 5}, (_, k) => k + 1).map(k => `<option ${+d.anni === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="st-campo"><label>Evolutiva</label><div class="st-cv">${campo("a:driver.evolutiva", d.evolutiva)}<span class="muted">gg/anno</span></div></div>
        <div class="st-campo"><label>&nbsp;</label><label class="st-chk"><input type="checkbox" id="st-presa" ${presa ? "checked" : ""}> Presa in carico (solo anno 1)</label></div></div>
        ${d.fonte === "esercizio" ? `<h3 class="st-h3">Oggetti in esercizio</h3>${tabellaRighe(s, "am_esercizio")}` : ""}`;
    }
    return `<div class="card"><div class="st-rh"><h3>Application Management</h3></div>
      <div class="st-seg">${[["", "Nessuna"], ["manuale", "Manuale"], ["driver", "Da driver"]].map(([k, l]) => `<button data-ammodo="${k}" class="${modo === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${corpo}<div data-blocco="am-ris"></div></div>
      <div class="card"><div class="st-rh"><h3>Parametri AM</h3></div><div class="st-campi">
        ${P("Margine dell'AM", "generali||margine_am|", {pct: true, max1: true, suf: "%"})}
        ${P("Correttiva annua sul build equivalente", "am||pct_correttiva|", {pct: true, suf: "%"})}
        ${["H8", "H12", "H24"].map(x => P(`Coefficiente ${x}`, `am||coeff|${x}`)).join("")}
        ${P("Presa in carico (anno 1)", "am||pct_presa|", {pct: true, suf: "%"})}
        ${P("Decalage annuo dal secondo anno", "am||decalage|", {pct: true, suf: "%"})}
        ${P("Anni massimi", "am||anni_max|")}</div></div>`;
  }

  // parametri avanzati: prima le fasi (con le ripartizioni), poi moduli e tipi oggetto
  function passoParametri(s) {
    const snap = s.snapshot, usati = new Set(s.righe.filter(r => !vuota(r)).map(r => r.tipo));
    const tipi = snap.tipi.filter(t => t.attivo !== false || usati.has(t.codice));
    const rip = (sez, c, x) => x.pct_be == null ? `<span class="muted">per team</span>` : `${campo(`p:${sez}|${c}|pct_be|`, x.pct_be, {pct: true, cls: "st-n3"})}${campo(`p:${sez}|${c}|pct_fe|`, x.pct_fe, {pct: true, cls: "st-n3"})}${diffDot(`${sez}|${c}|pct_be|`) || diffDot(`${sez}|${c}|pct_fe|`)}`;
    const errRip = x => x.pct_be != null && Math.abs((+x.pct_be || 0) + (+x.pct_fe || 0) - 1) > 1e-9;
    return `<div class="card"><div class="st-rh"><h3>Parametri avanzati della stima</h3><span class="st-sp"></span><button id="st-riall">${icona("refresh-cw")}Riallinea ai default correnti</button></div>
      <p class="hint" style="margin-top:0">Copia dei parametri congelata in questa stima. Il pallino <span class="st-diff-i"></span> segna i valori diversi dal catalogo corrente; ${icona("undo-2")} li riporta al default. Costi e margini sono nelle impostazioni, i parametri AM nel passo AM.</p>
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
      const el = modal(`<h2>Riallinea ai default correnti</h2><p class="muted">Questi valori della stima verranno sostituiti con quelli del catalogo. I tipi oggetto disattivati ancora usati dalle righe restano con i parametri attuali.</p>
        <div class="st-scroll" style="max-height:50vh"><table class="st-righe"><thead><tr><th>Sezione</th><th>Voce</th><th>Campo</th><th class="r">Stima</th><th class="r">Catalogo</th></tr></thead><tbody>
        ${r.differenze.map(d => `<tr><td>${nomeSez[d.sezione] || d.sezione}</td><td>${E(d.codice || "")}</td><td>${E(d.campo || "")}</td><td class="r">${val(d.stima)}</td><td class="r">${val(d.default)}</td></tr>`).join("")}</tbody></table></div>
        <div class="foot"><button id="ra-x">Annulla</button><button class="primary" id="ra-ok">Riallinea</button></div>`);
      qs("#ra-x", el).onclick = closeModal;
      qs("#ra-ok", el).onclick = async () => { try { await api(`/api/stime/${ST.s.id}/riallinea`, {method: "POST", body: {conferma: true}}); closeModal(); toast("Parametri riallineati"); apri(ST.s.id); } catch (e) { toast(e.message, true); } };
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- valori calcolati (solo totali: BE e FE restano nel calcolo)
  const tot = x => x == null ? null : (x.tot != null ? x.tot : (x.BE || 0) + (x.FE || 0));
  function aggiornaCalcolati() {
    const res = ST.res, root = ST.root; if (!res || !root) return;
    const p = res.progetto, out = {}, s = ST.s;
    p.righe.forEach(r => { out[`riga:${r.indice}`] = F.gg(r.tot); });
    p.moduli.forEach(m => { out[`mod:${m.codice}:progetto`] = F.gg(tot(m.impl)); });
    out["tot-moduli"] = `Implementazione dei moduli: ${F.gg(p.base_moduli)} gg`;
    Object.values(p.fasi).forEach(f => { out[`fase:${f.codice}`] = F.gg(tot(f)); });
    out["fase:SEC"] = F.gg(tot(p.sicurezza)); out["fase:PM"] = F.gg(p.PM); out["fase:CONT"] = F.gg(p.contingency.tot);
    p.voci_corpo.forEach((v, i) => { out[`voce:${i}`] = F.gg(tot(v)); });
    out.training = `${F.gg(tot(p.training))} gg in totale`;
    const am = res.am;
    if (am && am.modalita === "driver") {
      (am.righe || []).forEach(r => { out[`riga:${r.indice}`] = F.gg(r.tot); });
      const perMod = {}; (am.righe || []).forEach(r => { perMod[r.modulo] = (perMod[r.modulo] || 0) + r.tot; });
      Object.entries(perMod).forEach(([k, v]) => { out[`mod:${k}:am_esercizio`] = F.gg(v); });
    }
    if (am && am.modalita === "manuale") ["BE", "FE"].forEach(t => { out[`am:${t}:gg`] = F.gg(am.team[t].gg); });
    qsa("[data-out]", root).forEach(el => { el.textContent = out[el.dataset.out] ?? ""; });
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
  function messaggiHtml(res) {
    const msg = res.messaggi.filter((x, i, a) => a.findIndex(y => y.testo === x.testo) === i), ord = {errore: 0, avviso: 1, info: 2};
    msg.sort((a, b) => ord[a.livello] - ord[b.livello]);
    return msg.length ? `<div class="st-msg">${msg.map(x => `<div class="st-m ${x.livello}">${E(x.testo)}</div>`).join("")}${res.export_bloccato ? `<div class="st-m errore b">Ci sono errori: l'export Excel è bloccato finché non li correggi (il salvataggio è sempre possibile).</div>` : ""}</div>` : "";
  }
  function tabellaBlocchi(p) {
    return `<table class="st-riep-t"><thead><tr><th>Blocco</th><th class="r">Giornate</th><th class="r">Peso</th></tr></thead><tbody>
      ${BLOCCHI.filter(k => p.blocchi[k] && (k !== "Architettura" || p.blocchi[k].tot)).map(k => `<tr><td>${k}</td><td class="r">${F.gg(p.blocchi[k].tot)}</td><td class="r muted">${F.pct(p.blocchi[k].peso)}</td></tr>`).join("")}
      <tr class="tot"><td>Totale progetto</td><td class="r">${F.gg(p.TP.tot)}</td><td class="r">${p.TP.tot ? "100,00%" : "n/d"}</td></tr>
      <tr><td>PM</td><td class="r">${F.gg(p.PM)}</td><td class="r muted">${F.pct(p.peso_pm)}</td></tr>
      <tr><td>Contingency</td><td class="r">${F.gg(p.contingency.tot)}</td><td class="r muted">${F.pct(p.peso_contingency)}</td></tr>
      <tr class="tot big"><td>Totale complessivo</td><td class="r">${F.gg(p.totale)}</td><td></td></tr></tbody></table>`;
  }
  function economiaHtml(p, am) {
    const o = p.obiettivo, f = p.fte;
    return `<div class="st-eco"><div><span>Costo</span><b>${F.eur(p.costi.tot)}</b></div><div><span>Margine</span><b>${F.pct(p.margine)}</b></div>
      <div class="prezzo"><span>Prezzo</span><b>${F.eur(p.prezzo)}</b></div>
      <div><span>Costo / prezzo medio al giorno</span><b>${F.eur(p.costo_medio)} · ${F.eur(p.prezzo_medio)}</b></div>
      ${o ? `<div><span>Prezzo obiettivo</span><b>${F.eur(o.prezzo)}</b></div><div class="${o.sotto_margine ? "rosso" : ""}"><span>Margine risultante</span><b>${F.pct(o.margine)}</b></div><div><span>Scostamento dal prezzo</span><b>${F.eur(o.scostamento)}</b></div>` : ""}
      <div><span>FTE${p.durata_mesi ? ` su ${nf(1).format(p.durata_mesi)} mesi` : ""}</span><b>${f ? `${F.fte(f.tot)} (di cui PM ${F.fte(f.PM)})` : "inserisci la durata"}</b></div>
      ${am ? `<div class="am"><span>AM ${am.modalita === "driver" ? `da driver, ${am.anni_n} ${am.anni_n === 1 ? "anno" : "anni"}` : "manuale"}</span><b>${am.calcolabile === false ? "non calcolabile" : `${F.gg(am.gg)} gg · ${F.eur0(am.prezzo)}`}</b></div>` : ""}</div>`;
  }
  // a destra: totali a scomparsa (chiusi di default: solo giornate e prezzo)
  function disegnaRiepilogo() {
    const el = ST.root && qs("#st-riep", ST.root), res = ST.res; if (!el || !res) return;
    const p = res.progetto, aperto = ST.totaliAperti;
    el.innerHTML = `${messaggiHtml(res)}<details class="card st-riep" ${aperto ? "open" : ""}><summary><span>Totali</span><span class="st-sp"></span><b>${F.gg(p.totale)} gg</b><b class="st-prz">${F.eur0(p.prezzo)}</b></summary>
      ${tabellaBlocchi(p)}${economiaHtml(p, res.am)}</details>`;
    qs("details", el).ontoggle = e => { ST.totaliAperti = e.target.open; };
  }
  function riepilogoCompleto() {
    const res = ST.res, p = res.progetto, am = res.am;
    return `<div class="st-rh"><h3>Riepilogo</h3></div>${messaggiHtml(res)}<div class="st-riep-full"><div>${tabellaBlocchi(p)}</div><div>${economiaHtml(p, am)}</div></div>
      ${am ? `<h3 class="st-h3">Application Management</h3>${amRisultatiHtml(am)}` : ""}`;
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
