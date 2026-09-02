// ============================================================
// HR Overland — Portale self-service (me.html) — versione c5
// Auth basata su TOKEN passato nell'URL (?token=xxx). Niente login email.
// L'HR genera il token, manda il link come vuole (WhatsApp/Outlook/SMS).
// Tutte le operazioni passano da RPC SECURITY DEFINER che validano il token.
// ============================================================
console.log("[me.js] versione c5 caricata");

const state = {
  token: null,
  dipendente: null,
  tipi: [],           // 3.4 · tutto il catalogo dei tipi di requisito (prima del blocco B: solo i documenti)
  adempimenti: [],
  onboardItems: [],   // voci che il dipendente deve gestire dal portale
  cedolini: [],       // 3.2 · i cedolini della persona, con il loro collegamento firmato
  uploadPrefix: null, // prefisso casuale dell'invito: i file vivono sotto portal/{prefisso}/
};

// Ogni file caricato dal portale sta sotto "portal/{prefisso dell'invito}/".
// E' l'unico path che le policy storage concedono al ruolo anon, e solo in
// SCRITTURA: dalla Fase 1b (2026-09-02) anon non ha nessuna policy di
// lettura sul bucket. Il portale invia file e non ne riapre nessuno,
// nemmeno i propri: la policy "self_doc_select" concedeva la SELECT su
// storage.objects, che in Supabase Storage *e'* l'elenco, e l'elenco
// rivelava a chiunque avesse la chiave pubblica il prefisso casuale che
// doveva essere il segreto. Chi legge un file o e' l'HR autenticato, o ha
// un link firmato generato dall'HR (Fase 3).
const PORTAL_PREFIX = "portal/";
function portalPath(suffisso) {
  if (!state.uploadPrefix) return null;
  return `${PORTAL_PREFIX}${state.uploadPrefix}/${suffisso}`;
}

// $, els, esc, uid, fmtDate, STORAGE_BUCKET, sb: vedi common.js (condivisi con app.js).

// ============================================================
// SCHERMATE
// ============================================================
function showError(msg) {
  $("me-loading").hidden = true;
  $("me-app").hidden = true;
  $("me-error").hidden = false;
  if (msg) $("me-error-msg").textContent = msg;
}
function showLoading() {
  $("me-error").hidden = true;
  $("me-app").hidden = true;
  $("me-loading").hidden = false;
}
function setLoadingStep(msg) {
  // Aggiorna il messaggio sotto "Carico i tuoi dati..." così vediamo dove ci blocchiamo.
  const el = document.querySelector("#me-loading .login-subtitle");
  if (el) el.textContent = msg;
}
// RPC con timeout reale: allo scadere abortiamo davvero la richiesta (AbortController),
// così una singola RPC lenta non può congelare il portale. Ritorna sempre { data, error }.
async function rpcT(fn, args, ms, label) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await sb.rpc(fn, args).abortSignal(ctrl.signal);
  } catch (err) {
    return { data: null, error: new Error(`Richiesta troppo lenta in "${label}" (${ms / 1000}s): ${err?.message || err}`) };
  } finally {
    clearTimeout(tid);
  }
}
function showApp() {
  $("me-error").hidden = true;
  $("me-loading").hidden = true;
  $("me-app").hidden = false;
}

