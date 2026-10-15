"use strict";
const STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID", "Closed"];
const BCLASS = {"WIP": "WIP", "Waiting For response": "Waiting", "Sospeso": "Sospeso", "Won": "Won", "Lost": "Lost", "NoBID": "NoBID", "Closed": "Closed"};
const COLOR = {"WIP": "var(--st-wip)", "Waiting For response": "var(--st-waiting)", "Sospeso": "var(--st-sospeso)", "Won": "var(--st-won)", "Lost": "var(--st-lost)", "NoBID": "var(--st-nobid)", "Closed": "var(--st-closed)", "Altro": "var(--st-altro)"};
const STATO_COL = {"WIP": "s-WIP", "Waiting For response": "s-Waiting", "Won": "s-Won", "Lost": "s-Lost", "NoBID": "s-NoBID", "Sospeso": "s-Sospeso", "Closed": "s-Closed", "Altro": "s-Altro"};
const S = {data: null, dash: null, view: "dash", months: "12", trendSeries: "inserite", trendCum: true, pipeBy: "market",
  filt: {q: "", stato: "", vertical: "", market: "", solution: "", anno: ""}, sort: {k: "Data ins.", dir: -1}, clean: null, state: null};
const EMPTY_FILT = () => ({q: "", stato: "", vertical: "", market: "", tipo: "", solution: "", anno: "", rows: null, rowsLabel: ""});

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
  const name = S.state.path.split(/[\\/]/).pop(), hh = (S.data.loaded || "").slice(11, 16);
  $("#status").innerHTML = `${esc(name)}<br>${S.data.rows.length} righe · letto alle ${esc(hh)}`;
  $("#file-box").title = `${name}\n${S.data.rows.length} righe · letto alle ${hh}`;
  $("#file-dot").classList.add("ok");
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
const legendItem = s => `<span><i style="background:${COLOR[s]}"></i>${s === "Altro" ? "Sospeso / NoBID / Closed" : s === "Waiting For response" ? "Waiting" : s}</span>`;

