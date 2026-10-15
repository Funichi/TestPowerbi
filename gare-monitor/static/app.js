"use strict";
const STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID"];
const BCLASS = {"WIP": "WIP", "Waiting For response": "Waiting", "Sospeso": "Sospeso", "Won": "Won", "Lost": "Lost", "NoBID": "NoBID"};
const COLOR = {"WIP": "var(--wip)", "Waiting For response": "var(--waiting)", "Sospeso": "var(--sospeso)", "Won": "var(--won)", "Lost": "var(--lost)", "NoBID": "var(--nobid)", "Altro": "var(--altro)"};
const S = {data: null, dash: null, view: "dash", months: "12", trendMode: "inserite",
  filt: {q: "", stato: "", vertical: "", solution: "", anno: ""}, sort: {k: "Data ins.", dir: -1},
  clean: null, state: null};

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v10"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll("i[data-ico]").forEach(i => i.outerHTML = ico(i.dataset.ico)); }
const TITLES = {dash: ["Cruscotto", "Scadenze, attenzioni e andamento delle offerte"], table: ["Tabella", "Tutte le offerte: filtra, ordina, clicca una riga per modificarla"], wip: ["Consegne WIP", "Scadenze delle offerte in corso e preparazione della riunione"], clean: ["Pulizia dati", "Uniforma gli stati e correggi i dati nel file Excel"]};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = iso => iso ? iso.split("-").reverse().join("/") : "";
const badge = s => s ? `<span class="badge b-${BCLASS[s] || "x"}">${esc(s)}</span>` : "";
const normStato = s => { const m = {"closed": "Sospeso", "no bid": "NoBID", "no-bid": "NoBID", "nobid": "NoBID", "waiting": "Waiting For response"}; const k = (s || "").trim().toLowerCase(); return STATI.find(x => x.toLowerCase() === k) || m[k] || s; };
const splitSol = v => (v || "").split(/\s*[\/,+&;]\s*/).map(x => x.trim()).filter(Boolean);

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
async function withBusy(fn) {
  $("#busy").hidden = false;
  try { return await fn(); } finally { $("#busy").hidden = true; }
}