// ============================================================
// CARICAMENTO DATI
// ============================================================
async function loadMyData() {
  showLoading();
  // CRITICAL: solo self_get serve per aprire il portale.
  setLoadingStep("Verifico il link…");
  const { data: dip, error: e1 } = await rpcT("self_get", { t: state.token }, 8000, "self_get");
  if (e1 || !dip) { showError(e1?.message || "Link non valido o scaduto."); return; }
  state.dipendente = dip;

  // Prefisso di upload: senza, il portale resta in sola lettura (l'invio file
  // fallirebbe comunque a livello di policy storage).
  const rPref = await rpcT("self_get_upload_prefix", { t: state.token }, 4000, "self_get_upload_prefix");
  if (rPref.error) console.warn("upload_prefix skipped:", rPref.error.message);
  state.uploadPrefix = rPref.data || null;

  // Le altre RPC sono opzionali: se falliscono/stallano, l'app si apre comunque e
  // le sezioni corrispondenti restano vuote/nascoste.
  setLoadingStep("Carico i tuoi documenti…");
  const rTipi = await rpcT("self_get_tipi_documenti", { t: state.token }, 4000, "self_get_tipi_documenti");
  if (rTipi.error) console.warn("tipi_documenti skipped:", rTipi.error.message);
  state.tipi = rTipi.data || [];

  const rAd = await rpcT("self_get_adempimenti", { t: state.token }, 4000, "self_get_adempimenti");
  if (rAd.error) console.warn("adempimenti skipped:", rAd.error.message);
  state.adempimenti = rAd.data || [];

  // showApp() SEMPRE, anche se un render lancia un'eccezione inattesa.
  try {
    populateLookups();
    renderForm();
    renderDocs();
    renderAttestati();
  } catch (err) {
    console.error("Errore nel rendering iniziale:", err);
  } finally {
    showApp();   // anagrafica + documenti identificativi visibili comunque
  }

  // 3.2 · Cedolini. Opzionale come le altre: se la RPC non c'e' ancora (portale
  // aperto fra migrazione e deploy) la sezione resta nascosta e il resto funziona.
  const rCed = await rpcT("self_get_cedolini", { t: state.token }, 4000, "self_get_cedolini");
  if (rCed.error) console.warn("cedolini skipped:", rCed.error.message);
  state.cedolini = rCed.data || [];
  // Il render va DOPO la risposta, non prima: la chiamata sta qui, sotto
  // showApp(), per non rallentare la prima schermata, e disegnare la sezione
  // insieme alle altre la lascerebbe vuota e quindi nascosta per sempre.
  renderCedolini();

  // OPZIONALE — Onboarding self-service (richiede iter_b1_accettazioni.sql).
  // Se non disponibile, le 2 sezioni nuove restano nascoste, il resto funziona.
  loadOnboardingOptional();
}

async function loadOnboardingOptional() {
  try {
    const { data: onb, error } = await sb.rpc("self_get_onboarding_my", { t: state.token });
    if (error) { console.warn("Onboarding self-service non disponibile:", error.message); return; }
    state.onboardItems = onb || [];
    renderAccetta();
    renderFirma();
  } catch (err) {
    console.warn("loadOnboardingOptional failed:", err);
  }
}

function populateLookups() {
  const fill = (selId, opts) => {
    const sel = $(selId);
    sel.innerHTML = '<option value="">—</option>' + opts.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  };
  fill("me-stato-civile", window.STATI_CIVILI || []);
  fill("me-emerg-parentela", window.PARENTELE || []);
}

function renderForm() {
  const d = state.dipendente;
  $("me-hello").textContent = `Ciao ${d.nome} ${d.cognome}`;
  $("me-telefono").value = d.telefono || "";
  $("me-luogo-nascita").value = d.luogo_nascita || "";
  $("me-cittadinanza").value = d.cittadinanza || "";
  $("me-stato-civile").value = d.stato_civile || "";
  $("me-titolo-studio").value = d.titolo_studio || "";
  $("me-res-indirizzo").value = d.residenza_indirizzo || "";
  $("me-res-cap").value = d.residenza_cap || "";
  $("me-res-citta").value = d.residenza_citta || "";
  $("me-res-prov").value = d.residenza_provincia || "";
  $("me-dom-diverso").checked = !!d.domicilio_diverso;
  $("me-dom-block").hidden = !d.domicilio_diverso;
  $("me-dom-indirizzo").value = d.domicilio_indirizzo || "";
  $("me-dom-cap").value = d.domicilio_cap || "";
  $("me-dom-citta").value = d.domicilio_citta || "";
  $("me-dom-prov").value = d.domicilio_provincia || "";
  $("me-emerg-nome").value = d.emergenza_nome || "";
  $("me-emerg-tel").value = d.emergenza_telefono || "";
  $("me-emerg-parentela").value = d.emergenza_parentela || "";
}

