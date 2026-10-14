"use strict";
const STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID"];
const BCLASS = {"WIP": "WIP", "Waiting For response": "Waiting", "Sospeso": "Sospeso", "Won": "Won", "Lost": "Lost", "NoBID": "NoBID"};
const COLOR = {"WIP": "var(--wip)", "Waiting For response": "var(--waiting)", "Sospeso": "var(--sospeso)", "Won": "var(--won)", "Lost": "var(--lost)", "NoBID": "var(--nobid)", "Altro": "var(--altro)"};
const S = {data: null, dash: null, view: "dash", months: "12", trendMode: "inserite",
  filt: {q: "", stato: "", vertical: "", solution: "", anno: ""}, sort: {k: "Data ins.", dir: -1},
  kanban: {months: "12", solution: ""}, clean: null, state: null};

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v10"/>',
  kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
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
const TITLES = {dash: ["Cruscotto", "Scadenze, attenzioni e andamento delle offerte"], table: ["Tabella", "Tutte le offerte: filtra, ordina, clicca una riga per modificarla"], kanban: ["Schede", "Offerte per stato: trascina una scheda per cambiare stato"], clean: ["Pulizia dati", "Uniforma gli stati e correggi i dati nel file Excel"]};
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
  ({dash: renderDash, table: renderTable, kanban: renderKanban, clean: renderClean})[S.view](m);
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

// ------------------------------------------------------------ schede (kanban)
function renderKanban(m) {
  const K = S.kanban, today = S.dash.oggi;
  const cutoff = K.months === "all" ? "" : (() => { const d = new Date(today); d.setMonth(d.getMonth() - (+K.months - 1), 1); return d.toISOString().slice(0, 10); })();
  const rows = S.data.rows.filter(r => {
    const s = normStato(r.Stato);
    if (s !== "WIP" && cutoff && r["Data ins."] && r["Data ins."] < cutoff) return false;
    if (K.solution && !(K.solution === "(non assegnata)" ? !splitSol(r["Solution D&A"]).length : splitSol(r["Solution D&A"]).some(x => x.toLowerCase() === K.solution.toLowerCase()))) return false;
    return true;
  });
  m.innerHTML = `<div class="toolbar"><div><label>Periodo</label><select id="k-m">${[["6", "Ultimi 6 mesi"], ["12", "Ultimi 12 mesi"], ["24", "Ultimi 24 mesi"], ["all", "Tutto"]].map(([v, l]) => `<option value="${v}" ${K.months === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div><label>Solution</label><select id="k-s"><option value="">Tutte</option>${["(non assegnata)", ...S.data.domini.solutions].map(x => `<option ${x === K.solution ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
    <div class="muted" style="padding-bottom:8px">Trascina una scheda in un'altra colonna per cambiare lo stato. WIP: sempre tutte.</div></div>
    <div class="kanban">${STATI.map(s => { const rs = rows.filter(r => normStato(r.Stato) === s).sort((a, b) => (b["Data ins."] || "").localeCompare(a["Data ins."] || ""));
      return `<div class="kcol" data-st="${s}"><h3>${badge(s)} <span class="muted">${rs.length}</span></h3><div class="kcards">${rs.map(r => {
        let tag = ""; if (s === "WIP" && r["Data consegna"]) { const g = Math.round((new Date(r["Data consegna"]) - new Date(today)) / 864e5); if (g <= 7) tag = dayLabel(g); }
        if (s === "Waiting For response" && r["Data ins."]) { const g = Math.round((new Date(today) - new Date(r["Data ins."])) / 864e5); if (g >= 30) tag = `<span class="tag soon">${g} gg</span>`; }
        return `<div class="kcard" draggable="true" data-row="${r._row}" style="border-left-color:${COLOR[s]}"><b>${esc(r.Cliente)}</b><span class="o">${esc(r.Oggetto)}</span><div class="m"><span>${esc(r["Solution D&A"] || "—")}</span><span>${fmt(r["Data consegna"] || r["Data ins."])}</span>${tag}</div></div>`; }).join("")}</div></div>`; }).join("")}</div>`;
  $("#k-m").onchange = e => { K.months = e.target.value; renderKanban(m); };
  $("#k-s").onchange = e => { K.solution = e.target.value; renderKanban(m); };
  m.querySelectorAll(".kcard").forEach(c => { c.onclick = () => openForm(rowByNum(+c.dataset.row)); c.ondragstart = e => e.dataTransfer.setData("text/plain", c.dataset.row); });
  m.querySelectorAll(".kcol").forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = async e => { e.preventDefault(); col.classList.remove("over");
      const r = rowByNum(+e.dataTransfer.getData("text/plain")); if (!r || normStato(r.Stato) === col.dataset.st) return;
      try { await withBusy(() => api("/api/rows/" + r._row, {method: "PUT", body: {sig: r._sig, changes: {Stato: col.dataset.st}}})); toast(`${r.Cliente}: ${col.dataset.st}`); await loadAll(true); }
      catch (err) { toast(err.message, true); } };
  });
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