// ------------------------------------------------------------ caricamento
async function loadAll(force) {
  S.state = await api("/api/state");
  if (!S.state.exists) { openSettings(true); return; }
  try {
    S.data = await api("/api/data" + (force ? "?force=1" : ""));
    S.dash = await api("/api/dashboard?months=" + S.months);
  } catch (e) { toast(e.message, true); openSettings(true, e.message); return; }
  $("#status").innerHTML = `${esc(S.state.path.split(/[\\/]/).pop())}<br>${S.data.rows.length} righe · letto alle ${esc((S.data.loaded || "").slice(11, 16))}`;
  $("#status").title = S.state.path;
  render();
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
function periodSelect() {
  return `<div><label>Periodo</label><select id="period">${[["12", "Ultimi 12 mesi"], ["24", "Ultimi 24 mesi"], ["6", "Ultimi 6 mesi"], ["all", "Tutto lo storico"]].map(([v, l]) => `<option value="${v}" ${S.months === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
function dayLabel(g) { return g < 0 ? `<span class="tag late">scaduta da ${-g} gg</span>` : g === 0 ? `<span class="tag late">oggi</span>` : `<span class="tag soon">tra ${g} gg</span>`; }
function miniTable(items, cols) {
  if (!items.length) return `<div class="empty">Nessuna voce.</div>`;
  return `<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${items.map(x => `<tr class="click" data-row="${x._row}">${cols.map(c => `<td>${c[1](x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const offer = x => `<div class="offer"><b>${esc(x.Cliente)}</b><span>${esc((x.Oggetto || "").slice(0, 90))}</span></div>`;
function tile(cls, icon, n, label, attrs) { return `<div class="tile ${cls}" ${attrs}><div class="ico-c">${ico(icon)}</div><div><div class="n">${n}</div><div class="l">${label}</div></div></div>`; }
function renderDash(m) {
  const d = S.dash, t = d.tiles, so = d.soglie;
  m.innerHTML = `
  <div class="toolbar">${periodSelect()}<div class="muted" style="padding-bottom:10px">Oggi ${fmt(d.oggi)} · WIP: tutte le offerte in corso; il resto segue il periodo (per Data ins.)</div></div>
  <div class="tiles">
    ${tile("c-blue", "bolt", t.wip, "In corso (WIP)", 'data-go="WIP"')}
    ${tile("c-violet", "clock", t.waiting, "In attesa di risposta", 'data-go="Waiting For response"')}
    ${tile("c-coral", "cal", `${t.scadute} <small>+ ${t.imminenti}</small>`, `Consegne scadute · entro ${so.scadenza} gg`, 'data-scroll="sec-scad"')}
    ${tile("c-orange", "bell", t.solleciti, `Da sollecitare (${so.sollecito}–${so.riclassifica} gg)`, 'data-scroll="sec-soll"')}
    ${tile("c-pink", "alert", t.attenzioni, "Punti di attenzione", 'data-scroll="sec-att"')}
  </div>
  <div class="grid2">
    <div class="card" id="sec-scad"><h2>Scadenze</h2><div class="sub">Offerte in corso (WIP) con consegna scaduta o entro ${so.scadenza} giorni.</div>
      ${miniTable(d.scadenze, [["Quando", x => dayLabel(x.giorni) + `<span class="sm">${fmt(x["Data consegna"])}</span>`], ["Offerta", offer], ["Solution", x => esc(x["Solution D&A"])]])}</div>
    <div class="card" id="sec-soll"><h2>Da sollecitare</h2><div class="sub">Consegnate (Waiting For response) da ${so.sollecito}–${so.riclassifica} giorni dalla Data ins.</div>
      ${miniTable(d.solleciti, [["Giorni", x => `<span class="tag soon">${x.giorni} gg</span><span class="sm">${fmt(x["Data ins."])}</span>`], ["Offerta", offer], ["Solution", x => esc(x["Solution D&A"])]])}
      <details><summary>Oltre ${so.riclassifica} giorni <span class="cnt">— ${d.riclassificare.length} nel periodo (${d.riclassificare_totale} in tutto): probabili Sospeso</span></summary>
      ${miniTable(d.riclassificare, [["Giorni", x => `${x.giorni} gg`], ["Offerta", offer], ["Solution", x => esc(x["Solution D&A"])]])}</details></div>
  </div>
  <div class="grid3">
    <div class="card"><div class="row"><div><h2>Trend mensile</h2><div class="sub">Per mese di Data ins. (inserite) o Data consegna (consegnate)</div></div>
      <div class="seg" style="margin-left:auto"><button data-tm="inserite" class="${S.trendMode === "inserite" ? "on" : ""}">Inserite</button><button data-tm="consegnate" class="${S.trendMode === "consegnate" ? "on" : ""}">Consegnate</button></div></div>
      <div id="trend"></div></div>
    <div class="card"><h2>Offerte per stato</h2><div class="sub">Nel periodo scelto</div><div id="donut" class="donut"></div></div>
  </div>
  <div class="card"><h2>Pipeline per solution</h2><div class="sub">Numero di offerte; se lavorano in più persone la riga conta per ciascuna. Clicca un numero per vedere l'elenco.</div>
    ${pipelineTable(d.pipeline)}</div>
  <div class="card" id="sec-att"><h2>Punti di attenzione</h2><div class="sub">Dati mancanti o anomali da sistemare.</div>
    ${d.attenzioni.length ? d.attenzioni.map(a => `<details><summary>${esc(a.titolo)} <span class="cnt">(${a.righe.length})</span></summary>${miniTable(a.righe, [["Seq", x => x.Seq], ["Offerta", offer], ["Stato", x => badge(x.Stato)], ["Data ins.", x => fmt(x["Data ins."])], ["", x => esc(x.dettaglio || "")]])}</details>`).join("") : `<div class="empty">Tutto in ordine.</div>`}</div>`;
  $("#period").onchange = async e => { S.months = e.target.value; await reloadDash(); render(); };
  m.querySelectorAll("tr[data-row]").forEach(tr => tr.onclick = () => openForm(rowByNum(+tr.dataset.row)));
  m.querySelectorAll(".tile[data-go]").forEach(t => t.onclick = () => goTable({stato: t.dataset.go}));
  m.querySelectorAll(".tile[data-scroll]").forEach(t => t.onclick = () => document.getElementById(t.dataset.scroll).scrollIntoView({behavior: "smooth"}));
  m.querySelectorAll("[data-sol]").forEach(c => c.onclick = () => goTable({solution: c.dataset.sol, stato: c.dataset.st}));
  m.querySelectorAll("[data-tm]").forEach(b => b.onclick = () => { S.trendMode = b.dataset.tm; render(); });
  drawTrend($("#trend"), d.trend);
  drawDonut($("#donut"), d.stati);
}
function drawDonut(el, st) {
  const tot = STATI.reduce((a, s) => a + (st[s] || 0), 0) || 1, R = 70, C = 2 * Math.PI * R, gap = 5;
  let off = 0, arcs = "";
  STATI.forEach(s => { const v = st[s] || 0; if (!v) return; const len = Math.max(C * v / tot - gap, 1);
    arcs += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${COLOR[s]}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"><title>${s}: ${v}</title></circle>`; off += C * v / tot; });
  el.innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="Offerte per stato"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--field)" stroke-width="22"/>${arcs}
    <text x="100" y="104" text-anchor="middle" style="font-size:30px;font-weight:700;fill:var(--ink)">${tot === 1 && !STATI.some(s => st[s]) ? 0 : tot}</text><text x="100" y="124" text-anchor="middle">offerte</text></svg>
    <div class="dl">${STATI.map(s => `<div><b>${Math.round(100 * (st[s] || 0) / tot)}%</b><span><i style="background:${COLOR[s]}"></i>${s === "Waiting For response" ? "Waiting" : s} (${st[s] || 0})</span></div>`).join("")}</div>`;
}
function pipelineTable(p) {
  if (!p.length) return `<div class="empty">Nessun dato.</div>`;
  const tot = {}; STATI.forEach(s => tot[s] = p.reduce((a, x) => a + x[s], 0));
  return `<table><thead><tr><th>Solution D&A</th>${STATI.map(s => `<th class="num">${badge(s)}</th>`).join("")}<th class="num">Totale</th></tr></thead><tbody>
  ${p.map(x => `<tr><td><b>${esc(x.solution)}</b></td>${STATI.map(s => `<td class="num">${x[s] ? `<span class="cell-link" data-sol="${esc(x.solution)}" data-st="${s}">${x[s]}</span>` : '<span class="muted">·</span>'}</td>`).join("")}<td class="num">${x.totale}</td></tr>`).join("")}
  <tr><td><b>Totale</b></td>${STATI.map(s => `<td class="num"><b>${tot[s]}</b></td>`).join("")}<td class="num"><b>${p.reduce((a, x) => a + x.totale, 0)}</b></td></tr></tbody></table>`;
}
function drawTrend(el, tr) {
  const W = 640, H = 300, L = 34, B = 28, T = 10, n = tr.mesi.length;
  const mode = S.trendMode;
  const stacks = tr.mesi.map((_, i) => mode === "inserite" ? [...STATI, "Altro"].map(s => [s, tr.inserite[i][s]]) : [["Consegnate", tr.consegnate[i]]]);
  const max = Math.max(1, ...stacks.map(st => st.reduce((a, x) => a + x[1], 0)));
  const nice = Math.ceil(max / 5) * 5 || 5, bw = (W - L - 8) / n, y = v => T + (H - T - B) * (1 - v / nice);
  let g = "";
  for (let k = 0; k <= 5; k++) { const v = nice / 5 * k; g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  stacks.forEach((st, i) => {
    let acc = 0; const x = L + i * bw + bw * .12, w = bw * .76;
    st.forEach(([s, v]) => { if (!v) return; const y0 = y(acc + v), h = y(acc) - y0; acc += v;
      g += `<rect x="${x}" y="${y0}" width="${w}" height="${h}" fill="${COLOR[s] || "var(--accent)"}" rx="5"><title>${tr.mesi[i]} · ${s}: ${v}</title></rect>`; });
    if (acc) g += `<text x="${x + w / 2}" y="${y(acc) - 4}" text-anchor="middle">${acc}</text>`;
    if (n <= 14 || i % 2 === 0) g += `<text x="${x + w / 2}" y="${H - 10}" text-anchor="middle">${tr.mesi[i].slice(5)}/${tr.mesi[i].slice(2, 4)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trend mensile">${g}</svg>` +
    (mode === "inserite" ? `<div class="legend">${[...STATI, "Altro"].map(s => `<span><i style="background:${COLOR[s]}"></i>${s}</span>`).join("")}</div>` : "");
}

// ------------------------------------------------------------ tabella
function goTable(f) { S.filt = {q: "", stato: "", vertical: "", solution: "", anno: "", ...f}; S.view = "table"; render(); }
const COLS = [["Seq", "Seq"], ["Cliente", "Cliente"], ["Oggetto", "Oggetto"], ["Vertical", "Vertical"], ["Market", "Market"], ["tipo", "Tipo"], ["Data ins.", "Data ins."], ["Data consegna", "Consegna"], ["Solution D&A", "Solution D&A"], ["Stato", "Stato"], ["SS", "SS"]];
function filteredRows() {
  const f = S.filt, q = f.q.toLowerCase();
  return S.data.rows.filter(r => {
    if (f.stato && (normStato(r.Stato) !== f.stato)) return false;
    if (f.vertical && r.Vertical !== f.vertical) return false;
    if (f.anno && (r["Data ins."] || "").slice(0, 4) !== f.anno) return false;
    if (f.solution) { const s = splitSol(r["Solution D&A"]).map(x => x.toLowerCase()); if (f.solution === "(non assegnata)" ? s.length : !s.includes(f.solution.toLowerCase())) return false; }
    if (q && ![r.Cliente, r.Oggetto, r.SS, r["Solution D&A"], r.Market, r.Note, r["Referenti vertical"]].some(v => (v || "").toLowerCase().includes(q))) return false;
    return true;
  });
}
function renderTable(m) {
  const d = S.data.domini, f = S.filt;
  const anni = [...new Set(S.data.rows.map(r => (r["Data ins."] || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const opts = (arr, cur) => `<option value="">Tutti</option>` + arr.map(x => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");
  m.innerHTML = `<div class="toolbar">
    <div class="grow"><label>Cerca</label><input id="f-q" value="${esc(f.q)}" placeholder="cliente, oggetto, codice SS, solution…"></div>
    <div><label>Stato</label><select id="f-stato">${opts(STATI, f.stato)}</select></div>
    <div><label>Vertical</label><select id="f-vertical">${opts(d.vertical, f.vertical)}</select></div>
    <div><label>Solution</label><select id="f-solution">${opts(["(non assegnata)", ...d.solutions], f.solution)}</select></div>
    <div><label>Anno (Data ins.)</label><select id="f-anno">${opts(anni, f.anno)}</select></div>
    <div><button id="f-reset">Azzera filtri</button></div><div class="muted" id="f-count" style="padding-bottom:8px"></div></div>
    <div class="tablewrap"><table><thead><tr>${COLS.map(([k, l]) => `<th class="sort" data-k="${k}">${l}${S.sort.k === k ? (S.sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const rows = filteredRows(), k = S.sort.k, dir = S.sort.dir;
    rows.sort((a, b) => { const x = a[k] ?? "", y = b[k] ?? ""; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "it", {numeric: true})) * dir; });
    $("#f-count").textContent = rows.length + " righe";
    $("#tb").innerHTML = rows.map(r => `<tr class="click" data-row="${r._row}"><td>${r.Seq}</td><td><b>${esc(r.Cliente)}</b></td><td>${esc((r.Oggetto || "").slice(0, 110))}</td><td>${esc(r.Vertical)}</td><td>${esc(r.Market)}</td><td>${esc(r.tipo)}</td><td>${fmt(r["Data ins."])}</td><td>${fmt(r["Data consegna"])}</td><td>${esc(r["Solution D&A"])}</td><td>${badge(r.Stato)}</td><td>${esc(r.SS)}</td></tr>`).join("");
    document.querySelectorAll("#tb tr").forEach(tr => tr.onclick = () => openForm(rowByNum(+tr.dataset.row)));
  };
  draw();
  const bind = (id, key) => $(id).oninput = e => { S.filt[key] = e.target.value; draw(); };
  bind("#f-q", "q"); bind("#f-stato", "stato"); bind("#f-vertical", "vertical"); bind("#f-solution", "solution"); bind("#f-anno", "anno");
  $("#f-reset").onclick = () => goTable({});
  m.querySelectorAll("th.sort").forEach(th => th.onclick = () => { S.sort = {k: th.dataset.k, dir: S.sort.k === th.dataset.k ? -S.sort.dir : 1}; renderTable(m); });
}

// ------------------------------------------------------------ consegne WIP (SOLA LETTURA: nessuna scrittura sull'Excel)
const WIP_BANDS = [
  {k: "late", t: "Scadute", note: "Verificare se consegnata o aggiornare lo stato"},
  {k: "week", t: "Questa settimana", note: ""},
  {k: "two", t: "Prossime 2 settimane", note: ""},
  {k: "over", t: "Oltre", note: ""},
  {k: "none", t: "Senza data di consegna", note: "Completare il dato"},
];
const SEL_KEY = "gare.wip.sel.v1";
const selLoad = () => { try { return new Set(JSON.parse(localStorage.getItem(SEL_KEY) || "[]")); } catch (e) { return new Set(); } };
const selSave = set => { try { localStorage.setItem(SEL_KEY, JSON.stringify([...set])); } catch (e) {} };
S.wip = {sol: new Set(), tipo: "", sel: selLoad(), collapsed: {}};
const isoDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtD = d => d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "";
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const NOASS = "(non assegnata)";

function wipContext() {
  const t = isoDate(S.dash && S.dash.oggi) || (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
  const wd = (t.getDay() + 6) % 7;                       // lunedì = 0
  return {today: t, monday: addDays(t, -wd), sunday: addDays(t, 6 - wd), weekEnd: 6 - wd};
}
function wipItems() {
  const ctx = wipContext();
  return S.data.rows.filter(r => normStato(r.Stato) === "WIP").map(r => {
    const d = isoDate(r["Data consegna"]);
    const days = d ? Math.round((d - ctx.today) / 864e5) : null;
    const band = days === null ? "none" : days < 0 ? "late" : days <= ctx.weekEnd ? "week" : days <= ctx.weekEnd + 14 ? "two" : "over";
    return {r, key: String(r.Seq), d, days, band, names: splitSol(r["Solution D&A"])};
  }).sort((a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity) || String(a.r.Cliente).localeCompare(String(b.r.Cliente), "it"));
}
const passTipo = it => !S.wip.tipo || it.r.tipo === S.wip.tipo;
const passSol = it => !S.wip.sol.size || (it.names.length ? it.names.some(n => S.wip.sol.has(n.toLowerCase())) : S.wip.sol.has(NOASS.toLowerCase()));
const dayText = g => g === null ? "" : g < 0 ? `scaduta da ${-g} gg` : g === 0 ? "oggi" : `tra ${g} gg`;
const dayBadge = (g, band) => g === null ? "" : `<span class="tag d-${band}">${dayText(g)}</span>`;
const ownerOf = it => it.r["Solution D&A"] || "n.d.";

function wipText(items, ctx) {
  const L = [`CONSEGNE WIP – settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)}`, `Generato il ${fmtD(ctx.today)} – ${items.length} gare`, ""];
  WIP_BANDS.forEach(b => {
    const its = items.filter(i => i.band === b.k); if (!its.length) return;
    L.push(`== ${b.t.toUpperCase()} (${its.length}) ==`);
    its.forEach(i => L.push(`• ${(i.r.Cliente || "n.d.").toUpperCase()} – ${i.r.Oggetto || "n.d."} | ${ownerOf(i)} | ${i.d ? `Consegna ${fmtD(i.d)} (${dayText(i.days)})` : "Consegna n.d."} | SS: ${i.r.SS || "n.d."}`));
    L.push("");
  });
  return L.join("\n");
}
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

function renderWip(m) {
  const ctx = wipContext(), all = wipItems();
  const tipi = [...new Set(all.map(i => i.r.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  const names = new Map(); let hasNo = false;
  all.forEach(i => { if (!i.names.length) hasNo = true; i.names.forEach(n => names.has(n.toLowerCase()) || names.set(n.toLowerCase(), n)); });
  const solOpts = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "it")); if (hasNo) solOpts.push([NOASS.toLowerCase(), NOASS]);
  $("#page-sub").textContent = `Oggi ${fmtD(ctx.today)} · ${all.length} offerte in WIP`;

  m.innerHTML = `
  <div class="toolbar">
    <div><label>Solution D&amp;A</label><details class="ms" id="w-ms"><summary id="w-ms-s"></summary><div class="ms-list" id="w-ms-l"></div></details></div>
    <div><label>Tipo</label><select id="w-tipo"><option value="">Tutti</option>${tipi.map(t => `<option ${t === S.wip.tipo ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
    <div><button id="w-reset" class="ghost">Azzera filtri</button></div>
    <div class="muted" style="padding-bottom:10px;margin-left:auto">Settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)} · sola lettura</div>
  </div>
  <div class="card wbar">
    <div class="row">
      <button id="w-selweek">Seleziona questa settimana</button><button id="w-selvis">Seleziona le visibili</button><button id="w-selnone">Deseleziona tutto</button>
      <span class="wcount" id="w-count"></span>
      <span style="margin-left:auto" class="row"><button id="w-meet" class="primary">${ico("cal")}Vista riunione</button><button id="w-txt">Scarica .txt</button><button id="w-copy">Copia negli appunti</button></span>
    </div>
    <div class="hint" id="w-exp-hint"></div>
  </div>
  <div class="wgrid"><div id="w-list"></div><aside class="card wload" id="w-load"></aside></div>`;

  const drawMs = () => {
    $("#w-ms-s").textContent = S.wip.sol.size ? `${S.wip.sol.size} selezionat${S.wip.sol.size === 1 ? "a" : "e"}` : "Tutte";
    $("#w-ms-l").innerHTML = solOpts.map(([k, n]) => `<label class="ms-i"><input type="checkbox" data-k="${esc(k)}" ${S.wip.sol.has(k) ? "checked" : ""}> ${esc(n)}</label>`).join("") || `<div class="muted">Nessuna</div>`;
    $("#w-ms-l").querySelectorAll("input").forEach(c => c.onchange = () => { c.checked ? S.wip.sol.add(c.dataset.k) : S.wip.sol.delete(c.dataset.k); draw(); });
  };
  const visible = () => all.filter(i => passTipo(i) && passSol(i));
  const exportItems = () => { const s = all.filter(i => S.wip.sel.has(i.key)); return s.length ? s : visible(); };

  const draw = () => {
    drawMs();
    const vis = visible(), selN = all.filter(i => S.wip.sel.has(i.key)).length;
    $("#w-count").textContent = `${selN} selezionate`;
    $("#w-exp-hint").textContent = selN ? `Il .txt e “Copia” useranno le ${selN} gare selezionate.` : `Nessuna selezione: il .txt e “Copia” useranno le ${vis.length} gare visibili.`;
    $("#w-list").innerHTML = WIP_BANDS.map(b => {
      const its = vis.filter(i => i.band === b.k); if (!its.length) return "";
      return `<details class="band band-${b.k}" data-b="${b.k}" ${S.wip.collapsed[b.k] ? "" : "open"}><summary><span class="bt">${b.t}</span><span class="bc">${its.length}</span>${b.note ? `<span class="bn">${b.note}</span>` : ""}</summary>
      <div class="wlist">${its.map(i => `<div class="wrow ${S.wip.sel.has(i.key) ? "sel" : ""}"><label class="wchk"><input type="checkbox" data-key="${esc(i.key)}" ${S.wip.sel.has(i.key) ? "checked" : ""}></label>
        <div class="wmain"><b>${esc(i.r.Cliente)}</b><span>${esc(i.r.Oggetto)}</span></div><div class="wtipo">${esc(i.r.tipo)}</div><div class="wsol">${esc(i.r["Solution D&A"] || "—")}</div>
        <div class="wss">${esc(i.r.SS)}</div><div class="wdate">${i.d ? fmtD(i.d) : "—"} ${dayBadge(i.days, i.band)}</div></div>`).join("")}</div></details>`;
    }).join("") || `<div class="card empty">Nessuna offerta WIP con questi filtri.</div>`;
    $("#w-list").querySelectorAll("details.band").forEach(d => d.ontoggle = () => S.wip.collapsed[d.dataset.b] = !d.open);
    $("#w-list").querySelectorAll(".wchk input").forEach(c => c.onchange = () => { c.checked ? S.wip.sel.add(c.dataset.key) : S.wip.sel.delete(c.dataset.key); selSave(S.wip.sel); c.closest(".wrow").classList.toggle("sel", c.checked);
      const n = all.filter(i => S.wip.sel.has(i.key)).length; $("#w-count").textContent = `${n} selezionate`; $("#w-exp-hint").textContent = n ? `Il .txt e “Copia” useranno le ${n} gare selezionate.` : `Nessuna selezione: il .txt e “Copia” useranno le ${visible().length} gare visibili.`; });

    // carico per Solution D&A (rispetta il filtro Tipo, non quello Solution)
    const base = all.filter(passTipo), per = new Map();
    base.forEach(i => (i.names.length ? i.names : [NOASS]).forEach(n => { const k = n.toLowerCase(); const o = per.get(k) || {n, d7: 0, d14: 0, tot: 0}; o.tot++; if (i.days !== null && i.days >= 0 && i.days <= 7) o.d7++; if (i.days !== null && i.days >= 0 && i.days <= 14) o.d14++; per.set(k, o); }));
    const rows = [...per.entries()].sort((a, b) => b[1].d7 - a[1].d7 || b[1].tot - a[1].tot || a[1].n.localeCompare(b[1].n, "it")), mx = Math.max(1, ...rows.map(r => r[1].tot));
    $("#w-load").innerHTML = `<h2>Carico per Solution D&amp;A</h2><div class="sub">Consegne nei prossimi 7 e 14 giorni, e totale WIP. Clicca un nome per filtrare.</div>` +
      (rows.map(([k, o]) => `<div class="lrow ${S.wip.sol.size === 1 && S.wip.sol.has(k) ? "on" : ""}" data-k="${esc(k)}"><div class="lname"><b>${esc(o.n)}</b><span>${o.d7} in 7 gg · ${o.d14} in 14 gg · ${o.tot} WIP</span></div>
        <div class="ltrack"><div class="lbar" style="width:${(100 * o.tot / mx).toFixed(1)}%"><i class="l7" style="width:${(100 * o.d7 / o.tot).toFixed(1)}%"></i><i class="l14" style="width:${(100 * (o.d14 - o.d7) / o.tot).toFixed(1)}%"></i></div></div></div>`).join("") || `<div class="empty">Nessun dato.</div>`) +
      `<div class="legend"><span><i style="background:var(--lost)"></i>entro 7 gg</span><span><i style="background:var(--waiting)"></i>8–14 gg</span><span><i style="background:var(--altro)"></i>altre WIP</span></div>`;
    $("#w-load").querySelectorAll(".lrow").forEach(r => r.onclick = () => { const k = r.dataset.k; if (S.wip.sol.size === 1 && S.wip.sol.has(k)) S.wip.sol.clear(); else S.wip.sol = new Set([k]); draw(); });
  };
  draw();
  $("#w-tipo").onchange = e => { S.wip.tipo = e.target.value; draw(); };
  $("#w-reset").onclick = () => { S.wip.sol.clear(); S.wip.tipo = ""; $("#w-tipo").value = ""; draw(); };
  $("#w-selweek").onclick = () => { visible().filter(i => i.band === "week").forEach(i => S.wip.sel.add(i.key)); selSave(S.wip.sel); draw(); };
  $("#w-selvis").onclick = () => { visible().forEach(i => S.wip.sel.add(i.key)); selSave(S.wip.sel); draw(); };
  $("#w-selnone").onclick = () => { S.wip.sel.clear(); selSave(S.wip.sel); draw(); };
  $("#w-txt").onclick = () => downloadText(wipText(exportItems(), ctx), ctx);
  $("#w-copy").onclick = () => copyText(wipText(exportItems(), ctx));
  $("#w-meet").onclick = () => openMeeting();
}

// vista riunione a schermo intero (solo righe selezionate)
function openMeeting() {
  const ctx = wipContext(), items = wipItems().filter(i => S.wip.sel.has(i.key));
  const el = document.createElement("div"); el.id = "meeting";
  const cnt = k => items.filter(i => i.band === k).length;
  const bands = WIP_BANDS.map(b => {
    const its = items.filter(i => i.band === b.k); if (!its.length) return "";
    const owners = new Map(); its.forEach(i => { const o = i.r["Solution D&A"] || NOASS; (owners.get(o) || owners.set(o, []).get(o)).push(i); });
    return `<section class="mt-band mb-${b.k}"><h2>${b.t} <em>${its.length}</em></h2>${b.note ? `<div class="mt-note">${b.note}</div>` : ""}` +
      [...owners.entries()].sort((a, b) => a[0].localeCompare(b[0], "it")).map(([o, g]) => `<h3>${esc(o)}</h3>` + g.map(i => `<div class="mt-item"><div class="mt-c"><b>${esc(i.r.Cliente)}</b><span>${esc(i.r.Oggetto)}</span></div>
        <div class="mt-m"><div><small>Owner</small>${esc(ownerOf(i))}</div><div><small>Consegna</small>${i.d ? fmtD(i.d) : "n.d."}</div><div><small>Giorni</small>${i.days === null ? "—" : `<span class="tag d-${i.band}">${dayText(i.days)}</span>`}</div><div><small>SS</small>${esc(i.r.SS || "n.d.")}</div></div></div>`).join("")).join("") + `</section>`;
  }).join("");
  el.innerHTML = `<div class="mt-bar"><button id="mt-exit">Esci (Esc)</button><span style="flex:1"></span><button id="mt-txt">Scarica .txt</button><button id="mt-copy">Copia negli appunti</button><button id="mt-print">Stampa</button></div>
    <div class="mt-page"><h1>Consegne WIP – settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)}</h1><div class="mt-gen">Generato il ${fmtD(ctx.today)}</div>
    ${items.length ? bands : `<p class="mt-empty">Nessuna gara selezionata. Torna indietro e spunta le gare da discutere.</p>`}
    <div class="mt-sum"><div><b>${items.length}</b><span>gare totali</span></div><div class="s-late"><b>${cnt("late")}</b><span>scadute</span></div><div class="s-week"><b>${cnt("week")}</b><span>questa settimana</span></div><div><b>${cnt("none")}</b><span>senza data</span></div></div></div>`;
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  const close = () => { el.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $("#mt-exit", el).onclick = close;
  $("#mt-txt", el).onclick = () => downloadText(wipText(items, ctx), ctx);
  $("#mt-copy", el).onclick = () => copyText(wipText(items, ctx));
  $("#mt-print", el).onclick = () => window.print();
}

// ------------------------------------------------------------ pulizia dati
async function renderClean(m) {
  m.innerHTML = `<div class="card"><h2>Pulizia dati</h2><div class="sub">Propone correzioni sul file Excel (stati uniformati, maiuscole come in Domini, date scritte come testo, clienti scritti in modi diversi). Nulla viene scritto finché non applichi; prima di scrivere viene fatta una copia di backup.</div>
    <button id="c-run" class="primary">Analizza il file</button><div id="c-out" style="margin-top:12px"></div></div>`;
  $("#c-run").onclick = async () => {
    const items = await api("/api/clean/preview"); S.clean = items; const out = $("#c-out");
    if (!items.length) { out.innerHTML = `<div class="empty">Non c'è niente da correggere.</div>`; return; }
    const kinds = [...new Set(items.map(i => i.kind))];
    out.innerHTML = kinds.map(k => { const its = items.map((it, idx) => [it, idx]).filter(([it]) => it.kind === k);
      return `<details open><summary>${esc(k)} <span class="cnt">(${its.length})</span></summary><table><thead><tr><th></th><th>Cliente</th><th>Campo</th><th>Ora</th><th>Diventa</th></tr></thead><tbody>${its.map(([it, idx]) =>
        `<tr><td><input type="checkbox" data-i="${idx}" ${it.default ? "checked" : ""} style="width:auto"></td><td>${esc(it.cliente)}</td><td>${esc(it.field)}</td><td>${esc(it.old)}</td><td><b>${esc(it.new)}</b></td></tr>`).join("")}</tbody></table></details>`; }).join("") +
      `<div class="foot"><span id="c-n" class="muted"></span><button id="c-apply" class="primary">Applica le correzioni selezionate</button></div>`;
    const upd = () => $("#c-n").textContent = out.querySelectorAll("input:checked").length + " selezionate";
    out.querySelectorAll("input").forEach(i => i.onchange = upd); upd();
    $("#c-apply").onclick = async () => {
      const sel = [...out.querySelectorAll("input:checked")].map(i => items[+i.dataset.i]); if (!sel.length) return;
      if (!confirm(`Applicare ${sel.length} correzioni al file Excel? (viene creato un backup)`)) return;
      try { const r = await withBusy(() => api("/api/clean/apply", {method: "POST", body: {items: sel}})); toast(`Fatto: ${r.modifiche} correzioni su ${r.righe} righe`); await loadAll(true); S.view = "clean"; render(); }
      catch (e) { toast(e.message, true); }
    };
  };
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
  const el = modal(`<h2>${edit ? "Modifica offerta" + (row.Seq ? " #" + row.Seq : "") : "Nuova offerta"}</h2>
  <div class="grid">
    <div class="full"><label class="req" for="f-Cliente">Cliente</label><input id="f-Cliente" list="dl-clienti" value="${esc(v.Cliente)}" autocomplete="off"><datalist id="dl-clienti">${d.clienti.map(c => `<option value="${esc(c.Cliente)}">`).join("")}</datalist></div>
    <div><label class="req" for="f-Vertical">Vertical</label>${sel("f-Vertical", d.vertical, v.Vertical, !edit ? false : false)}</div>
    <div><label class="req" for="f-Market">Market</label>${sel("f-Market", d.market, v.Market)}</div>
    ${ta("f-Oggetto", "Oggetto <span class='req'></span>", v.Oggetto)}
    <div><label class="req" for="f-tipo">Tipo</label>${sel("f-tipo", d.tipo, v.tipo)}</div>
    <div><label class="req" for="f-Stato">Stato</label>${sel("f-Stato", STATI, normStato(v.Stato) || v.Stato, true)}</div>
    ${inp("f-Data ins.", "Data ins. (apertura)", v["Data ins."], "", "date", true)}
    ${inp("f-Data consegna", "Data consegna", v["Data consegna"], "", "date")}
    <div class="full"><label for="f-Solution D&A">Solution D&amp;A (testo libero, più nomi separati da / )</label><input id="f-Solution D&A" list="dl-sol" value="${esc(v["Solution D&A"])}" autocomplete="off"><datalist id="dl-sol">${d.solutions.map(s => `<option value="${esc(s)}">`).join("")}</datalist><div class="hint" id="h-sol"></div></div>
    <div><label for="f-SS">Codice SS</label><input id="f-SS" value="${esc(v.SS)}"><div class="hint" id="h-ss"></div></div>
    <div><label for="f-Commessa">Commessa</label><input id="f-Commessa" value="${esc(v.Commessa)}"><div class="hint" id="h-com"></div></div>
  </div>
  <details style="margin-top:10px"><summary>Altri campi</summary><div class="grid" style="margin-top:8px">
    ${inp("f-Legal Entity", "Legal Entity", v["Legal Entity"])}${inp("f-Salesman", "Salesman", v.Salesman)}
    ${inp("f-Data Opt review", "Data Opt review", v["Data Opt review"], "", "date")}${inp("f-Referenti vertical", "Referenti vertical", v["Referenti vertical"])}
    ${ta("f-Tecnologie di riferimento D&A", "Tecnologie di riferimento D&A", v["Tecnologie di riferimento D&A"])}${ta("f-Note", "Note", v.Note)}</div></details>
  <div class="err" id="f-err"></div>
  <div class="foot"><button id="f-cancel">Annulla</button><button id="f-save" class="primary">${edit ? "Salva modifiche" : "Aggiungi all'Excel"}</button></div>`);
  const F_ = id => el.querySelector(`[id="f-${id}"]`);
  const g = id => (F_(id) || {}).value ?? "";
  const dirty = {SS: edit, Commessa: edit};
  ["SS", "Commessa"].forEach(k => F_(k).oninput = () => dirty[k] = true);
  const hintSol = () => { const s = g("Solution D&A").trim(); $("#h-sol", el).textContent = s ? "" : "Senza Solution D&A la riga comparirà nei punti di attenzione."; $("#h-sol", el).className = "hint warn"; };
  F_("Solution D&A").oninput = hintSol; hintSol();
  let tmr;
  const suggest = async () => {
    if (edit || !g("Cliente").trim()) return;
    try {
      const s = await api("/api/suggest", {method: "POST", body: {Cliente: g("Cliente"), Vertical: g("Vertical"), "Data consegna": g("Data consegna"), "Data ins.": g("Data ins.")}});
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
  F_("Cliente").focus();
  $("#f-save", el).onclick = async () => {
    const F = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Stato", "Data ins.", "Data consegna", "Solution D&A", "SS", "Commessa", "Legal Entity", "Salesman", "Data Opt review", "Referenti vertical", "Tecnologie di riferimento D&A", "Note"];
    const vals = {}; F.forEach(f => vals[f] = g(f).trim() || null);
    const err = $("#f-err", el); err.textContent = "";
    const miss = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Data ins.", "Stato"].filter(f => !vals[f]);
    if (miss.length) { err.textContent = "Campi obbligatori mancanti: " + miss.join(", "); return; }
    const send = async force => {
      if (edit) { const ch = {}; F.forEach(f => { if ((vals[f] || null) !== (row[f] || null)) ch[f] = vals[f]; }); if (!Object.keys(ch).length) { closeModal(); return; }
        await withBusy(() => api("/api/rows/" + row._row, {method: "PUT", body: {sig: row._sig, changes: ch}})); toast("Modifiche salvate nell'Excel"); }
      else { await withBusy(() => api("/api/rows", {method: "POST", body: {...vals, _force: force}})); toast("Offerta aggiunta all'Excel"); }
      closeModal(); await loadAll(true);
    };
    try { await send(false); }
    catch (e) { if (e.body && e.body.duplicato) { if (confirm(e.message)) { try { await send(true); } catch (e2) { err.textContent = e2.message; } } } else err.textContent = e.message; }
  };
}

// ------------------------------------------------------------ impostazioni
function openSettings(first, msg) {
  const el = modal(`<h2>${first ? "Benvenuto — scegli il file Excel" : "Impostazioni"}</h2>
    <p class="muted">Indica il file Excel (quello con il foglio “gare e offerte” e il foglio “Domini”). Se il file è in SharePoint usa la copia sincronizzata sul tuo PC.</p>
    <label for="s-path">Percorso del file</label><div class="row"><input id="s-path" style="flex:1" value="${esc(S.state && S.state.path || "")}" placeholder="C:\\Users\\…\\HISTORY.xlsx"><button id="s-browse">Sfoglia…</button></div>
    <div class="err" id="s-err">${esc(msg || "")}</div>
    <div class="foot">${first ? "" : '<button id="s-cancel">Chiudi</button>'}<button id="s-save" class="primary">Salva e carica</button></div>
    <p class="hint">I backup prima di ogni scrittura vengono salvati nella cartella “backup” accanto all'app.</p>`);
  modal.locked = !!first;
  const c = $("#s-cancel", el); if (c) c.onclick = closeModal;
  $("#s-browse", el).onclick = async () => { try { const r = await api("/api/browse", {method: "POST"}); if (r.path) $("#s-path", el).value = r.path; } catch (e) { $("#s-err", el).textContent = e.message; } };
  $("#s-save", el).onclick = async () => {
    try { await withBusy(() => api("/api/config", {method: "POST", body: {excel_path: $("#s-path", el).value}})); closeModal(); await loadAll(true); }
    catch (e) { $("#s-err", el).textContent = e.message; }
  };
}

// ------------------------------------------------------------ avvio
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => { S.view = b.dataset.view; if (!S.data) return; if (S.view === "table") S.filt = {q: "", stato: "", vertical: "", solution: "", anno: ""}; render(); });
$("#btn-new").onclick = () => S.data ? openForm(null) : toast("Prima scegli il file Excel", true);
$("#btn-reload").onclick = async () => { await loadAll(true); toast("File riletto"); };
$("#btn-settings").onclick = () => openSettings(false);
hydrateIcons();
loadAll(false);