function hbars(groups) {
  if (!groups.length) return `<div class="empty">Nessun dato.</div>`;
  const mx = Math.max(...groups.map(g => g.totale)), segs = ["WIP", "Waiting For response", "Won", "Lost", "Altro"];
  return `<div class="hb">${groups.map(g => `<div class="hn cl" title="${esc(g.nome)}" data-grp="${esc(g.nome)}">${esc(g.nome)}</div><div class="hbwrap"><div class="hbar" style="width:${(100 * g.totale / mx).toFixed(1)}%">${segs.map(s => g[s] ?
    `<i class="${STATO_COL[s]}" style="width:${(100 * g[s] / g.totale).toFixed(2)}%" data-grp="${esc(g.nome)}" data-st="${s}" title="${esc(g.nome)} · ${s === "Altro" ? "Sospeso / NoBID / Closed" : s}: ${g[s]}">${g[s] / mx >= .06 ? g[s] : ""}</i>` : "").join("")}</div><span class="ht-n">${g.totale}</span></div>`).join("")}</div>
    <div class="legend">${segs.map(legendItem).join("")}</div>`;
}
const ESITO_SEGS = ["Won", "Lost", "NoBID", "Waiting For response", "WIP", "Sospeso", "Closed"];
function esitoRows(list, minChiuse) {
  if (!list.length) return `<div class="empty">Nessuna offerta nel periodo.</div>`;
  const mx = Math.max(...list.map(g => g.totale));
  return `<div class="eb">${list.map(g => `<div class="hn cl" title="${esc(g.nome)}" data-tipo="${esc(g.nome)}">${esc(g.nome)}</div><div class="hbwrap"><div class="hbar" style="width:${(100 * g.totale / mx).toFixed(1)}%">${ESITO_SEGS.map(s => g[s] ?
    `<i class="${STATO_COL[s]}" style="width:${(100 * g[s] / g.totale).toFixed(2)}%" data-tipo="${esc(g.nome)}" data-st="${s}" title="${esc(g.nome)} · ${s}: ${g[s]}">${g[s] / mx >= .06 ? g[s] : ""}</i>` : "").join("")}</div><span class="ht-n">${g.totale}</span></div>
    <div class="erate">${g.rate === null ? `<b class="nil">—</b><span>pochi dati</span>` : `<b>${Math.round(g.rate * 100)}%</b><span>${g.Won} su ${g.chiuse} chiuse</span>`}</div>`).join("")}</div>
    <div class="legend">${ESITO_SEGS.map(legendItem).join("")}</div><div class="hint">Win rate = Won / (Won + Lost); mostrato solo con almeno ${minChiuse} offerte chiuse. Closed non rientra nel calcolo.</div>`;
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
    <div class="fbar-r">Il periodo vale solo per Pipeline per Market ed Esito per tipo</div></div>
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
    <button class="apill" data-scroll="sec-att"><i style="background:var(--accent)"></i><b>${pl.attenzioni}</b> punti di attenzione</button>
  </div>
  <div class="g12">
    <div class="card c8"><div class="card-h"><div><h2>Trend anno su anno</h2><div class="sub">${k.anno} contro ${k.prec}, per mese di Data ins.</div></div>
      <div class="row"><div class="seg"><button data-ts="inserite" class="${S.trendSeries === "inserite" ? "on" : ""}">Inserite</button><button data-ts="won" class="${S.trendSeries === "won" ? "on" : ""}">Won</button></div>
      <div class="seg"><button data-tc="0" class="${S.trendCum ? "" : "on"}">Mensile</button><button data-tc="1" class="${S.trendCum ? "on" : ""}">Cumulato</button></div></div></div>
      <div id="yoy" class="yoy"></div></div>
    <div class="card c4"><h2>Età delle offerte in attesa</h2><div class="sub">Quanto aspettiamo una risposta</div>${etaCard(d.eta_attesa)}</div>
  </div>
  <div class="g12">
    <div class="card c7"><div class="card-h"><div><h2>Pipeline per ${S.pipeBy === "market" ? "Market" : "Vertical"}</h2><div class="sub">Numero di offerte per stato. Clicca una barra per vedere l'elenco.</div></div>
      <div class="seg"><button data-pb="market" class="${S.pipeBy === "market" ? "on" : ""}">Market</button><button data-pb="vertical" class="${S.pipeBy === "vertical" ? "on" : ""}">Vertical</button></div></div>
      ${hbars(pb)}</div>
    <div class="card c5"><h2>Esito per tipo</h2><div class="sub">Offerte per stato e win rate del tipo, nel periodo scelto.</div>${esitoRows(d.esito_tipo, so.min_chiuse)}</div>
  </div>
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
  m.querySelectorAll(".hb [data-grp]").forEach(c => c.onclick = () => goTable({[S.pipeBy]: c.dataset.grp, stato: c.dataset.st && c.dataset.st !== "Altro" ? c.dataset.st : ""}));
  m.querySelectorAll(".eb [data-tipo]").forEach(c => c.onclick = () => goTable({tipo: c.dataset.tipo === "Altro" ? "__altro" : c.dataset.tipo, stato: c.dataset.st || ""}));
  m.querySelectorAll("[data-age]").forEach(c => c.onclick = () => { const f = d.eta_attesa.fasce.find(x => x.k === c.dataset.age); goTable({rows: f.rows, rowsLabel: `In attesa ${f.label} (${f.n})`}); });
  m.querySelectorAll("[data-pb]").forEach(b => b.onclick = () => { S.pipeBy = b.dataset.pb; render(); });
  m.querySelectorAll("[data-ts]").forEach(b => b.onclick = () => { S.trendSeries = b.dataset.ts; render(); });
  m.querySelectorAll("[data-tc]").forEach(b => b.onclick = () => { S.trendCum = b.dataset.tc === "1"; render(); });
  drawYoy($("#yoy"), t);
}

