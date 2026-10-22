/* Referenze — importazione da Excel e importazione di schede JSON (con unione).
   Caricato SOLO quando si preme "Importa…" (vedi caricaModuloDati() in referenze.js). */
(function () {
  "use strict";
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ETICHETTE = {cliente: "Cliente", titolo: "Titolo", titolo_excel: "Titolo (Excel originale)", ambito: "Ambito", tipologie: "Tipologie", mercato: "Mercato", segmento: "Segmento", anno: "Anno", temi: "Temi",
    tecnologie: "Tecnologie", pitch: "Racconto 30 secondi", esteso: "Racconto esteso", fonti: "Fonti", documenti: "Documenti", confidenza: "Confidenza", materiale: "Materiale", da_verificare: "Da verificare",
    note: "Note", descrizione_excel: "Descrizione (Excel)", tecnologie_excel: "Tecnologie (Excel)", referente_aidata: "Referente AI&Data", referente_mercato: "Referente mercato", referente_progetto: "Referente progetto", owner: "Owner", archiviata: "Archiviata"};
  const LISTE = ["tipologie", "temi", "tecnologie", "fonti", "documenti"];
  const CAMPI_UNIONE = ["cliente", "titolo", "titolo_excel", "ambito", "tipologie", "mercato", "segmento", "anno", "temi", "tecnologie", "pitch", "esteso", "fonti", "documenti", "confidenza", "materiale",
    "da_verificare", "note", "descrizione_excel", "tecnologie_excel", "referente_aidata", "referente_mercato", "referente_progetto", "owner"];

  const estesoTesto = es => (es || []).map(s => `## ${s.sezione}\n${Array.isArray(s.testo) ? s.testo.map(x => "• " + x).join("\n") : s.testo}`).join("\n\n");
  const valoreTesto = v => v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? (v.length && typeof v[0] === "object" ? estesoTesto(v) : v.join(" ; ") || "—") : typeof v === "boolean" ? (v ? "Sì" : "No") : String(v);
  const vuoto = v => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || v === false;
  const uguali = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
  const cella = v => { const t = valoreTesto(v); return `<td class="rf-val" title="${E(t)}">${E(t.length > 260 ? t.slice(0, 260) + "…" : t)}</td>`; };

  function finestra(titolo, corpo, piede) {
    const ov = document.createElement("div"); ov.className = "rf-ov";
    ov.innerHTML = `<div class="rf-dlg" role="dialog" aria-modal="true" aria-label="${E(titolo)}"><header class="rf-dh"><div><h2>${E(titolo)}</h2></div><button class="rf-x" aria-label="Chiudi">×</button></header>
      <div class="rf-db">${corpo}</div><footer class="rf-df"><div class="rf-row"></div><div class="rf-row">${piede}</div></footer></div>`;
    document.body.appendChild(ov); document.body.style.overflow = "hidden";
    const chiudi = () => { ov.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") chiudi(); };
    document.addEventListener("keydown", esc);
    ov.querySelector(".rf-x").onclick = chiudi;
    return {ov, chiudi, q: s => ov.querySelector(s), qa: s => ov.querySelectorAll(s)};
  }
  async function inviaFile(url, file) {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch(url, {method: "POST", body: fd});
    if (r.status === 401) { location.href = "/login"; throw new Error("Accesso richiesto"); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  // ================================================================ Importa da Excel
  function importaExcel(ctx) {
    const W = finestra("Importa da Excel", `<p class="rf-muted">Scegli un file nel formato dell'esportazione (usa “Esporta in Excel” come modello).
      Una riga con <b>ID esistente</b> aggiorna quella referenza, una riga <b>senza ID</b> ne crea una nuova. Prima di scrivere vedi un'anteprima.</p>
      <input type="file" id="rf-xf" accept=".xlsx,.xlsm"><div class="rf-err" id="rf-xe"></div><div id="rf-xp"></div>`,
      `<button id="rf-xa">Annulla</button><button class="primary" id="rf-xg" disabled>Applica</button>`);
    W.q("#rf-xa").onclick = W.chiudi;
    let token = null;
    W.q("#rf-xf").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      W.q("#rf-xe").textContent = ""; W.q("#rf-xp").innerHTML = `<p class="muted">Leggo il file…</p>`; W.q("#rf-xg").disabled = true;
      try {
        const a = await inviaFile("/api/referenze/import/anteprima", f); token = a.token;
        const tab = (righe, cols) => righe.length ? `<table class="rf-tab"><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${righe.map(r => `<tr>${cols.map(c => `<td>${E(c[1](r))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
        W.q("#rf-xp").innerHTML = `<div class="rf-badges rf-sum"><span class="rf-badge ok">${a.nuove.length} nuove</span><span class="rf-badge mid">${a.aggiornate.length} aggiornate</span><span class="rf-badge low">${a.invariate} invariate</span>
          <span class="rf-badge ${a.errori.length ? "warn" : "low"}">${a.errori.length} con errori</span><span class="rf-muted">${a.righe} righe lette</span></div>
          ${a.avvisi.length ? `<p class="rf-hint">${a.avvisi.map(E).join(" · ")}</p>` : ""}
          ${a.nuove.length ? `<h3 class="rf-sh">Nuove referenze</h3>${tab(a.nuove, [["Riga", r => r.n], ["Cliente", r => r.cliente], ["Titolo", r => r.titolo]])}` : ""}
          ${a.aggiornate.length ? `<h3 class="rf-sh">Referenze aggiornate</h3>${a.aggiornate.map(r => `<details class="rf-dd"><summary><b>${E(r.id)}</b> · ${E(r.cliente)} — ${E(r.titolo)} <span class="rf-muted">(${r.campi.length} ${r.campi.length === 1 ? "campo cambia" : "campi cambiano"}, riga ${r.n})</span></summary>
            <table class="rf-tab"><thead><tr><th>Campo</th><th>Prima</th><th>Dopo</th></tr></thead><tbody>${r.campi.map(c => `<tr><td>${E(c.etichetta)}</td>${cella(c.prima)}${cella(c.dopo)}</tr>`).join("")}</tbody></table></details>`).join("")}` : ""}
          ${a.errori.length ? `<h3 class="rf-sh">Righe con errori (non vengono applicate)</h3>${tab(a.errori, [["Riga", r => r.n], ["ID", r => r.id], ["Cliente", r => r.cliente], ["Errore", r => r.errore]])}` : ""}`;
        const n = a.nuove.length + a.aggiornate.length;
        const g = W.q("#rf-xg"); g.disabled = !n; g.textContent = n ? `Applica ${n} ${n === 1 ? "riga" : "righe"}` : "Niente da applicare";
      } catch (err) { W.q("#rf-xp").innerHTML = ""; W.q("#rf-xe").textContent = err.message; token = null; }
    };
    W.q("#rf-xg").onclick = async () => {
      if (!token) return;
      try {
        const r = await ctx.api("/api/referenze/import/applica", {method: "POST", body: {token}});
        W.chiudi(); await ctx.ricarica();
        ctx.toast(`Importazione completata: ${r.creati} create, ${r.aggiornati} aggiornate${r.errori.length ? `, ${r.errori.length} con errori` : ""}`, !!r.errori.length);
      } catch (err) { W.q("#rf-xe").textContent = err.message; }
    };
  }

  // ================================================================ Importa scheda (JSON) con unione
  const unisciLista = (a, b) => [...(a || []), ...(b || []).filter(x => !(a || []).includes(x))];
  const unisciEsteso = (a, b) => { const ha = new Set((a || []).map(s => s.sezione.trim().toLowerCase())); return [...(a || []), ...(b || []).filter(s => !ha.has(s.sezione.trim().toLowerCase()))]; };

  async function importaScheda(ctx) {
    const W = finestra("Importa scheda", `<p class="rf-muted">Scegli un file JSON con una o più schede (formato di <code>referenze.json</code>). Per ogni scheda decidi se crearla come nuova o unirla a una referenza esistente.</p>
      <input type="file" id="rf-jf" accept=".json,application/json"><div class="rf-err" id="rf-je"></div><div id="rf-jp"></div>`,
      `<button id="rf-ja">Annulla</button><button class="primary" id="rf-jg" disabled>Applica</button>`);
    W.q("#rf-ja").onclick = W.chiudi;
    let schede = [], universo = [];
    const stato = [];                                         // per scheda: {scelta, id, campi: {campo: scelta}}
    const esistente = id => universo.find(r => r.id === id);
    const differenze = (i) => {
      const s = schede[i].scheda, ex = esistente(stato[i].id); if (!ex) return [];
      return CAMPI_UNIONE.filter(c => !vuoto(s[c]) && !uguali(s[c], ex[c]));
    };
    const sceltaDefault = (c, ex, s) => LISTE.includes(c) || c === "esteso" ? "unisci" : vuoto(ex[c]) ? "nuova" : "esistente";
    const impostaUnisci = i => { const st = stato[i]; st.campi = {}; differenze(i).forEach(c => st.campi[c] = sceltaDefault(c, esistente(st.id), schede[i].scheda)); };

    function disegna() {
      W.q("#rf-jp").innerHTML = schede.map((x, i) => {
        const st = stato[i], s = x.scheda, ok = !x.errori.length;
        const opzCand = x.candidati.map(c => ({id: c.id, testo: `${c.id} — ${c.cliente} — ${c.titolo}${c.archiviata ? " (archiviata)" : ""} · somiglianza ${Math.round(c.punteggio * 100)}%`}));
        if (st.id && !opzCand.some(o => o.id === st.id)) { const r = esistente(st.id); if (r) opzCand.unshift({id: r.id, testo: `${r.id} — ${r.cliente} — ${r.titolo}`}); }
        const diffs = st.scelta === "unisci" ? differenze(i) : [];
        return `<section class="rf-sch" data-i="${i}"><div class="rf-sch-h"><div><b>${E(s.cliente || "(senza cliente)")}</b> — ${E(s.titolo || "(senza titolo)")}</div>
          ${ok ? "" : `<div class="rf-err">${x.errori.map(E).join(" · ")} <span class="rf-muted">(non si può creare come nuova: correggi il file, oppure uniscila a una referenza esistente)</span></div>`}</div>
          <div class="rf-opz"><label><input type="radio" name="sc${i}" value="nuova" ${st.scelta === "nuova" ? "checked" : ""} ${ok ? "" : "disabled"}> Crea come nuova</label>
            <label><input type="radio" name="sc${i}" value="unisci" ${st.scelta === "unisci" ? "checked" : ""}> Unisci a una esistente</label>
            <label><input type="radio" name="sc${i}" value="salta" ${st.scelta === "salta" ? "checked" : ""}> Salta</label></div>
          ${st.scelta === "unisci" ? `<div class="rf-un"><select data-cand="${i}"><option value="">— scegli la referenza —</option>${opzCand.map(o => `<option value="${E(o.id)}" ${o.id === st.id ? "selected" : ""}>${E(o.testo)}</option>`).join("")}</select>
            <input data-cerca="${i}" placeholder="…oppure cerca per cliente o titolo" autocomplete="off"><div class="rf-cerca" data-ris="${i}"></div></div>` : ""}
          ${st.scelta === "unisci" && st.id ? (diffs.length ? `<table class="rf-tab rf-merge"><thead><tr><th>Campo</th><th>Esistente</th><th>Nuova scheda</th><th>Cosa tenere</th></tr></thead><tbody>${diffs.map(c => {
            const ex = esistente(st.id), lista = LISTE.includes(c) || c === "esteso", sc = st.campi[c];
            return `<tr><td>${E(ETICHETTE[c] || c)}</td>${cella(ex[c])}${cella(s[c])}<td><select data-campo="${i}:${c}"><option value="esistente" ${sc === "esistente" ? "selected" : ""}>Tieni l'esistente</option><option value="nuova" ${sc === "nuova" ? "selected" : ""}>Usa la nuova</option>${lista ? `<option value="unisci" ${sc === "unisci" ? "selected" : ""}>${c === "esteso" ? "Unisci le sezioni" : "Unisci le voci"}</option>` : ""}</select></td></tr>`; }).join("")}</tbody></table>` : `<p class="rf-muted">La scheda non porta informazioni diverse da quelle già presenti.</p>`) : ""}</section>`;
      }).join("");
      W.qa("[name^=sc]").forEach(r => r.onchange = () => { const i = +r.name.slice(2); stato[i].scelta = r.value; if (r.value === "unisci" && stato[i].id) impostaUnisci(i); disegna(); });
      W.qa("[data-cand]").forEach(s => s.onchange = () => { const i = +s.dataset.cand; stato[i].id = s.value; if (s.value) impostaUnisci(i); disegna(); });
      W.qa("[data-campo]").forEach(s => s.onchange = () => { const [i, c] = s.dataset.campo.split(":"); stato[+i].campi[c] = s.value; });
      W.qa("[data-cerca]").forEach(inp => inp.oninput = () => {
        const i = +inp.dataset.cerca, t = norm(inp.value).trim(), box = W.q(`[data-ris="${i}"]`);
        if (t.length < 2) { box.innerHTML = ""; return; }
        const ris = universo.filter(r => norm(r.cliente + " " + r.titolo).includes(t)).slice(0, 8);
        box.innerHTML = ris.map(r => `<button type="button" class="rf-btn" data-scegli="${i}:${E(r.id)}">${E(r.id)} — ${E(r.cliente)} — ${E(r.titolo.slice(0, 70))}</button>`).join("") || `<span class="rf-muted">Nessun risultato</span>`;
        box.querySelectorAll("[data-scegli]").forEach(b => b.onclick = () => { const [k, id] = b.dataset.scegli.split(":"); stato[+k].id = id; impostaUnisci(+k); disegna(); });
      });
      const n = stato.filter((st, i) => st.scelta === "nuova" || (st.scelta === "unisci" && st.id)).length;
      const g = W.q("#rf-jg"); g.disabled = !n; g.textContent = n ? `Applica (${n})` : "Niente da applicare";
    }

    W.q("#rf-jf").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      W.q("#rf-je").textContent = ""; W.q("#rf-jp").innerHTML = `<p class="muted">Leggo il file…</p>`;
      try {
        let payload; try { payload = JSON.parse(await f.text()); } catch (er) { throw new Error("Il file non è un JSON valido"); }
        universo = (await ctx.api("/api/referenze?archiviate=1")).referenze;
        schede = (await ctx.api("/api/referenze/scheda/anteprima", {method: "POST", body: payload})).schede;
        stato.length = 0;
        schede.forEach((x, i) => { const merge = x.suggerimento !== "nuova"; stato.push({scelta: !x.errori.length || merge ? (merge ? "unisci" : "nuova") : "salta", id: merge ? x.suggerimento : "", campi: {}}); if (merge) impostaUnisci(i); });
        disegna();
      } catch (er) { W.q("#rf-jp").innerHTML = ""; W.q("#rf-je").textContent = er.message; }
    };
    W.q("#rf-jg").onclick = async () => {
      const azioni = schede.map((x, i) => {
        const st = stato[i], s = x.scheda;
        if (st.scelta === "nuova") return {tipo: "nuova", indice: i, scheda: s};
        if (st.scelta === "unisci" && st.id) {
          const ex = esistente(st.id), campi = {};
          Object.entries(st.campi).forEach(([c, sc]) => {
            if (sc === "nuova") campi[c] = s[c];
            else if (sc === "unisci") campi[c] = c === "esteso" ? unisciEsteso(ex.esteso, s.esteso) : unisciLista(ex[c], s[c]);
          });
          return Object.keys(campi).length ? {tipo: "unisci", indice: i, id: st.id, campi} : {tipo: "salta", indice: i};
        }
        return {tipo: "salta", indice: i};
      });
      try {
        const r = await ctx.api("/api/referenze/scheda/applica", {method: "POST", body: {azioni}});
        W.chiudi(); await ctx.ricarica();
        ctx.toast(`Fatto: ${r.creati} nuove, ${r.uniti} unite${r.errori.length ? `, ${r.errori.length} con errori (${r.errori[0].errore})` : ""}`, !!r.errori.length);
      } catch (er) { W.q("#rf-je").textContent = er.message; }
    };
  }

  window.ReferenzeDati = {importaExcel, importaScheda};
})();
