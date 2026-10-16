"use strict";
const STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID", "Closed"];
const BCLASS = {"WIP": "WIP", "Waiting For response": "Waiting", "Sospeso": "Sospeso", "Won": "Won", "Lost": "Lost", "NoBID": "NoBID", "Closed": "Closed"};
const COLOR = {"WIP": "var(--st-wip)", "Waiting For response": "var(--st-waiting)", "Sospeso": "var(--st-sospeso)", "Won": "var(--st-won)", "Lost": "var(--st-lost)", "NoBID": "var(--st-nobid)", "Closed": "var(--st-closed)", "Altro": "var(--st-altro)"};
const STATO_COL = {"WIP": "s-WIP", "Waiting For response": "s-Waiting", "Won": "s-Won", "Lost": "s-Lost", "NoBID": "s-NoBID", "Sospeso": "s-Sospeso", "Closed": "s-Closed", "Altro": "s-Altro"};
const S = {data: null, dash: null, view: "dash", months: "12", trendSeries: "inserite", trendCum: true, pipeBy: "vertical", attScope: "wip",
  filt: {q: "", stato: "", vertical: "", market: "", solution: "", anno: ""}, sort: {k: "Data ins.", dir: -1}, clean: null, state: null};
const EMPTY_FILT = () => ({q: "", stato: "", vertical: "", market: "", tipo: "", solution: "", anno: "", loc: "", att: "", rows: null, rowsLabel: ""});

