// ============================================================
// HR Overland — Portale self-service (me.html) — versione b1
// Auth basata su TOKEN passato nell'URL (?token=xxx). Niente login email.
// L'HR genera il token, manda il link come vuole (WhatsApp/Outlook/SMS).
// Tutte le operazioni passano da RPC SECURITY DEFINER che validano il token.
// ============================================================
console.log("[me.js] versione b1 caricata");

const SUPABASE_URL = "https://cqdmfhdcdvaezmexzxrq.supabase.co";
const SUPABASE_KEY = "sb_publishable_1ECriACxKWx6_4GPxyMXVQ_MPVc2GYy";
const STORAGE_BUCKET = "hr-documenti";

if (!window.supabase || !window.supabase.createClient) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:sans-serif;color:#991b1b">' +
    "Impossibile caricare la libreria Supabase. Ricarica la pagina.</div>";
  throw new Error("supabase-js non disponibile");
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  token: null,
  dipendente: null,
  tipiDoc: [],
  adempimenti: [],
  onboardItems: [],   // voci che il dipendente deve gestire dal portale
  clientIp: null,     // recuperato lato client per audit accettazioni
};

const $ = (id) => document.getElementById(id);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
function fmtDate(s) { if (!s) return "—"; const [y,m,d] = s.slice(0,10).split("-"); return `${d}/${m}/${y}`; }

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

  // Le altre RPC sono opzionali: se falliscono/stallano, l'app si apre comunque e
  // le sezioni corrispondenti restano vuote/nascoste.
  setLoadingStep("Carico i tuoi documenti…");
  const rTipi = await rpcT("self_get_tipi_documenti", { t: state.token }, 4000, "self_get_tipi_documenti");
  if (rTipi.error) console.warn("tipi_documenti skipped:", rTipi.error.message);
  state.tipiDoc = rTipi.data || [];

  const rAd = await rpcT("self_get_adempimenti", { t: state.token }, 4000, "self_get_adempimenti");
  if (rAd.error) console.warn("adempimenti skipped:", rAd.error.message);
  state.adempimenti = rAd.data || [];

  // showApp() SEMPRE, anche se un render lancia un'eccezione inattesa.
  try {
    populateLookups();
    renderForm();
    renderDocs();
  } catch (err) {
    console.error("Errore nel rendering iniziale:", err);
  } finally {
    showApp();   // anagrafica + documenti identificativi visibili comunque
  }

  // OPZIONALE — Onboarding self-service (richiede iter_b1_accettazioni.sql).
  // Se non disponibile, le 2 sezioni nuove restano nascoste, il resto funziona.
  loadOnboardingOptional();
}