// ============================================================
// SALVATAGGIO DATI PERSONALI
// ============================================================
async function saveMyData(e) {
  e.preventDefault();
  const btn = $("me-save");
  const status = $("me-save-status");
  btn.disabled = true;
  status.textContent = "Salvataggio…";
  status.className = "me-status";
  const domDiverso = $("me-dom-diverso").checked;
  const params = {
    t: state.token,
    p_telefono: $("me-telefono").value.trim() || null,
    p_luogo_nascita: $("me-luogo-nascita").value.trim() || null,
    p_cittadinanza: $("me-cittadinanza").value.trim() || null,
    p_stato_civile: $("me-stato-civile").value || null,
    p_titolo_studio: $("me-titolo-studio").value.trim() || null,
    p_res_indirizzo: $("me-res-indirizzo").value.trim() || null,
    p_res_cap: $("me-res-cap").value.trim() || null,
    p_res_citta: $("me-res-citta").value.trim() || null,
    p_res_provincia: ($("me-res-prov").value.trim() || "").toUpperCase() || null,
    p_dom_diverso: domDiverso,
    p_dom_indirizzo: domDiverso ? ($("me-dom-indirizzo").value.trim() || null) : null,
    p_dom_cap: domDiverso ? ($("me-dom-cap").value.trim() || null) : null,
    p_dom_citta: domDiverso ? ($("me-dom-citta").value.trim() || null) : null,
    p_dom_provincia: domDiverso ? (($("me-dom-prov").value.trim() || "").toUpperCase() || null) : null,
    p_emerg_nome: $("me-emerg-nome").value.trim() || null,
    p_emerg_tel: $("me-emerg-tel").value.trim() || null,
    p_emerg_parentela: $("me-emerg-parentela").value || null,
  };
  const { error } = await sb.rpc("self_update", params);
  btn.disabled = false;
  if (error) {
    status.textContent = "✕ Errore: " + error.message;
    status.className = "me-status err";
    return;
  }
  // Aggiorna lo stato locale
  Object.assign(state.dipendente, {
    telefono: params.p_telefono, luogo_nascita: params.p_luogo_nascita,
    cittadinanza: params.p_cittadinanza, stato_civile: params.p_stato_civile,
    titolo_studio: params.p_titolo_studio,
    residenza_indirizzo: params.p_res_indirizzo, residenza_cap: params.p_res_cap,
    residenza_citta: params.p_res_citta, residenza_provincia: params.p_res_provincia,
    domicilio_diverso: params.p_dom_diverso,
    domicilio_indirizzo: params.p_dom_indirizzo, domicilio_cap: params.p_dom_cap,
    domicilio_citta: params.p_dom_citta, domicilio_provincia: params.p_dom_provincia,
    emergenza_nome: params.p_emerg_nome, emergenza_telefono: params.p_emerg_tel,
    emergenza_parentela: params.p_emerg_parentela,
  });
  status.textContent = "✓ Salvato";
  status.className = "me-status ok";
  setTimeout(() => { status.textContent = ""; }, 3000);
}

// ============================================================
// DOCUMENTI IDENTIFICATIVI
// ============================================================
// I DOCUMENTI D'IDENTITA' sono i tipi di categoria "documenti": sono gli unici
// che il dipendente carica dal portale. Il filtro sta qui e non nella RPC perche'
// dalla Fase 3.4 la RPC deve restituire tutto il catalogo, per dare un nome agli
// attestati nella sezione piu' sotto.
function tipiIdentificativi() {
  return state.tipi.filter((t) => t.categoria === "documenti");
}