// icone Lucide (definite in icons.js)
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll("i[data-ico]").forEach(i => i.outerHTML = ico(i.dataset.ico)); }
const TITLES = {
  dash: ["Cruscotto", "Scadenze, attenzioni e andamento delle offerte"],
  table: ["Tabella", "Tutte le offerte: filtra, ordina, clicca una riga per modificarla"],
  wip: ["Consegne WIP", "Scadenze delle offerte in corso e preparazione della riunione"],
  clean: ["Pulizia dati", "Uniforma gli stati e correggi i dati nel file Excel"],
};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = iso => iso ? iso.split("-").reverse().join("/") : "";
const normStato = s => { const m = {"closed": "Closed", "no bid": "NoBID", "no-bid": "NoBID", "nobid": "NoBID", "waiting": "Waiting For response"}; const k = (s || "").trim().toLowerCase(); return STATI.find(x => x.toLowerCase() === k) || m[k] || s; };
const badge = s => s ? `<span class="badge b-${BCLASS[normStato(s)] || "x"}">${esc(s)}</span>` : "";
const splitSol = v => (v || "").split(/\s*[\/,+&;]\s*/).map(x => x.trim()).filter(Boolean);
const nil = () => `<span class="nil">—</span>`;
const orNil = v => (v === null || v === undefined || v === "") ? nil() : esc(v);
const num = n => Number(n).toLocaleString("it-IT");
const TIPO_SHORT = {"Offerta diretta": "Offerta", "Incontro Cliente": "Incontro", "Incontro Interno": "Interno", "Gara sotto AQ": "Gara AQ", "Gara": "Gara", "RFI": "RFI", "Manif. Interesse": "Manif."};
const tipoChip = t => t ? `<span class="tchip" title="${esc(t)}">${esc(TIPO_SHORT[t] || t)}</span>` : nil();
const NOIND = "(non indicato)";
const OWNERS = ["Base", "Scamuzzo", "Grando", "Melloncelli"];      // suggerimenti per Solution D&A (gli altri nomi si scrivono a mano)
const endOfMonthIso = iso => { const d = isoDate(iso) || new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`; };
// livello di attenzione = colore del nome cliente nell'Excel (giallo / arancione / rosso)
const ATT = {1: {label: "Rilevante", color: "giallo"}, 2: {label: "Da attenzionare", color: "arancione"}, 3: {label: "Urgente", color: "rosso"}};
const attOpts = (cur, short) => `<option value="0" ${!cur ? "selected" : ""}>${short ? "—" : "Nessuna"}</option>` + [1, 2, 3].map(k => `<option value="${k}" ${+cur === k ? "selected" : ""}>${ATT[k].label}${short ? "" : ` (${ATT[k].color})`}</option>`).join("");
const attDot = r => r.Attenzione ? `<span class="adot a${r.Attenzione}" title="${ATT[r.Attenzione].label} (${ATT[r.Attenzione].color})"></span>` : "";
const TIPI_MAIN = ["Gara", "Gara sotto AQ", "Offerta diretta", "Incontro Cliente", "RFI"];

// chip dei filtri attivi, rimovibili
function chipsHtml(items) {
  return `<div class="chips">${items.map(c => `<span class="chip">${esc(c.label)}<button data-chip="${esc(c.id)}" aria-label="Rimuovi filtro ${esc(c.label)}">${ico("x")}</button></span>`).join("")}${items.length ? `<button class="linkbtn" data-chip="__all">Azzera filtri</button>` : ""}</div>`;
}
function bindChips(root, onRemove, onAll) { root.querySelectorAll("[data-chip]").forEach(b => b.onclick = () => b.dataset.chip === "__all" ? onAll() : onRemove(b.dataset.chip)); }
const optionsHtml = (arr, cur, all = "Tutti") => `<option value="">${all}</option>` + arr.map(x => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");

function toast(msg, bad) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 7000 : 3000);
}
async function api(url, opts = {}) {
  const o = {headers: {"Content-Type": "application/json"}, ...opts};
  if (o.body && typeof o.body !== "string") o.body = JSON.stringify(o.body);
  const r = await fetch(url, o);
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.body = j; throw e; }
  return j;
}
async function withBusy(fn, msg = "Un momento…") {
  $("#busy-t").textContent = msg; $("#busy").hidden = false;
  try { return await fn(); } finally { $("#busy").hidden = true; }
}

// ------------------------------------------------------------ caricamento
async function loadAll(force) {
  S.state = await api("/api/state");
  if (!S.state.exists) { openSettings(true); return; }
  try {
    S.data = await api("/api/data" + (force ? "?force=1" : ""));
    S.dash = await api("/api/dashboard?months=" + S.months);
    S.state = await api("/api/state");                  // dopo il primo import automatico: data e righe da esportare aggiornate
  } catch (e) { toast(e.message, true); openSettings(true, e.message); return; }
  const name = S.state.path.split(/[\\/]/).pop(), hh = (S.state.imported_at || "").slice(11, 16);
  $("#status").innerHTML = `${esc(name)}<br>${S.data.rows.length} righe · importato alle ${esc(hh)}`;
  $("#file-box").title = `${name}\n${S.data.rows.length} righe · importato alle ${hh}`;
  updateExportBtn();
  $("#file-dot").classList.add("ok");
  render();
}
function updateExportBtn() {
  const p = S.state.pending || {new: 0, mod: 0}, n = p.new + p.mod, b = $("#exp-n");
  b.hidden = !n; b.textContent = n; $("#btn-export").classList.toggle("has", n > 0);
  $("#btn-export").title = n ? `${p.new} righe nuove e ${p.mod} modificate da scrivere nell'Excel` : "Niente da esportare: nessuna modifica locale";
}
async function importNow() {
  const p = S.state.pending || {new: 0, mod: 0}, n = p.new + p.mod;
  if (n && !confirm(`Ci sono ${n} modifiche non ancora esportate (${p.new} nuove, ${p.mod} modificate).\nAggiornando dall'Excel verranno ELIMINATE (ne viene fatta una copia di sicurezza del database).\n\nContinuare?`)) return;
  try { await withBusy(() => api("/api/import", {method: "POST", body: {force: true}}), "Rileggo il file Excel…"); await loadAll(true); toast("Database aggiornato dall'Excel"); }
  catch (e) { toast(e.message, true); }
}
async function exportFlow() {
  let p; try { p = await api("/api/pending"); } catch (e) { toast(e.message, true); return; }
  if (!p.nuove.length && !p.modificate.length) { toast("Non c'è niente da esportare"); return; }
  const el = modal(`<h2>Esporta in Excel</h2>
    <p class="muted">Verrà scritto direttamente nel file Excel: le righe nuove dopo l'ultima riga, le modifiche sulle righe esistenti. Prima viene fatta una copia di backup. Alla fine il database viene riletto dal file.</p>
    ${p.nuove.length ? `<h3 class="mh">${p.nuove.length === 1 ? "1 riga nuova" : p.nuove.length + " righe nuove"}</h3><ul class="plist">${p.nuove.map(x => `<li><b>${esc(x.Cliente)}</b> — ${esc((x.Oggetto || "").slice(0, 80))} ${badge(x.Stato)}${x.Attenzione !== "nessuna" ? ` <span class="muted">· ${esc(x.Attenzione)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${p.modificate.length ? `<h3 class="mh">${p.modificate.length === 1 ? "1 riga modificata" : p.modificate.length + " righe modificate"}</h3><ul class="plist">${p.modificate.map(x => `<li><b>${esc(x.Cliente)}</b> — ${esc((x.Oggetto || "").slice(0, 60))} <span class="muted">(riga Excel ${x.xl})</span>${x.campi.map(c => `<div class="chg"><span>${esc(c.campo)}</span> ${esc(c.prima ?? "—")} → <b>${esc(c.dopo ?? "—")}</b></div>`).join("")}</li>`).join("")}</ul>` : ""}
    <div class="err" id="x-err"></div>
    <div class="foot"><button id="x-cancel">Annulla</button><button id="x-go" class="primary">${ico("upload")}Scrivi in HISTORY.xlsx</button></div>`);
  $("#x-cancel", el).onclick = closeModal;
  $("#x-go", el).onclick = async () => {
    try {
      const r = await withBusy(() => api("/api/export", {method: "POST"}), "Scrivo nell'Excel…");
      closeModal(); await loadAll(true);
      toast(r.avviso || `Esportate ${r.nuove} ${r.nuove === 1 ? "riga nuova" : "righe nuove"} e ${r.modificate} ${r.modificate === 1 ? "modifica" : "modifiche"}`, !!r.avviso);
    } catch (e) { $("#x-err", el).textContent = e.message; }
  };
}
async function reloadDash() { S.dash = await api("/api/dashboard?months=" + S.months); }
function rowByNum(n) { return S.data.rows.find(r => r._row === n); }

function render() {
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === S.view));
  $("#page-title").textContent = TITLES[S.view][0]; $("#page-sub").textContent = TITLES[S.view][1];
  const m = $("#main");
  ({dash: renderDash, table: renderTable, wip: renderWip, clean: renderClean})[S.view](m);
}

// ------------------------------------------------------------ cruscotto
const PERIODS = [["6", "Ultimi 6 mesi"], ["12", "Ultimi 12 mesi"], ["24", "Ultimi 24 mesi"], ["all", "Tutto lo storico"]];
const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const kpi = (n, label, extra = "", cls = "", attrs = "") => `<div class="card kpi ${cls}" ${attrs}><div class="n">${n}${extra}</div><div class="l">${label}</div></div>`;
function ytdDelta(cur, prev, anno) {
  if (!prev) return `<span class="d" title="nessun dato nello stesso periodo del ${anno}">n.d. vs ${anno}</span>`;
  const d = cur - prev; if (!d) return `<span class="d">= invariato vs ${anno}</span>`;
  return `<span class="d" title="${cur} contro ${prev} nello stesso periodo del ${anno}">${d > 0 ? "▲" : "▼"} ${Math.abs(Math.round(100 * d / prev))}% vs ${anno}</span>`;
}
function miniTable(items, cols) {
  if (!items.length) return `<div class="empty">Nessuna voce.</div>`;
  return `<div class="tscroll"><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${items.map(x => `<tr class="click" data-row="${x._row}">${cols.map(c => `<td>${c[1](x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const offer = x => `<div class="offer"><b>${esc(x.Cliente)}</b><span>${esc((x.Oggetto || "").slice(0, 90))}</span></div>`;
const legendItem = s => `<span><i style="background:${COLOR[s]}"></i>${s === "Altro" ? "Sospeso / NoBID / Closed" : s === "NoBID" ? "No Bid" : s === "Waiting For response" ? "Waiting" : s}</span>`;

function hbars(groups) {
  if (!groups.length) return `<div class="empty">Nessun dato.</div>`;
  const mx = Math.max(...groups.map(g => g.totale)), segs = ["WIP", "Waiting For response", "Won", "Lost", "Altro"];
  return `<div class="hb">${groups.map(g => `<div class="hn cl" title="${esc(g.nome)}" data-grp="${esc(g.nome)}">${esc(g.nome)}</div><div class="hbwrap"><div class="hbar" style="width:${(100 * g.totale / mx).toFixed(1)}%">${segs.map(s => g[s] ?
    `<i class="${STATO_COL[s]}" style="width:${(100 * g[s] / g.totale).toFixed(2)}%" data-grp="${esc(g.nome)}" data-st="${s}" title="${esc(g.nome)} · ${s === "Altro" ? "Sospeso / NoBID / Closed" : s}: ${g[s]}">${g[s] / mx >= .06 ? g[s] : ""}</i>` : "").join("")}</div><span class="ht-n">${g.totale}</span></div>`).join("")}</div>
    <div class="legend">${segs.map(legendItem).join("")}</div>`;
}
function vcolumns(groups) {
  if (!groups.length) return `<div class="empty">Nessun dato.</div>`;
  const segs = ["WIP", "Waiting For response", "Won", "Lost", "Altro"], W = 640, H = 300, L = 40, T = 30, B = 44, n = groups.length;
  const mx = Math.max(...groups.map(g => g.totale)), step0 = Math.max(1, Math.ceil(mx / 4)), nice = step0 * 4, plot = H - T - B;
  const y = v => T + plot * (1 - v / nice), stepX = (W - L - 12) / n, bw = Math.min(120, stepX * .6);
  let g = "";
  for (let k = 0; k <= 4; k++) g += `<line x1="${L}" x2="${W}" y1="${y(step0 * k)}" y2="${y(step0 * k)}" stroke="var(--chart-grid)"/><text x="${L - 8}" y="${y(step0 * k) + 4}" text-anchor="end">${step0 * k}</text>`;
  groups.forEach((gr, i) => {
    const x = L + i * stepX + (stepX - bw) / 2; let acc = 0;
    segs.forEach(s => { const v = gr[s]; if (!v) return; const y1 = y(acc + v), h = y(acc) - y1; acc += v;
      g += `<rect class="vseg" x="${x}" y="${y1}" width="${bw}" height="${Math.max(h - 1, 1)}" fill="${COLOR[s]}" rx="3" data-grp="${esc(gr.nome)}" data-st="${s}"><title>${esc(gr.nome)} · ${s === "Altro" ? "Sospeso / NoBID / Closed" : s}: ${v}</title></rect>`;
      if (h >= 17) g += `<text x="${x + bw / 2}" y="${y1 + h / 2 + 4}" text-anchor="middle" style="fill:var(--eng-dark);font-weight:600;pointer-events:none">${v}</text>`; });
    g += `<text x="${x + bw / 2}" y="${y(gr.totale) - 7}" text-anchor="middle" style="fill:var(--text);font-weight:700;font-size:13px">${gr.totale}</text>
      <text class="vname" x="${x + bw / 2}" y="${H - 16}" text-anchor="middle" data-grp="${esc(gr.nome)}" style="fill:var(--text);font-weight:600;font-size:13px">${esc(gr.nome)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Offerte per Vertical e stato">${g}</svg><div class="legend">${segs.map(legendItem).join("")}</div>`;
}
const ESITO_SEGS = ["Won", "Lost", "NoBID", "Waiting For response", "WIP", "Closed"];        // NoBID = Sospeso + NoBID
function esitoRows(list, minChiuse) {
  if (!list.length) return `<div class="empty">Nessuna offerta nel periodo.</div>`;
  const mx = Math.max(...list.map(g => g.totale));
  return `<div class="eb">${list.map(g => `<div class="hn cl" title="${esc(g.nome)}" data-tipo="${esc(g.nome)}">${esc(g.nome)}</div><div class="hbwrap"><div class="hbar" style="width:${(100 * g.totale / mx).toFixed(1)}%">${ESITO_SEGS.map(s => g[s] ?
    `<i class="${STATO_COL[s]}" style="width:${(100 * g[s] / g.totale).toFixed(2)}%" data-tipo="${esc(g.nome)}" data-st="${s}" title="${esc(g.nome)} · ${s}: ${g[s]}">${g[s] / mx >= .06 ? g[s] : ""}</i>` : "").join("")}</div><span class="ht-n">${g.totale}</span></div>
    <div class="erate">${g.rate === null ? `<b class="nil">—</b><span>pochi dati</span>` : `<b>${Math.round(g.rate * 100)}%</b><span>${g.Won} su ${g.chiuse} chiuse</span>`}</div>`).join("")}</div>
    <div class="legend">${ESITO_SEGS.map(legendItem).join("")}</div><div class="hint">Win rate = Won / (Won + Lost); mostrato solo con almeno ${minChiuse} offerte chiuse. Closed non rientra nel calcolo.</div>`;
}
function topClienti(list) {
  if (!list.length) return `<div class="empty">Nessuna opportunità nel periodo.</div>`;
  const mx = Math.max(...list.map(c => c.totale));
  return `<div class="top10">${list.map((c, i) => `<button type="button" class="trow" data-cl="${i}" title="Apri le ${c.totale} opportunità di ${esc(c.nome)}"><span class="rk">${i + 1}</span><span class="tn">${esc(c.nome)}</span>
    <span class="ttrack"><span class="tbar" style="width:${(100 * c.totale / mx).toFixed(1)}%"><i class="tw" style="width:${(100 * c.won / c.totale).toFixed(1)}%"></i></span></span>
    <span class="tv"><b>${c.totale}</b>${c.won ? `<em class="wonpill">${c.won} ${c.won === 1 ? "vinta" : "vinte"}</em>` : ""}</span></button>`).join("")}</div>
    <div class="legend"><span><i style="background:var(--st-won)"></i>Vinte</span><span><i style="background:var(--chart-3)"></i>Altre opportunità</span></div>`;
}
// torta delle attenzioni: giallo / arancione / rosso, sulle WIP o su tutte le offerte
function attCard(counts) {
  const sl = [["3", "Urgente", "rosso"], ["2", "Da attenzionare", "arancione"], ["1", "Rilevante", "giallo"]];
  const tot = sl.reduce((a, [k]) => a + (counts[k] || 0), 0), none = counts["0"] || 0, R = 70, C = 2 * Math.PI * R, gap = sl.filter(([k]) => counts[k]).length > 1 ? 3 : 0;
  let off = 0, arcs = "";
  sl.forEach(([k, n, c]) => { const v = counts[k] || 0; if (!v) return; const len = Math.max(C * v / tot - gap, 1);
    arcs += `<circle class="aslice" data-att="${k}" cx="100" cy="100" r="${R}" fill="none" stroke="var(--att-${k})" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"><title>${n} (${c}): ${v}</title></circle>`; off += C * v / tot; });
  return `<div class="donut"><svg viewBox="0 0 200 200" role="img" aria-label="Offerte per livello di attenzione"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--chart-grid)" stroke-width="22"/>${arcs}
    <text x="100" y="104" text-anchor="middle" style="font-size:32px;font-weight:600;fill:var(--text)">${tot}</text><text x="100" y="124" text-anchor="middle">con attenzione</text></svg>
    <div class="alegend">${sl.map(([k, n, c]) => `<button type="button" class="arow2" data-att="${k}" ${counts[k] ? "" : "disabled"}><i style="background:var(--att-${k})"></i><span>${n} <small>(${c})</small></span><b>${counts[k] || 0}</b></button>`).join("")}</div>
    <div class="hint">${none} ${S.attScope === "wip" ? "offerte WIP" : "offerte"} senza attenzione</div></div>`;
}
// WIP per tipo e per scadenza
const WT_SEGS = [["scadute", "Scadute", "s-late"], ["settimana", "Questa settimana", "s-week"], ["prossima", "Prossima settimana", "s-two"], ["oltre", "Oltre", "s-over"], ["senza_data", "Senza data", "s-nodate"]];
function wipTipoCard(list) {
  if (!list.length) return `<div class="empty">Nessuna offerta in corso.</div>`;
  const mx = Math.max(...list.map(g => g.totale));
  return `<div class="hb">${list.map(g => `<div class="hn cl" title="${esc(g.nome)}" data-wt="${esc(g.nome)}">${esc(g.nome)}</div><div class="hbwrap"><div class="hbar" style="width:${(100 * g.totale / mx).toFixed(1)}%">${WT_SEGS.map(([k, l, c]) => g[k] ?
    `<i class="${c}" style="width:${(100 * g[k] / g.totale).toFixed(2)}%" data-wt="${esc(g.nome)}" title="${esc(g.nome)} · ${l}: ${g[k]}">${g[k] / mx >= .08 ? g[k] : ""}</i>` : "").join("")}</div><span class="ht-n">${g.totale}</span></div>`).join("")}</div>
    <div class="legend">${WT_SEGS.map(([k, l, c]) => `<span><i class="lg-${c}"></i>${l}</span>`).join("")}</div>`;
}
// tipi reali (come nel filtro) che stanno dietro a un gruppo del grafico
function tipiOfGroup(nome) {
  if (nome !== "Altro") return [nome];
  return [...new Set(S.data.rows.filter(r => normStato(r.Stato) === "WIP" && !TIPI_MAIN.includes(r.tipo)).map(r => r.tipo || NOIND))];
}
function etaCard(e) {
  const mx = Math.max(1, ...e.fasce.map(f => f.n)), over = e.oltre180;
  const frase = e.totale === 0 ? "Nessuna offerta in attesa di risposta."
    : over ? `<b>${num(over)}</b> offerte attendono risposta da oltre 6 mesi: valutare il passaggio a Sospeso.` : "Nessuna offerta attende risposta da oltre 6 mesi.";
  return `<div class="age">${e.fasce.map(f => `<button class="arow ${f.n ? "" : "zero"}" data-age="${f.k}" ${f.n ? "" : "disabled"} title="Apri in Tabella le ${f.n} offerte"><span class="an">${f.label}</span><span class="atrack"><i class="age-${f.k.replace("+", "p")}" style="width:${(100 * f.n / mx).toFixed(1)}%"></i></span><span class="av">${num(f.n)}</span></button>`).join("")}</div>
    <p class="age-sum">${frase}${e.mancante ? ` ${num(e.mancante)} senza data.` : ""}</p>
    <div class="hint">Giorni da Data consegna (se manca, da Data ins.). Solo stato Waiting For response.</div>`;
}

function renderDash(m) {
  const d = S.dash, k = d.kpi, pl = d.pillole, so = d.soglie, t = d.trend;
  const chips = S.months !== "12" ? [{id: "period", label: PERIODS.find(x => x[0] === S.months)[1]}] : [];
  const pb = S.pipeBy === "market" ? d.pipeline_market : d.pipeline_vertical;
  const w12 = k.winrate12;
  $("#page-sub").textContent = `Oggi ${fmt(d.oggi)} · KPI e trend sull'anno solare ${k.anno}`;
  m.innerHTML = `
  <div class="fbar"><div><label for="period">Periodo</label><select id="period">${PERIODS.map(([v, l]) => `<option value="${v}" ${S.months === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="fbar-r">Il periodo vale per Pipeline, Esito per tipo e Top clienti</div></div>
  <div id="f-chips">${chipsHtml(chips)}</div>
  <div class="kpis">
    ${kpi(num(k.wip), "In corso (WIP)", "", "click", 'data-wipgo="all"')}
    ${kpi(num(k.waiting), "In attesa di risposta", "", "click", 'data-go="Waiting For response"')}
    ${kpi(num(k.inserite_ytd.cur), `Offerte inserite ${k.anno} (da inizio anno)`, ytdDelta(k.inserite_ytd.cur, k.inserite_ytd.prev, k.prec))}
    ${kpi(num(k.won_ytd.cur), `Won ${k.anno} (da inizio anno)`, ytdDelta(k.won_ytd.cur, k.won_ytd.prev, k.prec))}
    ${kpi(w12.rate === null ? "—" : Math.round(w12.rate * 100) + "%", `Win rate ultimi 12 mesi · ${w12.won} su ${w12.chiuse} chiuse`, "", "key")}
  </div>
  <div class="alerts">
    <button class="apill" data-wipgo="late"><i style="background:var(--urg-late)"></i><b>${pl.scadute}</b> consegne scadute</button>
    <button class="apill" data-wipgo="d7"><i style="background:var(--urg-week)"></i><b>${pl.imminenti}</b> entro ${so.scadenza} gg</button>
    <button class="apill" data-solleciti="1"><i style="background:var(--urg-two)"></i><b>${pl.solleciti.length}</b> da sollecitare</button>
    ${pl.attenzione.totale ? `<button class="apill" data-wipatt="1" title="Offerte WIP segnate in rosso, arancione o giallo nell'Excel"><i style="background:var(--att-3)"></i><b>${pl.attenzione.totale}</b> WIP in attenzione <span class="muted">(${pl.attenzione.rosse} urgenti)</span></button>` : ""}
    <button class="apill" data-scroll="sec-att"><i style="background:var(--accent)"></i><b>${pl.attenzioni}</b> punti di attenzione</button>
  </div>
  <div class="g12">
    <div class="card c12"><div class="card-h"><div><h2>Trend anno su anno</h2><div class="sub">${k.anno} contro ${k.prec}, per mese di Data ins.</div></div>
      <div class="row"><div class="seg"><button data-ts="inserite" class="${S.trendSeries === "inserite" ? "on" : ""}">Inserite</button><button data-ts="won" class="${S.trendSeries === "won" ? "on" : ""}">Won</button></div>
      <div class="seg"><button data-tc="0" class="${S.trendCum ? "" : "on"}">Mensile</button><button data-tc="1" class="${S.trendCum ? "on" : ""}">Cumulato</button></div></div></div>
      <div id="yoy" class="yoy"></div></div>
  </div>
  <div class="g12">
    <div class="card c4"><h2>Età delle offerte in attesa</h2><div class="sub">Quanto aspettiamo una risposta</div>${etaCard(d.eta_attesa)}</div>
    <div class="card c4"><div class="card-h"><div><h2>Offerte per attenzione</h2><div class="sub">Il colore del nome cliente nell'Excel</div></div>
      <div class="seg"><button data-as="wip" class="${S.attScope === "wip" ? "on" : ""}">In corso</button><button data-as="tutte" class="${S.attScope === "tutte" ? "on" : ""}">Tutte</button></div></div>
      ${attCard(d.attenzione_chart[S.attScope])}</div>
    <div class="card c4"><h2>WIP per tipo e scadenza</h2><div class="sub">Offerte in corso: scadute, questa settimana, prossima o oltre. Clicca per aprirle.</div>${wipTipoCard(d.wip_tipo)}</div>
  </div>
  <div class="g12">
    <div class="card c7"><div class="card-h"><div><h2>Pipeline per ${S.pipeBy === "market" ? "Market" : "Vertical"}</h2><div class="sub">Numero di offerte per stato. Clicca un colore per vedere l'elenco.</div></div>
      <div class="seg"><button data-pb="vertical" class="${S.pipeBy === "vertical" ? "on" : ""}">Vertical</button><button data-pb="market" class="${S.pipeBy === "market" ? "on" : ""}">Market</button></div></div>
      ${S.pipeBy === "market" ? hbars(pb) : vcolumns(pb)}</div>
    <div class="card c5"><h2>Esito per tipo</h2><div class="sub">Offerte per stato e win rate del tipo, nel periodo scelto.</div>${esitoRows(d.esito_tipo, so.min_chiuse)}</div>
  </div>
  <div class="card" id="sec-top"><h2>Top 10 clienti per numero di opportunità</h2><div class="sub">Nel periodo scelto. In verde le opportunità vinte. Clicca un cliente per vederle.</div>${topClienti(d.top_clienti)}</div>
  <div class="card" id="sec-att"><h2>Punti di attenzione</h2><div class="sub">Dati mancanti o anomali da sistemare.</div>
    ${d.attenzioni.length ? d.attenzioni.map(a => `<details><summary>${esc(a.titolo)} <span class="cnt">(${a.righe.length})</span></summary>${miniTable(a.righe, [["Seq", x => x.Seq], ["Offerta", offer], ["Stato", x => badge(x.Stato)], ["Data ins.", x => fmt(x["Data ins."])], ["", x => esc(x.dettaglio || "")]])}</details>`).join("") : `<div class="empty">Tutto in ordine.</div>`}</div>`;
  const setPeriod = async v => { S.months = v; await reloadDash(); render(); };
  $("#period").onchange = e => setPeriod(e.target.value);
  bindChips(m, () => setPeriod("12"), () => setPeriod("12"));
  m.querySelectorAll("tr[data-row]").forEach(tr => tr.onclick = () => openForm(rowByNum(+tr.dataset.row)));
  m.querySelectorAll(".kpi[data-go]").forEach(c => c.onclick = () => goTable({stato: c.dataset.go}));
  m.querySelectorAll("[data-wipgo]").forEach(c => c.onclick = () => goWip({band: c.dataset.wipgo === "all" ? "" : c.dataset.wipgo}));
  m.querySelectorAll("[data-solleciti]").forEach(c => c.onclick = () => goTable({rows: pl.solleciti, rowsLabel: `Da sollecitare (${pl.solleciti.length})`}));
  m.querySelectorAll("[data-scroll]").forEach(c => c.onclick = () => document.getElementById(c.dataset.scroll).scrollIntoView({behavior: "smooth"}));
  m.querySelectorAll(".hb [data-grp], .vseg, .vname").forEach(c => c.onclick = () => goTable({[S.pipeBy]: c.dataset.grp, stato: c.dataset.st && c.dataset.st !== "Altro" ? c.dataset.st : ""}));
  m.querySelectorAll(".eb [data-tipo]").forEach(c => c.onclick = () => goTable({tipo: c.dataset.tipo === "Altro" ? "__altro" : c.dataset.tipo, stato: c.dataset.st || ""}));
  m.querySelectorAll("[data-age]").forEach(c => c.onclick = () => { const f = d.eta_attesa.fasce.find(x => x.k === c.dataset.age); goTable({rows: f.rows, rowsLabel: `In attesa ${f.label} (${f.n})`}); });
  m.querySelectorAll("[data-cl]").forEach(b => b.onclick = () => { const c = d.top_clienti[+b.dataset.cl]; goTable({rows: c.rows, rowsLabel: `Cliente: ${c.nome} (${c.totale})`}); });
  m.querySelectorAll("[data-wipatt]").forEach(c => c.onclick = () => goWip({att: "any"}));
  m.querySelectorAll("[data-as]").forEach(b => b.onclick = () => { S.attScope = b.dataset.as; render(); });
  m.querySelectorAll(".aslice, .arow2").forEach(c => c.onclick = () => S.attScope === "wip" ? goWip({att: c.dataset.att}) : goTable({att: c.dataset.att}));
  m.querySelectorAll("[data-wt]").forEach(c => c.onclick = () => goWip({tipi: tipiOfGroup(c.dataset.wt)}));
  m.querySelectorAll("[data-pb]").forEach(b => b.onclick = () => { S.pipeBy = b.dataset.pb; render(); });
  m.querySelectorAll("[data-ts]").forEach(b => b.onclick = () => { S.trendSeries = b.dataset.ts; render(); });
  m.querySelectorAll("[data-tc]").forEach(b => b.onclick = () => { S.trendCum = b.dataset.tc === "1"; render(); });
  drawYoy($("#yoy"), t);
}

// grafico a linee anno corrente vs anno precedente (12 mesi)
function drawYoy(el, t) {
  const W = 1100, H = 310, L = 44, R = 120, T = 18, B = 32, N = 12, m = t.mese, ser = t[S.trendSeries];
  const cum = a => { let s = 0; return a.map(v => s += v); };
  const cur = (S.trendCum ? cum(ser.cur.slice(0, m)) : ser.cur.slice(0, m)), prev = S.trendCum ? cum(ser.prev) : ser.prev;
  const max = Math.max(1, ...cur, ...prev), step = Math.max(1, Math.ceil(max / 4)), nice = step * 4;
  const x = i => L + (W - L - R) * i / (N - 1), y = v => T + (H - T - B) * (1 - v / nice);
  const pts = a => a.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  let g = "";
  for (let k = 0; k <= 4; k++) g += `<line x1="${L}" x2="${W - R + 10}" y1="${y(step * k)}" y2="${y(step * k)}" stroke="var(--chart-grid)" stroke-width="1"/><text x="${L - 8}" y="${y(step * k) + 4}" text-anchor="end">${step * k}</text>`;
  MESI.forEach((nm, i) => g += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${nm}</text>`);
  g += `<polyline points="${pts(prev).join(" ")}" fill="none" stroke="var(--chart-2)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const full = cur.slice(0, m - 1), last = cur.length - 1;
  if (full.length > 1) g += `<polyline points="${pts(full).join(" ")}" fill="none" stroke="var(--chart-main)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (last >= 1) g += `<line x1="${x(last - 1)}" y1="${y(cur[last - 1])}" x2="${x(last)}" y2="${y(cur[last])}" stroke="var(--chart-main)" stroke-width="3.5" stroke-dasharray="2 6" stroke-linecap="round"/>`;
  cur.forEach((v, i) => g += i === last ? `<circle cx="${x(i)}" cy="${y(v)}" r="5.5" fill="var(--card)" stroke="var(--chart-main)" stroke-width="2.5"><title>mese in corso: dato parziale</title></circle>` : `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="var(--chart-main)"/>`);
  // etichette dirette a fine linea (anno e valore), spostate se si sovrappongono
  let yc = y(cur[last]), yp = y(prev[N - 1]), xc = x(last) + 12, xp = x(N - 1) + 12;
  if (last === N - 1 && Math.abs(yc - yp) < 16) { if (yc <= yp) yp = yc + 16; else yc = yp + 16; }
  g += `<text x="${xc}" y="${yc + 4}" style="fill:var(--accent);font-weight:700;font-size:13px">${t.anno}: ${num(cur[last])}</text><text x="${xp}" y="${yp + 4}" style="fill:var(--text-2);font-weight:600;font-size:13px">${t.prec}: ${num(prev[N - 1])}</text>`;
  const cw = (W - L - R) / (N - 1);
  for (let i = 0; i < N; i++) g += `<rect class="hit" data-i="${i}" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trend ${S.trendSeries} ${t.anno} contro ${t.prec}">${g}</svg><div class="tip" hidden></div>
    <div class="hint">${S.trendCum ? "Valori cumulati dall'inizio dell'anno." : "Valori del singolo mese."} Il mese in corso (${MESI[m - 1]}) è parziale: punto vuoto e tratteggio.</div>`;
  const tip = $(".tip", el), svg = $("svg", el);
  el.querySelectorAll(".hit").forEach(r => {
    r.onmouseenter = () => {
      const i = +r.dataset.i, a = i < m ? cur[i] : null, b = prev[i], diff = a === null ? "" : `<div>Differenza: <b>${a - b > 0 ? "+" : ""}${a - b}</b>${b ? ` (${a - b > 0 ? "+" : ""}${Math.round(100 * (a - b) / b)}%)` : ""}</div>`;
      tip.innerHTML = `<b>${MESI[i]}${i === m - 1 ? " (parziale)" : ""}</b><div>${t.anno}: <b>${a === null ? "—" : a}</b></div><div>${t.prec}: <b>${b}</b></div>${diff}`;
      tip.hidden = false;
      const k = svg.getBoundingClientRect().width / W; tip.style.left = Math.min(x(i) * k + 14, svg.getBoundingClientRect().width - 170) + "px"; tip.style.top = "16px";
    };
    r.onmouseleave = () => tip.hidden = true;
  });
}

// ------------------------------------------------------------ tabella
function goTable(f) { S.filt = {...EMPTY_FILT(), ...f, rows: f.rows ? new Set(f.rows) : null}; S.view = "table"; render(); }
const COLDEFS = [
  {k: "Seq", l: "Seq", on: true}, {k: "Cliente", l: "Cliente", on: true}, {k: "Oggetto", l: "Oggetto", on: true}, {k: "Market", l: "Market", on: true},
  {k: "Vertical", l: "Vertical", on: false}, {k: "tipo", l: "Tipo", on: true}, {k: "Data ins.", l: "Data ins.", on: true}, {k: "Data consegna", l: "Consegna", on: true},
  {k: "Solution D&A", l: "Solution D&A", on: true}, {k: "Stato", l: "Stato", on: true}, {k: "SS", l: "SS", on: true},
];
const COL_KEY = "gare.table.cols.v1";
const colsLoad = () => { try { const v = JSON.parse(localStorage.getItem(COL_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) {} return new Set(COLDEFS.filter(c => c.on).map(c => c.k)); };
const colsSave = () => { try { localStorage.setItem(COL_KEY, JSON.stringify([...S.cols])); } catch (e) {} };
S.cols = colsLoad();
const CELLS = {
  "Seq": r => `<td>${r.Seq === null || r.Seq === undefined ? nil() : esc(r.Seq)}</td>`,
  "Cliente": r => `<td class="cl">${attDot(r)}${orNil(r.Cliente)}${r._state === "new" ? ` <span class="lchip new">nuova</span>` : r._state === "mod" ? ` <span class="lchip mod">modificata</span>` : ""}</td>`,
  "Oggetto": r => `<td class="og" title="${esc(r.Oggetto)}">${orNil(r.Oggetto)}</td>`,
  "Market": r => `<td>${r.Market === NOIND ? `<span class="nil">${NOIND}</span>` : orNil(r.Market)}</td>`,
  "Vertical": r => `<td>${orNil(r.Vertical)}</td>`,
  "tipo": r => `<td>${tipoChip(r.tipo)}</td>`,
  "Data ins.": r => `<td>${r["Data ins."] ? fmt(r["Data ins."]) : nil()}</td>`,
  "Data consegna": r => `<td>${r["Data consegna"] ? fmt(r["Data consegna"]) : nil()}</td>`,
  "Solution D&A": r => `<td>${orNil(r["Solution D&A"])}</td>`,
  "Stato": r => `<td>${r.Stato ? badge(r.Stato) : nil()}</td>`,
  "SS": r => `<td>${orNil(r.SS)}</td>`,
};
function filteredRows() {
  const f = S.filt, q = f.q.toLowerCase();
  return S.data.rows.filter(r => {
    if (f.stato && (normStato(r.Stato) !== f.stato)) return false;
    if (f.vertical && r.Vertical !== f.vertical) return false;
    if (f.market && r.Market !== f.market) return false;
    if (f.rows && !f.rows.has(r._row)) return false;
    if (f.loc && r._state === "orig") return false;
    if (f.att && (f.att === "any" ? !r.Attenzione : String(r.Attenzione) !== f.att)) return false;
    if (f.tipo && (f.tipo === "__altro" ? TIPI_MAIN.includes(r.tipo) : r.tipo !== f.tipo)) return false;
    if (f.anno && (r["Data ins."] || "").slice(0, 4) !== f.anno) return false;
    if (f.solution) { const s = splitSol(r["Solution D&A"]).map(x => x.toLowerCase()); if (f.solution === "(non assegnata)" ? s.length : !s.includes(f.solution.toLowerCase())) return false; }
    if (q && ![r.Cliente, r.Oggetto, r.SS, r["Solution D&A"], r.Market, r.Note, r["Referenti vertical"]].some(v => (v || "").toLowerCase().includes(q))) return false;
    return true;
  });
}
function renderTable(m) {
  const d = S.data.domini, f = S.filt;
  const anni = [...new Set(S.data.rows.map(r => (r["Data ins."] || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const markets = [...new Set([...d.market, ...S.data.rows.map(r => r.Market).filter(x => x && x !== NOIND)])].sort((a, b) => a.localeCompare(b, "it"));
  m.innerHTML = `<div class="fbar">
    <div class="grow"><label for="f-q">Cerca</label><input id="f-q" value="${esc(f.q)}" placeholder="cliente, oggetto, codice SS, solution…"></div>
    <div><label for="f-stato">Stato</label><select id="f-stato">${optionsHtml(STATI, f.stato)}</select></div>
    <div><label for="f-market">Market</label><select id="f-market">${optionsHtml([NOIND, ...markets], f.market)}</select></div>
    <div><label for="f-tipo">Tipo</label><select id="f-tipo"><option value="">Tutti</option>${[...d.tipo, "__altro"].map(t => `<option value="${esc(t)}" ${f.tipo === t ? "selected" : ""}>${t === "__altro" ? "Altro" : esc(t)}</option>`).join("")}</select></div>
    <div><label for="f-vertical">Vertical</label><select id="f-vertical">${optionsHtml(d.vertical, f.vertical)}</select></div>
    <div><label for="f-solution">Solution</label><select id="f-solution">${optionsHtml(["(non assegnata)", ...d.solutions], f.solution)}</select></div>
    <div><label for="f-att">Attenzione</label><select id="f-att"><option value="">Tutte</option><option value="any" ${f.att === "any" ? "selected" : ""}>Con attenzione</option>${[3, 2, 1].map(k => `<option value="${k}" ${f.att === String(k) ? "selected" : ""}>${ATT[k].label}</option>`).join("")}</select></div>
    <div><label for="f-loc">Locale</label><select id="f-loc"><option value="">Tutte</option><option value="1" ${f.loc ? "selected" : ""}>Da esportare</option></select></div>
    <div><label for="f-anno">Anno (Data ins.)</label><select id="f-anno">${optionsHtml(anni, f.anno)}</select></div>
    <div class="fbar-r"><span id="f-count"></span>
      <details class="ms cols-menu"><summary style="min-width:0">${ico("columns-3")}Colonne</summary><div class="ms-list" style="right:0;left:auto;min-width:200px">${COLDEFS.map(c => `<label class="ms-i"><input type="checkbox" data-col="${esc(c.k)}" ${S.cols.has(c.k) ? "checked" : ""}> ${esc(c.l)}</label>`).join("")}</div></details></div></div>
  <div id="f-chips"></div>
  <div class="card tablecard"><table class="dt"><thead id="th"></thead><tbody id="tb"></tbody></table></div>`;
  const LABEL = {q: v => `Cerca: ${v}`, stato: v => `Stato: ${v}`, tipo: v => `Tipo: ${v === "__altro" ? "Altro" : v}`, rows: () => f.rowsLabel || "Selezione", market: v => `Market: ${v}`, vertical: v => `Vertical: ${v}`, solution: v => `Solution: ${v}`, anno: v => `Anno: ${v}`, loc: () => "Da esportare", att: v => `Attenzione: ${v === "any" ? "con attenzione" : ATT[v].label}`};
  const drawChips = () => {
    const box = $("#f-chips"); box.innerHTML = chipsHtml(Object.keys(LABEL).filter(k => f[k]).map(k => ({id: k, label: LABEL[k](f[k])})));
    bindChips(box, id => { S.filt[id] = ""; renderTable(m); }, () => { S.filt = EMPTY_FILT(); renderTable(m); });
  };
  const draw = () => {
    const cols = COLDEFS.filter(c => S.cols.has(c.k));
    $("#th").innerHTML = `<tr>${cols.map(c => `<th class="sort" data-k="${esc(c.k)}">${c.l}${S.sort.k === c.k ? (S.sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>`;
    const rows = filteredRows(), k = S.sort.k, dir = S.sort.dir;
    rows.sort((a, b) => { const x = a[k] ?? "", y = b[k] ?? ""; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "it", {numeric: true})) * dir; });
    $("#f-count").textContent = rows.length + " righe";
    $("#tb").innerHTML = rows.map(r => `<tr class="click" data-row="${r._row}">${cols.map(c => CELLS[c.k](r)).join("")}</tr>`).join("");
    $("#tb").querySelectorAll("tr").forEach(tr => tr.onclick = () => openForm(rowByNum(+tr.dataset.row)));
    $("#th").querySelectorAll("th").forEach(th => th.onclick = () => { S.sort = {k: th.dataset.k, dir: S.sort.k === th.dataset.k ? -S.sort.dir : 1}; draw(); });
    drawChips();
  };
  draw();
  const bind = (id, key) => $(id).oninput = e => { S.filt[key] = e.target.value; draw(); };
  bind("#f-q", "q"); bind("#f-att", "att"); bind("#f-loc", "loc"); bind("#f-stato", "stato"); bind("#f-tipo", "tipo"); bind("#f-market", "market"); bind("#f-vertical", "vertical"); bind("#f-solution", "solution"); bind("#f-anno", "anno");
  m.querySelectorAll("[data-col]").forEach(c => c.onchange = () => { c.checked ? S.cols.add(c.dataset.col) : S.cols.delete(c.dataset.col); colsSave(); draw(); });
}

// ------------------------------------------------------------ consegne WIP (una sola lista, modificabile sul posto)
// Le modifiche (data di consegna, stato) vanno nel database locale; nell'Excel solo con "Esporta in Excel".
const SEL_KEY = "gare.wip.sel.v1";
const selLoad = () => { try { return new Set(JSON.parse(localStorage.getItem(SEL_KEY) || "[]")); } catch (e) { return new Set(); } };
const selSave = set => { try { localStorage.setItem(SEL_KEY, JSON.stringify([...set])); } catch (e) {} };
// view: all | late | week | future | d7 (d7 arriva dal cruscotto) · touched/order: le righe modificate restano dove sono finché non si cambia vista
S.wip = {sol: new Set(), tipi: new Set(), atts: new Set(), view: "all", sel: selLoad(), touched: new Set(), order: null, redraw: null};
function resetWipView() { S.wip.touched = new Set(); S.wip.order = null; }
function goWip(f) { S.wip.sol = new Set(); S.wip.tipi = new Set(f.tipi || []); S.wip.atts = f.att === "any" ? new Set(["1", "2", "3"]) : f.att ? new Set([String(f.att)]) : new Set(); S.wip.view = f.band === "late" || f.band === "d7" ? f.band : "all"; resetWipView(); S.view = "wip"; render(); }
const isoDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtD = d => d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "";
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const NOASS = "(non assegnata)";

function wipContext() {
  const t = isoDate(S.dash && S.dash.oggi) || (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const wd = (t.getDay() + 6) % 7;                       // lunedì = 0
  return {today: t, monday: addDays(t, -wd), sunday: addDays(t, 6 - wd), weekEnd: 6 - wd};
}
// righe WIP (+ quelle modificate in questa vista, anche se non sono più WIP)
function wipItems() {
  const ctx = wipContext();
  return S.data.rows.filter(r => normStato(r.Stato) === "WIP" || S.wip.touched.has(r._row)).map(r => {
    const d = isoDate(r["Data consegna"]);
    const days = d ? Math.round((d - ctx.today) / 864e5) : null;
    const band = days === null ? "none" : days < 0 ? "late" : days <= ctx.weekEnd ? "week" : days <= ctx.weekEnd + 14 ? "two" : "over";
    return {r, id: r._row, wip: normStato(r.Stato) === "WIP", key: r.Seq !== null && r.Seq !== undefined ? String(r.Seq) : "n" + r._row, d, days, band, names: splitSol(r["Solution D&A"])};
  });
}
const byDate = (a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity) || String(a.r.Cliente).localeCompare(String(b.r.Cliente), "it");
const tipoGroup = t => TIPI_MAIN.includes(t) ? t : "Altro";
const passTipo = it => !S.wip.tipi.size || S.wip.tipi.has(it.r.tipo || NOIND);
const passAtt = it => !S.wip.atts.size || S.wip.atts.has(String(it.r.Attenzione || 0));
const ATT_OPTS = [["3", "Urgente (rosso)"], ["2", "Da attenzionare (arancione)"], ["1", "Rilevante (giallo)"], ["0", "Nessuna"]];
const passSol = it => !S.wip.sol.size || (it.names.length ? it.names.some(n => S.wip.sol.has(n.toLowerCase())) : S.wip.sol.has(NOASS.toLowerCase()));
const passView = (it, v = S.wip.view) => v === "all" || (v === "late" ? it.band === "late" : v === "week" ? it.band === "week" : v === "future" ? it.band === "two" || it.band === "over" : it.days !== null && it.days >= 0 && it.days <= 7);
const dayText = g => g === null ? "" : g < 0 ? `scaduta da ${-g} gg` : g === 0 ? "oggi" : `tra ${g} gg`;
const dayBadge = (g, band) => g === null ? "" : `<span class="tag d-${band}">${dayText(g)}</span>`;
const ownerOf = it => it.r["Solution D&A"] || "n.d.";

// testo per appunti e .txt: una riga per gara, solo "Cliente: Descrizione"
function wipText(items) { return items.map(i => `${i.r.Cliente || "n.d."}: ${i.r.Oggetto || "n.d."}`).join("\n") + "\n"; }
function downloadText(txt, ctx) {
  const t = ctx.today, name = `consegne-wip_${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}.txt`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + txt], {type: "text/plain;charset=utf-8"})); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast("Copiato negli appunti");
}
// toast con un'azione (es. "Annulla")
function toastAction(msg, label, fn) {
  const t = $("#toast"); t.className = "toast"; t.innerHTML = `${esc(msg)} <button class="toast-btn">${esc(label)}</button>`; t.hidden = false;
  $(".toast-btn", t).onclick = async () => { t.hidden = true; await fn(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 9000);
}
async function refreshAfterEdit() { S.data = await api("/api/data"); S.state = await api("/api/state"); updateExportBtn(); }
// salva una modifica fatta sulla riga senza spostarla; permette di annullare
async function wipEdit(row, changes, msg) {
  const prev = {}; Object.keys(changes).forEach(k => prev[k] = row[k] ?? null);
  const y = window.scrollY;
  try { await api("/api/rows/" + row._row, {method: "PUT", body: {changes}}); S.wip.touched.add(row._row); await refreshAfterEdit(); }
  catch (e) { toast(e.message, true); try { await refreshAfterEdit(); } catch (e2) {} }
  S.wip.redraw(); window.scrollTo(0, y);
  toastAction(`${msg} (da esportare)`, "Annulla", async () => {
    try { await api("/api/rows/" + row._row, {method: "PUT", body: {changes: prev}}); await refreshAfterEdit(); } catch (e) { toast(e.message, true); }
    S.wip.redraw(); window.scrollTo(0, y);
  });
}

function renderWip(m) {
  const ctx = wipContext(), W = S.wip;
  const first = wipItems().filter(i => i.wip);
  const tipiOpts = [...new Set(first.map(i => i.r.tipo || NOIND))].sort((a, b) => a.localeCompare(b, "it")).map(t => [t, t]);
  const names = new Map(); let hasNo = false;
  first.forEach(i => { if (!i.names.length) hasNo = true; i.names.forEach(n => names.has(n.toLowerCase()) || names.set(n.toLowerCase(), n)); });
  const solOpts = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "it")); if (hasNo) solOpts.push([NOASS.toLowerCase(), NOASS]);
  const solName = k => (solOpts.find(o => o[0] === k) || [k, k])[1];

  m.innerHTML = `
  <div class="fbar">
    <div><label>Solution D&amp;A</label><details class="ms" id="w-ms"><summary id="w-ms-s"></summary><div class="ms-list" id="w-ms-l"></div></details></div>
    <div><label>Tipo</label><details class="ms" id="w-mt"><summary id="w-mt-s"></summary><div class="ms-list" id="w-mt-l"></div></details></div>
    <div><label>Attenzione</label><details class="ms" id="w-ma"><summary id="w-ma-s"></summary><div class="ms-list" id="w-ma-l"></div></details></div>
    <div class="fbar-r">Settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)} · le modifiche restano in locale fino a “Esporta in Excel”</div>
  </div>
  <div id="w-chips"></div>
  <div class="seg seg-lg" id="w-views" role="tablist"></div>
  <div id="w-alert"></div>
  <div class="card wbar">
    <div class="row">
      <button id="w-selweek">Seleziona questa settimana</button><button id="w-selcol" title="Seleziona le offerte con il colore di attenzione (giallo, arancione, rosso)">Seleziona le colorate <span class="vc" id="w-ncol"></span></button><button id="w-selvis">Seleziona le visibili</button><button id="w-selnone">Deseleziona tutto</button>
      <span class="wcount" id="w-count"></span>
      <span style="margin-left:auto" class="row"><button id="w-meet" class="primary">${ico("calendar-clock")}Vista riunione</button><button id="w-txt">Scarica .txt</button><button id="w-copy">Copia negli appunti</button></span>
    </div>
    <div class="hint" id="w-exp-hint"></div>
  </div>
  <div class="card wl" id="w-list"></div>`;

  const all = () => wipItems();
  const visible = () => {
    const its = all().filter(i => W.touched.has(i.id) || (i.d && i.wip && passTipo(i) && passSol(i) && passAtt(i) && passView(i)));
    if (!W.order) { W.order = new Map(its.slice().sort(byDate).map((i, n) => [i.id, n])); }
    return its.sort((a, b) => (W.order.has(a.id) ? W.order.get(a.id) : 1e6) - (W.order.has(b.id) ? W.order.get(b.id) : 1e6) || byDate(a, b));
  };
  const selected = () => all().filter(i => W.sel.has(i.key) && i.wip && i.d);
  const exportItems = () => (selected().length ? selected() : visible().filter(i => i.wip)).sort(byDate);
  const counters = () => {
    const n = selected().length;
    $("#w-count").textContent = `${n} selezionate`;
    $("#w-exp-hint").textContent = n ? `Il .txt e “Copia” useranno le ${n} gare selezionate.` : `Nessuna selezione: il .txt e “Copia” useranno le ${visible().filter(i => i.wip).length} gare visibili.`;
  };
  const setView = v => { W.view = v; resetWipView(); draw(); };
  // menu a tendina con scelta multipla (Solution, Tipo, Attenzione): stesso componente
  const multi = (sumId, listId, opts, set, all) => {
    const label = k => (opts.find(o => o[0] === k) || [k, k])[1];
    $("#" + sumId).textContent = !set.size ? all : set.size === 1 ? label([...set][0]) : `${set.size} selezionati`;
    $("#" + listId).innerHTML = opts.map(([k, n]) => `<label class="ms-i"><input type="checkbox" data-k="${esc(k)}" ${set.has(k) ? "checked" : ""}> ${esc(n)}</label>`).join("") || `<div class="muted">Nessuna</div>`;
    $("#" + listId).querySelectorAll("input").forEach(c => c.onchange = () => { c.checked ? set.add(c.dataset.k) : set.delete(c.dataset.k); resetWipView(); draw(); });
  };
  const drawMs = () => { multi("w-ms-s", "w-ms-l", solOpts, W.sol, "Tutte"); multi("w-mt-s", "w-mt-l", tipiOpts, W.tipi, "Tutti"); multi("w-ma-s", "w-ma-l", ATT_OPTS, W.atts, "Tutte"); };
  const drawChips = () => {
    const attName = k => (ATT_OPTS.find(o => o[0] === k) || [k, k])[1].replace(/ \(.*\)/, "");
    const items = [...[...W.sol].map(k => ({id: "s:" + k, label: "Solution: " + solName(k)})), ...[...W.tipi].map(t => ({id: "t:" + t, label: "Tipo: " + t})),
      ...[...W.atts].map(k => ({id: "a:" + k, label: "Attenzione: " + attName(k)})), ...(W.view === "d7" ? [{id: "v", label: "Entro 7 giorni"}] : [])];
    const box = $("#w-chips"); box.innerHTML = chipsHtml(items);
    bindChips(box, id => { if (id === "v") W.view = "all"; else if (id.startsWith("t:")) W.tipi.delete(id.slice(2)); else if (id.startsWith("a:")) W.atts.delete(id.slice(2)); else W.sol.delete(id.slice(2)); resetWipView(); draw(); },
      () => { W.sol.clear(); W.tipi.clear(); W.atts.clear(); W.view = "all"; resetWipView(); draw(); });
  };
  const rowHtml = i => {
    const r = i.r, sel = W.sel.has(i.key), st = normStato(r.Stato), out = !i.wip;
    return `<div class="wr2 ${sel ? "sel" : ""} ${out ? "done" : ""}" data-b="${i.band}" data-id="${i.id}">
      <label class="wchk"><input type="checkbox" data-key="${esc(i.key)}" ${sel ? "checked" : ""} aria-label="Seleziona ${esc(r.Cliente)}"></label>
      <div class="wcl" data-att="${r.Attenzione || 0}"><b>${esc(r.Cliente)}</b>${r["Solution D&A"] ? `<span class="owner">${esc(r["Solution D&A"])}</span>` : ""}</div>
      <div class="wds" title="${esc(r.Oggetto)}">${orNil(r.Oggetto)}</div>
      <div class="wtipo">${tipoChip(r.tipo)}</div>
      <div class="watt"><select class="inl inl-att att-${r.Attenzione || 0}" data-id="${i.id}" aria-label="Attenzione per ${esc(r.Cliente)}">${attOpts(r.Attenzione, true)}</select></div>
      <div class="wdt"><span class="dtw"><button type="button" class="inl inl-dt" data-id="${i.id}" title="Clicca per cambiare la data di consegna" aria-label="Data di consegna di ${esc(r.Cliente)}: ${i.d ? fmtD(i.d) : "nessuna"}. Cambia">${i.d ? fmtD(i.d) : "—"}${ico("calendar")}</button><input type="date" class="dtin" data-id="${i.id}" value="${esc(r["Data consegna"] || "")}" tabindex="-1" aria-hidden="true"></span>${out ? "" : dayBadge(i.days, i.band)}</div>
      <div class="wst"><select class="inl inl-st st-${BCLASS[st] || "x"}" data-id="${i.id}" aria-label="Stato di ${esc(r.Cliente)}">${STATI.map(x => `<option ${x === st ? "selected" : ""}>${x}</option>`).join("")}</select>${out ? "" : `<button type="button" class="btn-cons" data-id="${i.id}" title="Segna come consegnata: lo stato passa a Waiting For response">${ico("check")}Consegnata</button>`}</div>
    </div>`;
  };
  const draw = () => {
    drawMs(); drawChips();
    const base = all().filter(i => i.wip && i.d && passTipo(i) && passSol(i) && passAtt(i));
    const n = {all: base.length, late: base.filter(i => passView(i, "late")).length, week: base.filter(i => passView(i, "week")).length, future: base.filter(i => passView(i, "future")).length};
    const VIEWS = [["all", "Tutte", n.all], ["late", "Scadute", n.late], ["week", "Questa settimana", n.week], ["future", "Future", n.future]];
    $("#w-views").innerHTML = VIEWS.map(([k, l, c]) => `<button role="tab" data-v="${k}" title="${({all: "Tutte le WIP con data di consegna", late: "Consegna già passata", week: "Consegna da oggi a domenica", future: "Consegna dopo questa settimana"})[k]}" class="${W.view === k ? "on" : ""} v-${k}">${l}<span class="vc">${c}</span></button>`).join("");
    $("#w-views").querySelectorAll("button").forEach(b => b.onclick = () => setView(b.dataset.v));
    const nodate = all().filter(i => i.wip && !i.d);
    $("#w-alert").innerHTML = nodate.length ? `<div class="alertbar">${ico("triangle-alert")}<span><b>${nodate.length}</b> ${nodate.length === 1 ? "offerta WIP è senza" : "offerte WIP sono senza"} data di consegna e non compaiono qui: da completare.</span><button class="linkbtn" id="w-nodate">Vedi quali</button></div>` : "";
    const nb = $("#w-nodate"); if (nb) nb.onclick = () => goTable({rows: nodate.map(i => i.id), rowsLabel: `WIP senza data di consegna (${nodate.length})`});
    counters();
    const vis = visible();
    $("#w-ncol").textContent = vis.filter(i => i.wip && i.r.Attenzione).length;
    $("#w-list").innerHTML = vis.length ? `<div class="wh"><span></span><span>Cliente</span><span>Descrizione</span><span>Tipo</span><span>Attenzione</span><span>Consegna</span><span>Stato</span></div>${vis.map(rowHtml).join("")}` : `<div class="empty" style="padding:var(--pad)">Nessuna offerta WIP con questi filtri.</div>`;
    $("#w-list").querySelectorAll(".wchk input").forEach(c => c.onchange = () => { c.checked ? W.sel.add(c.dataset.key) : W.sel.delete(c.dataset.key); selSave(W.sel); c.closest(".wr2").classList.toggle("sel", c.checked); counters(); });
    $("#w-list").querySelectorAll(".inl-dt").forEach(btn => btn.onclick = () => { const inp = btn.nextElementSibling; try { inp.showPicker(); } catch (e) { inp.focus(); inp.click(); } });
    $("#w-list").querySelectorAll(".dtin").forEach(inp => inp.onchange = () => {
      const row = rowByNum(+inp.dataset.id); if (!row) return;
      wipEdit(row, {"Data consegna": inp.value || null}, inp.value ? `Consegna di ${row.Cliente}: ${fmt(inp.value)}` : `Data di consegna di ${row.Cliente} tolta`);
    });
    $("#w-list").querySelectorAll(".inl-att").forEach(sel => sel.onchange = () => { const row = rowByNum(+sel.dataset.id); if (!row) return; const k = +sel.value; wipEdit(row, {Attenzione: k}, k ? `${row.Cliente}: ${ATT[k].label}` : `${row.Cliente}: attenzione tolta`); });
    $("#w-list").querySelectorAll(".btn-cons").forEach(btn => btn.onclick = () => { const row = rowByNum(+btn.dataset.id); if (row) wipEdit(row, {Stato: "Waiting For response"}, `${row.Cliente}: consegnata`); });
    $("#w-list").querySelectorAll(".inl-st").forEach(sel => sel.onchange = () => { const row = rowByNum(+sel.dataset.id); if (row) wipEdit(row, {Stato: sel.value}, `${row.Cliente}: ${sel.value}`); });

  };
  W.redraw = draw;
  resetWipView();
  draw();
  $("#w-selweek").onclick = () => { visible().filter(i => i.wip && i.band === "week").forEach(i => W.sel.add(i.key)); selSave(W.sel); draw(); };
  $("#w-selcol").onclick = () => { visible().filter(i => i.wip && i.r.Attenzione).forEach(i => W.sel.add(i.key)); selSave(W.sel); draw(); };
  $("#w-selvis").onclick = () => { visible().filter(i => i.wip).forEach(i => W.sel.add(i.key)); selSave(W.sel); draw(); };
  $("#w-selnone").onclick = () => { W.sel.clear(); selSave(W.sel); draw(); };
  $("#w-txt").onclick = () => downloadText(wipText(exportItems(), ctx), ctx);
  $("#w-copy").onclick = () => copyText(wipText(exportItems(), ctx));
  $("#w-meet").onclick = () => openMeeting();
}

// ------------------------------------------------------------ vista riunione (densa, come la tabella)
const DISC_KEY = "gare.wip.disc.v1", MGRP_KEY = "gare.wip.mgrp.v1";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const MEET_URG = [{k: "late", t: "Scadute"}, {k: "week", t: "Questa settimana"}, {k: "two", t: "Prossimi 14 giorni"}, {k: "over", t: "Più avanti"}];
const meetBadge = i => `<span class="tag ${i.days < 0 ? "d-late" : i.days <= 7 ? "d-week" : "d-over"}">${dayText(i.days)}</span>`;

function openMeeting() {
  const ctx = wipContext();
  const items = wipItems().filter(i => S.wip.sel.has(i.key) && i.wip && i.d).sort(byDate);
  let disc = new Set(lsGet(DISC_KEY, [])), byOwner = !!lsGet(MGRP_KEY, false);
  const collapsed = new Set();
  const el = document.createElement("div"); el.id = "meeting";
  const week = `${fmtD(ctx.monday).slice(0, 5)} – ${fmtD(ctx.sunday)}`;
  const cnt = k => items.filter(i => i.band === k).length;
  const done = () => items.filter(i => disc.has(i.key)).length;
  const row = i => `<div class="mr ${disc.has(i.key) ? "disc" : ""}" data-key="${esc(i.key)}">
      <label class="mchk"><input type="checkbox" ${disc.has(i.key) ? "checked" : ""} aria-label="Discussa: ${esc(i.r.Cliente)}"></label>
      <div class="mcl" title="${esc(i.r.Cliente)} · ${esc(i.r.Oggetto)}">${attDot(i.r)}<b>${esc(i.r.Cliente)}</b><span class="mds">· ${esc(i.r.Oggetto || "")}</span></div>
      <div class="mtipo">${tipoChip(i.r.tipo)}</div><div class="mow">${orNil(i.r["Solution D&A"])}</div>
      <div class="mdt"><span>${fmtD(i.d)}</span>${meetBadge(i)}</div></div>`;
  const sections = () => {
    if (byOwner) {
      const g = new Map(); items.forEach(i => { const o = i.r["Solution D&A"] || NOASS; (g.get(o) || g.set(o, []).get(o)).push(i); });
      return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], "it")).map(([o, its]) => ({id: "o:" + o, t: o, band: "owner", its}));
    }
    return MEET_URG.map(u => ({id: u.k, t: u.t, band: u.k, its: items.filter(i => i.band === u.k)})).filter(x => x.its.length);
  };
  const upd = () => {
    const n = items.length, d = done();
    $("#rm-sub", el).textContent = `${n} ${n === 1 ? "gara selezionata" : "gare selezionate"} · ${d} di ${n} discusse`;
    $("#rm-bar", el).style.width = n ? `${(100 * d / n).toFixed(1)}%` : "0";
  };
  const draw = () => {
    const y = el.scrollTop;
    el.innerHTML = `<div class="rm-top"><div class="rm-head"><div><h1>Riunione consegne · ${week}</h1><div class="rm-sub" id="rm-sub"></div></div>
      <div class="rm-actions"><button id="rm-copy">Copia</button><button id="rm-txt">Scarica .txt</button><button id="rm-back" class="primary">${ico("x")}Torna alla lista</button></div></div>
      <div class="rm-prog" role="progressbar" aria-label="Gare discusse"><i id="rm-bar"></i></div></div>
      <div class="rm-body">
        <div class="rm-cards"><div class="card rm-card late"><div class="n">${cnt("late")}</div><div class="l">Scadute</div></div><div class="card rm-card week"><div class="n">${cnt("week")}</div><div class="l">Questa settimana</div></div><div class="card rm-card"><div class="n">${cnt("two")}</div><div class="l">Prossimi 14 gg</div></div></div>
        <div class="rm-tools"><label class="sw"><input type="checkbox" id="rm-grp" ${byOwner ? "checked" : ""}> Raggruppa per owner</label><button class="linkbtn" id="rm-reset" title="Toglie la spunta “discussa” da tutte le gare">Nuova riunione</button></div>
        ${items.length ? sections().map(sec => `<section class="card rm-sec mb-${sec.band} ${collapsed.has(sec.id) ? "closed" : ""}" data-sec="${esc(sec.id)}"><button class="rm-sh" aria-expanded="${!collapsed.has(sec.id)}"><span class="rm-t">${esc(sec.t)}</span><span class="bc">${sec.its.length}</span></button><div class="rm-rows">${sec.its.map(row).join("")}</div></section>`).join("") : `<div class="card empty" style="padding:var(--pad)">Nessuna gara selezionata. Torna alla lista e spunta le gare da discutere.</div>`}
      </div>`;
    el.scrollTop = y; upd();
    $("#rm-back", el).onclick = close;
    $("#rm-txt", el).onclick = () => downloadText(wipText(items), ctx);
    $("#rm-copy", el).onclick = () => copyText(wipText(items));
    $("#rm-grp", el).onchange = e => { byOwner = e.target.checked; lsSet(MGRP_KEY, byOwner); draw(); };
    $("#rm-reset", el).onclick = () => { if (disc.size && !confirm("Togliere la spunta “discussa” da tutte le gare e ricominciare?")) return; disc = new Set(); lsSet(DISC_KEY, []); draw(); };
    el.querySelectorAll(".rm-sh").forEach(h => h.onclick = () => { const sec = h.closest(".rm-sec"), id = sec.dataset.sec; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); sec.classList.toggle("closed", collapsed.has(id)); h.setAttribute("aria-expanded", !collapsed.has(id)); });
    el.querySelectorAll(".mr input").forEach(c => c.onchange = () => { const r = c.closest(".mr"), k = r.dataset.key; c.checked ? disc.add(k) : disc.delete(k); lsSet(DISC_KEY, [...disc]); r.classList.toggle("disc", c.checked); upd(); });
  };
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  const close = () => { el.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  draw();
}

// ------------------------------------------------------------ pulizia dati (SOLO suggerimenti: si corregge nell'Excel)
async function renderClean(m) {
  m.innerHTML = `<div class="card" style="margin-bottom:var(--gap)"><h2>Valori normalizzati in lettura</h2><div class="sub">L'app legge Stato e Market ignorando maiuscole e spazi, senza toccare il file. Qui vedi cosa viene unificato e quante righe riguarda.</div><div id="c-sum"><div class="muted">Caricamento…</div></div></div>
    <div class="card"><h2>Suggerimenti di pulizia</h2><div class="sub">Cosa conviene correggere nell'Excel (stati scritti in modi diversi, maiuscole diverse da Domini, date scritte come testo, clienti con grafie diverse). Sono solo indicazioni: correggi tu nel file, poi premi “Aggiorna dall'Excel”.</div>
    <div id="c-out"><div class="muted">Caricamento…</div></div></div>`;
  api("/api/clean/summary").then(list => {
    $("#c-sum").innerHTML = list.length ? `<div class="tscroll"><table><thead><tr><th>Campo</th><th>Valore nel file</th><th>Letto come</th><th class="num">Righe</th><th>Nel file</th></tr></thead><tbody>${list.map(x =>
      `<tr><td>${esc(x.campo)}</td><td>${esc(x.da)}</td><td><b>${esc(x.a)}</b></td><td class="num">${num(x.righe)}</td><td class="muted">${x.scrivibile ? "da correggere nell'Excel (vedi i suggerimenti sotto)" : "cella vuota: solo in lettura"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Tutti i valori sono già nella forma standard.</div>`;
  }).catch(e => { $("#c-sum").innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  api("/api/clean/preview").then(items => {
    const out = $("#c-out");
    if (!items.length) { out.innerHTML = `<div class="empty">Non c'è niente da correggere.</div>`; return; }
    const kinds = [...new Set(items.map(i => i.kind))];
    out.innerHTML = kinds.map(k => { const its = items.filter(it => it.kind === k);
      return `<details open><summary>${esc(k)} <span class="cnt">(${its.length})</span></summary><div class="tscroll"><table><thead><tr><th>Riga Excel</th><th>Cliente</th><th>Campo</th><th>Ora</th><th>Suggerito</th></tr></thead><tbody>${its.map(it =>
        `<tr><td>${esc(it.xl)}</td><td>${esc(it.cliente)}</td><td>${esc(it.field)}</td><td>${esc(it.old)}</td><td><b>${esc(it.new)}</b></td></tr>`).join("")}</tbody></table></div></details>`; }).join("");
  }).catch(e => { $("#c-out").innerHTML = `<div class="err">${esc(e.message)}</div>`; });
}

// ------------------------------------------------------------ modale inserimento/modifica
function modal(html) {
  const root = $("#modal-root"); root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  root.firstChild.onmousedown = e => { if (e.target === root.firstChild && !modal.locked) closeModal(); };
  return root.firstChild;
}
function closeModal() { $("#modal-root").innerHTML = ""; modal.locked = false; }

function openForm(row) {
  const edit = !!row, d = S.data.domini, v = row || {Stato: "WIP", "Data ins.": S.dash.oggi};
  const sel = (id, arr, cur, req) => `<select id="${id}">${req ? "" : '<option value=""></option>'}${cur && !arr.includes(cur) ? `<option selected>${esc(cur)}</option>` : ""}${arr.map(x => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const inp = (id, label, val, extra = "", type = "text", req = false) => `<div><label class="${req ? "req" : ""}" for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}" ${extra}></div>`;
  const ta = (id, label, val) => `<div class="full"><label for="${id}">${label}</label><textarea id="${id}">${esc(val)}</textarea></div>`;
  const el = modal(`<h2>${edit ? "Modifica offerta" + (row.Seq ? " #" + row.Seq : "") : "Nuova offerta"}${edit && row._state === "new" ? ` <span class="lchip new">nuova, da esportare</span>` : edit && row._state === "mod" ? ` <span class="lchip mod">modificata, da esportare</span>` : ""}</h2>
  <div class="grid">
    <div><label class="req" for="f-Vertical">Vertical</label>${sel("f-Vertical", d.vertical, v.Vertical)}</div>
    <div><label class="req" for="f-Market">Market</label>${sel("f-Market", d.market, v.Market)}</div>
    <div class="full"><label class="req" for="f-Cliente">Cliente</label><input id="f-Cliente" list="dl-clienti" value="${esc(v.Cliente)}" autocomplete="off"><datalist id="dl-clienti">${d.clienti.map(c => `<option value="${esc(c.Cliente)}">`).join("")}</datalist></div>
    ${ta("f-Oggetto", "Oggetto <span class='req'></span>", v.Oggetto)}
    <div><label class="req" for="f-tipo">Tipo</label>${sel("f-tipo", d.tipo, v.tipo)}</div>
    <div><label class="req" for="f-Stato">Stato</label>${sel("f-Stato", STATI, normStato(v.Stato) || v.Stato, true)}</div>
    ${inp("f-Data ins.", "Data ins. (apertura)", v["Data ins."], "", "date", true)}
    <div><label for="f-Data consegna">Data consegna</label><input id="f-Data consegna" type="date" value="${esc(v["Data consegna"])}"><div class="hint" id="h-dc"></div></div>
    <div class="full"><label for="f-Solution D&A">Solution D&amp;A</label><input id="f-Solution D&A" list="dl-sol" value="${esc(v["Solution D&A"])}" autocomplete="off" placeholder="Scegli o scrivi i nomi, separati da /"><datalist id="dl-sol">${OWNERS.map(o => `<option value="${o}">`).join("")}</datalist>
      <div class="ochips" id="o-chips">${OWNERS.map(o => `<button type="button" class="ochip" data-o="${o}">${o}</button>`).join("")}</div><div class="hint" id="h-sol"></div></div>
    ${edit ? `<div class="full"><label for="f-Attenzione">Attenzione (colora il nome cliente nell'Excel)</label><select id="f-Attenzione">${attOpts(v.Attenzione)}</select></div>` : ""}
  </div>
  <details style="margin-top:14px"><summary>Altri campi</summary><div class="grid" style="margin-top:10px">
    <div><label for="f-SS">Codice SS</label><input id="f-SS" value="${esc(v.SS)}"><div class="hint" id="h-ss"></div></div>
    <div><label for="f-Commessa">Commessa</label><input id="f-Commessa" value="${esc(v.Commessa)}"><div class="hint" id="h-com"></div></div>
    ${inp("f-Legal Entity", "Legal Entity", v["Legal Entity"])}${inp("f-Salesman", "Salesman", v.Salesman)}
    ${inp("f-Data Opt review", "Data Opt review", v["Data Opt review"], "", "date")}${inp("f-Referenti vertical", "Referenti vertical", v["Referenti vertical"])}
    ${ta("f-Tecnologie di riferimento D&A", "Tecnologie di riferimento D&A", v["Tecnologie di riferimento D&A"])}${ta("f-Note", "Note", v.Note)}</div></details>
  <div class="err" id="f-err"></div>
  <div class="hint">${edit ? "Le modifiche restano nel database locale finché non premi “Esporta in Excel”." : "La riga viene salvata nel database locale e finisce nell'Excel quando premi “Esporta in Excel”."}</div>
  <div class="foot">${edit && row._state === "new" ? `<button id="f-del" style="margin-right:auto">${ico("trash-2")}Elimina riga</button>` : ""}${edit && row._state === "mod" ? `<button id="f-rev" style="margin-right:auto">${ico("undo-2")}Annulla modifiche</button>` : ""}<button id="f-cancel">Annulla</button><button id="f-save" class="primary">${edit ? "Salva modifiche" : "Aggiungi"}</button></div>`);
  const F_ = id => el.querySelector(`[id="f-${id}"]`);
  const g = id => (F_(id) || {}).value ?? "";
  const dirty = {SS: edit, Commessa: edit};
  ["SS", "Commessa"].forEach(k => F_(k).oninput = () => dirty[k] = true);
  const hintSol = () => {
    const s = g("Solution D&A").trim(), names = splitSol(s).map(x => x.toLowerCase());
    $("#h-sol", el).textContent = s ? "" : "Senza Solution D&A la riga comparirà nei punti di attenzione."; $("#h-sol", el).className = "hint warn";
    el.querySelectorAll(".ochip").forEach(c => c.classList.toggle("on", names.includes(c.dataset.o.toLowerCase())));
  };
  F_("Solution D&A").oninput = hintSol; hintSol();
  el.querySelectorAll(".ochip").forEach(c => c.onclick = () => {                 // un clic aggiunge/toglie il nome, gli altri nomi scritti a mano restano
    const cur = splitSol(g("Solution D&A")), i = cur.findIndex(x => x.toLowerCase() === c.dataset.o.toLowerCase());
    i >= 0 ? cur.splice(i, 1) : cur.push(c.dataset.o); F_("Solution D&A").value = cur.join(" / "); hintSol();
  });
  const hintDc = () => { const h = $("#h-dc", el); h.textContent = !edit && !g("Data consegna") ? `Se la lasci vuota: fine mese (${fmt(endOfMonthIso(g("Data ins.")))})` : ""; };
  F_("Data consegna").addEventListener("input", hintDc); F_("Data ins.").addEventListener("input", hintDc); hintDc();
  let tmr;
  const suggest = async () => {
    if (edit || !g("Cliente").trim()) return;
    try {
      const s = await api("/api/suggest", {method: "POST", body: {Cliente: g("Cliente"), Vertical: g("Vertical"), "Data consegna": g("Data consegna") || endOfMonthIso(g("Data ins.")), "Data ins.": g("Data ins.")}});
      if (!dirty.SS && s.ss) F_("SS").value = s.ss;
      if (!dirty.Commessa && s.commessa) F_("Commessa").value = s.commessa;
      $("#h-ss", el).textContent = s.ss ? `Proposto: prefisso ${s.prefisso}, opportunità n. ${s.numero} per questo cliente` : "";
      $("#h-ss", el).className = "hint" + (s.avviso ? " warn" : ""); if (s.avviso) $("#h-ss", el).textContent = s.avviso;
      $("#h-com", el).textContent = s.commessa ? "Calcolata da Domini (Vertical + anno)" : "Nessuna commessa in Domini per questo anno/vertical";
    } catch (e) {}
  };
  const sched = () => { clearTimeout(tmr); tmr = setTimeout(suggest, 250); };
  ["Cliente", "Vertical", "Data consegna", "Data ins."].forEach(k => F_(k).addEventListener("input", sched));
  F_("Cliente").addEventListener("change", () => {
    if (edit) return; const c = d.clienti.find(x => x.Cliente.toLowerCase() === g("Cliente").trim().toLowerCase());
    if (c) { if (!g("Vertical") && c.Vertical) F_("Vertical").value = c.Vertical; if (!g("Market") && c.Market) F_("Market").value = c.Market; }
    suggest();
  });
  $("#f-cancel", el).onclick = closeModal;
  const del = $("#f-del", el); if (del) del.onclick = async () => { if (!confirm("Eliminare questa riga? Non è ancora nell'Excel.")) return; try { await api("/api/rows/" + row._row, {method: "DELETE"}); closeModal(); await loadAll(true); toast("Riga eliminata"); } catch (e) { toast(e.message, true); } };
  const rev = $("#f-rev", el); if (rev) rev.onclick = async () => { if (!confirm("Annullare le modifiche di questa riga e tornare ai valori dell'Excel?")) return; try { await api("/api/rows/" + row._row + "/revert", {method: "POST"}); closeModal(); await loadAll(true); toast("Modifiche annullate"); } catch (e) { toast(e.message, true); } };
  F_("Cliente").focus();
  $("#f-save", el).onclick = async () => {
    const F = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Stato", "Data ins.", "Data consegna", "Solution D&A", "SS", "Commessa", "Legal Entity", "Salesman", "Data Opt review", "Referenti vertical", "Tecnologie di riferimento D&A", "Note"];
    const vals = {}; F.forEach(f => vals[f] = g(f).trim() || null); vals.Attenzione = +g("Attenzione") || 0;
    if (!edit && !vals["Data consegna"] && vals["Data ins."]) vals["Data consegna"] = endOfMonthIso(vals["Data ins."]);     // senza data di consegna: fine mese
    const err = $("#f-err", el); err.textContent = "";
    const miss = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Data ins.", "Stato"].filter(f => !vals[f]);
    if (miss.length) { err.textContent = "Campi obbligatori mancanti: " + miss.join(", "); return; }
    const send = async force => {
      if (edit) { const ch = {}; F.forEach(f => { if ((vals[f] || null) !== (row[f] || null)) ch[f] = vals[f]; }); if (F_("Attenzione") && vals.Attenzione !== (row.Attenzione || 0)) ch.Attenzione = vals.Attenzione; if (!Object.keys(ch).length) { closeModal(); return; }
        await withBusy(() => api("/api/rows/" + row._row, {method: "PUT", body: {changes: ch}})); toast("Modifiche salvate (da esportare nell'Excel)"); }
      else { await withBusy(() => api("/api/rows", {method: "POST", body: {...vals, _force: force}})); toast("Offerta aggiunta (da esportare nell'Excel)"); }
      closeModal(); await loadAll(true);
    };
    try { await send(false); }
    catch (e) { if (e.body && e.body.duplicato) { if (confirm(e.message)) { try { await send(true); } catch (e2) { err.textContent = e2.message; } } } else err.textContent = e.message; }
  };
}

// ------------------------------------------------------------ impostazioni
function openSettings(first, msg) {
  const st = S.state || {};
  const el = modal(`<h2>${first ? "Benvenuto — configura i dati" : "Impostazioni"}</h2>
    <p class="muted">L'app lavora su un <b>database locale</b> (SQLite) caricato dal tuo file Excel. L'Excel viene scritto solo quando premi “Esporta in Excel”.</p>
    <label for="s-path">File Excel (copia sincronizzata di SharePoint)</label><div class="row"><input id="s-path" style="flex:1" value="${esc(st.path || "")}" placeholder="C:\\Users\\…\\HISTORY.xlsx"><button id="s-browse">Sfoglia…</button></div>
    <label for="s-db" style="margin-top:12px">Database locale (si crea da solo se non esiste; tienilo fuori da OneDrive)</label><input id="s-db" value="${esc(st.db_path || "")}">
    <div class="hint">${st.imported_at ? `Ultimo import: ${esc(st.imported_at.replace("T", " "))}` : "Nessun import ancora eseguito."}${st.pending && (st.pending.new + st.pending.mod) ? ` · <b>${st.pending.new + st.pending.mod} modifiche non esportate</b>` : ""}</div>
    <div class="err" id="s-err">${esc(msg || "")}</div>
    <div class="foot">${first ? "" : '<button id="s-cancel">Chiudi</button>'}<button id="s-save" class="primary">${ico("database")}Salva e importa dall'Excel</button></div>
    <p class="hint">Le copie di sicurezza (Excel prima di ogni esportazione, database prima di un aggiornamento con modifiche in sospeso) stanno nella cartella “backup” accanto all'app.</p>`);
  modal.locked = !!first;
  const c = $("#s-cancel", el); if (c) c.onclick = closeModal;
  $("#s-browse", el).onclick = async () => { try { const r = await api("/api/browse", {method: "POST"}); if (r.path) $("#s-path", el).value = r.path; } catch (e) { $("#s-err", el).textContent = e.message; } };
  $("#s-save", el).onclick = async () => {
    try {
      const n = st.pending ? st.pending.new + st.pending.mod : 0;
      if (n && !confirm(`Ci sono ${n} modifiche non esportate: importando verranno eliminate. Continuare?`)) return;
      await withBusy(async () => {
        await api("/api/config", {method: "POST", body: {excel_path: $("#s-path", el).value, db_path: $("#s-db", el).value}});
        await api("/api/import", {method: "POST", body: {force: true}});
      }, "Importo il file Excel…");
      closeModal(); await loadAll(true); toast("Dati importati dall'Excel");
    } catch (e) { $("#s-err", el).textContent = e.message; }
  };
}

// ------------------------------------------------------------ barra laterale (compatta, si espande al passaggio del mouse; si può fissare)
const PIN_KEY = "gare.side.pinned";
function setPinned(v, save = true) {
  document.body.classList.toggle("pinned", v);
  const b = $("#btn-pin"); b.setAttribute("aria-pressed", v); b.title = v ? "Sblocca la barra" : "Fissa la barra aperta";
  b.querySelector(".lbl").textContent = v ? "Sblocca barra" : "Fissa barra"; b.querySelector("svg").outerHTML = ico(v ? "pin-off" : "pin");
  if (save) { try { localStorage.setItem(PIN_KEY, v ? "1" : "0"); } catch (e) {} }
}

// ------------------------------------------------------------ avvio
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => { S.view = b.dataset.view; if (!S.data) return; if (S.view === "table") S.filt = EMPTY_FILT(); if (S.view === "wip") resetWipView(); render(); });
$("#btn-new").onclick = () => S.data ? openForm(null) : toast("Prima scegli il file Excel", true);
$("#btn-reload").onclick = importNow;
$("#btn-export").onclick = exportFlow;
$("#btn-settings").onclick = () => openSettings(false);
$("#btn-pin").onclick = () => setPinned(!document.body.classList.contains("pinned"));
hydrateIcons();
try { setPinned(localStorage.getItem(PIN_KEY) === "1", false); } catch (e) {}
loadAll(false);