// grafico a linee anno corrente vs anno precedente (12 mesi)
function drawYoy(el, t) {
  const W = 760, H = 310, L = 42, R = 92, T = 18, B = 32, N = 12, m = t.mese, ser = t[S.trendSeries];
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
  "Seq": r => `<td>${esc(r.Seq)}</td>`,
  "Cliente": r => `<td class="cl">${orNil(r.Cliente)}</td>`,
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
    <div><label for="f-anno">Anno (Data ins.)</label><select id="f-anno">${optionsHtml(anni, f.anno)}</select></div>
    <div class="fbar-r"><span id="f-count"></span>
      <details class="ms cols-menu"><summary style="min-width:0">${ico("columns-3")}Colonne</summary><div class="ms-list" style="right:0;left:auto;min-width:200px">${COLDEFS.map(c => `<label class="ms-i"><input type="checkbox" data-col="${esc(c.k)}" ${S.cols.has(c.k) ? "checked" : ""}> ${esc(c.l)}</label>`).join("")}</div></details></div></div>
  <div id="f-chips"></div>
  <div class="card tablecard"><table class="dt"><thead id="th"></thead><tbody id="tb"></tbody></table></div>`;
  const LABEL = {q: v => `Cerca: ${v}`, stato: v => `Stato: ${v}`, tipo: v => `Tipo: ${v === "__altro" ? "Altro" : v}`, rows: () => f.rowsLabel || "Selezione", market: v => `Market: ${v}`, vertical: v => `Vertical: ${v}`, solution: v => `Solution: ${v}`, anno: v => `Anno: ${v}`};
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
  bind("#f-q", "q"); bind("#f-stato", "stato"); bind("#f-tipo", "tipo"); bind("#f-market", "market"); bind("#f-vertical", "vertical"); bind("#f-solution", "solution"); bind("#f-anno", "anno");
  m.querySelectorAll("[data-col]").forEach(c => c.onchange = () => { c.checked ? S.cols.add(c.dataset.col) : S.cols.delete(c.dataset.col); colsSave(); draw(); });
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
S.wip = {sol: new Set(), tipo: "", market: "", band: "", sel: selLoad(), collapsed: {}};
function goWip(f) { S.wip.sol = new Set(); S.wip.tipo = ""; S.wip.market = ""; S.wip.band = f.band || ""; S.view = "wip"; render(); }
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
    return {r, key: String(r.Seq), d, days, band, names: splitSol(r["Solution D&A"]), market: r.Market || NOIND};
  }).sort((a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity) || String(a.r.Cliente).localeCompare(String(b.r.Cliente), "it"));
}
const passTipo = it => !S.wip.tipo || it.r.tipo === S.wip.tipo;
const passSol = it => !S.wip.sol.size || (it.names.length ? it.names.some(n => S.wip.sol.has(n.toLowerCase())) : S.wip.sol.has(NOASS.toLowerCase()));
const passMarket = it => !S.wip.market || it.market === S.wip.market;
const passBand = it => !S.wip.band || (S.wip.band === "late" ? it.band === "late" : it.days !== null && it.days >= 0 && it.days <= 7);
const BAND_LABEL = {late: "Consegne scadute", d7: "Consegne entro 7 giorni"};
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
  const solName = k => (solOpts.find(o => o[0] === k) || [k, k])[1];
  $("#page-sub").textContent = `Oggi ${fmtD(ctx.today)} · ${all.length} offerte in WIP`;

  m.innerHTML = `
  <div class="fbar">
    <div><label>Solution D&amp;A</label><details class="ms" id="w-ms"><summary id="w-ms-s"></summary><div class="ms-list" id="w-ms-l"></div></details></div>
    <div><label for="w-tipo">Tipo</label><select id="w-tipo">${optionsHtml(tipi, S.wip.tipo)}</select></div>
    <div class="fbar-r">Settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)} · sola lettura</div>
  </div>
  <div id="w-chips"></div>
  <div class="card wbar">
    <div class="row">
      <button id="w-selweek">Seleziona questa settimana</button><button id="w-selvis">Seleziona le visibili</button><button id="w-selnone">Deseleziona tutto</button>
      <span class="wcount" id="w-count"></span>
      <span style="margin-left:auto" class="row"><button id="w-meet" class="primary">${ico("calendar-clock")}Vista riunione</button><button id="w-txt">Scarica .txt</button><button id="w-copy">Copia negli appunti</button></span>
    </div>
    <div class="hint" id="w-exp-hint"></div>
  </div>
  <div class="wgrid"><div id="w-list"></div><aside class="card wload" id="w-load"></aside></div>`;

  const visible = () => all.filter(i => passTipo(i) && passSol(i) && passMarket(i) && passBand(i));
  const exportItems = () => { const s = all.filter(i => S.wip.sel.has(i.key)); return s.length ? s : visible(); };
  const counters = () => {
    const n = all.filter(i => S.wip.sel.has(i.key)).length;
    $("#w-count").textContent = `${n} selezionate`;
    $("#w-exp-hint").textContent = n ? `Il .txt e “Copia” useranno le ${n} gare selezionate.` : `Nessuna selezione: il .txt e “Copia” useranno le ${visible().length} gare visibili.`;
  };
  const drawMs = () => {
    $("#w-ms-s").textContent = S.wip.sol.size ? `${S.wip.sol.size} selezionat${S.wip.sol.size === 1 ? "a" : "e"}` : "Tutte";
    $("#w-ms-l").innerHTML = solOpts.map(([k, n]) => `<label class="ms-i"><input type="checkbox" data-k="${esc(k)}" ${S.wip.sol.has(k) ? "checked" : ""}> ${esc(n)}</label>`).join("") || `<div class="muted">Nessuna</div>`;
    $("#w-ms-l").querySelectorAll("input").forEach(c => c.onchange = () => { c.checked ? S.wip.sol.add(c.dataset.k) : S.wip.sol.delete(c.dataset.k); draw(); });
  };
  const drawChips = () => {
    const items = [...[...S.wip.sol].map(k => ({id: "s:" + k, label: "Solution: " + solName(k)})), ...(S.wip.tipo ? [{id: "t", label: "Tipo: " + S.wip.tipo}] : []), ...(S.wip.market ? [{id: "m", label: "Market: " + S.wip.market}] : []), ...(S.wip.band ? [{id: "b", label: BAND_LABEL[S.wip.band]}] : [])];
    const box = $("#w-chips"); box.innerHTML = chipsHtml(items);
    bindChips(box, id => { if (id === "t") { S.wip.tipo = ""; $("#w-tipo").value = ""; } else if (id === "m") S.wip.market = ""; else if (id === "b") S.wip.band = ""; else S.wip.sol.delete(id.slice(2)); draw(); },
      () => { S.wip.sol.clear(); S.wip.tipo = ""; S.wip.market = ""; S.wip.band = ""; $("#w-tipo").value = ""; draw(); });
  };
  const draw = () => {
    drawMs(); drawChips(); counters();
    const vis = visible();
    $("#w-list").innerHTML = WIP_BANDS.map(b => {
      const its = vis.filter(i => i.band === b.k); if (!its.length) return "";
      return `<details class="card band band-${b.k}" data-b="${b.k}" ${S.wip.collapsed[b.k] ? "" : "open"}><summary><span>${b.t}</span><span class="bc">${its.length}</span>${b.note ? `<span class="bn">${b.note}</span>` : ""}</summary>
      <div class="wlist">${its.map(i => `<div class="wrow ${S.wip.sel.has(i.key) ? "sel" : ""}"><label class="wchk"><input type="checkbox" data-key="${esc(i.key)}" ${S.wip.sel.has(i.key) ? "checked" : ""} aria-label="Seleziona ${esc(i.r.Cliente)}"></label>
        <div class="wmain"><b>${esc(i.r.Cliente)}</b><span>${esc(i.r.Oggetto)}</span></div><div class="wtipo">${tipoChip(i.r.tipo)}</div><div class="wsol">${orNil(i.r["Solution D&A"])}</div>
        <div class="wss">${orNil(i.r.SS)}</div><div class="wdate">${i.d ? fmtD(i.d) : nil()} ${dayBadge(i.days, i.band)}</div></div>`).join("")}</div></details>`;
    }).join("") || `<div class="card empty">Nessuna offerta WIP con questi filtri.</div>`;
    $("#w-list").querySelectorAll("details.band").forEach(d => d.ontoggle = () => S.wip.collapsed[d.dataset.b] = !d.open);
    $("#w-list").querySelectorAll(".wchk input").forEach(c => c.onchange = () => { c.checked ? S.wip.sel.add(c.dataset.key) : S.wip.sel.delete(c.dataset.key); selSave(S.wip.sel); c.closest(".wrow").classList.toggle("sel", c.checked); counters(); });

    // consegne per Market (rispetta i filtri Tipo e Solution, non quello Market)
    const base = all.filter(i => passTipo(i) && passSol(i)), per = new Map();
    base.forEach(i => { const o = per.get(i.market) || {n: i.market, d7: 0, d14: 0, tot: 0}; o.tot++; if (i.days !== null && i.days >= 0 && i.days <= 7) o.d7++; if (i.days !== null && i.days >= 0 && i.days <= 14) o.d14++; per.set(i.market, o); });
    const rows = [...per.values()].sort((a, b) => b.d7 - a.d7 || b.tot - a.tot || a.n.localeCompare(b.n, "it")), mx = Math.max(1, ...rows.map(r => r.tot));
    $("#w-load").innerHTML = `<h2>Consegne per Market</h2><div class="sub">Consegne nei prossimi 7 e 14 giorni, e totale WIP. Clicca un Market per filtrare.</div>` +
      (rows.map(o => `<div class="lrow ${S.wip.market === o.n ? "on" : ""}" data-m="${esc(o.n)}"><div class="lname"><b>${esc(o.n)}</b><span>${o.d7} in 7 gg · ${o.d14} in 14 gg · ${o.tot} WIP</span></div>
        <div class="ltrack"><div class="lbar" style="width:${(100 * o.tot / mx).toFixed(1)}%"><i class="l7" style="width:${(100 * o.d7 / o.tot).toFixed(1)}%"></i><i class="l14" style="width:${(100 * (o.d14 - o.d7) / o.tot).toFixed(1)}%"></i></div></div></div>`).join("") || `<div class="empty">Nessun dato.</div>`) +
      `<div class="legend"><span><i style="background:var(--chart-main)"></i>entro 7 gg</span><span><i style="background:var(--chart-2)"></i>8–14 gg</span><span><i style="background:var(--chart-3)"></i>altre WIP</span></div>`;
    $("#w-load").querySelectorAll(".lrow").forEach(r => r.onclick = () => { S.wip.market = S.wip.market === r.dataset.m ? "" : r.dataset.m; draw(); });
  };
  draw();
  $("#w-tipo").onchange = e => { S.wip.tipo = e.target.value; draw(); };
  $("#w-selweek").onclick = () => { visible().filter(i => i.band === "week").forEach(i => S.wip.sel.add(i.key)); selSave(S.wip.sel); draw(); };
  $("#w-selvis").onclick = () => { visible().forEach(i => S.wip.sel.add(i.key)); selSave(S.wip.sel); draw(); };
  $("#w-selnone").onclick = () => { S.wip.sel.clear(); selSave(S.wip.sel); draw(); };
  $("#w-txt").onclick = () => downloadText(wipText(exportItems(), ctx), ctx);
  $("#w-copy").onclick = () => copyText(wipText(exportItems(), ctx));
  $("#w-meet").onclick = () => openMeeting();
}

// vista riunione a schermo intero (tema chiaro, solo righe selezionate)
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
  el.innerHTML = `<div class="mt-bar"><button id="mt-exit">${ico("x")}Esci (Esc)</button><span style="flex:1"></span><button id="mt-txt">Scarica .txt</button><button id="mt-copy">Copia negli appunti</button><button id="mt-print">Stampa</button></div>
    <div class="mt-page"><div class="mt-head"><h1>Consegne WIP – settimana dal ${fmtD(ctx.monday)} al ${fmtD(ctx.sunday)}</h1><div class="mt-gen">Generato il ${fmtD(ctx.today)}</div></div>
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
  m.innerHTML = `<div class="card" style="margin-bottom:var(--gap)"><h2>Valori normalizzati in lettura</h2><div class="sub">L'app legge Stato e Market ignorando maiuscole e spazi, senza toccare il file. Qui vedi cosa viene unificato e quante righe riguarda.</div><div id="c-sum"><div class="muted">Caricamento…</div></div></div>
    <div class="card"><h2>Pulizia dati</h2><div class="sub">Propone correzioni sul file Excel (stati uniformati, maiuscole come in Domini, date scritte come testo, clienti scritti in modi diversi). Nulla viene scritto finché non applichi; prima di scrivere viene fatta una copia di backup.</div>
    <button id="c-run" class="primary">Analizza il file</button><div id="c-out" style="margin-top:12px"></div></div>`;
  api("/api/clean/summary").then(list => {
    $("#c-sum").innerHTML = list.length ? `<div class="tscroll"><table><thead><tr><th>Campo</th><th>Valore nel file</th><th>Letto come</th><th class="num">Righe</th><th>Nel file</th></tr></thead><tbody>${list.map(x =>
      `<tr><td>${esc(x.campo)}</td><td>${esc(x.da)}</td><td><b>${esc(x.a)}</b></td><td class="num">${num(x.righe)}</td><td class="muted">${x.scrivibile ? "correggibile con la pulizia qui sotto" : "solo in lettura (cella vuota)"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Tutti i valori sono già nella forma standard.</div>`;
  }).catch(e => { $("#c-sum").innerHTML = `<div class="err">${esc(e.message)}</div>`; });
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


// ------------------------------------------------------------ barra laterale (compatta, si espande al passaggio del mouse; si può fissare)
const PIN_KEY = "gare.side.pinned";
function setPinned(v, save = true) {
  document.body.classList.toggle("pinned", v);
  const b = $("#btn-pin"); b.setAttribute("aria-pressed", v); b.title = v ? "Sblocca la barra" : "Fissa la barra aperta";
  b.querySelector(".lbl").textContent = v ? "Sblocca barra" : "Fissa barra"; b.querySelector("svg").outerHTML = ico(v ? "pin-off" : "pin");
  if (save) { try { localStorage.setItem(PIN_KEY, v ? "1" : "0"); } catch (e) {} }
}

// ------------------------------------------------------------ avvio
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => { S.view = b.dataset.view; if (!S.data) return; if (S.view === "table") S.filt = EMPTY_FILT(); render(); });
$("#btn-new").onclick = () => S.data ? openForm(null) : toast("Prima scegli il file Excel", true);
$("#btn-reload").onclick = async () => { await loadAll(true); toast("File riletto"); };
$("#btn-settings").onclick = () => openSettings(false);
$("#btn-pin").onclick = () => setPinned(!document.body.classList.contains("pinned"));
hydrateIcons();
try { setPinned(localStorage.getItem(PIN_KEY) === "1", false); } catch (e) {}
loadAll(false);