async function loadOnboardingOptional() {
  fetchClientIp();
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

async function fetchClientIp() {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    state.clientIp = j.ip || null;
  } catch { /* offline o blocco rete: lasciamo null */ }
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
function renderDocs() {
  const host = $("me-docs-list");
  if (!state.tipiDoc.length) {
    host.innerHTML = '<div class="muted">Nessun tipo di documento configurato.</div>';
    return;
  }
  host.innerHTML = state.tipiDoc.map((t) => {
    const mio = state.adempimenti.find((a) => a.tipo_requisito_id === t.id);
    const stato = mio?.data_scadenza
      ? `Scade il ${fmtDate(mio.data_scadenza)}`
      : (mio?.data_rilascio ? "Registrato (senza scadenza)" : "Non registrato");
    const hasFile = !!mio?.documento_path;
    return `<div class="me-doc-row" data-tipo="${esc(t.id)}" data-ad="${esc(mio?.id || "")}">
      <div class="me-doc-head">
        <div>
          <div class="me-doc-nome">${esc(t.icon || "📄")} ${esc(t.nome)}</div>
          <div class="me-doc-stato">${esc(stato)}</div>
        </div>
        <button type="button" class="ghost-btn me-doc-toggle">${hasFile ? "Modifica" : "Carica"}</button>
      </div>
      <div class="me-doc-form" hidden>
        <div class="row">
          <label><span>Data rilascio</span><input type="date" class="me-doc-rilascio" value="${esc(mio?.data_rilascio || "")}"></label>
          <label><span>Data scadenza</span><input type="date" class="me-doc-scadenza" value="${esc(mio?.data_scadenza || "")}"></label>
        </div>
        <label><span>Allega PDF / foto</span><input type="file" class="me-doc-file" accept=".pdf,image/*"></label>
        <div class="me-doc-progress" hidden>⏳ Caricamento…</div>
        <div class="me-actions">
          <button type="button" class="primary-btn me-doc-save">Salva documento</button>
          ${hasFile ? `<button type="button" class="ghost-btn me-doc-open" data-path="${esc(mio.documento_path)}">📎 Apri PDF attuale</button>` : ""}
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
  els(".me-doc-open", host).forEach((btn) => btn.addEventListener("click", () => openSignedUrl(btn.dataset.path)));
}

async function openSignedUrl(path) {
  // TTL 10 minuti (dati personali/documenti identificativi).
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(path, 600);
  if (error) { alert("Errore: " + error.message); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function saveDoc(e, row) {
  e.preventDefault();
  const tipoId = row.dataset.tipo;
  let admId = row.dataset.ad || "";
  const rilascio = row.querySelector(".me-doc-rilascio").value || null;
  const scadenza = row.querySelector(".me-doc-scadenza").value || null;
  const fileInput = row.querySelector(".me-doc-file");
  const file = fileInput.files?.[0] || null;
  const progress = row.querySelector(".me-doc-progress");
  const status = row.querySelector(".me-doc-status");
  const saveBtn = row.querySelector(".me-doc-save");
  saveBtn.disabled = true;
  status.textContent = "";
  status.className = "me-status";

  let documento_path = state.adempimenti.find((a) => a.id === admId)?.documento_path || null;

  if (file) {
    progress.hidden = false;
    try {
      const targetAdmId = admId || uid();
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${targetAdmId}/${Date.now()}.${ext}`;
      const up = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
        upsert: false, contentType: file.type || "application/octet-stream",
      });
      if (up.error) throw up.error;
      documento_path = path;
      admId = targetAdmId;
    } catch (err) {
      progress.hidden = true;
      saveBtn.disabled = false;
      status.textContent = "✕ Errore caricamento file: " + err.message;
      status.className = "me-status err";
      return;
    }
    progress.hidden = true;
  }

  const { data: savedId, error } = await sb.rpc("self_save_documento", {
    t: state.token,
    p_adempimento_id: admId || null,
    p_tipo_id: tipoId,
    p_rilascio: rilascio,
    p_scadenza: scadenza,
    p_doc_path: documento_path,
  });
  saveBtn.disabled = false;
  if (error) {
    status.textContent = "✕ Errore salvataggio: " + error.message;
    status.className = "me-status err";
    return;
  }
  // Aggiorna lo stato locale e rirenderizza.
  const existing = state.adempimenti.find((a) => a.id === savedId);
  if (existing) {
    Object.assign(existing, { data_rilascio: rilascio, data_scadenza: scadenza, documento_path });
  } else {
    state.adempimenti.push({
      id: savedId, dipendente_id: state.dipendente.id, tipo_requisito_id: tipoId,
      data_rilascio: rilascio, data_scadenza: scadenza, documento_path,
      documento_url: null, done: false, history: [], note: null,
    });
  }
  status.textContent = "✓ Documento salvato";
  status.className = "me-status ok";
  setTimeout(() => renderDocs(), 1200);
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
  const { error } = await sb.rpc("self_accetta", {
    t: state.token, p_item_id: itemId, p_ip: state.clientIp,
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
  if (it) { it.fatto = true; it.fatto_il = new Date().toISOString().slice(0, 10); }
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
          ${caricato ? `<button type="button" class="ghost-btn me-firma-open" data-path="${esc(it.documento_path)}">📎 Vedi firmato</button>` : ""}
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
  els(".me-firma-open", host).forEach((btn) => btn.addEventListener("click", async (e) => {
    await openSignedUrl(e.currentTarget.dataset.path);
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
  saveBtn.disabled = true;
  progress.hidden = false;
  status.textContent = "";
  try {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `onboard/${itemId}/${state.dipendente.id}/${Date.now()}.${ext}`;
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
    if (it) { it.documento_path = path; it.fatto = true; it.fatto_il = new Date().toISOString().slice(0, 10); }
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