function renderDocs() {
  const host = $("me-docs-list");
  const tipiDoc = tipiIdentificativi();
  if (!tipiDoc.length) {
    host.innerHTML = '<div class="muted">Nessun tipo di documento configurato.</div>';
    return;
  }
  host.innerHTML = tipiDoc.map((t) => {
    const mio = state.adempimenti.find((a) => a.tipo_requisito_id === t.id);
    let stato;
    if (mio?.data_rilascio) stato = mio.data_scadenza ? `✅ Verificato — scade il ${fmtDate(mio.data_scadenza)}` : "✅ Verificato";
    else if (mio?.documento_path) stato = "📤 Inviato — in attesa di verifica";
    else stato = "Da caricare";
    const hasFile = !!mio?.documento_path;
    return `<div class="me-doc-row" data-tipo="${esc(t.id)}" data-ad="${esc(mio?.id || "")}">
      <div class="me-doc-head">
        <div>
          <div class="me-doc-nome">${esc(t.icon || "📄")} ${esc(t.nome)}</div>
          <div class="me-doc-stato">${esc(stato)}</div>
        </div>
        <button type="button" class="ghost-btn me-doc-toggle">${hasFile ? "Sostituisci" : "Carica"}</button>
      </div>
      <div class="me-doc-form" hidden>
        <label><span>Allega PDF / foto</span><input type="file" class="me-doc-file" accept=".pdf,image/*"></label>
        <div class="me-doc-progress" hidden>⏳ Caricamento…</div>
        <div class="me-actions">
          <button type="button" class="primary-btn me-doc-save">Invia documento</button>
        </div>
        <span class="me-status me-doc-status"></span>
      </div>
    </div>`;
  }).join("");
  els(".me-doc-toggle", host).forEach((btn) => btn.addEventListener("click", () => {
    const form = btn.closest(".me-doc-row").querySelector(".me-doc-form");
    form.hidden = !form.hidden;
  }));
  els(".me-doc-save", host).forEach((btn) => btn.addEventListener("click", (e) => saveDoc(e, btn.closest(".me-doc-row"))));
}

async function saveDoc(e, row) {
  e.preventDefault();
  const tipoId = row.dataset.tipo;
  const admId = row.dataset.ad || "";
  const fileInput = row.querySelector(".me-doc-file");
  const file = fileInput.files?.[0] || null;
  const progress = row.querySelector(".me-doc-progress");
  const status = row.querySelector(".me-doc-status");
  const saveBtn = row.querySelector(".me-doc-save");
  if (!file) {
    status.textContent = "Seleziona prima un file.";
    status.className = "me-status err";
    return;
  }
  if (!state.uploadPrefix) {
    status.textContent = "Link non piu' valido per l'invio di file. Chiedi all'HR un nuovo link.";
    status.className = "me-status err";
    return;
  }
  saveBtn.disabled = true;
  status.textContent = "";
  status.className = "me-status";

  let documento_path;
  progress.hidden = false;
  try {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    documento_path = portalPath(`doc-${admId || uid()}-${Date.now()}.${ext}`);
    const up = await sb.storage.from(STORAGE_BUCKET).upload(documento_path, file, {
      upsert: false, contentType: file.type || "application/octet-stream",
    });
    if (up.error) throw up.error;
  } catch (err) {
    progress.hidden = true;
    saveBtn.disabled = false;
    status.textContent = "✕ Errore caricamento file: " + err.message;
    status.className = "me-status err";
    return;
  }
  progress.hidden = true;

  const { data: savedId, error } = await sb.rpc("self_save_documento", {
    t: state.token, p_adempimento_id: admId || null, p_tipo_id: tipoId, p_doc_path: documento_path,
  });
  if (error) {
    saveBtn.disabled = false;   // il bottone si riabilita solo in errore
    status.textContent = "✕ Errore salvataggio: " + error.message;
    status.className = "me-status err";
    return;
  }
  const existing = state.adempimenti.find((a) => a.id === savedId);
  // La RPC azzera data_rilascio/data_scadenza lato DB quando si sostituisce il file
  // (nuovo upload = da rivalidare): rispecchiamo l'azzeramento anche nello stato locale.
  if (existing) Object.assign(existing, { documento_path, data_rilascio: null, data_scadenza: null });
  else state.adempimenti.push({
    id: savedId, dipendente_id: state.dipendente.id, tipo_requisito_id: tipoId,
    data_rilascio: null, data_scadenza: null, documento_path, done: false, history: [], note: null,
  });
  renderDocs();   // subito: niente finestra da 1200ms per il doppio click
}

// ============================================================
// 3.2 · I MIEI CEDOLINI
// Le righe arrivano dalla RPC self_get_cedolini, che restituisce solo quelle
// della persona del token e non restituisce il percorso del file: il portale non
// tocca lo storage, apre il collegamento firmato che l'HR ha generato quando ha
// caricato il cedolino. Dalla Fase 1b il ruolo anon non ha nessuna policy di
// lettura sul bucket, e non deve riaverla.
// ============================================================
function nomePeriodoCedolino(c) {
  const mesi = window.MESI || [];
  if (c.tipo === "tredicesima") return `Tredicesima ${c.anno}`;
  if (c.tipo === "cu") return `Certificazione Unica ${c.anno}`;
  return `${mesi[Number(c.mese) - 1] || c.mese} ${c.anno}`;
}

function renderCedolini() {
  const section = $("me-cedolini-section");
  const host = $("me-cedolini-list");
  if (!section || !host) return;   // HTML vecchio in cache: esco in silenzio
  if (!state.cedolini.length) { section.hidden = true; return; }
  section.hidden = false;

  // Raggruppati per anno, l'anno piu' recente in cima: e' come li cerca chi li
  // apre ("il cedolino di marzo"), non come li ha caricati l'ufficio.
  const perAnno = new Map();
  for (const c of state.cedolini) {
    const lista = perAnno.get(c.anno) || [];
    lista.push(c);
    perAnno.set(c.anno, lista);
  }
  const anni = [...perAnno.keys()].sort((a, b) => b - a);

  host.innerHTML = anni.map((anno) => {
    const righe = perAnno.get(anno).slice().sort((a, b) => b.mese - a.mese);
    return `<div class="me-anno">
      <div class="me-anno-titolo">${esc(anno)}</div>
      ${righe.map((c) => {
        // Un collegamento SCADUTO e' un collegamento che non c'e': presentarlo
        // come "pronto da aprire" farebbe cliccare il dipendente per ricevere un
        // errore dallo storage. linkCedolinoDaRinnovare con preavviso 0 e'
        // esattamente questa domanda, ed e' gia' coperta dai test di common.js.
        const apribile = !linkCedolinoDaRinnovare(c, 0);
        return `<div class="me-doc-row">
        <div class="me-doc-head">
          <div>
            <div class="me-doc-nome">🧾 ${esc(nomePeriodoCedolino(c))}</div>
            <div class="me-doc-stato">${apribile
              ? "Caricato il " + esc(fmtDate(String(c.caricato_il || "").slice(0, 10)))
              : "Non disponibile: chiedi all'ufficio del personale di rifare il collegamento"}</div>
          </div>
          ${apribile
            ? `<a class="ghost-btn" href="${esc(c.url_firmato)}" target="_blank" rel="noopener">📄 Apri</a>`
            : ""}
        </div>
      </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

// ============================================================
// 3.4 · I MIEI ATTESTATI E IDONEITA'
// Il dipendente vede quando gli scade il carrello, senza telefonare all'ufficio.
// Sola lettura: nessun bottone. Le date le registra l'HR quando valida.
//
// Il semaforo e' `classificaStato` di common.js, LA STESSA che disegna il
// cruscotto dell'HR. Una seconda regola qui vorrebbe dire che un giorno il
// portale dice "in regola" e l'app dice "scaduto" per la stessa riga.
//
// Prima del blocco B della migrazione la RPC restituisce solo i tipi di
// documento d'identita': gli attestati non hanno un nome da mostrare, la lista
// resta vuota e la sezione non compare. E' il degrado voluto, non un errore.
// ============================================================
const SEMAFORO = {
  ok:          { icona: "✅", testo: "In regola" },
  in_scadenza: { icona: "🟠", testo: "In scadenza" },
  scaduto:     { icona: "🔴", testo: "Scaduto" },
};

function renderAttestati() {
  const section = $("me-attestati-section");
  const host = $("me-attestati-list");
  if (!section || !host) return;   // HTML vecchio in cache: esco in silenzio

  const identificativi = new Set(tipiIdentificativi().map((t) => t.id));
  const righe = state.adempimenti
    // corrente === false = ciclo superato, tenuto come prova storica: nel portale
    // non ci va, o un attestato del 2016 sembrerebbe quello valido.
    .filter((a) => a.corrente !== false && !identificativi.has(a.tipo_requisito_id))
    .map((a) => ({ a, tipo: state.tipi.find((t) => t.id === a.tipo_requisito_id) }))
    .filter((r) => r.tipo)
    .sort((x, y) => (x.a.data_scadenza || "9999-99-99").localeCompare(y.a.data_scadenza || "9999-99-99"));

  if (!righe.length) { section.hidden = true; return; }
  section.hidden = false;

  host.innerHTML = righe.map(({ a, tipo }) => {
    const stato = classificaStato(!!a.data_rilascio, a.data_scadenza || null);
    const s = SEMAFORO[stato] || SEMAFORO.scaduto;
    let quando;
    if (!a.data_rilascio) quando = "Non ancora registrato dall'ufficio del personale";
    else if (a.data_scadenza) quando = `Scade il ${fmtDate(a.data_scadenza)}`;
    else quando = "Non scade";
    return `<div class="me-doc-row">
      <div class="me-doc-head">
        <div>
          <div class="me-doc-nome">${esc(tipo.icon || "📘")} ${esc(tipo.nome)}</div>
          <div class="me-doc-stato">${esc(s.icona)} ${esc(s.testo)} · ${esc(quando)}</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ============================================================
// SEZIONE 1 — DOCUMENTI DA LEGGERE E ACCETTARE (click "ho letto")
// ============================================================
function valoreSegnaposto(key) {
  const v = state.dipendente?.[key];
  if (v == null || v === "") return "________";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(v);
  return esc(String(v));
}
function applicaTemplate(testo) {
  return String(testo || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => valoreSegnaposto(key));
}
function apriDocumentoStampabile(titolo, htmlContenuto, downloadHint) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("Il browser ha bloccato l'apertura. Consenti i popup per questa pagina."); return; }
  const hint = downloadHint
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;padding:10px 14px;border-radius:6px;margin:14px 0;font-family:sans-serif;font-size:13px">${esc(downloadHint)}</div>`
    : "";
  w.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>${esc(titolo)}</title>
<style>
  body{font-family:Georgia,"Times New Roman",serif;max-width:780px;margin:32px auto;padding:24px;color:#1a1f2e;line-height:1.55}
  h1{font-size:22px;border-bottom:2px solid #1a1f2e;padding-bottom:8px;margin-bottom:18px}
  h2{font-size:16px;margin-top:22px;color:#1e3aa8}
  ul{padding-left:22px} li{margin:4px 0}
  .toolbar{position:fixed;top:8px;right:8px;display:flex;gap:6px;font-family:sans-serif}
  .toolbar button{padding:8px 14px;border:1px solid #d4d8e3;background:#fff;border-radius:6px;cursor:pointer}
  .toolbar button.primary{background:#2f57d9;color:white;border-color:#2f57d9}
  @media print{.toolbar,.no-print{display:none}body{margin:0;padding:24px}}
</style></head><body>
<div class="toolbar">
  <button class="primary" onclick="window.print()">🖨 Stampa / Salva PDF</button>
  <button onclick="window.close()">Chiudi</button>
</div>
<div class="no-print">${hint}</div>
${htmlContenuto}
</body></html>`);
  w.document.close();
}

function renderAccetta() {
  const section = $("me-accetta-section");
  const host = $("me-accetta-list");
  if (!section || !host) return;  // HTML vecchio in cache: niente sezione, esco silenziosamente
  const items = state.onboardItems.filter((i) => i.tipo_workflow === "accetta_click");
  if (!items.length) { section.hidden = true; return; }
  section.hidden = false;
  host.innerHTML = items.map((it) => {
    const accettato = it.fatto;
    const dataTxt = it.fatto_il ? `il ${fmtDate(it.fatto_il)}` : "";
    return `<div class="me-doc-row" data-item="${esc(it.item_id)}" data-tpl="${esc(it.template_id || "")}">
      <div class="me-doc-head">
        <div>
          <div class="me-doc-nome">${esc(it.label)}</div>
          <div class="me-doc-stato">${accettato ? `✅ Accettato ${esc(dataTxt)}` : "⏳ In attesa di lettura"}</div>
          ${it.descrizione ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(it.descrizione)}</div>` : ""}
        </div>
        <div class="me-actions" style="gap:6px">
          ${it.template_id ? `<button type="button" class="ghost-btn me-acc-read">📖 Leggi</button>` : ""}
          ${!accettato && it.template_id ? `<button type="button" class="primary-btn me-acc-confirm">Ho letto e accetto</button>` : ""}
        </div>
      </div>
      <span class="me-status me-acc-status"></span>
    </div>`;
  }).join("");
  els(".me-acc-read", host).forEach((btn) => btn.addEventListener("click", async (e) => {
    const row = e.currentTarget.closest(".me-doc-row");
    await openTemplate(row.dataset.tpl, "Quando hai finito di leggere, torna sul portale e clicca 'Ho letto e accetto'.");
  }));
  els(".me-acc-confirm", host).forEach((btn) => btn.addEventListener("click", async (e) => {
    const row = e.currentTarget.closest(".me-doc-row");
    await confermaAccettazione(row.dataset.item, row);
  }));
}

async function openTemplate(templateId, hint) {
  if (!templateId) return;
  const { data, error } = await sb.rpc("self_get_template_contenuto", {
    t: state.token, p_template_id: templateId,
  });
  if (error) { alert("Errore apertura documento: " + error.message); return; }
  const html = applicaTemplate(data || "");
  const titolo = (state.onboardItems.find((i) => i.template_id === templateId)?.label) || "Documento";
  apriDocumentoStampabile(titolo, html, hint);
}

async function confermaAccettazione(itemId, row) {
  const status = row.querySelector(".me-acc-status");
  const btn = row.querySelector(".me-acc-confirm");
  if (btn) btn.disabled = true;
  status.textContent = "Registrazione in corso…";
  status.className = "me-status";
  // p_ip resta nella firma della RPC ma il client non lo riempie piu' (Fase 0.5):
  // self_accetta prende l'IP dall'header x-forwarded-for della richiesta e usa
  // p_ip solo come ripiego. L'IP del server e' sempre quello vero, e cosi' il
  // portale non chiama piu' nessun servizio esterno oltre a Supabase.
  const { error } = await sb.rpc("self_accetta", {
    t: state.token, p_item_id: itemId, p_ip: null,
  });
  if (error) {
    status.textContent = "✕ Errore: " + error.message;
    status.className = "me-status err";
    if (btn) btn.disabled = false;
    return;
  }
  status.textContent = "✓ Accettazione registrata";
  status.className = "me-status ok";
  // Aggiorna stato locale e rirenderizza.
  const it = state.onboardItems.find((i) => i.item_id === itemId);
  if (it) { it.fatto = true; it.fatto_il = localISO(new Date()); }
  setTimeout(renderAccetta, 800);
}

// ============================================================
// SEZIONE 2 — DOCUMENTI DA FIRMARE E RICARICARE
// ============================================================
function renderFirma() {
  const section = $("me-firma-section");
  const host = $("me-firma-list");
  if (!section || !host) return;  // HTML vecchio in cache
  const items = state.onboardItems.filter((i) => i.tipo_workflow === "genera_pdf_template");
  if (!items.length) { section.hidden = true; return; }
  section.hidden = false;
  host.innerHTML = items.map((it) => {
    const caricato = !!it.documento_path;
    const stato = caricato ? `📎 Firmato e caricato il ${fmtDate(it.fatto_il)}` : "⏳ In attesa di firma";
    return `<div class="me-doc-row" data-item="${esc(it.item_id)}" data-tpl="${esc(it.template_id || "")}">
      <div class="me-doc-head">
        <div>
          <div class="me-doc-nome">${esc(it.label)}</div>
          <div class="me-doc-stato">${esc(stato)}</div>
          ${it.descrizione ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(it.descrizione)}</div>` : ""}
        </div>
        <div class="me-actions" style="gap:6px">
          ${it.template_id ? `<button type="button" class="ghost-btn me-firma-download">📄 Scarica da firmare</button>` : ""}
        </div>
      </div>
      <div class="me-firma-upload">
        <label><span>${caricato ? "Sostituisci con un nuovo file:" : "Carica il documento firmato:"}</span>
          <input type="file" class="me-firma-file" accept=".pdf,image/*">
        </label>
        <div class="me-doc-progress" hidden>⏳ Caricamento…</div>
        <button type="button" class="primary-btn me-firma-save" disabled>${caricato ? "Sostituisci" : "Carica firmato"}</button>
        <span class="me-status me-firma-status"></span>
      </div>
    </div>`;
  }).join("");
  els(".me-firma-download", host).forEach((btn) => btn.addEventListener("click", async (e) => {
    const row = e.currentTarget.closest(".me-doc-row");
    await openTemplate(row.dataset.tpl, "Stampa questo documento, firmalo a penna e poi torna sul portale per caricarlo.");
  }));
  els(".me-firma-file", host).forEach((inp) => inp.addEventListener("change", (e) => {
    const row = e.currentTarget.closest(".me-doc-row");
    const saveBtn = row.querySelector(".me-firma-save");
    saveBtn.disabled = !inp.files?.length;
  }));
  els(".me-firma-save", host).forEach((btn) => btn.addEventListener("click", async (e) => {
    const row = e.currentTarget.closest(".me-doc-row");
    await uploadFirmato(row);
  }));
}

async function uploadFirmato(row) {
  const itemId = row.dataset.item;
  const fileInput = row.querySelector(".me-firma-file");
  const file = fileInput.files?.[0];
  if (!file) return;
  const progress = row.querySelector(".me-doc-progress");
  const status = row.querySelector(".me-firma-status");
  const saveBtn = row.querySelector(".me-firma-save");
  if (!state.uploadPrefix) {
    status.textContent = "✕ Link non piu' valido per l'invio di file. Chiedi all'HR un nuovo link.";
    status.className = "me-status err";
    return;
  }
  saveBtn.disabled = true;
  progress.hidden = false;
  status.textContent = "";
  try {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = portalPath(`firmato-${itemId}-${Date.now()}.${ext}`);
    const up = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
      upsert: false, contentType: file.type || "application/octet-stream",
    });
    if (up.error) throw up.error;
    const { error } = await sb.rpc("self_save_signed_onboarding", {
      t: state.token, p_item_id: itemId, p_doc_path: path,
    });
    if (error) throw error;
    progress.hidden = true;
    status.textContent = "✓ Caricato. L'HR riceve la notifica.";
    status.className = "me-status ok";
    // Aggiorna stato locale
    const it = state.onboardItems.find((i) => i.item_id === itemId);
    if (it) { it.documento_path = path; it.fatto = true; it.fatto_il = localISO(new Date()); }
    setTimeout(renderFirma, 1200);
  } catch (err) {
    progress.hidden = true;
    status.textContent = "✕ Errore: " + err.message;
    status.className = "me-status err";
    saveBtn.disabled = false;
  }
}

// ============================================================
// BOOT
// ============================================================
async function init() {
  $("me-form").addEventListener("submit", saveMyData);
  $("me-dom-diverso").addEventListener("change", (e) => { $("me-dom-block").hidden = !e.target.checked; });

  const params = new URLSearchParams(window.location.search);
  state.token = params.get("token");
  if (!state.token) {
    showError("Il link non contiene il token. Chiedi all'HR un nuovo link.");
    return;
  }
  await loadMyData();
}

document.addEventListener("DOMContentLoaded", init);
