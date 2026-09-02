// ============================================================
// HR Overland — app.js
// Frontend vanilla. Sorgente unica = Supabase (stesso progetto
// dello Scadenziario). Le REGOLE sono dati (tabella requisiti_ruolo).
// Il "motore gap" calcola lato client lo stato di compliance.
// ============================================================

// ---------- Stato in memoria ----------
const state = {
  ruoli: [],
  tipi: [],
  requisiti: [],          // requisiti_ruolo (la matrice)
  dipendenti: [],
  dipRuoli: [],           // dipendente_ruoli
  adempimenti: [],
  categorie: [],          // catalogo categorie (caricato da DB)
  provvedimenti: [],      // provvedimenti disciplinari (caricati da DB)
  onboardItems: [],       // template voci onboarding (catalogo)
  onboardProgressi: [],   // istanze per dipendente
  accettazioni: [],       // firme elettroniche leggere ricevute dal portale
  modelli: [],            // documenti_template (lettera assunzione, GDPR, ecc.)
  dpiTipi: [],            // catalogo DPI
  dpiConsegne: [],        // registro consegne DPI per dipendente
  storicoModifiche: [],   // audit trail scritto dal trigger, mai dall'app (1.6)
  parametri: [],          // 3.1 · i numeri che cambiano con le norme, editabili dall'app
  cedolini: [],           // 3.2 · cedolini caricati dall'HR, letti dal dipendente nel portale
  scambiConsulente: [],   // 3.3 · registro degli scambi con il consulente del lavoro
  eventi: [],             // 4.1 · ferie, permessi, malattie, infortuni, straordinari
  view: "compliance",
  compView: "list",          // "list" | "calendar" — toggle dentro il tab Scadenze
  configTab: "ruoli",
  dipTab: "anagrafica",      // 2.3 · linguetta aperta nella scheda dipendente
  scambiAnno: new Date().getFullYear(),   // 3.3 · anno mostrato nella vista Consulente
  eventiAnno: new Date().getFullYear(),   // 4.2 · mese mostrato nella vista Eventi
  eventiMese: new Date().getMonth() + 1,
  eventiFilter: { dipendente: "", tipo: "" },
  search: "",
  compFilter: { dipendente: "", mansione: "", incarico: "", stato: "" },
  storicoFilter: { dipendente: "", tipo: "", categoria: "", anno: "", mese: "" },
  calRef: new Date(),
  user: null,
};

const TABLES = ["categorie", "ruoli", "tipi_requisito", "requisiti_ruolo", "dipendenti", "dipendente_ruoli", "adempimenti", "provvedimenti", "onboarding_items", "onboarding_progressi", "accettazioni", "documenti_template", "dpi_tipi", "dpi_consegne", "storico_modifiche", "parametri", "cedolini", "scambi_consulente", "eventi"];

// Tabelle sottoscritte in realtime. LISTA SEPARATA da TABLES, e volutamente
// scritta per esteso (1.6): fino alla Fase 1 subscribeRealtime iterava TABLES,
// quindi "caricata ma non in realtime" era impossibile da esprimere. Una tabella
// nuova entra in TABLES e NON qui, se non per una decisione motivata.
// storico_modifiche non c'e': e' un registro, non una vista, e ogni salvataggio
// ne produrrebbe una riga e un render in piu'.
// `eventi` (4.1) SI', ed e' l'unica eccezione che tutto il piano prevede (§4
// punto 2): e' l'unica tabella in cui scrive qualcun ALTRO — il dipendente, dal
// portale — mentre l'HR ha l'app aperta, e il contatore delle richieste deve
// muoversi senza ricaricare la pagina.
const REALTIME_TABLES = ["categorie", "ruoli", "tipi_requisito", "requisiti_ruolo", "dipendenti", "dipendente_ruoli", "adempimenti", "provvedimenti", "onboarding_items", "onboarding_progressi", "accettazioni", "documenti_template", "dpi_tipi", "dpi_consegne", "eventi"];
const STORE_BY_TABLE = {
  categorie: "categorie",
  ruoli: "ruoli",
  tipi_requisito: "tipi",
  requisiti_ruolo: "requisiti",
  dipendenti: "dipendenti",
  dipendente_ruoli: "dipRuoli",
  adempimenti: "adempimenti",
  provvedimenti: "provvedimenti",
  onboarding_items: "onboardItems",
  onboarding_progressi: "onboardProgressi",
  accettazioni: "accettazioni",
  documenti_template: "modelli",
  dpi_tipi: "dpiTipi",
  dpi_consegne: "dpiConsegne",
  storico_modifiche: "storicoModifiche",
  // 3.1-3.3 · Le tre tabelle della Fase 3. Entrano in TABLES e qui, NON in
  // REALTIME_TABLES: nessun altro le scrive mentre l'HR ha l'app aperta (il
  // dipendente dal portale le legge soltanto). L'unica tabella nuova prevista in
  // realtime da tutto il piano e' `eventi`, in Fase 4.
  parametri: "parametri",
  cedolini: "cedolini",
  scambi_consulente: "scambiConsulente",
  // 4.1 · L'unica tabella nuova che entra ANCHE in REALTIME_TABLES, qui sopra.
  eventi: "eventi",
};

// Tabelle salvate dal backup dei dati: TUTTE quelle del database, non solo le 14
// che l'app carica in memoria. `invite_tokens` non sta in TABLES perche' nessuna
// vista la legge, ma il suo `upload_prefix` e' l'unico legame fra un file
// caricato dal portale e la persona a cui appartiene: senza, il backup dei
// documenti diventa un mucchio di file anonimi.
// NON entra in TABLES ne' in STORE_BY_TABLE: non va in `state` ne' in realtime.
const TABELLE_BACKUP = TABLES.concat(["invite_tokens"]);
// La colonna che identifica una riga. Quasi tutte le tabelle hanno `id`, ma non
// tutte: `invite_tokens` ha `token` e `parametri` (3.1) ha `chiave`.
// UNA mappa sola per i due mestieri che ne hanno bisogno, perche' sono lo stesso
// fatto: sbUpsert/sbDelete la usano per ritrovare la riga in `state`, e il backup
// per ordinare le pagine.
// Non e' un dettaglio: con `id` su `parametri`, sbUpsert confronterebbe
// undefined con undefined e ritroverebbe SEMPRE la prima riga — salvando un
// parametro ne sovrascriverebbe un altro in memoria — e il backup ordinerebbe per
// una colonna che non esiste, fermandosi con un errore e non scaricando niente.
const CHIAVE_TABELLA = { invite_tokens: "token", parametri: "chiave" };
const chiaveDi = (tabella) => CHIAVE_TABELLA[tabella] || "id";

// ---------- Helpers ----------
// $, el, els, uid, esc, localISO, parseISO, fmtDate, addMonths, addDays, daysUntil,
// GG_SCAD, GG_ONBOARD, STORAGE_BUCKET: vedi common.js (condivisi con me.js).
const sanitizeName = (s) => String(s || "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

function initials(nome, cognome) {
  return ((nome || "?")[0] + (cognome || "")[0]).toUpperCase();
}

// Etichetta del tipo contratto a tempo determinato (deve coincidere con TIPI_CONTRATTO[1] in data.js).
const CONTRATTO_DETERMINATO = "Determinato";
// Helper: il tipo requisito è di categoria sanitaria? (era hardcoded come prefisso "tr-san-")
function isTipoSanitario(tipoReqId) {
  const t = tipoById(tipoReqId);
  return t ? t.categoria === "sanitario" : false;
}
// Categorie: dalla tabella DB (state.categorie) con fallback ai default data.js.
function categoriaInfo(key) {
  const dbRow = state.categorie.find((c) => c.id === key);
  if (dbRow) return { key: dbRow.id, label: dbRow.label, icon: dbRow.icon || "" };
  const fallback = (window.CATEGORIE_REQUISITO || []).find((c) => c.key === key);
  if (fallback) return fallback;
  return { key, label: key, icon: "" };
}
// Comoda per leggere/iconare in modo retrocompatibile col vecchio CAT_BY_KEY.
const CAT_BY_KEY = new Proxy({}, { get: (_t, k) => categoriaInfo(k) });
function categorieList() {
  if (state.categorie.length) {
    return state.categorie.slice().sort((a, b) => (a.ordine || 0) - (b.ordine || 0) || (a.label || "").localeCompare(b.label || ""));
  }
  return (window.CATEGORIE_REQUISITO || []).map((c) => ({ id: c.key, label: c.label, icon: c.icon, ordine: 100 }));
}
const STATO_INFO = {
  scaduto:     { label: "Scaduto",     order: 1 },
  in_scadenza: { label: "In scadenza", order: 2 },
  ok:          { label: "In regola",   order: 3 },
};

// ---------- Storage (PDF su Supabase) ----------
function downloadName(dip, tipo, adm) {
  const date = (adm?.data_rilascio || adm?.data_scadenza || localISO(new Date())).slice(0, 10);
  const parts = [
    sanitizeName(dip?.cognome) || "Cognome",
    sanitizeName(dip?.nome) || "Nome",
    sanitizeName(tipo?.nome) || "Doc",
    date,
  ];
  const path = adm?.documento_path || "";
  const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "pdf";
  return parts.join("_") + "." + ext;
}

async function uploadDoc(adempimentoId, file) {
  // Path con timestamp così rinnovi successivi NON sovrascrivono il file precedente
  // (il vecchio resta nel bucket, recuperabile dallo storico).
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${adempimentoId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

// 1.5 · Atto di nomina: stesso schema degli altri upload, prefisso proprio.
// Il timestamp evita che una nomina nuova sovrascriva quella vecchia.
async function uploadNomina(rigaId, file) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `nomine/${rigaId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

// TTL 10 minuti: i PDF contengono dati sanitari (idoneità) o provvedimenti
// disciplinari — link a 1h è troppo se vengono inoltrati per errore.
async function getSignedDocUrl(path, dlName) {
  if (!path) return null;
  const opts = dlName ? { download: dlName } : {};
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(path, 600, opts);
  if (error) throw error;
  return data?.signedUrl || null;
}

async function deleteDoc(path) {
  if (!path) return;
  try { await sb.storage.from(STORAGE_BUCKET).remove([path]); }
  catch (e) { console.warn("deleteDoc failed:", e); }
}

// Helper unico per aprire un PDF dal bucket: signed url + nuova tab + alert errore.
// Sostituisce 9 callsite identici (DPI, onboarding, provv, storico ×3, ecc.).
async function openSignedDoc(path, dlName) {
  if (!path) return;
  try {
    const url = await getSignedDocUrl(path, dlName);
    if (url) window.open(url, "_blank", "noopener");
  } catch (err) {
    alert("Errore apertura documento: " + err.message);
  }
}

// Apre il PDF di un adempimento dato il suo {dip, tipo, path}, con download name leggibile.
async function openAdempimentoDoc(adm, path) {
  if (!path) return;
  const dip = adm ? dipById(adm.dipendente_id) : null;
  const tipo = adm ? tipoById(adm.tipo_requisito_id) : null;
  const dl = downloadName(dip, tipo, { ...adm, documento_path: path });
  await openSignedDoc(path, dl);
}

async function openDoc(adm) {
  if (!adm) return;
  if (adm.documento_path) {
    await openAdempimentoDoc(adm, adm.documento_path);
  } else if (adm.documento_url) {
    window.open(adm.documento_url, "_blank", "noopener");
  }
}

// ---------- Auth ----------
function isAuthError(e) {
  if (!e) return false;
  const status = e.status || e.code;
  if (status === 401 || status === 403) return true;
  const code = String(e.code || "");
  if (code === "PGRST301" || code === "PGRST302") return true;
  const name = String(e.name || "");
  if (/AuthError|AuthApiError/i.test(name)) return true;
  // NON trattare "rls"/"row-level" come sessione scaduta: una violazione di
  // policy con sessione validissima manderebbe l'utente al login a caccia
  // della causa sbagliata. Quelli sono errori di autorizzazione, non di auth.
  const msg = String(e.message || "").toLowerCase();
  return /jwt|unauthorized|not authenticated/.test(msg);
}

function showLogin(msg) {
  $("app-root").hidden = true;
  $("login-overlay").style.display = "flex";
  const errBox = $("login-error");
  if (msg) { errBox.textContent = msg; errBox.hidden = false; }
  else { errBox.hidden = true; }
}
function hideLogin() {
  $("login-overlay").style.display = "none";
  $("app-root").hidden = false;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const btn = $("login-submit");
  btn.disabled = true;
  btn.textContent = "Accesso…";
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value,
  });
  btn.disabled = false;
  btn.textContent = "Accedi";
  if (error) {
    // Un errore di RETE non e' una password sbagliata. Con un messaggio solo per
    // entrambi i casi si finisce a ridigitare credenziali giuste mentre il vero
    // problema e' che il progetto Supabase e' in pausa o la rete e' assente.
    const msg = String(error.message || "");
    const nome = String(error.name || "");
    const problemaDiRete = !navigator.onLine || error.status === 0
      || /AuthRetryableFetchError/i.test(nome)
      || /failed to fetch|fetch failed|networkerror|load failed/i.test(msg);
    showLogin(problemaDiRete
      ? "Server non raggiungibile: database in pausa o rete assente. Le credenziali non c'entrano."
      : "Credenziali non valide. Riprova.");
    return;
  }
  state.user = data.user;
  hideLogin();
  await startApp();
}

async function handleLogout() {
  await sb.auth.signOut();
  unsubscribeAll();
  state.user = null;
  showLogin();
}

// ---------- CRUD ----------
async function sbLoadAll() {
  const results = await Promise.all(TABLES.map((t) => sb.from(t).select("*")));
  const failed = [];
  for (let i = 0; i < TABLES.length; i++) {
    const { data, error } = results[i];
    if (error) {
      if (isAuthError(error)) { showLogin("Sessione scaduta. Rientra."); throw error; }
      // Errore non-auth: NON sovrascrivere lo state (evita "tutto in regola" fittizio
      // perché una tabella vuota azzererebbe il motore gap). Segnala però all'utente.
      failed.push(`${TABLES[i]}: ${error.message}`);
      continue;
    }
    state[STORE_BY_TABLE[TABLES[i]]] = data || [];
  }
  if (failed.length) {
    alert("Errore caricamento dati (refresha la pagina):\n" + failed.join("\n"));
  }
}

async function sbUpsert(table, row) {
  const store = STORE_BY_TABLE[table];
  const arr = state[store];
  const k = chiaveDi(table);
  const idx = arr.findIndex((r) => r[k] === row[k]);
  const prev = idx >= 0 ? arr[idx] : null;
  if (idx >= 0) arr[idx] = row; else arr.push(row);   // optimistic
  renderAll();
  const { error } = await sb.from(table).upsert(row);
  if (error) {
    // Rollback safe contro realtime concorrente: ritrova la riga per chiave ORA,
    // non riusare l'idx vecchio (potrebbe essere stale dopo eventi RT).
    const now = arr.findIndex((r) => r[k] === row[k]);
    if (prev) {
      if (now >= 0) arr[now] = prev;
      else arr.push(prev);
    } else if (now >= 0) {
      arr.splice(now, 1);
    }
    renderAll();
    if (isAuthError(error)) showLogin("Sessione scaduta. Rientra.");
    else alert("Errore salvataggio: " + error.message);
    return false;
  }
  return true;
}

async function sbDelete(table, id) {
  const store = STORE_BY_TABLE[table];
  const arr = state[store];
  const k = chiaveDi(table);
  const idx = arr.findIndex((r) => r[k] === id);
  const prev = idx >= 0 ? arr[idx] : null;
  if (idx >= 0) arr.splice(idx, 1);                   // optimistic
  renderAll();
  const { error } = await sb.from(table).delete().eq(k, id);
  if (error) {
    if (prev) {
      // Rollback safe contro realtime concorrente: ricontrolla ORA se la riga esiste.
      const now = arr.findIndex((r) => r[k] === id);
      if (now < 0) arr.push(prev);
      renderAll();
    }
    if (isAuthError(error)) showLogin("Sessione scaduta. Rientra.");
    else alert("Errore eliminazione: " + error.message);
    return false;
  }
  return true;
}

// ---------- Realtime ----------
let rtChannel = null;
function subscribeRealtime() {
  rtChannel = sb.channel("hr-all");
  for (const t of REALTIME_TABLES) {
    rtChannel.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      const store = STORE_BY_TABLE[t];
      const arr = state[store];
      if (payload.eventType === "DELETE") {
        const i = arr.findIndex((r) => r.id === payload.old.id);
        if (i >= 0) arr.splice(i, 1);
      } else {
        const row = payload.new;
        const i = arr.findIndex((r) => r.id === row.id);
        if (i >= 0) arr[i] = row; else arr.push(row);
      }
      renderAll();
    });
  }
  rtChannel.subscribe();
}
function unsubscribeAll() {
  if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
}

// ---------- Lookups ----------
const ruoloById = (id) => state.ruoli.find((r) => r.id === id);
const tipoById = (id) => state.tipi.find((t) => t.id === id);
const dipById = (id) => state.dipendenti.find((d) => d.id === id);
// 1.5 · UNICO punto che filtra le assegnazioni attive di una persona.
// Da qui passano il motore gap, il sync degli obblighi, il calcolo della
// validita' e la scheda: se il filtro finisse in piu' posti, un incarico
// revocato tornerebbe a contare da qualche parte, in silenzio.
// L'altro lettore di state.dipRuoli e' calcolaCariche in common.js, che ha il
// suo filtro e il suo test.
function assegnazioniOfDip(dipId, { conRevocate = false } = {}) {
  return state.dipRuoli
    .filter((dr) => dr.dipendente_id === dipId && (conRevocate || assegnazioneAttiva(dr)))
    .map((dr) => ({ ...dr, ruolo: ruoloById(dr.ruolo_id) }))
    .filter((a) => a.ruolo);
}
function ruoliOfDip(dipId) {
  return assegnazioniOfDip(dipId).map((a) => a.ruolo);
}
function mansioniList() { return state.ruoli.filter((r) => r.tipo === "mansione"); }
function incarichiList() { return state.ruoli.filter((r) => r.tipo === "incarico"); }

// ============================================================
// MOTORE GAP — cuore dell'app
// Per ogni dipendente attivo: unione dei requisiti obbligatori
// dei suoi ruoli, confronto con l'adempimento valido più recente.
// ============================================================
// Adattatore: raccoglie lo stato e chiama il nucleo puro in common.js.
// L'ordinamento per gravita' resta qui perche' e' presentazione: STATO_INFO
// e' UI, e il nucleo non deve conoscerla.
function computeGaps(dip) {
  const rows = calcolaGap({
    dip,
    ruoloIds: new Set(ruoliOfDip(dip.id).map((r) => r.id)),
    requisiti: state.requisiti,
    adempimenti: state.adempimenti,
    trovaTipo: tipoById,
  });
  rows.sort((a, b) => STATO_INFO[a.stato].order - STATO_INFO[b.stato].order);
  return rows;
}

// Tutti i gap di tutti i dipendenti attivi.
function allGapRows() {
  const out = [];
  for (const dip of state.dipendenti) {
    if (dip.attivo === false) continue;
    out.push(...computeGaps(dip));
  }
  // Ordine globale: prima i problemi (scaduto/in_scadenza), in regola in fondo.
  // A parità di stato, ordina per scadenza (più imminenti prima).
  out.sort((a, b) => {
    const so = STATO_INFO[a.stato].order - STATO_INFO[b.stato].order;
    if (so !== 0) return so;
    return (a.scadenza || "9999-99-99").localeCompare(b.scadenza || "9999-99-99");
  });
  return out;
}

// ============================================================
// RENDER
// ============================================================
let _gapCache = null;
// La cache vive per un giro di renderAll: chi muta dati che influenzano i gap DEVE
// passare da renderAll() (che la invalida). I call diretti di renderCompliance() sono
// legittimi solo per cambi filtro/vista/calendario, mai dopo una mutazione dati.
// Calcola i gap una sola volta per ciclo di render (invalidata a inizio renderAll).
function gapRows() {
  if (!_gapCache) _gapCache = allGapRows();
  return _gapCache;
}

function renderAll() {
  if (!state.user) return;
  _gapCache = null;
  renderCounts();
  if (state.view === "compliance") renderCompliance();
  else if (state.view === "cariche") renderCariche();
  else if (state.view === "dipendenti") renderDipendenti();
  else if (state.view === "storico") renderStorico();
  else if (state.view === "consulente") renderConsulente();
  else if (state.view === "config") renderConfig();
}

function renderCounts() {
  const gaps = gapRows();
  const openGaps = gaps.filter((g) => g.stato !== "ok").length;
  $("count-gap").textContent = openGaps;
  $("count-dip").textContent = state.dipendenti.filter((d) => d.attivo !== false).length;
  // Cariche aziendali sotto soglia.
  const sottoSoglia = caricheStato().filter((c) => c.sottoSoglia).length;
  $("count-cariche").textContent = sottoSoglia;
  // Storico: totale eventi (correnti + archiviati).
  $("count-storico").textContent = collectStoricoEvents().length;
  // 3.2 · "Cedolini di luglio: 3/8" e i collegamenti da rinnovare.
  const pagheMese = mesePaghe();
  const quanti = conteggioCedoliniDelMese({
    dipendenti: state.dipendenti, cedolini: state.cedolini,
    anno: pagheMese.anno, mese: pagheMese.mese,
  });
  $("btn-cedolini-mese").textContent =
    `🧾 Cedolini di ${nomeMese(pagheMese.mese)}: ${quanti.presenti}/${quanti.attesi}`;
  // 3.3 · Le caselle che mancano allo studio, per l'anno in corso.
  $("count-consulente").textContent = scambiMancanti(grigliaScambiAnno(new Date().getFullYear()));
  const daRinnovare = cedoliniConLinkDaRinnovare().length;
  $("count-link-cedolini").textContent = daRinnovare;
  $("count-link-cedolini").hidden = daRinnovare === 0;
}

// Stato di ogni incarico aziendale con minimo > 0.
// Adattatore: il conteggio e' una regola su stati e vive in common.js (testata);
// qui resta solo l'ORDINAMENTO, che e' presentazione — sotto soglia in cima.
function caricheStato() {
  return calcolaCariche({ ruoli: state.ruoli, dipRuoli: state.dipRuoli, dipendenti: state.dipendenti })
    .sort((a, b) => (a.sottoSoglia === b.sottoSoglia ? a.ruolo.nome.localeCompare(b.ruolo.nome) : (a.sottoSoglia ? -1 : 1)));
}

function renderCariche() {
  const cariche = caricheStato();
  $("cariche-empty").hidden = cariche.length > 0;
  const host = $("cariche-list");
  host.innerHTML = cariche.map((c) => {
    const stato = c.sottoSoglia
      ? `${c.nominati.length}/${c.minimo} — sotto soglia`
      : `${c.nominati.length}/${c.minimo} — in regola`;
    const nominati = c.nominati.length
      ? `<div class="nominati">${c.nominati.map((d) => `<span class="chip">${esc(d.cognome)} ${esc(d.nome)}</span>`).join("")}</div>`
      : `<div class="vuoto">Nessun dipendente attivo nominato.</div>`;
    return `<div class="carica-card ${c.sottoSoglia ? "warn" : "ok"}">
      <div>
        <div class="nome">${esc(c.ruolo.nome)}</div>
        <div class="meta">Minimo richiesto: ${c.minimo} · Nominati attivi: ${c.nominati.length}</div>
      </div>
      <div class="stato">${c.sottoSoglia ? "⚠️ " : "✅ "}${stato}</div>
      ${nominati}
    </div>`;
  }).join("");
}

// ---------- Compliance ----------
function matchSearch(text) {
  if (!state.search) return true;
  return text.toLowerCase().includes(state.search.toLowerCase());
}

// Filtri della barra Scadenze, in un punto solo: li usano sia le righe di
// sicurezza sia il blocco Contratti (1.7).
function passaFiltriCompliance(dip, stato, testo) {
  const f = state.compFilter;
  if (f.stato && stato !== f.stato) return false;
  if (f.dipendente && dip.id !== f.dipendente) return false;
  const ruoli = ruoliOfDip(dip.id);
  if (f.mansione && !ruoli.some((x) => x.id === f.mansione)) return false;
  if (f.incarico && !ruoli.some((x) => x.id === f.incarico)) return false;
  return matchSearch(dip.nome + " " + dip.cognome + " " + (testo || ""));
}

// 1.7 · Il blocco Contratti. Non c'e' un "Fatto": una scadenza contrattuale si
// risolve modificando la scheda (proroga, conferma, trasformazione), e il
// trigger dello storico conserva la data precedente.
function renderContratti(righe) {
  $("contratti-count").textContent = righe.length;
  $("contratti-wrap").hidden = righe.length === 0;
  $("contratti-rows").innerHTML = righe.map((r) => `<div class="comp-row contratti-cols" data-dip="${esc(r.dip.id)}">
      <div><strong>${esc(r.dip.cognome)} ${esc(r.dip.nome)}</strong></div>
      <div>${esc(r.etichetta)}</div>
      <div>${fmtDate(r.data)}</div>
      <div><span class="stato ${r.stato}">${STATO_INFO[r.stato].label}</span></div>
    </div>`).join("");
  els(".comp-row", $("contratti-rows")).forEach((el2) =>
    el2.addEventListener("click", () => openDipModal(el2.dataset.dip)));
}

function renderCompliance() {
  let rows = gapRows();

  // KPI globali (prima dei filtri tabella, ma il filtro stato applica alla tabella).
  const counts = { scaduto: 0, in_scadenza: 0, ok: 0 };
  rows.forEach((r) => counts[r.stato]++);
  $("kpi-scaduto").textContent = counts.scaduto;
  $("kpi-inscadenza").textContent = counts.in_scadenza;
  $("kpi-ok").textContent = counts.ok;
  els('#view-compliance .kpi').forEach((k) => k.classList.toggle("active", k.dataset.cstatus === (state.compFilter.stato || "all")));

  // Filtri. Gli stessi valgono per le righe di sicurezza e per quelle
  // contrattuali (1.7): filtrare "Rossi" deve nascondere entrambe.
  rows = rows.filter((r) => passaFiltriCompliance(r.dip, r.stato, r.tipo.nome));

  // 1.7 · Righe contrattuali: fine prova e fine contratto dei soli dipendenti in
  // forza. NON entrano nei KPI di sicurezza, che restano quelli degli adempimenti.
  const contratti = state.dipendenti
    .flatMap((d) => righeContrattuali(d))
    .filter((r) => passaFiltriCompliance(r.dip, r.stato, r.etichetta))
    .sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  // Modalità Calendario: nasconde le liste e disegna il mese con gli stessi eventi.
  if (state.compView === "calendar") {
    $("comp-wrap").hidden = true;
    $("contratti-wrap").hidden = true;
    $("comp-cal-wrap").hidden = false;
    // Eventi calendario = righe con una data di scadenza utile, piu' i contratti.
    const events = rows.filter((r) => r.scadenza).map((r) => ({
      a: r.adempimento, tipo: r.tipo, dip: r.dip, scadenza: r.scadenza,
    })).concat(contratti.map((r) => ({
      kind: "contratto", dip: r.dip, scadenza: r.data, etichetta: r.etichetta,
    })));
    renderCalendar(events);
    return;
  }
  $("comp-wrap").hidden = false;
  $("comp-cal-wrap").hidden = true;
  renderContratti(contratti);

  const host = $("comp-rows");
  $("comp-empty").hidden = rows.length > 0;
  host.innerHTML = rows.map((r) => {
    const ruoli = ruoliOfDip(r.dip.id);
    const man = ruoli.find((x) => x.tipo === "mansione");
    const inc = ruoli.filter((x) => x.tipo === "incarico");
    const rolesHtml =
      (man ? `<span class="chip mansione">${esc(man.nome)}</span>` : "") +
      inc.map((i) => `<span class="chip incarico">${esc(i.nome)}</span>`).join("");
    const cat = r.tipo.categoria;
    return `<div class="comp-row" data-dip="${r.dip.id}" data-tipo="${r.tipo.id}" data-ad="${r.adempimento ? r.adempimento.id : ''}">
      <div><strong>${esc(r.dip.cognome)} ${esc(r.dip.nome)}</strong></div>
      <div class="comp-roles">${rolesHtml || '<span class="muted">—</span>'}</div>
      <div>${esc(r.tipo.nome)}</div>
      <div><span class="chip cat-${cat}">${CAT_BY_KEY[cat]?.icon || ""} ${CAT_BY_KEY[cat]?.label || cat}</span></div>
      <div>${r.scadenza ? fmtDate(r.scadenza) : '<span class="muted">—</span>'}</div>
      <div><span class="stato ${r.stato}">${STATO_INFO[r.stato].label}</span></div>
    </div>`;
  }).join("");

  // Click sulla riga = apre la scheda di quel SINGOLO adempimento (non quella del dipendente).
  // Se MANCANTE (nessun adempimento ancora creato), pre-popola il tipo requisito.
  els(".comp-row", host).forEach((el2) => el2.addEventListener("click", () => {
    const dipId = el2.dataset.dip;
    const admId = el2.dataset.ad;
    const tipoId = el2.dataset.tipo;
    if (admId) openAdmModal(dipId, admId);
    else openAdmModal(dipId, null, tipoId);
  }));
}

// ---------- Dipendenti ----------
function renderDipendenti() {
  const host = $("dip-cards");
  const list = state.dipendenti
    .filter((d) => matchSearch(d.nome + " " + d.cognome + " " + (d.email || "")))
    .sort((a, b) => (a.cognome || "").localeCompare(b.cognome || ""));
  $("dip-empty").hidden = list.length > 0;
  host.innerHTML = list.map((d) => {
    const ruoli = ruoliOfDip(d.id);
    const man = ruoli.find((x) => x.tipo === "mansione");
    const inc = ruoli.filter((x) => x.tipo === "incarico");
    const rolesHtml =
      (man ? `<span class="chip mansione">${esc(man.nome)}</span>` : "") +
      inc.map((i) => `<span class="chip incarico">${esc(i.nome)}</span>`).join("");
    const gaps = computeGaps(d);
    const c = { scaduto: 0, in_scadenza: 0, ok: 0 };
    gaps.forEach((g) => c[g.stato]++);
    // Requisiti dovuti ma mai registrati (indipendente dal semaforo: per i
    // neoassunti risultano "in_scadenza" fino a scadenza onboarding).
    const daRegistrare = gaps.filter((g) => !(g.adempimento && g.adempimento.data_rilascio)).length;
    const pills = [];
    if (c.scaduto) pills.push(`<span class="gap-pill scaduto">${c.scaduto} scaduti</span>`);
    if (c.in_scadenza) pills.push(`<span class="gap-pill in_scadenza">${c.in_scadenza} in scad.</span>`);
    if (!c.scaduto && !c.in_scadenza) pills.push(`<span class="gap-pill ok">In regola</span>`);
    // Flag onboarding: assunto da meno di 60gg con requisiti ancora da registrare.
    let onboard = "";
    if (d.data_assunzione && d.attivo !== false) {
      const gg = daysUntil(localISO(addDays(parseISO(d.data_assunzione), GG_ONBOARD)));
      if (gg != null && gg >= 0 && daRegistrare > 0) onboard = `<span class="onboard-flag">⏳ ${gg}gg onboarding</span>`;
    }
    return `<div class="dip-card ${d.attivo === false ? "cessato" : ""}" data-dip="${d.id}">
      <div class="dip-card-head">
        <div class="dip-avatar">${esc(initials(d.nome, d.cognome))}</div>
        <div>
          <div class="name">${esc(d.cognome)} ${esc(d.nome)}</div>
          <div class="meta">${d.attivo === false ? "Cessato" : "In forza"}${d.livello_ccnl ? " · Liv. " + esc(d.livello_ccnl) : ""}</div>
        </div>
      </div>
      <div class="dip-card-roles">${rolesHtml || '<span class="muted">Nessun ruolo</span>'}</div>
      <div class="dip-card-foot">
        <div class="dip-gap-summary">${pills.join("")}</div>
        ${onboard}
      </div>
    </div>`;
  }).join("");
  els(".dip-card", host).forEach((el2) => el2.addEventListener("click", () => openDipModal(el2.dataset.dip)));
}

// ---------- Scadenze ----------
function renderCalendar(all) {
  const ref = state.calRef;
  const y = ref.getFullYear(), m = ref.getMonth();
  $("cal-title").textContent = ref.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const first = new Date(y, m, 1);
  let startDow = (first.getDay() + 6) % 7; // lun=0
  const start = new Date(y, m, 1 - startDow);
  const byDay = {};
  all.forEach((x) => { (byDay[x.scadenza] = byDay[x.scadenza] || []).push(x); });

  const grid = $("cal-grid");
  let html = "";
  const todayISO = localISO(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = localISO(d);
    const other = d.getMonth() !== m;
    const evs = byDay[iso] || [];
    const shown = evs.slice(0, 3);
    const evHtml = shown.map((x) => x.kind === "contratto"
      // 1.7 · Un contratto non si "fa": cliccandolo si apre la scheda, dove si
      // proroga, si conferma o si trasforma.
      ? `<div class="cal-event contratto" data-dipcard="${esc(x.dip.id)}" title="${esc(x.etichetta)} — ${esc(x.dip.cognome)}">${esc(x.dip.cognome)}: ${esc(x.etichetta)}</div>`
      : `<div class="cal-event ${x.tipo.categoria}" data-ad="${x.a?.id || ""}" data-tipo="${x.tipo.id}" data-dip="${x.dip.id}" title="${esc(x.tipo.nome)} — ${esc(x.dip.cognome)}">${esc(x.dip.cognome)}: ${esc(x.tipo.nome)}</div>`
    ).join("");
    const more = evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} altri</div>` : "";
    html += `<div class="cal-day ${other ? "other-month" : ""} ${iso === todayISO ? "today" : ""}">
      <div class="cal-day-num">${d.getDate()}</div>${evHtml}${more}</div>`;
  }
  grid.innerHTML = html;
  els(".cal-event", grid).forEach((ev) => ev.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ev.dataset.dipcard) openDipModal(ev.dataset.dipcard);
    else if (ev.dataset.ad) openAdmModal(ev.dataset.dip, ev.dataset.ad);
    else openAdmModal(ev.dataset.dip, null, ev.dataset.tipo);
  }));
}

// ---------- Config ----------
function renderConfig() {
  els(".ct-btn").forEach((b) => b.classList.toggle("active", b.dataset.ctab === state.configTab));
  renderDatiDiProva();
  // 3.2 · Il bottone compare solo quando c'e' qualcosa da rinnovare, e dice quanto.
  const daRinnovareCfg = cedoliniConLinkDaRinnovare().length;
  $("btn-rinnova-link-cedolini").hidden = daRinnovareCfg === 0;
  $("btn-rinnova-link-cedolini").textContent =
    `🔗 Rinnova i collegamenti dei cedolini (${daRinnovareCfg})`;
  $("cfg-ruoli").hidden = state.configTab !== "ruoli";
  $("cfg-categorie").hidden = state.configTab !== "categorie";
  $("cfg-tipi").hidden = state.configTab !== "tipi";
  $("cfg-matrice").hidden = state.configTab !== "matrice";
  $("cfg-onboarding").hidden = state.configTab !== "onboarding";
  $("cfg-modelli").hidden = state.configTab !== "modelli";
  $("cfg-parametri").hidden = state.configTab !== "parametri";
  if (state.configTab === "ruoli") renderRuoliTable();
  else if (state.configTab === "categorie") renderCategorieTable();
  else if (state.configTab === "tipi") renderTipiTable();
  else if (state.configTab === "matrice") renderMatriceTable();
  else if (state.configTab === "onboarding") renderOnboardingItemsTable();
  else if (state.configTab === "modelli") renderModelliTable();
  else if (state.configTab === "parametri") renderParametriTable();
}

// ============================================================
// 3.1 · Parametri — i numeri che cambiano con le norme.
// La chiave e' in SOLA LETTURA: i parametri li crea una migrazione, insieme al
// codice che li legge. Una chiave inventata dall'HR non la leggerebbe nessuno, e
// sembrerebbe una manopola collegata a niente.
// ============================================================
function renderParametriTable() {
  const righe = state.parametri.slice().sort((x, y) => (x.chiave || "").localeCompare(y.chiave || ""));
  $("parametri-table").innerHTML =
    `<div class="cfg-row head cfg-cols-param"><div>Parametro</div><div>Valore</div><div>A cosa serve</div></div>` +
    (righe.length === 0
      ? '<div class="muted" style="padding:14px">Nessun parametro configurato.</div>'
      : righe.map((p) => `<div class="cfg-row cfg-cols-param" data-id="${esc(p.chiave)}">
          <div><strong>${esc(p.chiave)}</strong></div>
          <div>${esc(p.valore)}</div>
          <div class="muted">${esc(p.descrizione || "—")}</div>
        </div>`).join(""));
  els("#parametri-table .cfg-row:not(.head)").forEach((el2) =>
    el2.addEventListener("click", () => openParametroModal(el2.dataset.id)));
}

function openParametroModal(chiave) {
  const p = state.parametri.find((x) => x.chiave === chiave);
  if (!p) return;
  $("param-title").textContent = p.chiave;
  $("param-chiave").value = p.chiave;
  $("param-valore").value = p.valore || "";
  $("param-descrizione").value = p.descrizione || "";
  openModal("modal-parametro");
}

async function saveParametro(e) {
  e.preventDefault();
  const chiave = $("param-chiave").value;
  const prec = state.parametri.find((x) => x.chiave === chiave);
  if (!prec) return;
  const row = {
    ...prec,
    valore: $("param-valore").value.trim(),
    descrizione: $("param-descrizione").value.trim() || null,
    aggiornato_il: new Date().toISOString(),
  };
  if (!row.valore) { alert("Il valore non puo' restare vuoto."); return; }
  if (await sbUpsert("parametri", row)) closeModal("modal-parametro");
}

// Quanti giorni vale il link del portale: dai parametri, con lo stesso ripiego
// che applica il database in parametro_int.
function giorniLinkPortale() { return parametroInt(state.parametri, "portale_giorni_link", 365); }

// 1c · Bottone e didascalia dei dati di prova: esistono finche' esistono quelle
// persone, e spariscono da soli quando non ce ne sono piu'. E' la guardia
// contro il rischio vero della fase — dati finti dimenticati in mezzo a quelli
// veri: finche' il bottone e' li' con un numero sopra, non si puo' non vederlo.
function renderDatiDiProva() {
  const n = dipendentiDiProva(state.dipendenti).length;
  const btn = $("btn-elimina-dati-prova");
  const hint = $("dati-prova-hint");
  btn.hidden = n === 0;
  hint.hidden = n === 0;
  if (!n) return;
  btn.textContent = `🧹 Elimina i dati di prova (${n})`;
  hint.textContent =
    `Nell'app ci sono ${n} persone finte, con il cognome che inizia per "Prova": servono a esercitarsi ` +
    "e non sono dipendenti veri. Premi questo bottone PRIMA di inserire la prima persona vera. " +
    "Vengono cancellati anche i documenti che hai caricato su di loro; il dipendente di collaudo non viene toccato.";
}

function renderCategorieTable() {
  const rows = categorieList();
  $("categorie-table").innerHTML =
    `<div class="cfg-row head cfg-cols-tipi"><div>Nome</div><div>Icona</div><div>Ordine</div><div>ID</div></div>` +
    rows.map((c) => `<div class="cfg-row cfg-cols-tipi" data-id="${esc(c.id)}">
      <div><strong>${esc(c.label)}</strong></div>
      <div>${esc(c.icon || "—")}</div>
      <div class="muted">${c.ordine ?? 100}</div>
      <div class="muted">${esc(c.id)}</div>
    </div>`).join("");
  els("#categorie-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openCategoriaModal(el2.dataset.id)));
}

function renderRuoliTable() {
  const rows = state.ruoli.slice().sort((a, b) => (a.tipo + a.nome).localeCompare(b.tipo + b.nome));
  $("ruoli-table").innerHTML =
    `<div class="cfg-row head cfg-cols-ruoli"><div>Nome</div><div>Tipo</div><div>Minimo richiesto</div></div>` +
    rows.map((r) => {
      const detail = r.tipo === "incarico"
        ? (r.minimo_richiesto ? `min. ${r.minimo_richiesto}` : "—")
        : "—";
      return `<div class="cfg-row cfg-cols-ruoli" data-id="${r.id}">
        <div><strong>${esc(r.nome)}</strong></div>
        <div>${r.tipo === "mansione" ? "🏭 Mansione" : "📌 Incarico"}</div>
        <div class="muted">${detail}</div>
      </div>`;
    }).join("");
  els("#ruoli-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openRuoloModal(el2.dataset.id)));
}

function renderTipiTable() {
  const rows = state.tipi.slice().sort((a, b) => (a.categoria + a.nome).localeCompare(b.categoria + b.nome));
  $("tipi-table").innerHTML =
    `<div class="cfg-row head cfg-cols-tipi"><div>Nome</div><div>Categoria</div><div>Durata</div><div>Riferimento</div></div>` +
    rows.map((t) => `<div class="cfg-row cfg-cols-tipi" data-id="${t.id}">
      <div><strong>${esc(t.nome)}</strong></div>
      <div><span class="chip cat-${t.categoria}">${CAT_BY_KEY[t.categoria]?.icon || ""} ${CAT_BY_KEY[t.categoria]?.label || t.categoria}</span></div>
      <div class="muted">${esc(t.durata_iniziale || "—")}</div>
      <div class="muted">${esc(t.riferimento_normativo || "—")}</div>
    </div>`).join("");
  els("#tipi-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openTipoModal(el2.dataset.id)));
}

function renderMatriceTable() {
  const rows = state.requisiti.slice().sort((a, b) => {
    const ra = ruoloById(a.ruolo_id), rb = ruoloById(b.ruolo_id);
    return ((ra?.nome || "") + (tipoById(a.tipo_requisito_id)?.nome || "")).localeCompare((rb?.nome || "") + (tipoById(b.tipo_requisito_id)?.nome || ""));
  });
  $("matrice-table").innerHTML =
    `<div class="cfg-row head cfg-cols-matrice"><div>Ruolo</div><div>Requisito</div><div>Obblig.</div><div>Validità</div></div>` +
    rows.map((req) => {
      const r = ruoloById(req.ruolo_id), t = tipoById(req.tipo_requisito_id);
      return `<div class="cfg-row cfg-cols-matrice" data-id="${req.id}">
        <div><strong>${esc(r?.nome || "?")}</strong></div>
        <div>${esc(t?.nome || "?")}</div>
        <div>${req.obbligatorio ? "Sì" : "No"}</div>
        <div class="muted">${req.validita_mesi == null ? "non scade" : req.validita_mesi + " mesi"}</div>
      </div>`;
    }).join("");
  els("#matrice-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openReqModal(el2.dataset.id)));
}

// ============================================================
// STORICO — eventi cronologici aggregati: cicli correnti + history archiviati.
// ============================================================
function collectStoricoEvents() {
  const events = [];
  for (const a of state.adempimenti) {
    const dip = dipById(a.dipendente_id);
    const tipo = tipoById(a.tipo_requisito_id);
    if (!dip || !tipo) continue;
    // Voci archiviate (dalla history).
    if (Array.isArray(a.history)) {
      for (const h of a.history) {
        if (!h.doneAt && !h.rilascio) continue;
        events.push({
          data: h.doneAt || h.rilascio,
          dip, tipo,
          rilascio: h.rilascio || null,
          scadenza: h.scadenza || h.dueDate || null,
          docPath: h.documentoPath || null,
          docUrl: null,
          note: h.note || null,
          source: "history",
          admId: a.id,
        });
      }
    }
    // Ciclo corrente (se registrato).
    if (a.data_rilascio) {
      events.push({
        data: a.data_rilascio,
        dip, tipo,
        rilascio: a.data_rilascio,
        scadenza: a.data_scadenza || null,
        docPath: a.documento_path || null,
        docUrl: a.documento_url || null,
        note: a.note || null,
        source: a.corrente === false ? "history" : "current",
        admId: a.id,
      });
    }
  }
  // Ordina dal più recente al più vecchio.
  events.sort((x, y) => (y.data || "").localeCompare(x.data || ""));
  return events;
}

function filterStorico(events) {
  const f = state.storicoFilter;
  return events.filter((e) => {
    if (f.dipendente && e.dip.id !== f.dipendente) return false;
    if (f.tipo && e.tipo.id !== f.tipo) return false;
    if (f.categoria && e.tipo.categoria !== f.categoria) return false;
    if (f.anno) {
      const y = (e.data || "").slice(0, 4);
      if (y !== f.anno) return false;
    }
    if (f.mese) {
      const m = (e.data || "").slice(5, 7);
      if (m !== f.mese) return false;
    }
    const hay = `${e.dip.nome} ${e.dip.cognome} ${e.tipo.nome} ${e.note || ""}`;
    if (!matchSearch(hay)) return false;
    return true;
  });
}

function populateStoricoFilters() {
  // Dipendenti
  const dips = state.dipendenti.slice().sort((a, b) => (a.cognome || "").localeCompare(b.cognome || ""));
  fillSelect($("filter-st-dipendente"), dips, {
    placeholder: "Tutti i dipendenti",
    label: (d) => `${d.cognome} ${d.nome}`,
  });
  // Tipi
  const tipi = state.tipi.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  fillSelect($("filter-st-tipo"), tipi, {
    placeholder: "Tutti i tipi",
    label: (t) => `${CAT_BY_KEY[t.categoria]?.icon || ""} ${t.nome}`,
  });
  // Categorie (da DB)
  const cats = categorieList();
  $("filter-st-categoria").innerHTML = `<option value="">Tutte le categorie</option>` +
    cats.map((c) => `<option value="${esc(c.id)}">${esc((c.icon ? c.icon + " " : "") + c.label)}</option>`).join("");
  // Anni (dalle date degli eventi).
  const anni = [...new Set(collectStoricoEvents().map((e) => (e.data || "").slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  $("filter-st-anno").innerHTML = `<option value="">Tutti gli anni</option>` + anni.map((y) => `<option value="${y}">${y}</option>`).join("");
  // Ripristina selezioni.
  const f = state.storicoFilter;
  $("filter-st-dipendente").value = f.dipendente;
  $("filter-st-tipo").value = f.tipo;
  $("filter-st-categoria").value = f.categoria;
  $("filter-st-anno").value = f.anno;
  $("filter-st-mese").value = f.mese;
}

function renderStorico() {
  populateStoricoFilters();
  const all = collectStoricoEvents();
  const filtered = filterStorico(all);
  // Riepilogo.
  const dipsCount = new Set(filtered.map((e) => e.dip.id)).size;
  $("storico-summary").innerHTML = `Eventi: <strong>${filtered.length}</strong> · Dipendenti coinvolti: <strong>${dipsCount}</strong>`;
  // Lista.
  const host = $("storico-rows");
  $("storico-empty").hidden = filtered.length > 0;
  host.innerHTML = filtered.map((e) => {
    const cat = e.tipo.categoria;
    const hasDoc = e.docPath || e.docUrl;
    const sourceTxt = e.source === "history" ? "archiviato" : "corrente";
    return `<div class="storico-row ${e.source === "history" ? "archived" : ""}" data-source="${e.source}" data-ad="${e.admId}" data-doc="${esc(e.docPath || "")}" data-docurl="${esc(e.docUrl || "")}">
      <div></div>
      <div><strong>${fmtDate(e.data)}</strong><div class="sub">${sourceTxt}</div></div>
      <div>${esc(e.dip.cognome)} ${esc(e.dip.nome)}</div>
      <div><strong>${esc(e.tipo.nome)}</strong></div>
      <div>${e.scadenza ? fmtDate(e.scadenza) : '<span class="muted">—</span>'}</div>
      <div><span class="chip cat-${cat}">${CAT_BY_KEY[cat]?.icon || ""} ${CAT_BY_KEY[cat]?.label || cat}</span></div>
      <div>${hasDoc ? `<button type="button" class="doc-link doc-link-btn" title="Apri documento">📎</button>` : '<span class="doc-link disabled">📎</span>'}</div>
    </div>`;
  }).join("");
  // Click riga → apre l'adempimento di provenienza (per vedere contesto / history).
  els(".storico-row", host).forEach((row) => row.addEventListener("click", () => {
    const adm = state.adempimenti.find((a) => a.id === row.dataset.ad);
    if (adm) openAdmModal(adm.dipendente_id, adm.id);
  }));
  // Click 📎 → apre il PDF (signed url se path, link diretto se url esterno).
  els(".doc-link-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const row = btn.closest(".storico-row");
    const path = row.dataset.doc;
    const url = row.dataset.docurl;
    if (path) {
      const adm = state.adempimenti.find((a) => a.id === row.dataset.ad);
      await openAdempimentoDoc(adm, path);
    } else if (url) {
      window.open(url, "_blank", "noopener");
    }
  }));
}

function exportStoricoExcel() {
  if (!window.XLSX) { alert("Libreria Excel non caricata."); return; }
  const rows = filterStorico(collectStoricoEvents()).map((e) => ({
    Data: e.data ? fmtDate(e.data) : "",
    Cognome: e.dip.cognome,
    Nome: e.dip.nome,
    Requisito: e.tipo.nome,
    Categoria: CAT_BY_KEY[e.tipo.categoria]?.label || e.tipo.categoria,
    "Data rilascio": e.rilascio ? fmtDate(e.rilascio) : "",
    "Data scadenza": e.scadenza ? fmtDate(e.scadenza) : "",
    "Documento": (e.docPath || e.docUrl) ? "Sì" : "No",
    Stato: e.source === "history" ? "Archiviato" : "Corrente",
  }));
  if (!rows.length) { alert("Nessun evento da esportare con i filtri attuali."); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Storico");
  XLSX.writeFile(wb, `HR-storico-${localISO(new Date())}.xlsx`);
}

// ============================================================
// MODALI
// ============================================================
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

// ---------- Dipendente ----------
function fillSelect(sel, items, { value = "id", label = "nome", placeholder = null } = {}) {
  sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") +
    items.map((i) => `<option value="${esc(i[value])}">${esc(typeof label === "function" ? label(i) : i[label])}</option>`).join("");
}

// ============================================================
// 2.2 - La mappa dei campi della scheda dipendente.
// Prima questa lista esisteva due volte, in due ordini diversi: 41 assegnazioni
// in openDipModal e 41 chiavi in saveDip. Aggiungere un campo voleva dire
// ricordarsene in due posti, e dimenticarne uno non dava nessun errore: dava un
// campo che si compila e non si salva, o che si salva e riapre vuoto.
//
// ATTENZIONE: l'id sta scritto in `idCampo` apposta. tests/test-dom-ids.mjs
// riconosce quella chiave e controlla che l'elemento esista davvero in
// index.html. Senza, spostare 41 id dentro un array li toglierebbe dall'unica
// rete che esiste sotto questa modale, e un refuso diventerebbe un campo che non
// si salva, in silenzio.
//
//   tipo             testo | data | scelta (select) | numero | spunta (checkbox)
//   maiNull          campo di testo che NON diventa null se vuoto (e' required)
//   maiuscolo        normalizzato in maiuscolo (le sigle di provincia)
//   soloSe           se ritorna false si salva null invece del valore letto
//   scritturaAParte  scriviCampiDipendente lo salta (ha una regola sua)
// ============================================================
const dipDomicilioDiverso = () => $("dip-dom-diverso").checked;
const dipDeterminato = () => $("dip-tipo-contratto").value === CONTRATTO_DETERMINATO;
const dipCessato = () => !$("dip-attivo").checked;

const CAMPI_DIPENDENTE = [
  // Dati di base
  { idCampo: "dip-nome",           campo: "nome",            tipo: "testo", maiNull: true },
  { idCampo: "dip-cognome",        campo: "cognome",         tipo: "testo", maiNull: true },
  { idCampo: "dip-cf",             campo: "codice_fiscale",  tipo: "testo" },
  { idCampo: "dip-nascita",        campo: "data_nascita",    tipo: "data" },
  { idCampo: "dip-assunzione",     campo: "data_assunzione", tipo: "data" },
  { idCampo: "dip-livello",        campo: "livello_ccnl",    tipo: "scelta" },
  { idCampo: "dip-email",          campo: "email",           tipo: "testo" },
  { idCampo: "dip-telefono",       campo: "telefono",        tipo: "testo" },
  { idCampo: "dip-attivo",         campo: "attivo",          tipo: "spunta", scritturaAParte: true },
  { idCampo: "dip-note",           campo: "note",            tipo: "testo" },
  // Dati personali estesi
  { idCampo: "dip-luogo-nascita",  campo: "luogo_nascita",   tipo: "testo" },
  { idCampo: "dip-sesso",          campo: "sesso",           tipo: "scelta" },
  { idCampo: "dip-cittadinanza",   campo: "cittadinanza",    tipo: "testo" },
  { idCampo: "dip-stato-civile",   campo: "stato_civile",    tipo: "scelta" },
  { idCampo: "dip-titolo-studio",  campo: "titolo_studio",   tipo: "testo" },
  // Residenza e domicilio
  { idCampo: "dip-res-indirizzo",  campo: "residenza_indirizzo",  tipo: "testo" },
  { idCampo: "dip-res-cap",        campo: "residenza_cap",        tipo: "testo" },
  { idCampo: "dip-res-citta",      campo: "residenza_citta",      tipo: "testo" },
  { idCampo: "dip-res-prov",       campo: "residenza_provincia",  tipo: "testo", maiuscolo: true },
  { idCampo: "dip-dom-diverso",    campo: "domicilio_diverso",    tipo: "spunta" },
  { idCampo: "dip-dom-indirizzo",  campo: "domicilio_indirizzo",  tipo: "testo", soloSe: dipDomicilioDiverso },
  { idCampo: "dip-dom-cap",        campo: "domicilio_cap",        tipo: "testo", soloSe: dipDomicilioDiverso },
  { idCampo: "dip-dom-citta",      campo: "domicilio_citta",      tipo: "testo", soloSe: dipDomicilioDiverso },
  { idCampo: "dip-dom-prov",       campo: "domicilio_provincia",  tipo: "testo", maiuscolo: true, soloSe: dipDomicilioDiverso },
  // Contratto
  { idCampo: "dip-tipo-contratto",      campo: "tipo_contratto",      tipo: "scelta" },
  { idCampo: "dip-data-fine-contratto", campo: "data_fine_contratto", tipo: "data", soloSe: dipDeterminato },
  { idCampo: "dip-data-fine-prova",     campo: "data_fine_prova",     tipo: "data" },
  { idCampo: "dip-qualifica",           campo: "qualifica",           tipo: "scelta" },
  { idCampo: "dip-orario",              campo: "orario_tipo",         tipo: "scelta" },
  { idCampo: "dip-ore",                 campo: "ore_settimanali",     tipo: "numero" },
  { idCampo: "dip-sede",                campo: "sede_lavoro",         tipo: "testo" },
  // Contatto di emergenza
  { idCampo: "dip-emerg-nome",      campo: "emergenza_nome",      tipo: "testo" },
  { idCampo: "dip-emerg-tel",       campo: "emergenza_telefono",  tipo: "testo" },
  { idCampo: "dip-emerg-parentela", campo: "emergenza_parentela", tipo: "scelta" },
  // Cessazione: si scrivono solo se la persona NON e' in forza.
  { idCampo: "dip-data-cessazione",   campo: "data_cessazione",   tipo: "data",   soloSe: dipCessato },
  { idCampo: "dip-motivo-cessazione", campo: "motivo_cessazione", tipo: "scelta", soloSe: dipCessato },
];

// IBAN e RAL non sono in questa tabella e non devono tornarci (voce 0.5): sono
// dati del consulente del lavoro, l'app non li usa, e sono i due che fanno piu'
// danno in caso di accesso indebito. Le colonne restano nel database e i valori
// esistenti non vengono toccati: sbUpsert scrive solo le colonne che riceve.

// Dal dipendente al form.
function scriviCampiDipendente(d) {
  for (const c of CAMPI_DIPENDENTE) {
    if (c.scritturaAParte) continue;
    const elemento = $(c.idCampo);
    const v = d ? d[c.campo] : null;
    if (c.tipo === "spunta") elemento.checked = !!v;
    else if (c.tipo === "numero") elemento.value = v ?? "";
    else elemento.value = v || "";
  }
}

// Dal form al dipendente.
function leggiCampiDipendente() {
  const row = {};
  for (const c of CAMPI_DIPENDENTE) {
    const elemento = $(c.idCampo);
    if (c.tipo === "spunta") { row[c.campo] = elemento.checked; continue; }
    if (c.soloSe && !c.soloSe()) { row[c.campo] = null; continue; }
    if (c.tipo === "numero") { row[c.campo] = elemento.value ? parseFloat(elemento.value) : null; continue; }
    if (c.tipo === "data" || c.tipo === "scelta") { row[c.campo] = elemento.value || null; continue; }
    let testo = elemento.value.trim();
    if (c.maiuscolo) testo = testo.toUpperCase();
    row[c.campo] = c.maiNull ? testo : (testo || null);
  }
  return row;
}

// ============================================================
// 2.3 · Le cinque linguette della scheda dipendente.
// Due mestieri distinti: renderDipTabs DISEGNA, mostraLinguetta SCEGLIE.
// I contenitori si riconoscono da `data-dtab`, mai da un id composto a mano
// ($("dip-tab-" + tab)): quello uscirebbe dal controllo di test-dom-ids, che
// vede solo i letterali, ed e' l'unica rete sotto lo spostamento di questo HTML.
// ============================================================
function renderDipTabs() {
  els("#modal-dip .dt-btn").forEach((b) => b.classList.toggle("active", b.dataset.dtab === state.dipTab));
  els("#modal-dip .dip-tab-panel").forEach((p) => (p.hidden = p.dataset.dtab !== state.dipTab));
}

function mostraLinguetta(tab) {
  state.dipTab = tab;
  renderDipTabs();
}

function openDipModal(id) {
  const d = id ? dipById(id) : null;
  $("dip-title").textContent = d ? `${d.cognome} ${d.nome}` : "Nuovo dipendente";
  $("dip-id").value = d ? d.id : "";
  // Riaprire una scheda deve mostrare sempre la stessa faccia.
  mostraLinguetta("anagrafica");
  // Le tendine dei lookup vanno riempite PRIMA di scriverci dentro un valore
  // (idempotente: riscrivere le option e' ok).
  fillSelect($("dip-livello"), (window.LIVELLI_CCNL || []).map((l) => ({ id: l, nome: "Livello " + l })), { placeholder: "—" });
  fillSelect($("dip-sesso"), (window.SESSI || []).map((s) => ({ id: s.key, nome: s.label })), { placeholder: "—" });
  fillSelect($("dip-stato-civile"), (window.STATI_CIVILI || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });
  fillSelect($("dip-tipo-contratto"), (window.TIPI_CONTRATTO || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });
  fillSelect($("dip-qualifica"), (window.QUALIFICHE || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });
  fillSelect($("dip-orario"), (window.ORARI || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });
  fillSelect($("dip-emerg-parentela"), (window.PARENTELE || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });
  fillSelect($("dip-motivo-cessazione"), (window.MOTIVI_CESSAZIONE || []).map((s) => ({ id: s, nome: s })), { placeholder: "—" });

  // 2.2 - Tutti i campi in una riga sola, dalla stessa tabella che legge saveDip.
  scriviCampiDipendente(d);
  // L'unica eccezione della tabella: una persona NUOVA nasce in forza.
  $("dip-attivo").checked = d ? d.attivo !== false : true;

  // Blocchi che si mostrano o si nascondono a seconda dei valori appena scritti.
  $("dip-dom-block").hidden = !d?.domicilio_diverso;
  $("dip-fine-contr-wrap").hidden = (d?.tipo_contratto || "") !== CONTRATTO_DETERMINATO;
  $("dip-cessazione-section").hidden = !(d && d.attivo === false);

  // Taglie DPI: quattro tendine che diventano UN SOLO oggetto JSON, e viceversa.
  // Non e' una corrispondenza campo -> colonna, quindi resta fuori dalla tabella.
  populaTaglieDipDropdowns();
  const taglie = d?.taglie_dpi || {};
  $("dip-taglia-scarpe").value = taglie.scarpe || "";
  $("dip-taglia-tuta").value = taglie.tuta || "";
  $("dip-taglia-guanti").value = taglie.guanti || "";
  $("dip-taglia-maschera").value = taglie.maschera || "";

  // Tutte le sezioni collassabili partono chiuse.
  els(".dip-section .dip-section-body").forEach((b) => (b.hidden = true));
  els(".dip-section .history-arrow").forEach((a) => a.classList.remove("expanded"));

  // Mansione (1) + incarichi (checkbox), ciascuno con la sua data di nomina e
  // il suo atto (1.5). Le righe revocate restano in fondo, in sola lettura.
  const attive = d ? assegnazioniOfDip(d.id) : [];
  const perRuolo = new Map(attive.map((a) => [a.ruolo_id, a]));
  fillSelect($("dip-mansione"), mansioniList(), { placeholder: "— seleziona —" });
  const curMan = attive.find((a) => a.ruolo.tipo === "mansione") || null;
  $("dip-mansione").value = curMan ? curMan.ruolo_id : "";
  // ATTENZIONE: `dal` NON si precompila mai su una riga che esiste gia'. Se
  // scrivessimo oggi, il primo salvataggio della scheda registrerebbe la data di
  // oggi come data di nomina di un incarico vecchio di anni. Vuoto = non nota.
  $("dip-mansione-dal").value = curMan?.dal || "";

  $("dip-incarichi").innerHTML = incarichiList().map((i) => {
    const a = perRuolo.get(i.id);
    return `<div class="inc-row" data-ruolo="${esc(i.id)}" data-esistente="${a ? "1" : ""}">
      <label class="inline-check"><input type="checkbox" class="inc-check" value="${esc(i.id)}" ${a ? "checked" : ""}> <span>${esc(i.nome)}</span></label>
      <div class="inc-dettagli" ${a ? "" : "hidden"}>
        <label><span>dal</span><input type="date" class="inc-dal" value="${esc(a?.dal || "")}"></label>
        <label><span>atto di nomina</span><input type="file" class="inc-file" accept=".pdf,image/*"></label>
        ${a?.documento_path ? `<button type="button" class="icon-btn inc-doc" data-path="${esc(a.documento_path)}" title="Apri l'atto di nomina">📎</button>` : ""}
      </div>
    </div>`;
  }).join("") || '<span class="muted">Nessun incarico configurato.</span>';

  els("#dip-incarichi .inc-check").forEach((c) => c.addEventListener("change", () => {
    const riga = c.closest(".inc-row");
    el(".inc-dettagli", riga).hidden = !c.checked;
    // Una casella appena spuntata e' una nomina che avviene ORA: quella data,
    // a differenza di quelle gia' in archivio, la conosciamo. Ma solo se
    // l'incarico NON era gia' assegnato all'apertura della scheda: togliere e
    // rimettere la spunta a un incarico vecchio senza data non deve stampargli
    // la data di oggi, che sarebbe falsa.
    const dal = el(".inc-dal", riga);
    if (c.checked && !dal.value && !riga.dataset.esistente) dal.value = localISO(new Date());
  }));
  els("#dip-incarichi .inc-doc").forEach((b) => b.addEventListener("click", () => openSignedDoc(b.dataset.path)));

  const revocate = d ? assegnazioniOfDip(d.id, { conRevocate: true }).filter((a) => !assegnazioneAttiva(a)) : [];
  revocate.sort((a, b) => (b.al || "").localeCompare(a.al || ""));
  $("dip-incarichi-revocati").innerHTML = revocate.length
    ? '<div class="rev-titolo">Revocati</div>' + revocate.map((a) =>
        `<div class="rev-row">
          <span class="rev-nome">${esc(a.ruolo.nome)}</span>
          <span>dal ${a.dal ? fmtDate(a.dal) : "—"} al ${fmtDate(a.al)}</span>
          ${a.documento_path ? `<button type="button" class="icon-btn rev-doc" data-path="${esc(a.documento_path)}" title="Apri l'atto di nomina">📎</button>` : ""}
        </div>`).join("")
    : "";
  els("#dip-incarichi-revocati .rev-doc").forEach((b) => b.addEventListener("click", () => openSignedDoc(b.dataset.path)));

  $("dip-delete").hidden = !d;
  // Genera link self-service: per qualunque dipendente esistente.
  $("dip-invite").hidden = !d;

  // Adempimenti del dipendente.
  const section = $("dip-adempimenti-section");
  section.hidden = !d;
  if (d) renderDipAdempimenti(d.id);

  // Checklist onboarding — sincronizza progressi mancanti, poi renderizza.
  if (d) {
    syncOnboardingProgressi(d.id).then(() => renderDipOnboarding(d.id));
  } else {
    // Tutte e due, o "Nuovo dipendente" mostrerebbe la checklist di uscita di
    // chi era aperto un momento prima.
    $("dip-onboard-section").hidden = true;
    $("dip-uscita-section").hidden = true;
  }

  // DPI consegnati.
  if (d) renderDipDPI(d.id);
  else $("dip-dpi-section").hidden = true;

  // Provvedimenti disciplinari del dipendente.
  if (d) renderDipProvvedimenti(d.id);
  else $("dip-provv-section").hidden = true;

  // 3.2 · Cedolini della persona.
  if (d) renderDipCedolini(d.id);
  else $("dip-cedolini-section").hidden = true;

  // Modifiche registrate dal database (1.6).
  if (d) renderDipModifiche(d.id);
  else $("dip-modifiche-section").hidden = true;

  // Storico esecuzioni del dipendente (tutte).
  if (d) renderDipHistory(d.id);
  else $("dip-history-section").hidden = true;

  openModal("modal-dip");
}

// ============================================================
// DPI — Dispositivi di Protezione Individuale
// ============================================================
function renderDipDPI(dipId) {
  const dip = dipById(dipId);
  const section = $("dip-dpi-section");
  if (!dip) { section.hidden = true; return; }
  const list = state.dpiConsegne
    .filter((c) => c.dipendente_id === dipId)
    .sort((a, b) => (b.data_consegna || "").localeCompare(a.data_consegna || ""));
  section.hidden = false;
  $("dip-dpi-count").textContent = `${list.length}`;

  const host = $("dip-dpi-list");
  if (!list.length) {
    host.innerHTML = '<div class="muted" style="padding:8px 0">Nessuna consegna registrata. Click su "+ Consegna DPI" per la prima.</div>';
    return;
  }
  host.innerHTML = list.map((c) => {
    const t = state.dpiTipi.find((x) => x.id === c.dpi_tipo_id);
    const tagliaTxt = c.taglia ? ` · taglia ${esc(c.taglia)}` : "";
    const qtaTxt = c.quantita > 1 ? ` · ${c.quantita} pz` : "";
    return `<div class="hist-row dpi-row" data-id="${esc(c.id)}">
      <div><strong>${esc(t?.icon || "🦺")} ${esc(t?.nome || c.dpi_tipo_id)}</strong><div class="hist-note">${esc(fmtDate(c.data_consegna))}${tagliaTxt}${qtaTxt}${c.consegnato_da ? " · cons. " + esc(c.consegnato_da) : ""}</div></div>
      ${c.modulo_path ? `<button type="button" class="hist-doc dpi-doc-btn" data-path="${esc(c.modulo_path)}" title="Apri modulo firmato">📎</button>` : '<span class="hist-doc disabled">—</span>'}
    </div>`;
  }).join("");
  els(".dpi-row", host).forEach((row) => row.addEventListener("click", (ev) => {
    if (ev.target.tagName === "BUTTON") return;
    openDpiModal(dipId, row.dataset.id);
  }));
  els(".dpi-doc-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await openSignedDoc(btn.dataset.path);
  }));
}

// Toggle generico delle sezioni richiudibili nella scheda dipendente/adempimento.
function toggleSection(toggleId, listId) {
  const list = $(listId);
  const btn = $(toggleId);
  const arrow = el(".history-arrow", btn);
  const willShow = list.hidden;
  list.hidden = !willShow;
  if (arrow) arrow.classList.toggle("expanded", willShow);
  btn.setAttribute("aria-expanded", willShow ? "true" : "false");
}

let pendingDpiFile = null;

function openDpiModal(dipId, consegnaId) {
  const c = consegnaId ? state.dpiConsegne.find((x) => x.id === consegnaId) : null;
  const dip = dipById(dipId);
  $("dpi-title").textContent = c ? "Consegna DPI" : "Nuova consegna DPI";
  $("dpi-id").value = c ? c.id : "";
  $("dpi-dip-id").value = dipId;
  $("dpi-target").textContent = dip ? `${dip.cognome} ${dip.nome}` : "—";

  // Popola dropdown dei tipi DPI ordinato per "ordine".
  const tipiOrdinati = state.dpiTipi.slice().sort((a, b) => (a.ordine ?? 100) - (b.ordine ?? 100));
  fillSelect($("dpi-tipo"), tipiOrdinati.map((t) => ({ id: t.id, nome: (t.icon ? t.icon + " " : "") + t.nome })), { placeholder: "— seleziona —" });
  $("dpi-tipo").value = c?.dpi_tipo_id || "";

  // Popola taglie in base al tipo selezionato e alle preferenze del dipendente.
  aggiornaTaglieDpi();
  $("dpi-taglia").value = c?.taglia || tagliaSuggeritaDip(dip, c?.dpi_tipo_id) || "";

  $("dpi-quantita").value = c?.quantita ?? 1;
  $("dpi-data").value = c?.data_consegna || localISO(new Date());
  $("dpi-consegnato-da").value = c?.consegnato_da || localStorage.getItem("hr_last_operator") || "";
  $("dpi-note").value = c?.note || "";
  $("dpi-delete").hidden = !c;
  pendingDpiFile = null;
  $("dpi-doc-file").value = "";
  $("dpi-doc-upload-label").textContent = "Carica un file";
  $("dpi-doc-progress").hidden = true;
  $("dpi-doc-current").hidden = !c?.modulo_path;
  if (c?.modulo_path) $("dpi-doc-current-name").textContent = "Modulo del " + fmtDate(c.data_consegna);
  openModal("modal-dpi");
}

function aggiornaTaglieDpi() {
  const tipoId = $("dpi-tipo").value;
  const tipo = state.dpiTipi.find((t) => t.id === tipoId);
  const taglie = tipo?.taglie_disponibili || [];
  const cur = $("dpi-taglia").value;
  $("dpi-taglia").innerHTML = '<option value="">—</option>' + (Array.isArray(taglie) ? taglie : [])
    .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if (cur && taglie.includes(cur)) $("dpi-taglia").value = cur;
}

// Popola i dropdown "Taglie DPI" nella modale dipendente.
function populaTaglieDipDropdowns() {
  const popula = (selId, tipoId) => {
    const tipo = state.dpiTipi.find((t) => t.id === tipoId);
    const taglie = tipo?.taglie_disponibili || [];
    $(selId).innerHTML = '<option value="">—</option>' +
      (Array.isArray(taglie) ? taglie : [])
        .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  };
  popula("dip-taglia-scarpe",   "dpi-scarpe");
  popula("dip-taglia-tuta",     "dpi-tuta");
  popula("dip-taglia-guanti",   "dpi-guanti-chim");
  popula("dip-taglia-maschera", "dpi-maschera");
}

function tagliaSuggeritaDip(dip, tipoId) {
  if (!dip?.taglie_dpi || !tipoId) return "";
  // dip.taglie_dpi è un oggetto del tipo {scarpe:"43", tuta:"L", ...} con chiave libera.
  // Mappa "tipo dpi" → chiave preferita.
  const key = tipoId.replace(/^dpi-/, "").replace(/-.*/, ""); // dpi-scarpe → "scarpe"
  return dip.taglie_dpi[key] || "";
}

async function saveDpiConsegna(e) {
  e.preventDefault();
  const id = $("dpi-id").value || uid();
  const dipId = $("dpi-dip-id").value;
  const prev = state.dpiConsegne.find((x) => x.id === id) || null;
  const consegnatoDa = $("dpi-consegnato-da").value.trim() || null;
  if (consegnatoDa) localStorage.setItem("hr_last_operator", consegnatoDa);

  // Valida i campi obbligatori PRIMA di caricare il file: niente upload orfano se manca tipo/data.
  const dpiTipoId = $("dpi-tipo").value;
  const dpiDataConsegna = $("dpi-data").value;
  if (!dpiTipoId || !dpiDataConsegna) { alert("Tipo DPI e data consegna sono obbligatori."); return; }

  // Upload modulo se selezionato.
  const oldModuloPath = prev?.modulo_path || null;
  let modulo_path = oldModuloPath;
  let uploadedModuloPath = null;
  if (pendingDpiFile) {
    $("dpi-doc-progress").hidden = false;
    try {
      const ext = (pendingDpiFile.name.split(".").pop() || "bin").toLowerCase();
      const path = `dpi-${id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, pendingDpiFile, {
        upsert: false, contentType: pendingDpiFile.type || "application/octet-stream",
      });
      if (error) throw error;
      uploadedModuloPath = path;
      modulo_path = path;
    } catch (err) {
      $("dpi-doc-progress").hidden = true;
      alert("Errore upload modulo: " + err.message);
      return;
    }
    $("dpi-doc-progress").hidden = true;
  }

  const row = {
    id,
    dipendente_id: dipId,
    dpi_tipo_id: dpiTipoId,
    data_consegna: dpiDataConsegna,
    prossima_sostituzione: null,
    taglia: $("dpi-taglia").value || null,
    quantita: parseInt($("dpi-quantita").value, 10) || 1,
    modulo_path,
    consegnato_da: consegnatoDa,
    note: $("dpi-note").value.trim() || null,
  };
  const ok = await sbUpsert("dpi_consegne", row);
  if (!ok) { if (uploadedModuloPath) await deleteDoc(uploadedModuloPath); return; }
  if (uploadedModuloPath && oldModuloPath) await deleteDoc(oldModuloPath);   // il vecchio file solo a salvataggio riuscito
  pendingDpiFile = null;
  closeModal("modal-dpi");
  renderDipDPI(dipId);
}

async function deleteDpiConsegna() {
  const id = $("dpi-id").value;
  if (!id) return;
  if (!confirm("Eliminare questa consegna DPI e il modulo firmato?")) return;
  const dipId = $("dpi-dip-id").value;
  const prev = state.dpiConsegne.find((x) => x.id === id);
  if (prev?.modulo_path) await deleteDoc(prev.modulo_path);
  await sbDelete("dpi_consegne", id);
  closeModal("modal-dpi");
  renderDipDPI(dipId);
}

// ============================================================
// ONBOARDING CHECKLIST
// ============================================================
// Crea le righe progressi mancanti per un dipendente (idempotente).
async function syncOnboardingProgressi(dipId) {
  const dip = dipById(dipId);
  if (!dip) return;
  const have = new Set(state.onboardProgressi.filter((p) => p.dipendente_id === dipId).map((p) => p.item_id));
  // 2.1 · Chi e' in forza riceve solo le voci d'ingresso, chi e' cessato (con la
  // sua data) solo quelle d'uscita. La regola sta in common.js con i test.
  const rows = itemsOnboardingDaSincronizzare({ dip, items: state.onboardItems, itemIdEsistenti: have })
    .map((item) => ({
      id: uid(),
      dipendente_id: dipId,
      item_id: item.id,
      fatto: false,
      fatto_il: null,
      fatto_da: null,
      documento_path: null,
      note: null,
    }));
  if (!rows.length) return;
  // Un solo round-trip e un solo render, non uno per voce.
  const { error } = await sb.from("onboarding_progressi").upsert(rows);
  if (error) {
    if (isAuthError(error)) showLogin("Sessione scaduta. Rientra.");
    else console.warn("syncOnboardingProgressi:", error.message);
    return;
  }
  state.onboardProgressi.push(...rows);
  renderAll();
}

// 2.1 · scadenzaOnboardingItem e' passata in common.js: la data di base non e'
// piu' sempre l'assunzione (per le voci d'uscita e' la cessazione), ed e' una
// regola su date, quindi vive dove ci sono i test.

function renderDipOnboarding(dipId) {
  const dip = dipById(dipId);
  const sezIngresso = $("dip-onboard-section");
  const sezUscita = $("dip-uscita-section");
  if (!dip) { sezIngresso.hidden = true; sezUscita.hidden = true; return; }
  const items = state.onboardItems.slice().sort((a, b) => (a.ordine ?? 100) - (b.ordine ?? 100));
  const progressiByItem = Object.fromEntries(
    state.onboardProgressi.filter((p) => p.dipendente_id === dipId).map((p) => [p.item_id, p])
  );
  const perFase = (f) => items.filter((it) => (it.fase || "ingresso") === f);

  disegnaChecklist({ dip, items: perFase("ingresso"), progressiByItem,
    idSezione: "dip-onboard-section", idConteggio: "dip-onboard-count", idLista: "dip-onboard-list" });

  // La checklist di uscita esiste solo per chi se ne e' andato, E solo se la sua
  // data di cessazione c'e'. La condizione e' la STESSA di
  // itemsOnboardingDaSincronizzare: senza la data quelle righe non vengono
  // create, e disegnarle lo stesso darebbe sette voci con la spunta che non
  // salva niente e nessun termine. A una persona in forza non si mostra vuota:
  // non si mostra affatto.
  if (dip.attivo === false && dip.data_cessazione) {
    disegnaChecklist({ dip, items: perFase("uscita"), progressiByItem,
      idSezione: "dip-uscita-section", idConteggio: "dip-uscita-count", idLista: "dip-uscita-list" });
  } else {
    sezUscita.hidden = true;
  }
}

// Disegna UNA delle due checklist. Il corpo e' quello di sempre: separarlo per
// fase avrebbe voluto dire due copie della stessa logica di stato, allegati e
// click, cioe' il modo sicuro di farle divergere.
function disegnaChecklist({ dip, items, progressiByItem, idSezione, idConteggio, idLista }) {
  const dipId = dip.id;
  const section = $(idSezione);
  if (!items.length) { section.hidden = true; return; }

  // Calcolo lo stato di ogni voce: derivato dall'adempimento (per crea_adempimento)
  // o dal progresso (per gli altri).
  const rows = items.map((item) => {
    if (item.tipo_workflow === "crea_adempimento") {
      const tipoReqId = item.adempimento_tipo_id;
      const adm = state.adempimenti.find((a) => a.dipendente_id === dipId && a.tipo_requisito_id === tipoReqId && a.corrente !== false);
      if (!adm) return { item, derived: true, applicabile: false, fatto: false };
      return {
        item, derived: true, applicabile: true,
        fatto: !!adm.data_rilascio,
        data: adm.data_rilascio,
        doc: adm.documento_path,
        admId: adm.id,
      };
    }
    const p = progressiByItem[item.id];
    return {
      item, derived: false, applicabile: true,
      fatto: !!p?.fatto,
      data: p?.fatto_il,
      doc: p?.documento_path,
      progrId: p?.id,
      da: p?.fatto_da,
    };
  });

  const totale = rows.filter((r) => r.applicabile).length;
  const fatti = rows.filter((r) => r.applicabile && r.fatto).length;
  $(idConteggio).textContent = `${fatti}/${totale}`;
  section.hidden = false;

  const host = $(idLista);
  host.innerHTML = rows.map((r) => {
    const item = r.item;
    if (!r.applicabile) {
      return `<div class="hist-row onboard-row" style="opacity:.55" data-applicabile="0">
        <div><input type="checkbox" disabled></div>
        <div><strong>${esc(item.label)}</strong><div class="hist-note">Non richiesto dal ruolo del dipendente</div></div>
        <div class="hist-meta"><span class="muted">—</span></div>
        <span class="hist-doc disabled">—</span>
      </div>`;
    }
    const scadenza = scadenzaOnboardingItem(dip, item);
    const ggToScad = scadenza ? daysUntil(scadenza) : null;
    let scadColor = "";
    if (!r.fatto && ggToScad != null) {
      scadColor = ggToScad < 0 ? "red" : (ggToScad <= 7 ? "orange" : (ggToScad <= 30 ? "yellow" : "green"));
    }
    const derivedTag = r.derived ? ` <span class="muted" style="font-size:11px">→ in Scadenze</span>` : "";
    // Se è una voce accetta_click, mostra ✍️ se accettata via portale.
    const acc = state.accettazioni.find((a) => a.dipendente_id === dipId && a.item_id === item.id);
    const accTag = (item.tipo_workflow === "accetta_click" && acc)
      ? ` <span class="hist-late ontime" title="Accettato via portale il ${esc(fmtDateTime(acc.accettato_at))}${acc.ip_address ? ' — IP ' + esc(acc.ip_address) : ''}" style="font-size:11px">✍️ portale</span>`
      : "";
    const fattoTxt = r.fatto
      ? `<span class="hist-late ontime">✓ ${fmtDate(r.data)}${r.da ? " · " + esc(r.da) : ""}${accTag}</span>`
      : (scadenza ? `<span class="days-cell ${scadColor}">entro ${fmtDate(scadenza)}</span>` : '<span class="muted">—</span>');
    const ckDisabled = r.derived ? "disabled" : "";
    return `<div class="hist-row onboard-row" data-progr-id="${esc(r.progrId || "")}" data-item-id="${esc(item.id)}" data-derived="${r.derived ? 1 : 0}" data-adm-id="${esc(r.admId || "")}">
      <div><input type="checkbox" class="onboard-check" ${r.fatto ? "checked" : ""} ${ckDisabled}></div>
      <div><strong>${esc(item.label)}</strong>${derivedTag}${item.descrizione ? `<div class="hist-note">${esc(item.descrizione)}</div>` : ""}</div>
      <div class="hist-meta">${fattoTxt}</div>
      ${r.doc ? `<button type="button" class="hist-doc onboard-doc-btn" data-path="${esc(r.doc)}" title="Apri">📎</button>` : '<span class="hist-doc disabled">—</span>'}
    </div>`;
  }).join("");
  // Toggle veloce della checkbox SOLO per le voci con progresso proprio.
  els(".onboard-check", host).forEach((cb) => cb.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (cb.disabled) return;
    const row = cb.closest(".onboard-row");
    const progrId = row.dataset.progrId;
    if (!progrId) return;
    const p = state.onboardProgressi.find((x) => x.id === progrId);
    if (!p) return;
    const newDone = cb.checked;
    await sbUpsert("onboarding_progressi", { ...p, fatto: newDone, fatto_il: newDone ? localISO(new Date()) : null });
    renderDipOnboarding(dipId);
  }));
  // Click sulla riga: per le voci "derived" apre l'adempimento in Scadenze; altrimenti modale dettaglio.
  els(".onboard-row", host).forEach((row) => row.addEventListener("click", (ev) => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "BUTTON") return;
    if (row.dataset.applicabile === "0") return;
    if (row.dataset.derived === "1") {
      const admId = row.dataset.admId;
      if (admId) openAdmModal(dipId, admId);
    } else {
      openOnboardModal(dipId, row.dataset.itemId);
    }
  }));
  els(".onboard-doc-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await openSignedDoc(btn.dataset.path);
  }));
}

let pendingOnboardFile = null;

// 1.1 · Nel flusso onboarding le due scadenze (visita / formazione) stanno in
// due blocchi che si escludono a vicenda: qui si prende quella visibile.
function campoScadenzaOnboard(isVisita) {
  return isVisita
    ? { input: $("onboard-adm-scadenza"), avviso: $("onboard-adm-scadenza-avviso") }
    : { input: $("onboard-adm-scadenza-form"), avviso: $("onboard-adm-scadenza-form-avviso") };
}

function openOnboardModal(dipId, itemId) {
  const dip = dipById(dipId);
  const item = state.onboardItems.find((i) => i.id === itemId);
  if (!dip || !item) return;
  // I due campi scadenza sono in blocchi che si escludono: `required` va SEMPRE
  // azzerato prima di riassegnarlo. Un campo required dentro un blocco nascosto
  // blocca l'invio del form e il browser non puo' nemmeno metterci il fuoco:
  // il bottone Salva smetterebbe di funzionare senza dire niente.
  $("onboard-adm-scadenza").required = false;
  $("onboard-adm-scadenza-form").required = false;
  $("onboard-adm-scadenza-avviso").hidden = true;
  $("onboard-adm-scadenza-form-avviso").hidden = true;
  const p = state.onboardProgressi.find((x) => x.dipendente_id === dipId && x.item_id === itemId);
  $("onboard-title").textContent = item.label;
  $("onboard-progr-id").value = p?.id || "";
  $("onboard-dip-id").value = dipId;
  $("onboard-item-id").value = itemId;
  $("onboard-target").textContent = `${dip.cognome} ${dip.nome}`;
  $("onboard-descrizione").textContent = item.descrizione || "";
  // Workflow specifico per la voce.
  const wfGenera = $("onboard-wf-genera");
  const wfAdm = $("onboard-wf-adempimento");
  if (item.tipo_workflow === "genera_pdf_template") {
    wfGenera.hidden = false;
    wfAdm.hidden = true;
    fillSelect($("onboard-tpl-id"), state.modelli.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "")),
      { placeholder: "— seleziona —", label: "nome" });
    $("onboard-tpl-id").value = item.template_id || "";
  } else if (item.tipo_workflow === "crea_adempimento") {
    wfGenera.hidden = true;
    wfAdm.hidden = false;
    const tipoReqId = item.adempimento_tipo_id || "";
    const tipoReq = state.tipi.find((t) => t.id === tipoReqId);
    const isVisita = isTipoSanitario(tipoReqId);
    $("onboard-adm-legend").textContent = isVisita ? "🩺 Registra visita medica" : "📚 Registra corso di formazione";
    $("onboard-adm-ente-label").textContent = isVisita ? "Medico competente" : "Ente formatore";
    $("onboard-adm-ente").placeholder = isVisita ? "Es. Dr. Bianchi (Studio Med 81)" : "Es. CFP Bergamo";
    $("onboard-adm-visita-wrap").hidden = !isVisita;
    $("onboard-adm-formazione-wrap").hidden = isVisita;
    // Pre-fill dai dati salvati nel progresso, o dall'adempimento esistente.
    const existingAdm = state.adempimenti.find((a) => a.dipendente_id === dipId && a.tipo_requisito_id === tipoReqId && a.corrente !== false);
    const dati = p?.dati || {};
    $("onboard-adm-data").value = dati.data_evento || existingAdm?.data_rilascio || "";
    $("onboard-adm-ente").value = dati.ente || "";
    $("onboard-adm-esito").value = dati.esito || "";
    $("onboard-adm-prescrizioni").value = dati.prescrizioni || "";
    $("onboard-adm-ore").value = dati.ore_effettive ?? "";
    $("onboard-adm-hint").textContent =
      tipoReq ? `Verrà creato/aggiornato l'adempimento "${tipoReq.nome}" con la data indicata. La scadenza è proposta dalla matrice ruoli e si può correggere.`
              : "Tipo di requisito non trovato.";
    // 1.1 · La scadenza e' precompilata dalla matrice ma MODIFICABILE: fino alla
    // Fase 1 il campo era `disabled` e la data del medico si perdeva.
    const v = validitaMesiForTipo(tipoReqId, dipId);
    const { input: campoScad, avviso: campoAvviso } = campoScadenzaOnboard(isVisita);
    const aggiornaAvviso = () => {
      const msg = avvisoScadenza($("onboard-adm-data").value,
                                 scadenzaRichiesta(v) ? v : null, campoScad.value);
      campoAvviso.textContent = msg || "";
      campoAvviso.hidden = !msg;
    };
    // `dallaRegola = false` all'apertura: se l'adempimento e' gia' registrato con
    // quella stessa data, la scadenza che si mostra e' QUELLA SALVATA, non quella
    // ricalcolata. Altrimenti riaprendo la voce per allegare il certificato si
    // riproporrebbero i 12 mesi della matrice al posto dei 6 scritti dal medico,
    // e il salvataggio successivo li sovrascriverebbe in silenzio: esattamente il
    // difetto che la 1.1 esiste per chiudere.
    // Cambiare la data dell'evento invece ricalcola: la data e' il presupposto.
    const precompila = (dallaRegola) => {
      const d = $("onboard-adm-data").value;
      let scad = d ? (calcScadenza(d, tipoReqId, dipId) || "") : "";
      if (!dallaRegola && existingAdm && existingAdm.data_rilascio === d && existingAdm.data_scadenza) {
        scad = existingAdm.data_scadenza;
      }
      // Scrive su entrambi i campi: solo uno e' visibile, ma il salvataggio
      // legge quello attivo e i due non devono divergere.
      $("onboard-adm-scadenza").value = scad;
      $("onboard-adm-scadenza-form").value = scad;
      aggiornaAvviso();
    };
    campoScad.required = scadenzaRichiesta(v) && !!$("onboard-adm-data").value;
    precompila(false);
    $("onboard-adm-data").onchange = () => {
      campoScad.required = scadenzaRichiesta(v) && !!$("onboard-adm-data").value;
      precompila(true);
    };
    campoScad.oninput = aggiornaAvviso;
  } else {
    wfGenera.hidden = true;
    wfAdm.hidden = true;
  }
  $("onboard-fatto").checked = !!p?.fatto;
  $("onboard-fatto-il").value = p?.fatto_il || (p?.fatto ? localISO(new Date()) : "");
  $("onboard-fatto-da").value = p?.fatto_da || localStorage.getItem("hr_last_operator") || "";
  $("onboard-note").value = p?.note || "";
  pendingOnboardFile = null;
  $("onboard-doc-file").value = "";
  $("onboard-doc-upload-label").textContent = "Carica un file";
  $("onboard-doc-progress").hidden = true;
  $("onboard-doc-current").hidden = !p?.documento_path;
  if (p?.documento_path) {
    $("onboard-doc-current-name").textContent = item.label + " — documento";
  }
  openModal("modal-onboard");
}

async function saveOnboardProgresso(e) {
  e.preventDefault();
  const progrId = $("onboard-progr-id").value;
  const dipId = $("onboard-dip-id").value;
  const itemId = $("onboard-item-id").value;
  if (!progrId) { alert("Voce non sincronizzata. Chiudi e riapri la scheda."); return; }
  const prev = state.onboardProgressi.find((x) => x.id === progrId);

  // 1.1 · Guardia della scadenza PRIMA dell'upload, come in applyFatto: uscire
  // dopo aver caricato il file significherebbe caricarlo per niente.
  const itemGuardia = state.onboardItems.find((i) => i.id === itemId);
  if (itemGuardia?.tipo_workflow === "crea_adempimento" && $("onboard-adm-data").value) {
    const vG = validitaMesiForTipo(itemGuardia.adempimento_tipo_id, dipId);
    if (scadenzaRichiesta(vG) && !campoScadenzaOnboard(isTipoSanitario(itemGuardia.adempimento_tipo_id)).input.value) {
      alert(`La regola prevede una validità di ${vG} mesi: la scadenza è obbligatoria. `
            + 'Lasciandola vuota, questo obbligo risulterebbe "non scade" per sempre.');
      return;
    }
  }

  const oldPath = prev?.documento_path || null;
  let documento_path = oldPath;
  let uploadedPath = null;
  if (pendingOnboardFile) {
    $("onboard-doc-progress").hidden = false;
    try {
      const ext = (pendingOnboardFile.name.split(".").pop() || "bin").toLowerCase();
      const path = `onboard-${progrId}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, pendingOnboardFile, {
        upsert: false, contentType: pendingOnboardFile.type || "application/octet-stream",
      });
      if (error) throw error;
      uploadedPath = path;
      documento_path = path;
    } catch (err) {
      $("onboard-doc-progress").hidden = true;
      alert("Errore upload: " + err.message);
      return;
    }
    $("onboard-doc-progress").hidden = true;
  }
  const fatto = $("onboard-fatto").checked;
  const fattoDa = $("onboard-fatto-da").value.trim() || null;
  if (fattoDa) localStorage.setItem("hr_last_operator", fattoDa);

  // Se la voce è "crea_adempimento", raccolgo i dati extra e creo/aggiorno l'adempimento.
  const item = state.onboardItems.find((i) => i.id === itemId);
  let dati = prev?.dati || null;
  // true se il nuovo file è già stato referenziato da un adempimento salvato con successo:
  // in tal caso NON va cancellato neanche se il salvataggio finale del progresso fallisce.
  let fileCommitted = false;
  if (item?.tipo_workflow === "crea_adempimento") {
    const dataEvento = $("onboard-adm-data").value || null;
    const tipoReqId = item.adempimento_tipo_id;
    const isVisita = isTipoSanitario(tipoReqId);
    dati = {
      data_evento: dataEvento,
      ente: $("onboard-adm-ente").value.trim() || null,
      ...(isVisita
        ? { esito: $("onboard-adm-esito").value || null, prescrizioni: $("onboard-adm-prescrizioni").value.trim() || null }
        : { ore_effettive: $("onboard-adm-ore").value ? parseFloat($("onboard-adm-ore").value) : null }),
    };
    // Se ho data evento + tipo requisito → creo/aggiorno l'adempimento.
    if (dataEvento && tipoReqId) {
      // 1.1 · La scadenza e' quella scritta nel campo, non piu' quella calcolata.
      // La guardia sull'obbligatorieta' e' gia' passata, prima dell'upload.
      const scadenza = campoScadenzaOnboard(isVisita).input.value || null;
      const existing = state.adempimenti.find((a) => a.dipendente_id === dipId && a.tipo_requisito_id === tipoReqId && a.corrente !== false);
      const admRow = {
        id: existing?.id || uid(),
        dipendente_id: dipId,
        tipo_requisito_id: tipoReqId,
        corrente: true,
        data_rilascio: dataEvento,
        data_scadenza: scadenza,
        documento_path: documento_path || existing?.documento_path || null,
        documento_url: existing?.documento_url || null,
        done: existing?.done || false,
        done_at: existing?.done_at || null,
        done_by: existing?.done_by || fattoDa,
        last_done_at: dataEvento,
        previous_date: existing?.data_scadenza || null,
        history: existing?.history || [],
        note: isVisita && dati.prescrizioni ? "Prescrizioni: " + dati.prescrizioni : (existing?.note || null),
      };
      const admOk = await sbUpsert("adempimenti", admRow);
      if (!admOk) { if (uploadedPath) await deleteDoc(uploadedPath); return; }
      // Se l'adempimento ora referenzia il nuovo file, il file è "committed": non va più
      // cancellato per un eventuale fallimento del salvataggio finale del progresso.
      if (uploadedPath && admRow.documento_path === uploadedPath) fileCommitted = true;
    }
  }

  const row = {
    id: progrId,
    dipendente_id: dipId,
    item_id: itemId,
    fatto,
    fatto_il: fatto ? ($("onboard-fatto-il").value || localISO(new Date())) : null,
    fatto_da: fatto ? fattoDa : null,
    documento_path,
    dati,
    note: $("onboard-note").value.trim() || null,
  };
  const ok = await sbUpsert("onboarding_progressi", row);
  // Se il file è già referenziato da adempimenti (fileCommitted), non cancellarlo qui: il
  // vecchio file resta comunque referenziato dal progresso non aggiornato, e va bene così.
  if (!ok) { if (uploadedPath && !fileCommitted) await deleteDoc(uploadedPath); return; }
  if (uploadedPath && oldPath) await deleteDoc(oldPath);   // il vecchio file solo a salvataggio riuscito
  pendingOnboardFile = null;
  closeModal("modal-onboard");
  renderDipOnboarding(dipId);
  renderAll(); // aggiorna anche compliance/scadenze viste
}

// ============================================================
// MODELLI DOCUMENTO — template aziendali con segnaposto {{campo}}
// ============================================================
// Lista campi dipendente disponibili come segnaposto.
const SEGNAPOSTI_DISPONIBILI = [
  { key: "nome", label: "Nome" },
  { key: "cognome", label: "Cognome" },
  { key: "codice_fiscale", label: "Codice fiscale" },
  { key: "data_nascita", label: "Data di nascita" },
  { key: "luogo_nascita", label: "Luogo di nascita" },
  { key: "cittadinanza", label: "Cittadinanza" },
  { key: "stato_civile", label: "Stato civile" },
  { key: "titolo_studio", label: "Titolo di studio" },
  { key: "email", label: "Email" },
  { key: "telefono", label: "Telefono" },
  { key: "data_assunzione", label: "Data assunzione" },
  { key: "data_fine_prova", label: "Fine periodo prova" },
  { key: "data_fine_contratto", label: "Fine contratto (se determinato)" },
  { key: "tipo_contratto", label: "Tipo contratto" },
  { key: "qualifica", label: "Qualifica" },
  { key: "livello_ccnl", label: "Livello CCNL" },
  { key: "orario_tipo", label: "Orario di lavoro" },
  { key: "ore_settimanali", label: "Ore settimanali" },
  { key: "sede_lavoro", label: "Sede di lavoro" },
  // Niente {{iban}}: il campo non e' piu' compilabile dalla scheda (Fase 0.5),
  // quindi il segnaposto stamperebbe "________" per sempre.
  { key: "residenza_indirizzo", label: "Indirizzo residenza" },
  { key: "residenza_cap", label: "CAP residenza" },
  { key: "residenza_citta", label: "Città residenza" },
  { key: "residenza_provincia", label: "Provincia residenza" },
  { key: "emergenza_nome", label: "Emergenza — nome" },
  { key: "emergenza_telefono", label: "Emergenza — telefono" },
  { key: "emergenza_parentela", label: "Emergenza — parentela" },
];

// Formatta un valore per la sostituzione (date in formato leggibile, null = "—").
// IMPORTANTE: il template viene scritto in document.write() come HTML, quindi il
// valore sostituito DEVE essere escapato per impedire XSS via campi dipendente.
function valoreSegnaposto(dip, key) {
  const v = dip?.[key];
  if (v == null || v === "") return "________";
  // Date in formato ISO → italiano (già safe: solo cifre e /).
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(v);
  return esc(String(v));
}

// Sostituisce {{key}} con i valori del dipendente.
function applicaTemplate(testo, dip) {
  return String(testo || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => valoreSegnaposto(dip, key));
}

function renderModelliTable() {
  const rows = state.modelli.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  $("modelli-table").innerHTML =
    `<div class="cfg-row head cfg-cols-tipi"><div>Nome</div><div>ID</div><div>Descrizione</div><div></div></div>` +
    (rows.length === 0
      ? '<div class="muted" style="padding:14px">Nessun modello configurato.</div>'
      : rows.map((m) => `<div class="cfg-row cfg-cols-tipi" data-id="${esc(m.id)}">
          <div><strong>${esc(m.nome)}</strong></div>
          <div class="muted">${esc(m.id)}</div>
          <div class="muted">${esc(m.descrizione || "—")}</div>
          <div></div>
        </div>`).join(""));
  els("#modelli-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openModelloModal(el2.dataset.id)));
}

function openModelloModal(id) {
  const m = id ? state.modelli.find((x) => x.id === id) : null;
  $("modello-title").textContent = m ? m.nome : "Nuovo modello documento";
  $("modello-id").value = m ? m.id : "";
  $("modello-nome").value = m?.nome || "";
  $("modello-desc").value = m?.descrizione || "";
  $("modello-contenuto").value = m?.contenuto || "";
  $("modello-delete").hidden = !m;
  // Popola la lista segnaposto cliccabili.
  $("modello-segnaposto-list").innerHTML = SEGNAPOSTI_DISPONIBILI.map((s) =>
    `<button type="button" data-seg="{{${esc(s.key)}}}" title="${esc(s.label)}">{{${esc(s.key)}}}</button>`
  ).join("");
  els("#modello-segnaposto-list button").forEach((btn) => btn.addEventListener("click", () => {
    const ta = $("modello-contenuto");
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const seg = btn.dataset.seg;
    ta.value = before + seg + after;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + seg.length;
  }));
  openModal("modal-modello");
}

async function saveModello(e) {
  e.preventDefault();
  const id = $("modello-id").value || ("tpl-" + (sanitizeName($("modello-nome").value.toLowerCase()) || Date.now()));
  const row = {
    id,
    nome: $("modello-nome").value.trim(),
    descrizione: $("modello-desc").value.trim() || null,
    contenuto: $("modello-contenuto").value,
  };
  if (!row.nome || !row.contenuto) { alert("Nome e contenuto sono obbligatori."); return; }
  if (await sbUpsert("documenti_template", row)) closeModal("modal-modello");
}

async function deleteModello() {
  const id = $("modello-id").value;
  if (!id) return;
  if (!confirm("Eliminare questo modello? Le voci onboarding che lo usano resteranno orfane.")) return;
  await sbDelete("documenti_template", id);
  closeModal("modal-modello");
}

// Anteprima: apre in una nuova finestra il template renderizzato con dati FITTIZI.
function previewModello() {
  const contenuto = $("modello-contenuto").value;
  const dipDemo = {
    nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA75A01F205X",
    data_nascita: "1975-01-01", data_assunzione: "2026-06-09",
    tipo_contratto: "Indeterminato", qualifica: "Operaio specializzato",
    livello_ccnl: "4", orario_tipo: "Full-time", ore_settimanali: 40,
    sede_lavoro: "Stabilimento Bergamo", data_fine_prova: "2026-09-09",
    residenza_indirizzo: "Via Roma 12", residenza_cap: "24100",
    residenza_citta: "Bergamo", residenza_provincia: "BG",
  };
  const html = applicaTemplate(contenuto, dipDemo);
  apriDocumentoStampabile("Anteprima: " + ($("modello-nome").value || "modello"), html);
}

// Apre una finestra dedicata stampabile (Ctrl+P → Salva PDF).
function apriDocumentoStampabile(titolo, htmlContenuto) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("Il browser ha bloccato l'apertura. Consenti i popup per questa pagina."); return; }
  w.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>${esc(titolo)}</title>
<style>
  body{font-family:Georgia,"Times New Roman",serif;max-width:780px;margin:32px auto;padding:24px;color:#1a1f2e;line-height:1.55}
  h1{font-size:22px;border-bottom:2px solid #1a1f2e;padding-bottom:8px;margin-bottom:18px}
  h2{font-size:16px;margin-top:22px;color:#1e3aa8}
  ul{padding-left:22px}
  li{margin:4px 0}
  .toolbar{position:fixed;top:8px;right:8px;display:flex;gap:6px}
  .toolbar button{padding:8px 14px;border:1px solid #d4d8e3;background:#fff;border-radius:6px;cursor:pointer;font-family:inherit}
  .toolbar button.primary{background:#2f57d9;color:white;border-color:#2f57d9}
  @media print{.toolbar{display:none}body{margin:0;padding:24px}}
</style></head><body>
<div class="toolbar">
  <button class="primary" onclick="window.print()">🖨 Stampa / Salva PDF</button>
  <button onclick="window.close()">Chiudi</button>
</div>
${htmlContenuto}
</body></html>`);
  w.document.close();
}

// --- Template onboarding (config tab) ---
// Workflow possibili di una voce di checklist. Erano configurabili solo via SQL:
// dalla UI ogni voce nasceva 'semplice', quindi i due flussi del portale
// (accettazione e firma) restavano irraggiungibili senza toccare il database.
const WORKFLOW_ONBOARDING = {
  semplice:            { label: "Semplice", hint: "L'HR spunta la voce a mano quando è fatta." },
  accetta_click:       { label: "Da accettare nel portale", hint: "Il dipendente legge il modello nel portale e conferma con un click. Serve un modello documento." },
  genera_pdf_template: { label: "Da firmare e ricaricare", hint: "Il dipendente scarica il modello, lo firma a mano e lo ricarica dal portale. Serve un modello documento." },
  crea_adempimento:    { label: "Registra un adempimento", hint: "Alla compilazione crea/aggiorna l'adempimento di compliance scelto (visita medica, corso…)." },
};

// 2.1 · Le due checklist vivono nella stessa tabella, distinte da `fase`.
// L'ordinamento e' per (fase, ordine) di proposito: mescolarle renderebbe
// illeggibile l'elenco, perche' i due `ordine` partono entrambi da 10.
const FASE_ONBOARDING = { ingresso: "Ingresso", uscita: "Uscita" };

function renderOnboardingItemsTable() {
  const faseDi = (r) => (r.fase === "uscita" ? "uscita" : "ingresso");
  const rows = state.onboardItems.slice().sort((a, b) =>
    faseDi(a).localeCompare(faseDi(b)) || (a.ordine ?? 100) - (b.ordine ?? 100));
  $("onboard-items-table").innerHTML =
    `<div class="cfg-row head cfg-cols-onb"><div>Etichetta</div><div>Fase</div><div>Giorni</div><div>Workflow</div><div>Descrizione</div></div>` +
    rows.map((r) => `<div class="cfg-row cfg-cols-onb" data-id="${esc(r.id)}">
      <div><strong>${esc(r.label)}</strong></div>
      <div>${esc(FASE_ONBOARDING[faseDi(r)])}</div>
      <div>${r.giorni_da_assunzione ?? 0}gg</div>
      <div class="muted">${esc(WORKFLOW_ONBOARDING[r.tipo_workflow]?.label || r.tipo_workflow || "Semplice")}</div>
      <div class="muted">${esc((r.descrizione || "").slice(0, 60))}${(r.descrizione || "").length > 60 ? "…" : ""}</div>
    </div>`).join("");
  els("#onboard-items-table .cfg-row:not(.head)").forEach((el2) => el2.addEventListener("click", () => openOnboardItemModal(el2.dataset.id)));
}

// Mostra i campi pertinenti al workflow scelto e la relativa spiegazione.
function aggiornaCampiWorkflowOnboarding() {
  const wf = $("onbi-workflow").value;
  $("onbi-tpl-wrap").hidden = !(wf === "accetta_click" || wf === "genera_pdf_template");
  $("onbi-adm-wrap").hidden = wf !== "crea_adempimento";
  $("onbi-workflow-hint").textContent = WORKFLOW_ONBOARDING[wf]?.hint || "";
}

// 2.1 · I giorni si contano da due date diverse a seconda della fase, e
// l'etichetta deve dirlo: "30 giorni" da soli non vogliono dire niente.
function aggiornaEtichettaGiorniOnboarding() {
  $("onbi-giorni-label").textContent = $("onbi-fase").value === "uscita"
    ? "Giorni dalla cessazione *"
    : "Giorni dall'assunzione *";
}

function openOnboardItemModal(id) {
  const it = id ? state.onboardItems.find((x) => x.id === id) : null;
  $("onbi-title").textContent = it ? it.label : "Nuova voce template onboarding";
  $("onbi-id").value = it ? it.id : "";
  $("onbi-label").value = it?.label || "";
  $("onbi-descrizione").value = it?.descrizione || "";
  $("onbi-fase").value = it?.fase === "uscita" ? "uscita" : "ingresso";
  aggiornaEtichettaGiorniOnboarding();
  $("onbi-giorni").value = it?.giorni_da_assunzione ?? 0;
  $("onbi-ordine").value = it?.ordine ?? 100;
  $("onbi-workflow").value = it?.tipo_workflow || "semplice";
  fillSelect($("onbi-template"), state.modelli.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "")),
    { placeholder: "— nessuno —", label: "nome" });
  $("onbi-template").value = it?.template_id || "";
  fillSelect($("onbi-adempimento-tipo"), state.tipi.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "")),
    { placeholder: "— nessuno —", label: (t) => `${CAT_BY_KEY[t.categoria]?.icon || ""} ${t.nome}` });
  $("onbi-adempimento-tipo").value = it?.adempimento_tipo_id || "";
  aggiornaCampiWorkflowOnboarding();
  $("onbi-delete").hidden = !it;
  openModal("modal-onboard-item");
}

async function saveOnboardItem(e) {
  e.preventDefault();
  const id = $("onbi-id").value || ("onb-" + (sanitizeName($("onbi-label").value.toLowerCase()) || Date.now()));
  const wf = $("onbi-workflow").value;
  const templateId = (wf === "accetta_click" || wf === "genera_pdf_template") ? ($("onbi-template").value || null) : null;
  const admTipoId = wf === "crea_adempimento" ? ($("onbi-adempimento-tipo").value || null) : null;
  if ((wf === "accetta_click" || wf === "genera_pdf_template") && !templateId) {
    alert("Questo workflow richiede un modello documento: sceglilo o crealo in Configurazione → Modelli.");
    return;
  }
  if (wf === "crea_adempimento" && !admTipoId) {
    alert("Scegli il tipo di requisito che questa voce deve registrare.");
    return;
  }
  const row = {
    id,
    label: $("onbi-label").value.trim(),
    descrizione: $("onbi-descrizione").value.trim() || null,
    fase: $("onbi-fase").value === "uscita" ? "uscita" : "ingresso",
    giorni_da_assunzione: parseInt($("onbi-giorni").value, 10) || 0,
    ordine: parseInt($("onbi-ordine").value, 10) || 100,
    tipo_workflow: wf,
    template_id: templateId,
    adempimento_tipo_id: admTipoId,
  };
  if (await sbUpsert("onboarding_items", row)) closeModal("modal-onboard-item");
}

async function deleteOnboardItem() {
  const id = $("onbi-id").value;
  if (!id) return;
  if (!confirm("Eliminare questa voce del template? Verranno rimossi anche i progressi dei dipendenti su questa voce.")) return;
  await sbDelete("onboarding_items", id);
  closeModal("modal-onboard-item");
}

// ============================================================
// PROVVEDIMENTI DISCIPLINARI
// ============================================================
const PROVV_BY_KEY = Object.fromEntries((window.TIPI_PROVVEDIMENTO || []).map((p) => [p.key, p]));

function renderDipProvvedimenti(dipId) {
  const list = state.provvedimenti
    .filter((p) => p.dipendente_id === dipId)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const section = $("dip-provv-section");
  const host = $("dip-provv-list");
  section.hidden = false;  // sempre visibile per gli HR (utile bottone +)
  $("dip-provv-count").textContent = list.length;
  host.innerHTML = list.length === 0
    ? '<div class="muted" style="padding:8px 0">Nessun provvedimento registrato.</div>'
    : list.map((p) => {
        const tipo = PROVV_BY_KEY[p.tipo] || { label: p.tipo, icon: "" };
        return `<div class="hist-row provv-row" data-id="${esc(p.id)}">
          <div class="hist-date">${fmtDate(p.data)}</div>
          <div><strong>${esc(tipo.icon || "")} ${esc(tipo.label)}</strong></div>
          <div class="hist-meta">${p.motivazione ? `<span class="hist-note">${esc(p.motivazione).slice(0, 80)}${p.motivazione.length > 80 ? "…" : ""}</span>` : ""}</div>
          ${p.documento_path ? `<button type="button" class="hist-doc provv-doc-btn" data-path="${esc(p.documento_path)}" title="Apri lettera">📎</button>` : '<span class="hist-doc disabled">—</span>'}
        </div>`;
      }).join("");
  els(".provv-row", host).forEach((row) => row.addEventListener("click", () => openProvvModal(dipId, row.dataset.id)));
  els(".provv-doc-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await openSignedDoc(btn.dataset.path);
  }));
}

let pendingProvvFile = null;

function openProvvModal(dipId, provvId) {
  const p = provvId ? state.provvedimenti.find((x) => x.id === provvId) : null;
  const dip = dipById(dipId);
  $("provv-title").textContent = p ? "Provvedimento disciplinare" : "Nuovo provvedimento disciplinare";
  $("provv-id").value = p ? p.id : "";
  $("provv-dip-id").value = dipId;
  $("provv-target").textContent = dip ? `${dip.cognome} ${dip.nome}` : "—";
  fillSelect($("provv-tipo"), (window.TIPI_PROVVEDIMENTO || []).map((t) => ({ id: t.key, nome: (t.icon ? t.icon + " " : "") + t.label })), { placeholder: "— seleziona —" });
  $("provv-tipo").value = p?.tipo || "";
  $("provv-data").value = p?.data || localISO(new Date());
  $("provv-motivazione").value = p?.motivazione || "";
  $("provv-note").value = p?.note || "";
  $("provv-delete").hidden = !p;
  pendingProvvFile = null;
  $("provv-doc-file").value = "";
  $("provv-doc-upload-label").textContent = "Carica un file";
  $("provv-doc-progress").hidden = true;
  $("provv-doc-current").hidden = !p?.documento_path;
  if (p?.documento_path) {
    $("provv-doc-current-name").textContent = `Lettera ${fmtDate(p.data)}`;
  }
  openModal("modal-provv");
}

async function saveProvvedimento(e) {
  e.preventDefault();
  const id = $("provv-id").value || uid();
  const dipId = $("provv-dip-id").value;
  const prev = state.provvedimenti.find((x) => x.id === id) || null;

  // Valida i campi obbligatori PRIMA di caricare il file: niente upload orfano se manca tipo/data.
  const provvTipo = $("provv-tipo").value;
  const provvData = $("provv-data").value;
  if (!provvTipo || !provvData) { alert("Tipo e data sono obbligatori."); return; }

  const oldPath = prev?.documento_path || null;
  let documento_path = oldPath;
  let uploadedPath = null;
  if (pendingProvvFile) {
    $("provv-doc-progress").hidden = false;
    try {
      // Path: provv/{id}/{timestamp}.{ext} per non confonderli con quelli adempimenti.
      const ext = (pendingProvvFile.name.split(".").pop() || "bin").toLowerCase();
      const path = `provv-${id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, pendingProvvFile, {
        upsert: false, contentType: pendingProvvFile.type || "application/octet-stream",
      });
      if (error) throw error;
      uploadedPath = path;
      documento_path = path;
    } catch (err) {
      $("provv-doc-progress").hidden = true;
      alert("Errore upload: " + err.message);
      return;
    }
    $("provv-doc-progress").hidden = true;
  }

  const row = {
    id,
    dipendente_id: dipId,
    tipo: provvTipo,
    data: provvData,
    motivazione: $("provv-motivazione").value.trim() || null,
    documento_path,
    note: $("provv-note").value.trim() || null,
  };

  const ok = await sbUpsert("provvedimenti", row);
  if (!ok) { if (uploadedPath) await deleteDoc(uploadedPath); return; }
  if (uploadedPath && oldPath) await deleteDoc(oldPath);   // il vecchio file solo a salvataggio riuscito
  pendingProvvFile = null;
  closeModal("modal-provv");
  renderDipProvvedimenti(dipId);
}

async function deleteProvvedimento() {
  const id = $("provv-id").value;
  if (!id) return;
  if (!confirm("Eliminare questo provvedimento e il PDF allegato?")) return;
  const dipId = $("provv-dip-id").value;
  const prev = state.provvedimenti.find((x) => x.id === id);
  if (prev?.documento_path) await deleteDoc(prev.documento_path);
  await sbDelete("provvedimenti", id);
  closeModal("modal-provv");
  renderDipProvvedimenti(dipId);
}

function renderDipHistory(dipId) {
  // Raccoglie tutti gli eventi (history + cicli correnti) di questo dipendente.
  const events = collectStoricoEvents().filter((e) => e.dip.id === dipId);
  const section = $("dip-history-section");
  const list = $("dip-history-list");
  $("dip-history-count").textContent = events.length;
  section.hidden = events.length === 0;
  // Default: collassato.
  list.hidden = true;
  el(".history-arrow", $("dip-history-toggle"))?.classList.remove("expanded");
  $("dip-history-toggle").setAttribute("aria-expanded", "false");
  // Ordine: più recenti in cima.
  events.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  list.innerHTML = events.map((e) => {
    const docPath = e.docPath || "";
    const docUrl = e.docUrl || "";
    const fonte = e.source === "history" ? '<span class="hist-late early">archiviato</span>' : '<span class="hist-late ontime">corrente</span>';
    return `<div class="hist-row">
      <div class="hist-date">${fmtDate(e.data)}</div>
      <div>${fonte}</div>
      <div class="hist-meta">
        <span class="hist-by">${esc(e.tipo.nome)}</span>
        ${e.scadenza ? `<span class="hist-note">scade ${fmtDate(e.scadenza)}</span>` : ""}
      </div>
      ${docPath || docUrl ? `<button type="button" class="hist-doc" data-path="${esc(docPath)}" data-url="${esc(docUrl)}" data-ad="${esc(e.admId)}" title="Apri PDF">📎</button>` : '<span class="hist-doc disabled">—</span>'}
    </div>`;
  }).join("");
  els(".hist-doc", list).forEach((btn) => btn.addEventListener("click", async () => {
    const path = btn.dataset.path;
    const url = btn.dataset.url;
    if (path) {
      const adm = state.adempimenti.find((a) => a.id === btn.dataset.ad);
      await openAdempimentoDoc(adm, path);
    } else if (url) {
      window.open(url, "_blank", "noopener");
    }
  }));
}

// 1.6 · "Modifiche": chi ha cambiato cosa, e quando. Le righe le scrive un
// trigger nel database, mai l'app: e' insieme la storia delle variazioni
// contrattuali e l'audit trail ("chi ha cancellato questo provvedimento").
// Sola lettura per costruzione: non esiste nessuna scrittura verso questa tabella.
// Registra QUANDO e' stato salvato, non la decorrenza: per due o tre variazioni
// l'anno la lettera nel fascicolo basta.
// La tabella NON e' in realtime (scelta del piano): le righe scritte dopo il
// caricamento della pagina compaiono al primo ricaricamento.
const ETICHETTA_TABELLA = {
  dipendenti: "Scheda",
  dipendente_ruoli: "Ruoli",
  adempimenti: "Adempimento",
  provvedimenti: "Provvedimento",
  requisiti_ruolo: "Matrice",
  ruoli: "Ruolo",
  tipi_requisito: "Tipo requisito",
  cedolini: "Cedolino",
};

// Il valore com'e' scritto nel jsonb: null diventa un trattino, gli oggetti
// (taglie_dpi) restano leggibili invece di diventare [object Object].
function valoreModifica(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(v);
  return String(v);
}

function renderDipModifiche(dipId) {
  const section = $("dip-modifiche-section");
  const list = $("dip-modifiche-list");
  const righe = state.storicoModifiche
    .filter((m) => m.dipendente_id === dipId)
    .sort((a, b) => String(b.modificato_il || "").localeCompare(String(a.modificato_il || "")));
  $("dip-modifiche-count").textContent = righe.length;
  section.hidden = righe.length === 0;
  // Default: collassato, come le altre sezioni della scheda.
  list.hidden = true;
  el(".history-arrow", $("dip-modifiche-toggle"))?.classList.remove("expanded");
  $("dip-modifiche-toggle").setAttribute("aria-expanded", "false");

  list.innerHTML = righe.map((m) => {
    const campi = m.campi && typeof m.campi === "object" ? m.campi : {};
    const dove = ETICHETTA_TABELLA[m.tabella] || m.tabella;
    const testo = campi.__cancellata
      ? '<span class="mod-cancellata">riga cancellata</span>'
      : Object.entries(campi).map(([campo, v]) =>
          `<span class="mod-campo">${esc(campo)}</span>: `
          + `<span class="mod-da">${esc(valoreModifica(v && v.da))}</span> → ${esc(valoreModifica(v && v.a))}`
        ).join(" · ");
    return `<div class="mod-row">
      <div class="mod-quando">${fmtDateTime(m.modificato_il)}</div>
      <div class="mod-campi">${esc(dove)} · ${testo}</div>
      <div class="mod-chi">${esc(m.modificato_da || "—")}</div>
    </div>`;
  }).join("");
}

function renderDipAdempimenti(dipId) {
  const dip = dipById(dipId);
  if (!dip) return;
  // Popola il dropdown "+ Aggiungi adempimento…" con i tipi NON ancora assegnati.
  const giaAssegnati = new Set(state.adempimenti.filter((a) => a.dipendente_id === dipId && a.corrente !== false).map((a) => a.tipo_requisito_id));
  const aggiungibili = state.tipi.filter((t) => !giaAssegnati.has(t.id))
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  $("dip-add-adempimento").innerHTML = `<option value="">+ Aggiungi adempimento…</option>` +
    aggiungibili.map((t) => `<option value="${esc(t.id)}">${esc(CAT_BY_KEY[t.categoria]?.icon || "")} ${esc(t.nome)}</option>`).join("");
  $("dip-add-adempimento").disabled = aggiungibili.length === 0;
  // Gli adempimenti dovuti dalla matrice (gap engine) +
  // gli adempimenti "extra" (tipi non in matrice ma comunque registrati per questo dipendente).
  const gaps = computeGaps(dip);
  const matrixTipos = new Set(gaps.map((g) => g.tipo.id));
  const extras = state.adempimenti
    .filter((a) => a.dipendente_id === dipId && !matrixTipos.has(a.tipo_requisito_id) && a.corrente !== false)
    .map((a) => {
      const tipo = tipoById(a.tipo_requisito_id);
      if (!tipo) return null;
      const scadenza = a.data_scadenza || null;
      const stato = classificaStato(!!a.data_rilascio, scadenza);
      return { dip, tipo, stato, scadenza, adempimento: a };
    })
    .filter(Boolean);
  const allItems = [...gaps, ...extras];
  allItems.sort((a, b) => STATO_INFO[a.stato].order - STATO_INFO[b.stato].order);

  const host = $("dip-adempimenti-list");
  if (!allItems.length) {
    host.innerHTML = '<div class="muted" style="padding:8px 0">Nessun adempimento richiesto dai ruoli del dipendente.</div>';
    return;
  }
  host.innerHTML = allItems.map((g) => {
    const a = g.adempimento;
    const t = g.tipo;
    const col = g.stato === "scaduto" ? "red"
      : g.stato === "in_scadenza" ? "orange"
      : "green";
    const hasDoc = a && (a.documento_path || a.documento_url);
    const dataLabel = g.scadenza ? "scade " + fmtDate(g.scadenza) : "non scade";
    return `<div class="adempimenti-row" data-ad="${a?.id || ""}" data-tipo="${t.id}">
      <span class="status-dot ${col}" title="${esc(STATO_INFO[g.stato]?.label || "")}"></span>
      <div><strong>${esc(t.nome)}</strong><div class="ad-date">${dataLabel}</div></div>
      <div class="row-actions">
        ${hasDoc ? `<button type="button" class="icon-btn doc-link-btn" data-ad="${a.id}" title="Apri documento">📎</button>` : ""}
        ${a?.id ? `<button type="button" class="icon-btn del-adm-btn" data-ad="${a.id}" title="Elimina questo adempimento">🗑</button>` : ""}
      </div>
    </div>`;
  }).join("");
  els(".adempimenti-row", host).forEach((el2) => el2.addEventListener("click", () => {
    const admId = el2.dataset.ad;
    const tipoId = el2.dataset.tipo;
    if (admId) openAdmModal(dipId, admId);
    else openAdmModal(dipId, null, tipoId);
  }));
  els(".doc-link-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const adm = state.adempimenti.find((a) => a.id === btn.dataset.ad);
    if (adm) await openDoc(adm);
  }));
  els(".del-adm-btn", host).forEach((btn) => btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const admId = btn.dataset.ad;
    const adm = state.adempimenti.find((a) => a.id === admId);
    if (!adm) return;
    const t = tipoById(adm.tipo_requisito_id);
    if (!confirm(`Eliminare l'adempimento "${t?.nome || "?"}" e il PDF associato (e tutto lo storico)?`)) return;
    // Rimuovi tutti i PDF (current + history) dal bucket.
    const paths = [];
    if (adm.documento_path) paths.push(adm.documento_path);
    if (Array.isArray(adm.history)) adm.history.forEach((h) => { if (h.documentoPath) paths.push(h.documentoPath); });
    if (paths.length) { try { await sb.storage.from(STORAGE_BUCKET).remove(paths); } catch (e) { console.warn(e); } }
    await sbDelete("adempimenti", admId);
    renderDipAdempimenti(dipId);
    renderAll();
  }));
}

// A capo nei messaggi di alert/confirm.
const NL = String.fromCharCode(10);

// Unico punto che legge le caselle degli incarichi dal form della scheda.
const incarichiSpuntati = () => els("#dip-incarichi input.inc-check:checked").map((c) => c.value);

// 1.2 · Prima di cessare qualcuno o di togliergli un incarico, ricalcola le
// cariche COME SE fosse gia' fatto e chiede conferma se qualcuna resta scoperta.
// E' l'unico momento in cui l'azienda si scopre senza accorgersene: cessare una
// persona fa MIGLIORARE il cruscotto, perche' i suoi obblighi spariscono.
// Ritorna false se l'utente annulla.
function confermaCariche(id, esistente) {
  const want = new Set([...($("dip-mansione").value ? [$("dip-mansione").value] : []), ...incarichiSpuntati()]);
  const attivoNuovo = $("dip-attivo").checked;
  const oggi = localISO(new Date());
  const dipendentiDopo = state.dipendenti.map((d) => (d.id === id ? { ...d, attivo: attivoNuovo } : d));
  // Le assegnazioni che stiamo per togliere vengono REVOCATE (al = oggi), non
  // cancellate: e' quello che fara' il salvataggio vero (1.5).
  const dipRuoliDopo = state.dipRuoli.map((dr) =>
    (dr.dipendente_id === id && assegnazioneAttiva(dr) && !want.has(dr.ruolo_id)) ? { ...dr, al: oggi } : dr);

  const scoperte = caricheScoperte(
    calcolaCariche({ ruoli: state.ruoli, dipRuoli: state.dipRuoli, dipendenti: state.dipendenti }),
    calcolaCariche({ ruoli: state.ruoli, dipRuoli: dipRuoliDopo, dipendenti: dipendentiDopo })
  );
  if (!scoperte.length) return true;

  const chi = `${esistente.cognome || ""} ${esistente.nome || ""}`.trim() || "questa persona";
  const righe = scoperte
    .map((c) => `• Senza ${chi}, "${c.ruolo.nome}" scende a ${c.dopo} su ${c.minimo} richiesti.`)
    .join(NL);
  return confirm("Attenzione: questa modifica lascia scoperta una carica aziendale." + NL + NL
    + righe + NL + NL + "Salvare lo stesso?");
}

async function saveDip(e) {
  e.preventDefault();
  const id = $("dip-id").value || uid();
  const esistente = $("dip-id").value ? dipById(id) : null;
  // L'avviso va dato PRIMA di qualunque scrittura: dopo, la carica e' gia' scoperta.
  if (esistente && !confermaCariche(id, esistente)) return;
  const row = {
    id,
    // 2.2 - I campi arrivano tutti dalla stessa tabella che ha riempito il form:
    // se un campo si vede nella scheda, si salva; se non si salva, non si vede.
    ...leggiCampiDipendente(),
    // Le quattro taglie diventano un solo oggetto JSON, e null se sono vuote:
    // non e' una corrispondenza campo -> colonna, quindi resta qui.
    taglie_dpi: (() => {
      const t = {
        scarpe:   $("dip-taglia-scarpe").value   || null,
        tuta:     $("dip-taglia-tuta").value     || null,
        guanti:   $("dip-taglia-guanti").value   || null,
        maschera: $("dip-taglia-maschera").value || null,
      };
      return Object.values(t).some((v) => v) ? t : null;
    })(),
  };
  const ok = await sbUpsert("dipendenti", row);
  if (!ok) return;

  // Sincronizza mansione e incarichi (1.5): revoca, non cancella.
  if (!await sincronizzaAssegnazioni(id)) return;   // l'errore e' gia' stato mostrato

  // 2.1 · La persona esce dall'azienda proprio adesso: link del portale spento e
  // incarichi da chiudere. Solo alla TRANSIZIONE in forza -> cessato: risalvare
  // la scheda di un cessato non deve rifare niente.
  // La condizione NON guarda la data di cessazione. Guardandola, chi togliesse la
  // spunta senza compilare la data si terrebbe il link del portale vivo, e al
  // salvataggio successivo (con la data) la transizione non varrebbe piu': quel
  // link non verrebbe spento mai.
  const esceOra = !!esistente && esistente.attivo !== false && !row.attivo;
  if (esceOra) await gestisciCessazione(id, row.data_cessazione);

  // Genera adempimenti MANCANTI per i requisiti obbligatori dei ruoli attuali
  // (sia per nuovi dipendenti che per cambi ruolo su esistenti).
  await syncAdempimentiObbligatori(id);

  closeModal("modal-dip");
  renderAll();
}

// 2.1 · Le due cose che devono succedere quando qualcuno viene cessato.
// La terza che il piano elenca — "checklist mostrata" — e' conseguenza: alla
// riapertura della scheda syncOnboardingProgressi crea le voci d'uscita.
async function gestisciCessazione(dipId, dataCessazione) {
  // 1) Il link del portale muore con il rapporto di lavoro. Un token ancora
  //    valido terrebbe in vita l'autorizzazione di caricamento sui file, e non
  //    va perso in silenzio: e' esattamente cio' che si vuole spegnere.
  const { error } = await sb.from("invite_tokens").delete().eq("dipendente_id", dipId);
  if (error) {
    console.warn("invite_tokens non cancellati:", error.message);
    alert("Attenzione: il link del portale di questa persona NON e' stato disattivato.\n"
      + "Riapri la scheda e rigenera il link, oppure riprova a salvare.\n\nDettaglio: " + error.message);
  }

  // 2) 3.2 · I cedolini RESTANO — servono all'esportazione del fascicolo (6.1) —
  //    ma il loro collegamento si spegne, come il link del portale e per la
  //    stessa ragione: non dipende dalla data di cessazione, che potrebbe non
  //    essere ancora stata scritta.
  //    LIMITE DICHIARATO: un link firmato gia' aperto e' un JWT autonomo e resta
  //    valido fino alla propria scadenza. Questo lo toglie dal portale, non dalle
  //    mani di chi lo aveva gia' aperto. E' scritto nell'informativa privacy.
  for (const c of state.cedolini.filter((x) => x.dipendente_id === dipId && (x.url_firmato || x.url_scade_il))) {
    if (!await sbUpsert("cedolini", { ...c, url_firmato: null, url_scade_il: null })) return;
  }

  // 3) Gli INCARICHI aperti si chiudono alla data di cessazione, se l'HR vuole.
  //    Non la mansione: e' `required` nella scheda e viene precompilata dalle
  //    sole assegnazioni attive, quindi chiuderla renderebbe la scheda del
  //    cessato non piu' salvabile, e l'unica via d'uscita sarebbe riscegliere
  //    una mansione — che verrebbe scritta come riga NUOVA e attiva. La mansione
  //    di un cessato resta aperta di proposito: dice che mestiere faceva.
  //    Senza una data di cessazione non si propone niente: `al` sarebbe una data
  //    inventata. La proposta torna appena l'HR scrive la data e risalva.
  if (!dataCessazione) return;
  const daChiudere = incarichiDaRevocare({ dipRuoli: state.dipRuoli, ruoli: state.ruoli, dipId });
  if (!daChiudere.length) return;
  const nomi = daChiudere.map((a) => "• " + (ruoloById(a.ruolo_id)?.nome || a.ruolo_id)).join(NL);
  if (!confirm(`Questa persona ha ancora ${daChiudere.length === 1 ? "un incarico aperto" : "degli incarichi aperti"}:`
    + NL + NL + nomi + NL + NL
    + `Li chiudo alla data di cessazione (${fmtDate(dataCessazione)})?`)) return;
  // Ci si ferma al primo errore: sbUpsert ha gia' avvisato, e tre alert in fila
  // direbbero all'HR che qualcosa non va senza dirgli quali incarichi sono
  // rimasti aperti.
  for (const a of daChiudere) {
    if (!await sbUpsert("dipendente_ruoli", { ...a, al: dataCessazione })) return;
  }
}

// 1.5 · Mansione e incarichi dal form alla tabella. Togliere la spunta NON
// cancella piu' la riga: la chiude con `al`. "Da quando e' preposto, e dov'e' la
// nomina" e' la storia che un'app di sicurezza deve conoscere — la formazione
// del preposto decorre dalla nomina — ed e' il presupposto della cessazione.
// Vale anche per la mansione: passare da operatore a manutentore chiude la riga
// vecchia e ne apre una nuova, e da quel giorno cambiano gli obblighi.
// Ritorna false se qualcosa e' andato storto (l'errore e' gia' a schermo).
async function sincronizzaAssegnazioni(dipId) {
  const oggi = localISO(new Date());
  const attive = state.dipRuoli.filter((dr) => dr.dipendente_id === dipId && assegnazioneAttiva(dr));
  const perRuolo = new Map(attive.map((dr) => [dr.ruolo_id, dr]));

  // Cosa chiede il form: ruolo → { dal, file }.
  const voluti = new Map();
  const man = $("dip-mansione").value;
  if (man) voluti.set(man, { dal: $("dip-mansione-dal").value || null, file: null });
  for (const riga of els("#dip-incarichi .inc-row")) {
    const check = el(".inc-check", riga);
    if (!check || !check.checked) continue;
    voluti.set(check.value, {
      dal: el(".inc-dal", riga)?.value || null,
      file: el(".inc-file", riga)?.files?.[0] || null,
    });
  }

  // 1) Prima si aprono le assegnazioni nuove, POI si revocano le vecchie.
  // L'ordine conta se qualcosa fallisce a meta': revocando prima, un cambio di
  // mansione andato storto lascia la persona SENZA mansione, il motore gap non
  // le assegna piu' nessun obbligo e il cruscotto migliora da solo. Nell'ordine
  // giusto, il caso peggiore sono due mansioni attive: obblighi in piu', non in
  // meno. L'indice unico parziale e' per (dipendente, ruolo) e non si oppone,
  // perche' un ruolo voluto non e' mai anche un ruolo da revocare.
  for (const [ruoloId, v] of voluti) {
    const esistente = perRuolo.get(ruoloId);
    const rigaId = esistente?.id || uid();

    let caricato = null;
    if (v.file) {
      try {
        caricato = await uploadNomina(rigaId, v.file);
      } catch (err) {
        alert("Errore caricamento atto di nomina: " + err.message);
        return false;
      }
    }
    // Niente da scrivere: la riga c'e' gia', la data non e' cambiata, nessun file.
    if (esistente && !caricato && (esistente.dal || null) === (v.dal || null)) continue;

    const riga = {
      ...(esistente || {}),
      id: rigaId,
      dipendente_id: dipId,
      ruolo_id: ruoloId,
      dal: v.dal || null,
      al: null,
      documento_path: caricato || esistente?.documento_path || null,
    };
    if (!await sbUpsert("dipendente_ruoli", riga)) {
      // Mai lasciare nel bucket un file che nessuna riga referenzia.
      if (caricato) await deleteDoc(caricato);
      return false;
    }
    // Il file vecchio si cancella SOLO a salvataggio riuscito, mai prima.
    if (caricato && esistente?.documento_path && esistente.documento_path !== caricato) {
      await deleteDoc(esistente.documento_path);
    }
  }

  // 2) Revoche: chiudono la riga, non la cancellano.
  for (const dr of attive) {
    if (voluti.has(dr.ruolo_id)) continue;
    if (!await sbUpsert("dipendente_ruoli", { ...dr, al: oggi })) return false;
  }
  return true;
}

// Righe MANCANTI da creare per i requisiti obbligatori non ancora a DB.
// Per ogni tipo requisito dovuto dai ruoli attuali del dipendente, se non esiste già
// un adempimento genera una riga MANCANTE. Non elimina adempimenti per tipi non più dovuti
// (lo storico è prezioso, e se il ruolo torna sono ancora utili). Il motore gap li ignora.
function missingAdempimentiRows(dipId) {
  const dip = dipById(dipId);
  if (!dip) return [];
  const ruoli = ruoliOfDip(dipId);
  const ruoloIds = new Set(ruoli.map((r) => r.id));
  const seen = new Set();
  // Per i neoassunti la deadline implicita è assunzione + 60gg.
  const onboardDeadline = dip.data_assunzione
    ? localISO(addDays(parseISO(dip.data_assunzione), GG_ONBOARD))
    : null;
  const rows = [];
  for (const req of state.requisiti) {
    if (!ruoloIds.has(req.ruolo_id) || !req.obbligatorio) continue;
    if (seen.has(req.tipo_requisito_id)) continue;
    seen.add(req.tipo_requisito_id);
    const exists = state.adempimenti.some((a) => a.dipendente_id === dipId && a.tipo_requisito_id === req.tipo_requisito_id && a.corrente !== false);
    if (exists) continue;
    rows.push({
      id: uid(),
      dipendente_id: dipId,
      tipo_requisito_id: req.tipo_requisito_id,
      corrente: true,
      data_rilascio: null,
      data_scadenza: onboardDeadline, // scadenza dei primi adempimenti = onboarding
      documento_url: null,
      documento_path: null,
      done: false,
      history: [],
      note: null,
    });
  }
  return rows;
}

async function syncAdempimentiObbligatori(dipId) {
  const rows = missingAdempimentiRows(dipId);
  for (const row of rows) await sbUpsert("adempimenti", row);
}

// Boot-time sync: garantisce che ogni dipendente attivo abbia in DB
// gli adempimenti dovuti dai suoi ruoli (anche se inserito da SQL/migration).
// Un solo upsert batch e un solo render per tutti i dipendenti.
async function syncAllDipendenti() {
  const rows = state.dipendenti
    .filter((d) => d.attivo !== false)
    .flatMap((d) => missingAdempimentiRows(d.id));
  if (!rows.length) return;
  const { error } = await sb.from("adempimenti").upsert(rows);
  if (error) {
    if (isAuthError(error)) { showLogin("Sessione scaduta. Rientra."); return; }
    console.warn("syncAllDipendenti:", error.message);
    return;
  }
  state.adempimenti.push(...rows);
  renderAll();
}

// Genera un link self-service per il dipendente. NIENTE email automatica:
// crea un token via RPC, costruisce il link, lo mostra nella modale e l'HR
// lo copia + lo manda dove vuole (WhatsApp/Outlook/SMS).
async function inviaInvitoSelfService() {
  const id = $("dip-id").value;
  const d = id ? dipById(id) : null;
  if (!d) return;
  const btn = $("dip-invite");
  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = "Generazione…";
  try {
    const { data, error } = await sb.rpc("create_invite_token", { dip_id: id });
    if (error) throw error;
    const token = data;
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
    const link = `${base}me.html?token=${token}`;
    $("invite-target").textContent = `${d.cognome} ${d.nome}`;
    $("invite-link").value = link;
    // 3.1 · La durata non e' piu' cablata: la decide `parametri`.
    const gg = giorniLinkPortale();
    $("invite-status").textContent =
      `Il link scade fra ${gg} giorni (${fmtDate(localISO(addDays(todayMid(), gg)))}). `
      + "Rigenerandolo, quello di prima smette di funzionare all'istante.";
    openModal("modal-invite");
    setTimeout(() => $("invite-link").select(), 100);
  } catch (err) {
    alert("Errore generazione link: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}

async function copyInviteLink() {
  const input = $("invite-link");
  const status = $("invite-status");
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = "✓ Link copiato! Ora incollalo nella chat / mail / dove vuoi.";
    status.style.color = "#166534";
  } catch {
    input.select();
    document.execCommand("copy");
    status.textContent = "✓ Link copiato!";
  }
}

// Tabelle figlie di un dipendente, con lo store locale e la colonna che
// contiene l'eventuale PDF.
// Dal 2026-09-02 le foreign key verso `dipendenti` esistono davvero, tutte con
// `on delete cascade` (prima non potevano esistere: la colonna id era bigint e
// le figlie avevano dipendente_id text). La cancellazione esplicita che segue
// NON e' quindi ridondante, per due ragioni che restano valide:
//   - i FILE dello Storage non seguono nessun cascade, e per rimuoverli bisogna
//     leggere i loro percorsi PRIMA di cancellare le righe che li nominano;
//   - setup.sql non sa ricreare quelle foreign key, quindi il codice non deve
//     dipendere dalla loro presenza.
const TABELLE_FIGLIE_DIP = [
  { table: "dipendente_ruoli",      store: "dipRuoli",         doc: "documento_path" },
  { table: "adempimenti",           store: "adempimenti",      doc: "documento_path" },
  { table: "provvedimenti",         store: "provvedimenti",    doc: "documento_path" },
  { table: "onboarding_progressi",  store: "onboardProgressi", doc: "documento_path" },
  { table: "accettazioni",          store: "accettazioni",     doc: null },
  { table: "dpi_consegne",          store: "dpiConsegne",      doc: "modulo_path" },
  // 3.2 · Senza questa riga deleteDip cancellerebbe le righe dei cedolini
  // (per cascade) e lascerebbe i loro PDF nel bucket, orfani per sempre.
  { table: "cedolini",              store: "cedolini",         doc: "path" },
  // 4.1 · Come sopra: la foreign key cancella la RIGA dell'evento, non il file.
  // Senza questa riga la scheda di un infortunio resterebbe nel bucket per
  // sempre, senza padrone — un dato sanitario orfano.
  { table: "eventi",                store: "eventi",           doc: "documento_path" },
];

// Tutti i PDF di un dipendente: cicli correnti, storico archiviato, moduli DPI,
// lettere di provvedimento, documenti di onboarding.
function tuttiIDocumentiDi(dipId) {
  const paths = [];
  for (const { store, doc } of TABELLE_FIGLIE_DIP) {
    if (!doc) continue;
    for (const row of state[store]) {
      if (row.dipendente_id !== dipId) continue;
      if (row[doc]) paths.push(row[doc]);
    }
  }
  // I path archiviati vivono dentro adempimenti.history[].
  for (const a of state.adempimenti) {
    if (a.dipendente_id !== dipId || !Array.isArray(a.history)) continue;
    for (const h of a.history) if (h.documentoPath) paths.push(h.documentoPath);
  }
  return [...new Set(paths)];
}

// Cancellazione completa di una persona: righe figlie, inviti, riga dipendente,
// e SOLO ALLA FINE i file. Ritorna true se e' andata a buon fine.
// Estratta da deleteDip nella Fase 1c: il bottone "Elimina i dati di prova"
// deve fare esattamente questo, otto volte. Duplicare la sequenza sarebbe il
// modo sicuro di sbagliarla — l'ordine dei passi qui non e' arbitrario, e
// dimenticare la raccolta dei path lascerebbe i PDF orfani nel bucket.
// Non tocca la modale e non chiama renderAll(): lo fa chi la chiama.
async function eliminaDipendenteCompleto(id) {
  // I path vanno raccolti PRIMA di cancellare le righe che li referenziano.
  const paths = tuttiIDocumentiDi(id);

  // 1) Righe figlie, 2) dipendente, 3) solo a cancellazione riuscita i file:
  //    se qualcosa fallisce a meta', i documenti sono ancora al loro posto.
  for (const { table } of TABELLE_FIGLIE_DIP) {
    const { error } = await sb.from(table).delete().eq("dipendente_id", id);
    if (error) {
      if (isAuthError(error)) showLogin("Sessione scaduta. Rientra.");
      else alert(`Errore eliminando ${table}: ${error.message}\nIl dipendente NON e' stato eliminato.`);
      return false;
    }
  }
  // Gli inviti self-service: un token ancora valido terrebbe in vita
  // l'autorizzazione di caricamento sui file del portale.
  await sb.from("invite_tokens").delete().eq("dipendente_id", id);

  if (!await sbDelete("dipendenti", id)) return false;

  for (const { store } of TABELLE_FIGLIE_DIP) {
    state[store] = state[store].filter((r) => r.dipendente_id !== id);
  }
  if (paths.length) {
    const { error } = await sb.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) console.warn("PDF non rimossi dal bucket:", error.message);
  }
  return true;
}

async function deleteDip() {
  const id = $("dip-id").value;
  if (!id) return;
  if (!confirm("Eliminare il dipendente con tutti i suoi dati (adempimenti, provvedimenti, DPI, onboarding) e i PDF associati?")) return;
  // In caso di errore la modale resta aperta sulla persona non cancellata,
  // com'era prima dell'estrazione.
  if (!await eliminaDipendenteCompleto(id)) return;
  closeModal("modal-dip");
  renderAll();
}

// ============================================================
// 1c · I dati di prova, e il bottone che li toglie di mezzo.
// Otto persone finte caricate da sql/fase_1c_2026-09-02_dati_prova.sql perche'
// l'HR possa esercitarsi prima di inserire le quindici vere. Chi e' finto lo
// decide isDatoDiProva in common.js (nota esatta oppure id dip-prova-*).
// ============================================================

// Chi e' finto, chi e' il dipendente di collaudo da saltare e quindi chi il
// bottone cancella: tutto in dipendentiDiProva (common.js), con i suoi test.
async function eliminaDatiDiProva() {
  const persone = dipendentiDiProva(state.dipendenti);
  if (!persone.length) return;
  const elenco = persone.map((d) => d.cognome).join(", ");
  if (!confirm(
    `Eliminare le ${persone.length} persone di prova (${elenco}) con tutti i loro dati e i documenti che hai caricato su di loro?\n\n` +
    "Il dipendente di collaudo e le persone vere non vengono toccati.\nL'operazione non si puo' annullare."
  )) return;

  for (const d of persone) {
    // eliminaDipendenteCompleto avvisa gia' l'utente dell'errore: qui basta
    // fermarsi, senza cancellare a meta' e senza un secondo avviso.
    if (!await eliminaDipendenteCompleto(d.id)) break;
  }
  renderAll();
}

// ============================================================
// 3.2 · CEDOLINI
// L'HR li carica un mese per volta; il dipendente li apre dal proprio portale.
//
// Come li legge il dipendente, e perche' cosi': dalla Fase 1b il ruolo `anon`
// NON ha nessuna policy di lettura sullo storage, e non deve riaverla. Quindi al
// caricamento l'HR — che e' autenticato — genera un link firmato di lunga durata
// e lo salva nella riga; la RPC self_get_cedolini restituisce al portale le sole
// righe di quella persona, con il loro link.
//
// ATTENZIONE, limite dichiarato: un link firmato di Supabase e' un JWT autonomo.
// Resta valido fino alla propria scadenza QUALUNQUE cosa si scriva nella riga:
// azzerare url_firmato toglie il cedolino dal portale, non dalle mani di chi
// l'aveva gia' aperto. E' scritto nell'informativa privacy e nel manuale.
// ============================================================

const MESI_NOME = () => window.MESI || [];
const nomeMese = (m) => MESI_NOME()[Number(m) - 1] || String(m);
const tipoCedolino = (k) => (window.TIPI_CEDOLINO || []).find((t) => t.key === k) || { key: k, label: k };

function etichettaPeriodoCedolino(c) {
  if (!c) return "—";
  if (c.tipo === "tredicesima") return `Tredicesima ${c.anno}`;
  if (c.tipo === "cu") return `Certificazione Unica ${c.anno}`;
  return `${nomeMese(c.mese)} ${c.anno}`;
}

// Il mese che il contatore in barra laterale sorveglia: quello PRECEDENTE.
// I cedolini di luglio arrivano dal consulente in agosto: puntare al mese
// corrente direbbe "0 su 15" per tutto il mese e non vorrebbe dire niente.
function mesePaghe() {
  const oggi = new Date();
  const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1);
  return { anno: d.getFullYear(), mese: d.getMonth() + 1 };
}

// Il link firmato che il dipendente usera'. La durata sta nei parametri, non
// nel codice: 13 mesi di default, perche' deve coprire l'anno piu' il mese di
// consegna.
async function generaLinkCedolino(path) {
  const giorni = parametroInt(state.parametri, "cedolino_giorni_link", 396);
  const { data, error } = await sb.storage.from(STORAGE_BUCKET)
    .createSignedUrl(path, giorni * 24 * 60 * 60);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Supabase non ha restituito nessun link.");
  return {
    url_firmato: data.signedUrl,
    url_scade_il: new Date(Date.now() + giorni * 86400000).toISOString(),
  };
}

// ---------- I cedolini nella scheda della persona (linguetta Registro) ----------
function renderDipCedolini(dipId) {
  const section = $("dip-cedolini-section");
  const list = $("dip-cedolini-list");
  const righe = state.cedolini
    .filter((c) => c.dipendente_id === dipId)
    .sort((a, b) => (b.anno - a.anno) || (b.mese - a.mese) || (a.tipo || "").localeCompare(b.tipo || ""));
  $("dip-cedolini-count").textContent = righe.length;
  section.hidden = false;   // sempre visibile: dice anche "nessuno ancora"
  list.hidden = true;
  el(".history-arrow", $("dip-cedolini-toggle"))?.classList.remove("expanded");
  $("dip-cedolini-toggle").setAttribute("aria-expanded", "false");

  list.innerHTML = righe.length === 0
    ? '<div class="muted" style="padding:8px 0">Nessun cedolino caricato. Si caricano dal bottone "Cedolini" nella barra a sinistra.</div>'
    : righe.map((c) => `<div class="hist-row ced-row" data-id="${esc(c.id)}">
        <div><strong>${esc(etichettaPeriodoCedolino(c))}</strong>
          <div class="hist-note">caricato il ${esc(fmtDateTime(c.caricato_il))}${c.url_firmato ? "" : " · link da rigenerare"}</div></div>
        <div class="row-actions">
          <button type="button" class="icon-btn ced-doc-btn" data-path="${esc(c.path)}" title="Apri il cedolino">📎</button>
          <button type="button" class="icon-btn ced-del-btn" data-id="${esc(c.id)}" title="Elimina questo cedolino">🗑</button>
        </div>
      </div>`).join("");

  els(".ced-doc-btn", list).forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    // L'HR apre con un link firmato generato adesso (10 minuti), non con quello
    // lungo salvato per il dipendente.
    await openSignedDoc(b.dataset.path);
  }));
  els(".ced-del-btn", list).forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await eliminaCedolino(b.dataset.id, dipId);
  }));
}

async function eliminaCedolino(id, dipId) {
  const c = state.cedolini.find((x) => x.id === id);
  if (!c) return;
  if (!confirm(`Eliminare il cedolino "${etichettaPeriodoCedolino(c)}" e il file allegato?`
    + NL + "Il dipendente non lo vedra' piu' nel suo portale.")) return;
  // Prima la riga, poi il file: nell'ordine inverso un errore lascerebbe una
  // riga che punta a un file che non c'e' piu'.
  if (!await sbDelete("cedolini", id)) return;
  await deleteDoc(c.path);
  renderDipCedolini(dipId);
}

// ---------- Modale "Carica il mese" ----------
// I file scelti non stanno negli <input>: stanno qui, per dipendente. Cosi' la
// selezione multipla (abbinata per matricola) e la scelta riga per riga
// scrivono nello stesso posto, e la riga mostra sempre quello che verra'
// caricato davvero.
let cedoliniPendenti = new Map();

function openCedoliniModal() {
  const { anno, mese } = mesePaghe();
  $("ced-anno").value = anno;
  fillSelect($("ced-mese"), (window.MESI || []).map((nome, i) => ({ id: String(i + 1), nome })));
  $("ced-mese").value = String(mese);
  fillSelect($("ced-tipo"), (window.TIPI_CEDOLINO || []).map((t) => ({ id: t.key, nome: t.label })));
  $("ced-tipo").value = "mensile";
  $("ced-multi-file").value = "";
  $("ced-multi-hint").textContent = "";
  $("ced-status").textContent = "";
  $("ced-progress").hidden = true;
  cedoliniPendenti = new Map();
  aggiornaMeseCedolini();
  renderRigheCedolini();
  openModal("modal-cedolini");
}

// Tredicesima e CU non hanno un mese da scegliere: il mese lo decide il tipo
// (13 e 0), ed e' la regola che rende vera l'unicita'.
function aggiornaMeseCedolini() {
  const t = tipoCedolino($("ced-tipo").value);
  const mensile = t.key === "mensile";
  $("ced-mese").disabled = !mensile;
  $("ced-mese-wrap").classList.toggle("disattivato", !mensile);
}

function periodoCedoliniScelto() {
  return normalizzaPeriodoCedolino({
    anno: $("ced-anno").value,
    mese: $("ced-mese").value,
    tipo: $("ced-tipo").value,
  });
}

function renderRigheCedolini() {
  const p = periodoCedoliniScelto();
  // Tredicesima e CU sono dell'ANNO, non di un mese: spettano anche a chi se n'e'
  // andato a meta' anno, e questa modale e' l'unico posto da cui si caricano.
  const persone = state.dipendenti
    .filter((d) => (p.tipo === "mensile" ? inForzaNelMese(d, p.anno, p.mese) : inForzaNellAnno(d, p.anno)))
    .sort((a, b) => (a.cognome || "").localeCompare(b.cognome || ""));
  const host = $("ced-rows");
  if (!persone.length) {
    host.innerHTML = '<div class="muted" style="padding:10px 0">Nessuna persona era in forza in questo periodo.</div>';
    return;
  }
  host.innerHTML = persone.map((d) => {
    const gia = state.cedolini.find((c) => c.dipendente_id === d.id
      && Number(c.anno) === p.anno && Number(c.mese) === p.mese && c.tipo === p.tipo);
    const scelto = cedoliniPendenti.get(d.id);
    const stato = scelto
      ? `<span class="ced-scelto">📄 ${esc(scelto.name)}</span>`
      : (gia ? '<span class="hist-late ontime">✓ già caricato</span>' : '<span class="muted">—</span>');
    return `<div class="ced-riga" data-dip="${esc(d.id)}">
      <div><strong>${esc(d.cognome)} ${esc(d.nome)}</strong>
        <div class="hist-note">matricola ${esc(d.matricola || "—")}</div></div>
      <div class="ced-stato">${stato}</div>
      <label class="ced-file-label"><span>Scegli</span>
        <input type="file" class="ced-file" accept=".pdf,image/*"></label>
    </div>`;
  }).join("");
  els(".ced-file", host).forEach((inp) => inp.addEventListener("change", (e) => {
    const dipId = e.currentTarget.closest(".ced-riga").dataset.dip;
    const f = e.currentTarget.files?.[0] || null;
    if (f) cedoliniPendenti.set(dipId, f); else cedoliniPendenti.delete(dipId);
    renderRigheCedolini();
  }));
}

// Selezione multipla: l'abbinamento per matricola e' un SUGGERIMENTO. Riempie le
// righe, e l'HR vede nome, matricola e nome del file accanto a ciascuna prima di
// confermare. Quello che non si abbina, o si abbina a due persone, resta scritto
// sotto: un file assegnato di nascosto alla persona sbagliata e' il danno
// peggiore che questa modale possa fare.
function abbinaFileScelti(files) {
  const perNome = new Map(files.map((f) => [f.name, f]));
  const r = abbinaCedoliniPerMatricola(files.map((f) => f.name), state.dipendenti);
  for (const { nomeFile, dipendenteId } of r.abbinati) {
    cedoliniPendenti.set(dipendenteId, perNome.get(nomeFile));
  }
  const parti = [`${r.abbinati.length} file su ${files.length} abbinati dalla matricola nel nome.`];
  if (r.ambigui.length) parti.push(`Ambigui (corrispondono a piu' persone, o piu' file alla stessa persona): ${r.ambigui.join(", ")}.`);
  if (r.nonAbbinati.length) parti.push(`Nessuna matricola riconosciuta in: ${r.nonAbbinati.join(", ")}.`);
  if (r.ambigui.length || r.nonAbbinati.length) parti.push("Questi assegnali a mano riga per riga.");
  $("ced-multi-hint").textContent = parti.join(" ");
  renderRigheCedolini();
}

async function caricaCedoliniDelMese(e) {
  e.preventDefault();
  const p = periodoCedoliniScelto();
  if (!p.anno || (p.tipo === "mensile" && !(p.mese >= 1 && p.mese <= 12))) {
    alert("Anno o mese non validi."); return;
  }
  if (!cedoliniPendenti.size) { alert("Non hai scelto nessun file."); return; }
  const btn = bottoneOccupato("ced-salva", "⏳ Caricamento…");
  $("ced-progress").hidden = false;
  let fatti = 0;
  try {
    for (const [dipId, file] of cedoliniPendenti) {
      const d = dipById(dipId);
      btn.aggiorna(`⏳ ${d ? d.cognome : dipId}…`);
      // Il percorso lo costruisce l'app dal dipendente_id della riga, MAI da un
      // input libero: e' la guardia contro il cedolino leggibile dalla persona
      // sbagliata.
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      const path = `cedolini/${dipId}/${p.anno}-${String(p.mese).padStart(2, "0")}-${p.tipo}-${Date.now()}.${ext}`;
      const up = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
        upsert: false, contentType: file.type || "application/octet-stream",
      });
      if (up.error) throw new Error(`${d ? d.cognome + " " + d.nome : dipId}: ${up.error.message}`);

      let link;
      try {
        link = await generaLinkCedolino(path);
      } catch (err) {
        await deleteDoc(path);   // mai lasciare nel bucket un file che nessuna riga referenzia
        throw err;
      }

      const esistente = state.cedolini.find((c) => c.dipendente_id === dipId
        && Number(c.anno) === p.anno && Number(c.mese) === p.mese && c.tipo === p.tipo);
      const row = {
        ...(esistente || {}),
        id: esistente?.id || uid(),
        dipendente_id: dipId,
        anno: p.anno, mese: p.mese, tipo: p.tipo,
        path,
        url_firmato: link.url_firmato,
        url_scade_il: link.url_scade_il,
        caricato_il: new Date().toISOString(),
      };
      if (!await sbUpsert("cedolini", row)) {
        await deleteDoc(path);
        $("ced-status").textContent = `✕ Interrotto dopo ${fatti} cedolini: salvataggio non riuscito.`;
        return;
      }
      // Il file vecchio si cancella SOLO a salvataggio riuscito, mai prima.
      if (esistente?.path && esistente.path !== path) await deleteDoc(esistente.path);
      fatti++;
    }
    $("ced-status").textContent = `✓ ${fatti} cedolini caricati.`;
    cedoliniPendenti = new Map();
    $("ced-multi-file").value = "";
    $("ced-multi-hint").textContent = "";
    renderRigheCedolini();
    renderAll();
  } catch (err) {
    // Ci si ferma al primo errore, come il backup: dire "fatto" a meta' su dei
    // cedolini vorrebbe dire non sapere piu' chi ha ricevuto cosa.
    $("ced-status").textContent = `✕ Interrotto dopo ${fatti} cedolini: ${err?.message || err}`;
    renderAll();
  } finally {
    $("ced-progress").hidden = true;
    btn.ripristina();
  }
}

// ---------- Rinnovo dei link ----------
function cedoliniConLinkDaRinnovare() {
  return cedoliniDaRinnovare(state.cedolini,
    parametroInt(state.parametri, "cedolino_giorni_preavviso", 30),
    state.dipendenti);   // i cessati restano fuori: il loro collegamento e' spento apposta
}

async function rinnovaLinkCedolini() {
  const daFare = cedoliniConLinkDaRinnovare();
  if (!daFare.length) { alert("Nessun link da rinnovare."); return; }
  if (!confirm(`Rigenerare il collegamento di ${daFare.length} ${daFare.length === 1 ? "cedolino" : "cedolini"}?`
    + NL + "I dipendenti ritroveranno nel portale quelli che erano scaduti.")) return;
  const btn = bottoneOccupato("btn-rinnova-link-cedolini", "⏳ Rinnovo…");
  let fatti = 0;
  try {
    for (const c of daFare) {
      btn.aggiorna(`⏳ ${fatti + 1}/${daFare.length}…`);
      const link = await generaLinkCedolino(c.path);
      if (!await sbUpsert("cedolini", { ...c, ...link })) return;
      fatti++;
    }
    alert(`✓ ${fatti} collegamenti rinnovati.`);
  } catch (err) {
    alert(`Rinnovo interrotto dopo ${fatti} collegamenti: ${err?.message || err}`);
  } finally {
    btn.ripristina();
    renderAll();
  }
}

// ============================================================
// 3.3 · SCAMBI CON IL CONSULENTE DEL LAVORO
// Una tabella sola per le due direzioni, perche' la domanda dell'HR e' una:
// "con lo studio, questo mese, sono a posto?". In entrata LUL, F24, Uniemens,
// prospetti, CU, 770; in uscita il riepilogo delle variabili del mese, che dalla
// Fase 4.4 si scrivera' da solo.
// I tipi e la loro periodicita' stanno in data.js: sono nomi di documenti, non
// numeri che cambiano con le norme.
// ============================================================
const tipiScambio = () => window.TIPI_SCAMBIO_CONSULENTE || [];
const tipoScambio = (k) => tipiScambio().find((t) => t.key === k) || { key: k, label: k, direzione: "entrata" };

const SIMBOLO_SCAMBIO = { presente: "✓", mancante: "!", futuro: "·" };

function grigliaScambiAnno(anno) {
  return grigliaScambi({ anno, tipi: tipiScambio(), righe: state.scambiConsulente });
}

function etichettaPeriodoScambio(mese, anno) {
  return Number(mese) === 0 ? `anno ${anno}` : `${nomeMese(mese)} ${anno}`;
}

function renderConsulente() {
  const anno = state.scambiAnno;
  const corrente = new Date().getFullYear();
  const anni = [];
  for (let y = corrente + 1; y >= corrente - 4; y--) anni.push(y);
  $("consulente-anno").innerHTML = anni.map((y) =>
    `<option value="${y}"${y === anno ? " selected" : ""}>${y}</option>`).join("");

  const griglia = grigliaScambiAnno(anno);
  const mancanti = scambiMancanti(griglia);
  $("consulente-mancanti").textContent = mancanti === 0
    ? "Con lo studio sei a posto: non manca niente per quest'anno."
    : `${mancanti} ${mancanti === 1 ? "casella manca" : "caselle mancano"}: ` + descriviMancanti(griglia);

  const mensili = griglia.filter((r) => !r.annuale);
  const annuali = griglia.filter((r) => r.annuale);

  const intestazione = `<div class="sc-riga sc-testa">
      <div>Documento</div>
      ${(window.MESI || []).map((m) => `<div title="${esc(m)}">${esc(m.slice(0, 3))}</div>`).join("")}
    </div>`;

  const rigaHtml = (r) => `<div class="sc-riga">
      <div class="sc-nome"><strong>${esc(r.label)}</strong>
        <div class="hist-note">${r.direzione === "entrata" ? "dallo studio" : "allo studio"}</div></div>
      ${r.celle.map((c) => `<button type="button" class="sc-cella ${c.stato}"
          data-tipo="${esc(r.tipo)}" data-mese="${c.mese}"
          title="${esc(r.label)} — ${esc(etichettaPeriodoScambio(c.mese, anno))}">${SIMBOLO_SCAMBIO[c.stato]}</button>`).join("")}
    </div>`;

  $("consulente-grid").innerHTML = intestazione + mensili.map(rigaHtml).join("");

  $("consulente-annuali").innerHTML = annuali.length === 0 ? "" :
    `<div class="sc-annuali-titolo">Una volta l'anno</div>` +
    annuali.map((r) => `<div class="sc-annuale">
        <span class="sc-nome"><strong>${esc(r.label)}</strong></span>
        <button type="button" class="sc-cella ${r.celle[0].stato}"
          data-tipo="${esc(r.tipo)}" data-mese="0"
          title="${esc(r.label)} — anno ${anno}">${SIMBOLO_SCAMBIO[r.celle[0].stato]}</button>
      </div>`).join("");

  els(".sc-cella").forEach((b) => b.addEventListener("click", () =>
    openScambioModal(b.dataset.tipo, Number(b.dataset.mese))));
}

// "manca il LUL di luglio": a parole, non con un numero soltanto. Al massimo
// quattro, poi "e altri N": un elenco lungo trenta voci non lo legge nessuno.
function descriviMancanti(griglia) {
  const voci = [];
  for (const r of griglia) {
    for (const c of r.celle) {
      if (c.stato === "mancante") voci.push(`${r.label} di ${etichettaPeriodoScambio(c.mese, state.scambiAnno)}`);
    }
  }
  const primi = voci.slice(0, 4).join(", ");
  return voci.length > 4 ? `${primi} e altri ${voci.length - 4}.` : `${primi}.`;
}

let pendingScambioFile = null;

function openScambioModal(tipoKey, mese) {
  const t = tipoScambio(tipoKey);
  const anno = state.scambiAnno;
  const riga = state.scambiConsulente.find((r) => Number(r.anno) === anno
    && Number(r.mese) === Number(mese) && r.tipo === tipoKey && r.direzione === t.direzione) || null;
  $("scambio-title").textContent = t.label;
  $("scambio-id").value = riga?.id || "";
  $("scambio-target").textContent =
    `${t.label} — ${etichettaPeriodoScambio(mese, anno)} · ${t.direzione === "entrata" ? "ricevuto dallo studio" : "mandato allo studio"}`;
  // Il periodo e il tipo NON si modificano dalla modale: si sceglie la casella.
  $("scambio-tipo").value = tipoKey;
  $("scambio-mese").value = String(mese);
  $("scambio-data").value = riga?.data || localISO(new Date());
  $("scambio-note").value = riga?.note || "";
  $("scambio-delete").hidden = !riga;
  pendingScambioFile = null;
  $("scambio-doc-file").value = "";
  $("scambio-doc-upload-label").textContent = "Carica un file";
  $("scambio-doc-progress").hidden = true;
  $("scambio-doc-current").hidden = !riga?.path;
  if (riga?.path) $("scambio-doc-current-name").textContent = `${t.label} — ${etichettaPeriodoScambio(mese, anno)}`;
  openModal("modal-scambio");
}

async function saveScambio(e) {
  e.preventDefault();
  const tipoKey = $("scambio-tipo").value;
  const t = tipoScambio(tipoKey);
  const mese = Number($("scambio-mese").value);
  const anno = state.scambiAnno;
  const id = $("scambio-id").value || uid();
  const prec = state.scambiConsulente.find((r) => r.id === id) || null;

  const oldPath = prec?.path || null;
  let path = oldPath;
  let caricato = null;
  if (pendingScambioFile) {
    $("scambio-doc-progress").hidden = false;
    try {
      const ext = (pendingScambioFile.name.split(".").pop() || "bin").toLowerCase();
      const nuovo = `consulente/${id}/${Date.now()}.${ext}`;
      const { error } = await sb.storage.from(STORAGE_BUCKET).upload(nuovo, pendingScambioFile, {
        upsert: false, contentType: pendingScambioFile.type || "application/octet-stream",
      });
      if (error) throw error;
      caricato = nuovo;
      path = nuovo;
    } catch (err) {
      $("scambio-doc-progress").hidden = true;
      alert("Errore caricamento file: " + err.message);
      return;
    }
    $("scambio-doc-progress").hidden = true;
  }

  const row = {
    ...(prec || {}),
    id, anno, mese, tipo: tipoKey, direzione: t.direzione,
    data: $("scambio-data").value || null,
    path,
    note: $("scambio-note").value.trim() || null,
  };
  const ok = await sbUpsert("scambi_consulente", row);
  if (!ok) { if (caricato) await deleteDoc(caricato); return; }
  // Il file vecchio solo a salvataggio riuscito, mai prima.
  if (caricato && oldPath && oldPath !== caricato) await deleteDoc(oldPath);
  pendingScambioFile = null;
  closeModal("modal-scambio");
}

async function deleteScambio() {
  const id = $("scambio-id").value;
  if (!id) return;
  const prec = state.scambiConsulente.find((r) => r.id === id);
  if (!confirm("Togliere questa casella dal registro degli scambi?"
    + (prec?.path ? NL + "Anche il file allegato viene cancellato." : ""))) return;
  // Prima la riga, poi il file.
  if (!await sbDelete("scambi_consulente", id)) return;
  if (prec?.path) await deleteDoc(prec.path);
  closeModal("modal-scambio");
}

// ---------- Adempimento ----------
function openAdmModal(dipId, admId, preTipoId) {
  const a = admId ? state.adempimenti.find((x) => x.id === admId) : null;
  const dip = dipById(dipId);
  $("adm-title").textContent = "Adempimento";
  $("adm-id").value = a ? a.id : "";
  $("adm-dip-id").value = dipId;
  $("adm-dip-name").textContent = dip ? `${dip.cognome} ${dip.nome}` : "—";
  // Tipo: sempre readonly. Se non c'è, mostriamo placeholder.
  const fixedTipoId = a?.tipo_requisito_id || preTipoId || "";
  $("adm-tipo").value = fixedTipoId; // hidden helper, usato dalla logica Fatto
  if (fixedTipoId) {
    // Tipo deciso (riga cliccata in Scadenze o adempimento esistente): readonly.
    const t = tipoById(fixedTipoId);
    $("adm-tipo-fixed").textContent = `${CAT_BY_KEY[t?.categoria]?.icon || ""} ${t?.nome || "—"}`;
    $("adm-tipo-fixed").hidden = false;
    $("adm-tipo-wrap").style.display = "none";
  } else {
    // "+ Registra adempimento": tendina visibile per scegliere il tipo (anche extra).
    $("adm-tipo-fixed").hidden = true;
    $("adm-tipo-wrap").style.display = "";
  }
  // Date readonly.
  $("adm-rilascio-ro").textContent = a?.data_rilascio ? fmtDate(a.data_rilascio) : "—";
  $("adm-scadenza-ro").textContent = a?.data_scadenza ? fmtDate(a.data_scadenza) : (a?.data_rilascio ? "non scade" : "—");
  // Documento corrente: solo se presente, mostra il bottone "Apri".
  if (a?.documento_path || a?.documento_url) {
    $("adm-doc-ro-wrap").hidden = false;
  } else {
    $("adm-doc-ro-wrap").hidden = true;
  }
  // Hint sotto le date.
  if (a?.data_rilascio || a?.data_scadenza) {
    $("adm-auto-hint").textContent = "";
  } else {
    $("adm-auto-hint").textContent = "Mai registrato. Clicca '✓ Fatto' per inserire la data dell'evento e l'eventuale PDF.";
  }
  // Storico.
  renderAdmHistory(a);
  openModal("modal-adempimento");
}

function renderAdmHistory(a) {
  const section = $("adm-history-section");
  const list = $("adm-history-list");
  // Eventi = ciclo corrente (se registrato) + tutte le voci dell'history.
  const events = [];
  if (a?.data_rilascio) {
    events.push({
      doneAt: a.data_rilascio,
      dueDate: a.data_scadenza || null,
      documentoPath: a.documento_path || null,
      source: "current",
    });
  }
  if (Array.isArray(a?.history)) {
    a.history.forEach((h) => events.push({ ...h, source: "history" }));
  }
  $("adm-history-count").textContent = events.length;
  section.hidden = events.length === 0;
  // Default: collassato.
  list.hidden = true;
  el(".history-arrow", $("adm-history-toggle"))?.classList.remove("expanded");
  $("adm-history-toggle").setAttribute("aria-expanded", "false");
  events.sort((x, y) => (y.doneAt || "").localeCompare(x.doneAt || ""));
  list.innerHTML = events.map((h) => {
    const docPath = h.documentoPath || "";
    const fonte = h.source === "current"
      ? '<span class="hist-late ontime">corrente</span>'
      : '<span class="hist-late early">archiviato</span>';
    return `<div class="hist-row">
      <div class="hist-date">${fmtDate(h.doneAt) || "—"}</div>
      <div>${fonte}</div>
      <div class="hist-meta">${h.dueDate ? `<span class="hist-by">scade ${fmtDate(h.dueDate)}</span>` : '<span class="hist-by">non scade</span>'}</div>
      <button type="button" class="hist-doc ${!docPath ? "disabled" : ""}" data-path="${esc(docPath)}" title="${docPath ? "Apri PDF" : "Nessun PDF"}">📎</button>
    </div>`;
  }).join("");
  els(".hist-doc", list).forEach((btn) => btn.addEventListener("click", async () => {
    await openSignedDoc(btn.dataset.path);
  }));
}

// Auto-calcolo scadenza da data rilascio + validita_mesi della regola del tipo selezionato.
// `requisiti` e' un parametro (1.3): serve a calcolare la validita' effettiva
// anche con una matrice SIMULATA, cioe' come sarebbe se la regola che si sta
// modificando avesse gia' il valore nuovo.
function validitaMesiForTipo(tipoId, dipId, requisiti = state.requisiti) {
  const ruoloIds = new Set(ruoliOfDip(dipId).map((r) => r.id));
  const reqs = requisiti.filter((req) => req.tipo_requisito_id === tipoId && ruoloIds.has(req.ruolo_id));
  if (!reqs.length) return undefined;
  // validità più stringente
  return reqs.reduce((min, r) => {
    const v = r.validita_mesi == null ? Infinity : r.validita_mesi;
    return v < min ? v : min;
  }, Infinity);
}

// Calcolo automatico della data scadenza dal rilascio + regola in matrice.
function calcScadenza(rilascio, tipoId, dipId) {
  if (!rilascio) return null;
  const v = validitaMesiForTipo(tipoId, dipId);
  if (v === undefined || v === Infinity) return null;
  return addMonths(rilascio, v);
}

// ---------- Rinnovo con un click ("Fatto") ----------
// Apre una mini-modale che chiede SOLO la data dell'evento.
// Conferma → archivia il ciclo corrente in history + calcola la nuova scadenza
// dalla regola in matrice + salva atomicamente sul DB. Niente PDF / nota qui:
// l'utente li carica/scrive dalla modale principale dopo, se vuole.
// 1.1 · Dipendente, tipo e validita' in gioco nella modale Fatto. Li legge come
// fa applyFatto: dall'adempimento se esiste, altrimenti dalla modale adempimento
// sottostante (caso "prima registrazione", admId vuoto).
function contestoFatto() {
  const admId = $("fatto-adm-id").value;
  const a = admId ? state.adempimenti.find((x) => x.id === admId) : null;
  const dipId = a?.dipendente_id || $("adm-dip-id").value;
  const tipoId = a?.tipo_requisito_id || $("adm-tipo").value;
  const validita = (dipId && tipoId) ? validitaMesiForTipo(tipoId, dipId) : undefined;
  return { a, dipId, tipoId, validita };
}

// La scadenza e' OBBLIGATORIA quando la regola prevede una validita': lasciarla
// vuota renderebbe l'obbligo "non scade" per sempre, cioe' verde per sempre.
// undefined = il tipo non e' nei requisiti della persona; Infinity = non scade.
const scadenzaRichiesta = (v) => v !== undefined && v !== Infinity;

function aggiornaHintFatto() {
  const { validita: v } = contestoFatto();
  const data = $("fatto-data").value;
  if (v === undefined) {
    $("fatto-hint").textContent = "Questo tipo non è fra i requisiti del dipendente: la scadenza, se ne ha una, scrivila tu.";
  } else if (v === Infinity) {
    $("fatto-hint").textContent = "Questo requisito non scade: la scadenza può restare vuota.";
  } else {
    $("fatto-hint").textContent = `Validità da regola: ${v} mesi${data ? " → " + fmtDate(addMonths(data, v)) : ""}.`;
  }
  $("fatto-scadenza").required = scadenzaRichiesta(v);
  // L'avviso confronta con la regola SOLO se una regola c'e'.
  const avviso = avvisoScadenza(data, scadenzaRichiesta(v) ? v : null, $("fatto-scadenza").value);
  $("fatto-scadenza-avviso").textContent = avviso || "";
  $("fatto-scadenza-avviso").hidden = !avviso;
}

// Riporta la scadenza al valore della regola. Si chiama all'apertura e a ogni
// cambio della data dell'evento: una correzione a mano fatta prima di cambiare
// la data viene sostituita, ed e' giusto cosi' (la data e' il presupposto).
function precompilaScadenzaFatto() {
  const { validita: v } = contestoFatto();
  const data = $("fatto-data").value;
  $("fatto-scadenza").value = (scadenzaRichiesta(v) && data) ? (addMonths(data, v) || "") : "";
  aggiornaHintFatto();
}

function openFattoModal(admId, dipIdFallback, tipoIdFallback) {
  // Caso 1: rinnovo di adempimento esistente. Caso 2: prima registrazione (admId vuoto).
  let a = admId ? state.adempimenti.find((x) => x.id === admId) : null;
  const dipId = a?.dipendente_id || dipIdFallback;
  const tipoId = a?.tipo_requisito_id || tipoIdFallback;
  if (!dipId || !tipoId) { alert("Manca dipendente o tipo requisito."); return; }
  const dip = dipById(dipId);
  const tipo = tipoById(tipoId);
  $("fatto-adm-id").value = admId || "";
  $("fatto-target").textContent = (dip ? `${dip.cognome} ${dip.nome} — ` : "") + (tipo?.nome || "—");
  const today = localISO(new Date());
  $("fatto-data").value = today;
  $("fatto-file").value = "";
  $("fatto-progress").hidden = true;
  precompilaScadenzaFatto();
  openModal("modal-fatto");
}

async function applyFatto(e) {
  e.preventDefault();
  const admId = $("fatto-adm-id").value;
  // Caso 1: rinnovo (a esiste). Caso 2: prima registrazione (a non esiste, prendiamo
  // dipId/tipoId dalla modale adempimento sottostante).
  const a = admId ? state.adempimenti.find((x) => x.id === admId) : null;
  const dipId = a?.dipendente_id || $("adm-dip-id").value;
  const tipoId = a?.tipo_requisito_id || $("adm-tipo").value;
  if (!dipId || !tipoId) { alert("Manca dipendente o tipo requisito."); return; }
  const dataEvento = $("fatto-data").value;
  if (!dataEvento) { alert("Inserisci la data dell'evento."); return; }

  // 1.1 · La scadenza la decide l'HR: precompilata dalla regola, correggibile.
  // Il medico competente scrive "prossima visita fra 6 mesi" e l'app deve
  // registrare quello, non i 12 mesi della matrice.
  // La guardia sta QUI, prima dell'upload: uscire dopo aver caricato il PDF
  // lascerebbe nel bucket un file che nessuna riga referenzia.
  const v = validitaMesiForTipo(tipoId, dipId);
  const newScadenza = $("fatto-scadenza").value || null;
  if (scadenzaRichiesta(v) && !newScadenza) {
    alert(`La regola prevede una validità di ${v} mesi: la scadenza è obbligatoria. `
          + 'Lasciandola vuota, questo obbligo risulterebbe "non scade" per sempre.');
    return;
  }

  const newFile = $("fatto-file").files?.[0] || null;

  const targetId = admId || uid();

  // Upload nuovo PDF (se fornito) PRIMA di toccare il DB.
  let newDocumentoPath = null;
  if (newFile) {
    $("fatto-progress").hidden = false;
    try {
      newDocumentoPath = await uploadDoc(targetId, newFile);
    } catch (err) {
      $("fatto-progress").hidden = true;
      alert("Errore upload: " + err.message);
      return;
    }
    $("fatto-progress").hidden = true;
  }

  // Snapshot del ciclo corrente per lo storico (campi dal DB). Solo se c'è un ciclo
  // davvero registrato (data_rilascio impostata): una riga MANCANTE pre-creata dal sync
  // non è un "ciclo" da archiviare.
  const history = Array.isArray(a?.history) ? [...a.history] : [];
  const hasCurrentCycle = a && a.data_rilascio;
  if (hasCurrentCycle) {
    history.push({
      doneAt: a.data_rilascio,
      dueDate: a.data_scadenza || null,
      rilascio: a.data_rilascio || null,
      scadenza: a.data_scadenza || null,
      documentoPath: a.documento_path || null,
      note: a.note || null,
    });
  }

  const row = a
    ? { ...a, corrente: true, data_rilascio: dataEvento, data_scadenza: newScadenza,
        // Se l'HR valida senza allegare un nuovo file, il file caricato dal dipendente resta
        // agganciato; quando invece si archivia un ciclo precedente (hasCurrentCycle) il vecchio
        // path vive nello storico e il campo si azzera come prima.
        documento_path: newDocumentoPath || (hasCurrentCycle ? null : (a?.documento_path || null)),
        note: null, last_done_at: dataEvento, previous_date: a.data_scadenza || null, history }
    : { id: targetId, dipendente_id: dipId, tipo_requisito_id: tipoId, corrente: true,
        data_rilascio: dataEvento, data_scadenza: newScadenza, documento_path: newDocumentoPath,
        documento_url: null, done: false, done_at: null, done_by: null,
        last_done_at: dataEvento, previous_date: null, history: [], note: null };

  const ok = await sbUpsert("adempimenti", row);
  if (!ok) {
    if (newDocumentoPath) await deleteDoc(newDocumentoPath);
    return;
  }

  // Se l'HR valida allegando un file NUOVO a un adempimento mai registrato
  // (tipico: il dipendente aveva caricato il suo dal portale), il vecchio file
  // non finisce in history — quel ramo vale solo per i cicli registrati — e
  // resterebbe nel bucket senza piu' nessun riferimento. Va cancellato qui,
  // come gia' fanno DPI, provvedimenti e onboarding.
  if (newDocumentoPath && !hasCurrentCycle && a?.documento_path && a.documento_path !== newDocumentoPath) {
    await deleteDoc(a.documento_path);
  }

  closeModal("modal-fatto");
  closeModal("modal-adempimento");
  if (!$("modal-dip").hidden && $("dip-id").value === dipId) {
    renderDipAdempimenti(dipId);
    renderDipOnboarding(dipId);
  }
  renderAll();
}

// ---------- Ruolo ----------
function openRuoloModal(id) {
  const r = id ? ruoloById(id) : null;
  $("ruolo-title").textContent = r ? r.nome : "Nuovo ruolo";
  $("ruolo-id").value = r ? r.id : "";
  $("ruolo-nome").value = r?.nome || "";
  $("ruolo-tipo").value = r?.tipo || "mansione";
  $("ruolo-minimo").value = r?.minimo_richiesto ?? 0;
  $("ruolo-note").value = r?.note || "";
  const tipo = r?.tipo || "mansione";
  $("ruolo-minimo-wrap").hidden = tipo !== "incarico";
  $("ruolo-delete").hidden = !r;
  openModal("modal-ruolo");
}
async function saveRuolo(e) {
  e.preventDefault();
  const id = $("ruolo-id").value || uid();
  const tipo = $("ruolo-tipo").value;
  const minimoRaw = $("ruolo-minimo").value;
  const row = {
    id,
    nome: $("ruolo-nome").value.trim(),
    tipo,
    minimo_richiesto: tipo === "incarico" ? Math.max(0, parseInt(minimoRaw, 10) || 0) : 0,
    note: $("ruolo-note").value.trim() || null,
  };
  if (await sbUpsert("ruoli", row)) closeModal("modal-ruolo");
}
async function deleteRuolo() {
  const id = $("ruolo-id").value;
  if (!id) return;
  // 1.3 · Rifiuta se in uso, come gia' fa deleteCategoria, e dice quanto.
  // Le assegnazioni REVOCATE contano: la cascata cancellerebbe anche la storia,
  // cioe' la prova di chi era preposto e da quando.
  const dipCoinvolti = new Set(state.dipRuoli.filter((dr) => dr.ruolo_id === id).map((dr) => dr.dipendente_id)).size;
  const regole = state.requisiti.filter((r) => r.ruolo_id === id).length;
  if (dipCoinvolti || regole) {
    const parti = [];
    if (dipCoinvolti) parti.push(`${dipCoinvolti} ${dipCoinvolti === 1 ? "dipendente lo ha" : "dipendenti lo hanno"} assegnato (anche revocato)`);
    if (regole) parti.push(`${regole} ${regole === 1 ? "regola della matrice lo usa" : "regole della matrice lo usano"}`);
    alert(`Impossibile eliminare questo ruolo: ${parti.join(" e ")}.`
      + NL + "Togli prima le assegnazioni e le regole, poi riprova.");
    return;
  }
  if (!confirm("Eliminare il ruolo? Non è assegnato a nessuno e non ha regole.")) return;
  await sbDelete("ruoli", id);
  state.requisiti = state.requisiti.filter((r) => r.ruolo_id !== id);
  state.dipRuoli = state.dipRuoli.filter((dr) => dr.ruolo_id !== id);
  closeModal("modal-ruolo");
  renderAll();
}

// ---------- Categoria ----------
function openCategoriaModal(id) {
  const c = id ? state.categorie.find((x) => x.id === id) : null;
  $("cat-title").textContent = c ? c.label : "Nuova categoria";
  $("cat-id").value = c ? c.id : "";
  $("cat-nome").value = c?.label || "";
  $("cat-icon").value = c?.icon || "";
  $("cat-ordine").value = c?.ordine ?? 100;
  $("cat-delete").hidden = !c;
  openModal("modal-categoria");
}
async function saveCategoria(e) {
  e.preventDefault();
  const id = $("cat-id").value || sanitizeName($("cat-nome").value.toLowerCase()) || ("cat-" + Date.now());
  const row = {
    id,
    label: $("cat-nome").value.trim(),
    icon: $("cat-icon").value.trim() || null,
    ordine: parseInt($("cat-ordine").value, 10) || 100,
  };
  if (await sbUpsert("categorie", row)) closeModal("modal-categoria");
}
async function deleteCategoria() {
  const id = $("cat-id").value;
  if (!id) return;
  // Controllo: ci sono tipi di requisito che usano questa categoria?
  const inUso = state.tipi.filter((t) => t.categoria === id).length;
  if (inUso > 0) {
    alert(`Impossibile eliminare: ${inUso} tipi di requisito usano ancora questa categoria. Riassegnali prima.`);
    return;
  }
  if (!confirm("Eliminare questa categoria?")) return;
  await sbDelete("categorie", id);
  closeModal("modal-categoria");
}

// ---------- Tipo requisito ----------
function openTipoModal(id) {
  const t = id ? tipoById(id) : null;
  $("tipo-title").textContent = t ? t.nome : "Nuovo tipo di requisito";
  $("tipo-id").value = t ? t.id : "";
  $("tipo-nome").value = t?.nome || "";
  const cats = categorieList();
  fillSelect($("tipo-categoria"), cats.map((c) => ({ id: c.id, nome: (c.icon ? c.icon + " " : "") + c.label })));
  $("tipo-categoria").value = t?.categoria || (cats[0]?.id || "formazione");
  $("tipo-durata").value = t?.durata_iniziale || "";
  $("tipo-norma").value = t?.riferimento_normativo || "";
  $("tipo-desc").value = t?.descrizione || "";
  $("tipo-delete").hidden = !t;
  openModal("modal-tipo");
}
async function saveTipo(e) {
  e.preventDefault();
  const id = $("tipo-id").value || uid();
  const row = {
    id,
    nome: $("tipo-nome").value.trim(),
    categoria: $("tipo-categoria").value,
    durata_iniziale: $("tipo-durata").value.trim() || null,
    riferimento_normativo: $("tipo-norma").value.trim() || null,
    descrizione: $("tipo-desc").value.trim() || null,
  };
  if (await sbUpsert("tipi_requisito", row)) closeModal("modal-tipo");
}
async function deleteTipo() {
  const id = $("tipo-id").value;
  if (!id) return;
  // 1.3 · Rifiuta se in uso. Le voci di onboarding sono contate perche' fra
  // onboarding_items e tipi_requisito NON c'e' foreign key: senza questo
  // conteggio la guardia direbbe "non in uso" e lascerebbe una voce del flusso
  // di ingresso che punta a un tipo che non esiste piu'.
  const dipCoinvolti = new Set(state.adempimenti.filter((a) => a.tipo_requisito_id === id).map((a) => a.dipendente_id)).size;
  const regole = state.requisiti.filter((r) => r.tipo_requisito_id === id).length;
  const vociOnboarding = state.onboardItems.filter((i) => i.adempimento_tipo_id === id).length;
  if (dipCoinvolti || regole || vociOnboarding) {
    const parti = [];
    if (dipCoinvolti) parti.push(`${dipCoinvolti} ${dipCoinvolti === 1 ? "dipendente ce l'ha" : "dipendenti ce l'hanno"} registrato`);
    if (regole) parti.push(`${regole} ${regole === 1 ? "regola della matrice lo usa" : "regole della matrice lo usano"}`);
    if (vociOnboarding) parti.push(`${vociOnboarding} ${vociOnboarding === 1 ? "voce di onboarding lo crea" : "voci di onboarding lo creano"}`);
    alert(`Impossibile eliminare questo tipo di requisito: ${parti.join(", ")}.`
      + NL + "Togli prima quelle righe, poi riprova.");
    return;
  }
  if (!confirm("Eliminare il tipo di requisito? Non è usato da nessuna regola né da nessun dipendente.")) return;
  await sbDelete("tipi_requisito", id);
  state.requisiti = state.requisiti.filter((r) => r.tipo_requisito_id !== id);
  closeModal("modal-tipo");
  renderAll();
}

// ---------- Regola (matrice) ----------

// 1.3 · Quali adempimenti cambierebbero scadenza se questa regola passasse a
// `nuovaValidita`. Adattatore: raccoglie lo stato e chiama ricalcolaScadenze.
// Tre filtri che decidono tutto:
//   - `corrente !== false`: un ciclo archiviato e' una prova storica. Ha una
//     data di rilascio e una scadenza coerente col vecchio calcolo, quindi
//     senza questo filtro verrebbe riscritto: si altererebbe un attestato.
//   - solo chi ha DAVVERO il ruolo di questa regola;
//   - la validita' e' quella EFFETTIVA della persona (validitaMesiForTipo tiene
//     conto degli altri suoi ruoli), non la regola da sola.
function righeDaRicalcolare(req, nuovaValidita) {
  if (!req || !req.id || !req.ruolo_id || !req.tipo_requisito_id) return [];
  const requisitiDopo = state.requisiti.map((r) => (r.id === req.id ? { ...r, validita_mesi: nuovaValidita } : r));
  const effettiva = (v) => (v === undefined || v === Infinity ? null : v);
  const righe = [];
  for (const a of state.adempimenti) {
    if (a.tipo_requisito_id !== req.tipo_requisito_id) continue;
    if (a.corrente === false) continue;
    if (!a.data_rilascio) continue;
    if (!ruoliOfDip(a.dipendente_id).some((r) => r.id === req.ruolo_id)) continue;
    const vVecchia = validitaMesiForTipo(req.tipo_requisito_id, a.dipendente_id);
    if (vVecchia === undefined) continue;
    righe.push({
      id: a.id,
      data_rilascio: a.data_rilascio,
      data_scadenza: a.data_scadenza,
      validitaVecchia: effettiva(vVecchia),
      validitaNuova: effettiva(validitaMesiForTipo(req.tipo_requisito_id, a.dipendente_id, requisitiDopo)),
    });
  }
  return ricalcolaScadenze(righe);
}

// La modale dice quante righe sarebbero toccate, mentre si scrive.
function aggiornaHintRicalcolo() {
  const box = $("req-ricalcolo-hint");
  const id = $("req-id").value;
  const prev = id ? state.requisiti.find((r) => r.id === id) : null;
  const vRaw = $("req-validita").value;
  const nuova = vRaw === "" ? null : Number(vRaw);
  if (!prev || (prev.validita_mesi ?? null) === nuova
      || prev.ruolo_id !== $("req-ruolo").value
      || prev.tipo_requisito_id !== $("req-tipo").value) {
    box.hidden = true;
    return;
  }
  const n = righeDaRicalcolare(prev, nuova).length;
  box.textContent = n
    ? `${n} ${n === 1 ? "adempimento registrato ha" : "adempimenti registrati hanno"} la scadenza calcolata con la validità vecchia: al salvataggio potrai ricalcolarla.`
    : "Nessun adempimento registrato usa questa validità: non c'è niente da ricalcolare.";
  box.hidden = false;
}

function openReqModal(id) {
  const req = id ? state.requisiti.find((r) => r.id === id) : null;
  $("req-title").textContent = req ? "Modifica regola" : "Nuova regola";
  $("req-id").value = req ? req.id : "";
  fillSelect($("req-ruolo"), state.ruoli.slice().sort((a, b) => (a.tipo + a.nome).localeCompare(b.tipo + b.nome)),
    { placeholder: "— seleziona —", label: (r) => (r.tipo === "mansione" ? "🏭 " : "📌 ") + r.nome });
  $("req-ruolo").value = req?.ruolo_id || "";
  fillSelect($("req-tipo"), state.tipi, { placeholder: "— seleziona —", label: (t) => `${CAT_BY_KEY[t.categoria]?.icon || ""} ${t.nome}` });
  $("req-tipo").value = req?.tipo_requisito_id || "";
  $("req-obblig").checked = req ? !!req.obbligatorio : true;
  $("req-validita").value = req?.validita_mesi ?? "";
  $("req-note").value = req?.note || "";
  $("req-delete").hidden = !req;
  $("req-ricalcolo-hint").hidden = true;
  openModal("modal-requisito");
}
async function saveReq(e) {
  e.preventDefault();
  const id = $("req-id").value || uid();
  const vRaw = $("req-validita").value;
  const row = {
    id,
    ruolo_id: $("req-ruolo").value,
    tipo_requisito_id: $("req-tipo").value,
    obbligatorio: $("req-obblig").checked,
    validita_mesi: vRaw === "" ? null : Number(vRaw),
    note: $("req-note").value.trim() || null,
  };
  if (!row.ruolo_id || !row.tipo_requisito_id) { alert("Seleziona ruolo e tipo di requisito."); return; }

  // 1.3 · Le righe da ricalcolare si calcolano PRIMA di salvare, quando lo stato
  // ha ancora la validita' vecchia. Solo se e' cambiata la validita' e nient'altro.
  const prev = $("req-id").value ? state.requisiti.find((r) => r.id === id) : null;
  const cambiaSoloValidita = prev
    && prev.ruolo_id === row.ruolo_id
    && prev.tipo_requisito_id === row.tipo_requisito_id
    && (prev.validita_mesi ?? null) !== (row.validita_mesi ?? null);
  const daRicalcolare = cambiaSoloValidita ? righeDaRicalcolare(prev, row.validita_mesi) : [];

  if (!await sbUpsert("requisiti_ruolo", row)) return;

  if (daRicalcolare.length) {
    const n = daRicalcolare.length;
    const ok = confirm(`Regola salvata. ${n} ${n === 1 ? "adempimento registrato ha" : "adempimenti registrati hanno"} ancora la scadenza calcolata con la validità vecchia.`
      + NL + NL + "Ricalcolarla adesso? Le date corrette a mano e i cicli archiviati non vengono toccati.");
    if (ok) {
      for (const u of daRicalcolare) {
        const a = state.adempimenti.find((x) => x.id === u.id);
        if (a) await sbUpsert("adempimenti", { ...a, data_scadenza: u.data_scadenza });
      }
    }
  }
  closeModal("modal-requisito");
}
async function deleteReq() {
  const id = $("req-id").value;
  if (!id) return;
  if (!confirm("Eliminare questa regola?")) return;
  await sbDelete("requisiti_ruolo", id);
  closeModal("modal-requisito");
}

// ============================================================
// EXPORT EXCEL (vista compliance corrente)
// ============================================================
function exportExcel() {
  if (!window.XLSX) { alert("Libreria Excel non caricata."); return; }
  const rows = allGapRows().map((g) => {
    const ruoli = ruoliOfDip(g.dip.id);
    const man = ruoli.find((r) => r.tipo === "mansione");
    const inc = ruoli.filter((r) => r.tipo === "incarico").map((r) => r.nome).join(", ");
    return {
      Cognome: g.dip.cognome,
      Nome: g.dip.nome,
      Mansione: man?.nome || "",
      Incarichi: inc,
      Requisito: g.tipo.nome,
      Categoria: CAT_BY_KEY[g.tipo.categoria]?.label || g.tipo.categoria,
      Scadenza: g.scadenza ? fmtDate(g.scadenza) : "",
      Stato: STATO_INFO[g.stato].label,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compliance");
  XLSX.writeFile(wb, `HR-compliance-${localISO(new Date())}.xlsx`);
}

// ============================================================
// EXPORT BACKUP ZIP — tutti i PDF di un dipendente in struttura per cartelle
// ============================================================
async function exportBackupZip(dipId) {
  if (!window.JSZip) { alert("Libreria ZIP non caricata."); return; }
  const dip = dipById(dipId);
  if (!dip) return;
  const docs = state.adempimenti.filter((a) => a.dipendente_id === dipId && a.documento_path);
  if (!docs.length) { alert("Questo dipendente non ha PDF caricati nell'app."); return; }

  const btn = $("dip-backup-zip");
  const origLabel = btn?.textContent;
  if (btn) { btn.textContent = "⏳ Preparazione ZIP…"; btn.disabled = true; }

  try {
    const zip = new JSZip();
    const folderName = `${sanitizeName(dip.cognome) || "Cognome"}_${sanitizeName(dip.nome) || "Nome"}`;
    const folder = zip.folder(folderName);
    let ok = 0;
    for (const a of docs) {
      try {
        const tipo = tipoById(a.tipo_requisito_id);
        const url = await getSignedDocUrl(a.documento_path);
        if (!url) continue;
        const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
        folder.file(downloadName(dip, tipo, a), blob);
        ok++;
      } catch (err) {
        console.warn("Skip doc", a.id, err);
      }
    }
    if (!ok) { alert("Impossibile scaricare i documenti."); return; }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName}_backup_${localISO(new Date())}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    if (btn) { btn.textContent = origLabel; btn.disabled = false; }
  }
}

// ============================================================
// BACKUP COMPLETI — dati (0.2) e documenti (0.6)
// Due bottoni nel piede della barra laterale. Entrambi sono di SOLA LETTURA:
// non scrivono nel database e non toccano il bucket. Sono l'unica copia che
// esiste dei dati e dei file: il piano gratuito di Supabase non fa backup, e i
// file del bucket non rientrerebbero comunque nei backup del piano a pagamento.
// ============================================================

// Scarica un blob con un nome di file, senza lasciare appeso l'URL temporaneo.
function scaricaBlob(blob, nomeFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Disabilita un bottone e ne cambia l'etichetta finche' il lavoro non finisce.
// `ripristina` va chiamata in un finally: un bottone che resta disabilitato dopo
// un errore sembra un'app rotta.
function bottoneOccupato(btnId, testoIniziale) {
  const btn = $(btnId);
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.textContent = testoIniziale; btn.disabled = true; }
  return {
    aggiorna: (t) => { if (btn) btn.textContent = t; },
    ripristina: () => { if (btn) { btn.textContent = orig; btn.disabled = false; } },
  };
}

// Per il foglio Excel: jsonb e array diventano testo, altrimenti la cella
// direbbe "[object Object]" (e' il caso di `adempimenti.history`).
// Nei file JSON i valori restano quelli veri: l'Excel e' per leggere, il JSON
// e' per ricostruire.
function appiattisciPerExcel(righe) {
  return righe.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
    }
    return out;
  });
}

// Legge una tabella INTERA, a pagine. Senza `range` PostgREST si ferma al
// `max-rows` del progetto (1000 di default su Supabase) e restituisce le prime
// N righe SENZA errore: il backup sembrerebbe completo e non lo sarebbe.
// Si esce solo su una pagina vuota, non su una pagina corta: cosi' il ciclo e'
// corretto qualunque sia il max-rows configurato, anche piu' piccolo di PAGINA.
// L'ordinamento e' obbligatorio: senza, due pagine possono ripetere o saltare righe.
const PAGINA_BACKUP = 1000;
async function leggiTabellaIntera(tabella) {
  const chiave = chiaveDi(tabella);
  const righe = [];
  for (let da = 0; ; ) {
    const { data, error } = await sb.from(tabella).select("*")
      .order(chiave, { ascending: true })
      .range(da, da + PAGINA_BACKUP - 1);
    if (error) return { error };
    const pagina = data || [];
    if (!pagina.length) break;
    righe.push(...pagina);
    da += pagina.length;
  }
  return { righe };
}

// ---------- 0.2 · Backup dei dati ----------
async function backupDati() {
  if (!window.XLSX || !window.JSZip) { alert("Librerie Excel/ZIP non caricate. Ricarica la pagina."); return; }
  const btn = bottoneOccupato("btn-backup-dati", "⏳ Backup dati…");
  try {
    // Si legge dal DATABASE, non da `state`: lo stato in memoria e' allineato dal
    // realtime, ma un backup deve essere la fotografia del database, non della
    // scheda aperta.
    const dati = {};
    for (const t of TABELLE_BACKUP) {
      btn.aggiorna(`⏳ ${t}…`);
      const { righe, error } = await leggiTabellaIntera(t);
      if (error) {
        // Ci si ferma: un backup con un buco e' peggio di un backup assente,
        // perche' sembra un backup.
        if (isAuthError(error)) showLogin("Sessione scaduta. Rientra.");
        else alert(`Backup interrotto: non riesco a leggere la tabella "${t}".\n${error.message}\n\nNessun file e' stato scaricato.`);
        return;
      }
      dati[t] = righe;
    }

    btn.aggiorna("⏳ Creazione file…");
    const zip = new JSZip();
    const wb = XLSX.utils.book_new();
    for (const t of TABELLE_BACKUP) {
      // Nome del foglio = nome della tabella (il piu' lungo e'
      // "onboarding_progressi", 20 caratteri: sotto il limite di 31 di Excel).
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appiattisciPerExcel(dati[t])), t);
      zip.file(`json/${t}.json`, JSON.stringify(dati[t], null, 2));
    }
    zip.file("dati.xlsx", XLSX.write(wb, { type: "array", bookType: "xlsx" }));

    const blob = await zip.generateAsync({ type: "blob" });
    scaricaBlob(blob, `HR-backup-dati-${localISO(new Date())}.zip`);
  } catch (err) {
    alert("Backup dei dati non riuscito: " + (err?.message || err));
  } finally {
    btn.ripristina();
  }
}

// ---------- 1.3 · Scarica configurazione ----------
// Le regole di compliance vivono SOLO nel database e si cambiano dall'app: una
// modifica sbagliata in Configurazione non ha un "annulla". Questo bottone e' la
// fotografia da fare prima. Solo il catalogo: nessun dato personale (per quelli
// c'e' il Backup dati).
const TABELLE_CONFIGURAZIONE = [
  ["categorie", "categorie"],
  ["ruoli", "ruoli"],
  ["tipi_requisito", "tipi"],
  ["requisiti_ruolo", "requisiti"],
  ["onboarding_items", "onboardItems"],
  ["documenti_template", "modelli"],
  ["dpi_tipi", "dpiTipi"],
];

function scaricaConfigurazione() {
  const contenuto = { esportato_il: new Date().toISOString(), tabelle: {} };
  for (const [tabella, store] of TABELLE_CONFIGURAZIONE) contenuto.tabelle[tabella] = state[store] || [];
  const blob = new Blob([JSON.stringify(contenuto, null, 2)], { type: "application/json" });
  scaricaBlob(blob, `configurazione-${localISO(new Date())}.json`);
}

// ---------- 0.6 · Backup dei documenti ----------

const BACKUP_DOC_AVVISO_BYTE = 200 * 1024 * 1024;   // oltre 200 MB il browser puo' non farcela

// Elenca ricorsivamente i file del bucket. `list` NON e' ricorsiva e pagina a
// 1000: si itera l'offset finche' la pagina e' piena, e le voci con id === null
// sono cartelle da visitare (una per adempimento, piu' portal/{prefisso}/).
async function elencaFileBucket(prefisso = "", profondita = 0) {
  // Guardia contro una ricorsione senza fine. Si ferma con un errore invece di
  // saltare i file in silenzio: un backup che tace su quello che non ha preso e'
  // esattamente il contrario di quello che serve. Oggi la profondita' massima
  // nel bucket e' 3 (portal/{prefisso}/{file}).
  if (profondita > 5) throw new Error(`Archivio troppo profondo sotto "${prefisso}": interrotto per non saltare file in silenzio.`);
  const PAG = 1000;
  const trovati = [];
  for (let offset = 0; ; offset += PAG) {
    const { data, error } = await sb.storage.from(STORAGE_BUCKET)
      .list(prefisso, { limit: PAG, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const pagina = data || [];
    for (const voce of pagina) {
      // Segnaposto che Supabase crea per tenere in piedi una cartella vuota.
      if (voce.name === ".emptyFolderPlaceholder") continue;
      const path = prefisso ? `${prefisso}/${voce.name}` : voce.name;
      if (voce.id === null) trovati.push(...await elencaFileBucket(path, profondita + 1));
      else trovati.push({ path, byte: voce.metadata?.size ?? 0 });
    }
    if (pagina.length < PAG) break;
  }
  return trovati;
}

// A chi e a cosa appartiene ciascun file. Legge `state` piu' la mappa
// prefisso -> dipendente ricavata dagli inviti. Un file che non compare in
// nessuna riga resta nell'elenco come "non collegato": e' proprio quello che non
// ha nessun'altra copia, ometterlo lo renderebbe invisibile.
function collegaDocumentiAiDati(prefissoDip) {
  const perPath = new Map();
  const segna = (path, dip, tipoDoc, descr, data, stato) => {
    if (!path || perPath.has(path)) return;
    perPath.set(path, { dip: dip || null, tipoDoc, descr: descr || "", data: data || "", stato });
  };

  for (const a of state.adempimenti) {
    const dip = dipById(a.dipendente_id);
    const nomeTipo = tipoById(a.tipo_requisito_id)?.nome || a.tipo_requisito_id || "";
    segna(a.documento_path, dip, "Adempimento", nomeTipo, a.data_rilascio,
      a.corrente === false ? "archiviato" : "corrente");
    if (Array.isArray(a.history)) {
      for (const h of a.history) {
        // `h.rilascio` e' la chiave delle voci history in formato vecchio: lo
        // Storico le accetta gia' cosi', l'indice deve leggerle allo stesso modo.
        segna(h.documentoPath, dip, "Adempimento (archiviato)", nomeTipo, h.doneAt || h.rilascio, "archiviato");
      }
    }
  }
  for (const dr of state.dipRuoli) {
    // 1.5 · Gli atti di nomina sono documenti come gli altri: senza questa riga
    // uscirebbero dal backup come "non collegato", cioe' file senza padrone.
    segna(dr.documento_path, dipById(dr.dipendente_id), "Nomina",
      ruoloById(dr.ruolo_id)?.nome || dr.ruolo_id || "", dr.dal,
      assegnazioneAttiva(dr) ? "corrente" : "revocata");
  }
  for (const p of state.provvedimenti) {
    const et = (window.TIPI_PROVVEDIMENTO || []).find((t) => t.key === p.tipo)?.label || p.tipo || "";
    segna(p.documento_path, dipById(p.dipendente_id), "Provvedimento", et, p.data, "corrente");
  }
  for (const pr of state.onboardProgressi) {
    const et = state.onboardItems.find((i) => i.id === pr.item_id)?.label || pr.item_id || "";
    segna(pr.documento_path, dipById(pr.dipendente_id), "Onboarding", et, pr.fatto_il, "corrente");
  }
  for (const c of state.dpiConsegne) {
    const et = state.dpiTipi.find((t) => t.id === c.dpi_tipo_id)?.nome || c.dpi_tipo_id || "";
    segna(c.modulo_path, dipById(c.dipendente_id), "Consegna DPI", et, c.data_consegna, "corrente");
  }
  // 3.2 · I cedolini sono documenti come gli altri: senza questa riga l'indice
  // del backup li darebbe per "non collegati", cioe' file senza padrone.
  for (const c of state.cedolini) {
    segna(c.path, dipById(c.dipendente_id), "Cedolino", etichettaPeriodoCedolino(c),
      (c.caricato_il || "").slice(0, 10), "corrente");
  }
  // 3.3 · Gli scambi con il consulente non sono di NESSUNA persona: la colonna
  // Dipendente resta vuota di proposito. Senza questo ciclo finirebbero
  // nell'indice come "non collegati", cioe' file senza padrone.
  for (const s of state.scambiConsulente) {
    segna(s.path, null, "Scambio consulente",
      `${tipoScambio(s.tipo).label} ${etichettaPeriodoScambio(s.mese, s.anno)}`, s.data, "corrente");
  }
  // 4.1 · Le schede infortunio e i certificati allegati agli eventi. Senza
  // questo ciclo l'indice del backup li darebbe per "non collegati".
  for (const ev of state.eventi) {
    segna(ev.documento_path, dipById(ev.dipendente_id), "Evento",
      `${tipoEvento(ev.tipo).label} del ${fmtDate(ev.dal)}`, ev.dal, "corrente");
  }

  // Fallback per i file del portale: portal/{prefisso}/... . Serve ai documenti
  // caricati dal dipendente e non ancora validati dall'HR, che non sono
  // referenziati da nessuna riga.
  return (path) => {
    const noto = perPath.get(path);
    if (noto) return noto;
    const m = /^portal\/([^/]+)\//.exec(path);
    const dip = m ? prefissoDip.get(m[1]) : null;
    return { dip: dip || null, tipoDoc: "Caricato dal portale", descr: "", data: "", stato: "non collegato" };
  };
}

async function backupDocumenti() {
  if (!window.XLSX || !window.JSZip) { alert("Librerie Excel/ZIP non caricate. Ricarica la pagina."); return; }
  const btn = bottoneOccupato("btn-backup-documenti", "⏳ Lettura archivio…");
  try {
    const file = await elencaFileBucket();
    if (!file.length) { alert("Nell'archivio dei documenti non c'e' ancora nessun file."); return; }

    const totale = file.reduce((s, f) => s + f.byte, 0);
    if (totale > BACKUP_DOC_AVVISO_BYTE) {
      const mb = Math.round(totale / 1024 / 1024);
      if (!confirm(`I documenti pesano circa ${mb} MB.\nUno ZIP cosi' grande potrebbe non farcela nel browser.\n\nProvo lo stesso?`)) return;
    }

    // Il prefisso dell'invito e' l'unico legame fra un file del portale e la
    // persona: `invite_tokens` non sta in `state`, si legge qui.
    const prefissoDip = new Map();
    const { righe: inviti, error: errInviti } = await leggiTabellaIntera("invite_tokens");
    if (errInviti) {
      // Non si interrompe il backup — i file si scaricano lo stesso — ma senza
      // avviso l'HR leggerebbe un indice con tutti i file del portale "senza
      // proprietario" e lo crederebbe la verita'.
      if (isAuthError(errInviti)) { showLogin("Sessione scaduta. Rientra."); return; }
      alert(`Non riesco a leggere gli inviti del portale: ${errInviti.message}\n\nIl backup prosegue, ma nell'indice i file caricati dai dipendenti resteranno senza nome.`);
    }
    for (const i of inviti || []) {
      if (i.upload_prefix) prefissoDip.set(i.upload_prefix, dipById(i.dipendente_id));
    }
    const trova = collegaDocumentiAiDati(prefissoDip);

    const zip = new JSZip();
    const righeIndice = [];
    let falliti = 0;
    for (let i = 0; i < file.length; i++) {
      const f = file[i];
      btn.aggiorna(`⏳ ${i + 1}/${file.length}…`);
      const info = trova(f.path);
      let scaricato = false;
      try {
        const url = await getSignedDocUrl(f.path);
        if (!url) throw new Error("nessun link firmato");
        const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); });
        // I file conservano il percorso che hanno nel bucket.
        zip.file(f.path, blob);
        scaricato = true;
      } catch (err) {
        console.warn("Documento non scaricato:", f.path, err);
        falliti++;
      }
      righeIndice.push({
        Percorso: f.path,
        Dipendente: info.dip ? `${info.dip.cognome || ""} ${info.dip.nome || ""}`.trim() : "",
        Matricola: info.dip?.matricola || "",
        "Tipo documento": info.tipoDoc,
        Descrizione: info.descr,
        Data: info.data ? fmtDate(info.data) : "",
        Byte: f.byte,
        Stato: info.stato,
        Scaricato: scaricato ? "Si" : "No",
      });
    }

    // L'indice si genera SEMPRE, anche per i file non scaricati: dice cosa manca.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(righeIndice), "Indice");
    zip.file("indice.xlsx", XLSX.write(wb, { type: "array", bookType: "xlsx" }));

    btn.aggiorna("⏳ Creazione ZIP…");
    const blob = await zip.generateAsync({ type: "blob" });
    scaricaBlob(blob, `HR-backup-documenti-${localISO(new Date())}.zip`);
    if (falliti) {
      alert(`${falliti} documenti su ${file.length} non sono stati scaricati.\nNello ZIP c'e' comunque indice.xlsx, che li elenca con "Scaricato = No".`);
    }
  } catch (err) {
    alert("Backup dei documenti non riuscito: " + (err?.message || err));
  } finally {
    btn.ripristina();
  }
}

// ============================================================
// NAVIGAZIONE / FILTRI / EVENTI
// ============================================================
function setView(v) {
  state.view = v;
  els(".module-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("view-compliance").hidden = v !== "compliance";
  $("view-cariche").hidden = v !== "cariche";
  $("view-dipendenti").hidden = v !== "dipendenti";
  $("view-storico").hidden = v !== "storico";
  $("view-consulente").hidden = v !== "consulente";
  $("view-config").hidden = v !== "config";
  // Topbar contestuale: toggle Lista/Calendario solo nel tab Scadenze (ex-Compliance).
  $("comp-view-toggle").hidden = v !== "compliance";
  const addBtn = $("btn-add");
  if (v === "dipendenti") { addBtn.hidden = false; addBtn.textContent = "+ Nuovo dipendente"; }
  else { addBtn.hidden = true; }
  // La ricerca non ha niente da cercare in Configurazione ne' nella griglia del
  // consulente: un campo che non fa niente e' peggio di un campo assente.
  $("search-wrap").style.display = (v === "config" || v === "consulente") ? "none" : "";
  closeDrawer();
  renderAll();
}

function populateFilters() {
  const f = state.compFilter;
  // Dipendenti (attivi prima, poi cessati, ordinati per cognome).
  const dips = state.dipendenti.slice().sort((a, b) => {
    if ((a.attivo === false) !== (b.attivo === false)) return a.attivo === false ? 1 : -1;
    return (a.cognome || "").localeCompare(b.cognome || "");
  });
  fillSelect($("filter-dipendente"), dips, {
    placeholder: "Tutti i dipendenti",
    label: (d) => `${d.cognome} ${d.nome}${d.attivo === false ? " (cessato)" : ""}`,
  });
  fillSelect($("filter-mansione"), mansioniList(), { placeholder: "Tutte le mansioni" });
  fillSelect($("filter-incarico"), incarichiList(), { placeholder: "Tutti gli incarichi" });
  $("filter-dipendente").value = f.dipendente;
  $("filter-mansione").value = f.mansione;
  $("filter-incarico").value = f.incarico;
}

function clearFilters() {
  state.search = "";
  $("search").value = "";
  state.compFilter = { dipendente: "", mansione: "", incarico: "", stato: "" };
  state.compView = "list";
  populateFilters();
  $("btn-clear-filters").hidden = true;
  renderAll();
}

function toggleDrawer() { $("sidebar").classList.toggle("open"); $("drawer-backdrop").classList.toggle("open"); }
function closeDrawer() { $("sidebar").classList.remove("open"); $("drawer-backdrop").classList.remove("open"); }

function wireEvents() {
  $("login-form").addEventListener("submit", handleLoginSubmit);
  $("btn-logout").addEventListener("click", handleLogout);
  $("hamburger").addEventListener("click", toggleDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);

  els(".module-btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  let searchTimer = null;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      $("btn-clear-filters").hidden = !state.search && !hasActiveFilters();
      renderAll();
    }, 200);
  });
  $("btn-clear-filters").addEventListener("click", clearFilters);
  $("btn-export").addEventListener("click", exportExcel);
  $("btn-backup-dati").addEventListener("click", backupDati);
  $("btn-backup-documenti").addEventListener("click", backupDocumenti);
  $("btn-scarica-config").addEventListener("click", scaricaConfigurazione);
  $("btn-elimina-dati-prova").addEventListener("click", eliminaDatiDiProva);
  // 3.2 · Cedolini.
  $("btn-cedolini-mese").addEventListener("click", openCedoliniModal);
  $("btn-rinnova-link-cedolini").addEventListener("click", rinnovaLinkCedolini);
  $("ced-form").addEventListener("submit", caricaCedoliniDelMese);
  $("ced-close").addEventListener("click", () => closeModal("modal-cedolini"));
  $("ced-cancel").addEventListener("click", () => closeModal("modal-cedolini"));
  // Cambiare periodo azzera i file gia' scelti: un file scelto per luglio che
  // restasse selezionato passando ad agosto verrebbe caricato come cedolino di
  // agosto, e nessuno se ne accorgerebbe.
  const cambiaPeriodo = () => { cedoliniPendenti = new Map(); $("ced-multi-hint").textContent = ""; renderRigheCedolini(); };
  $("ced-anno").addEventListener("change", cambiaPeriodo);
  $("ced-mese").addEventListener("change", cambiaPeriodo);
  $("ced-tipo").addEventListener("change", () => { aggiornaMeseCedolini(); cambiaPeriodo(); });
  $("ced-multi-file").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) abbinaFileScelti(files);
  });
  $("dip-cedolini-toggle").addEventListener("click", () => toggleSection("dip-cedolini-toggle", "dip-cedolini-list"));

  // 3.3 · Scambi con il consulente.
  $("consulente-anno").addEventListener("change", (e) => {
    state.scambiAnno = Number(e.target.value);
    renderConsulente();
  });
  $("scambio-form").addEventListener("submit", saveScambio);
  $("scambio-close").addEventListener("click", () => closeModal("modal-scambio"));
  $("scambio-cancel").addEventListener("click", () => closeModal("modal-scambio"));
  $("scambio-delete").addEventListener("click", deleteScambio);
  $("scambio-doc-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0] || null;
    pendingScambioFile = file;
    $("scambio-doc-upload-label").textContent = file ? `📄 ${file.name} (salva per caricare)` : "Carica un file";
  });
  $("scambio-doc-open").addEventListener("click", async () => {
    const r = state.scambiConsulente.find((x) => x.id === $("scambio-id").value);
    await openSignedDoc(r?.path);
  });

  $("btn-add").addEventListener("click", () => {
    if (state.view === "dipendenti") openDipModal(null);
  });

  // Compliance filtri + KPI.
  $("filter-dipendente").addEventListener("change", (e) => { state.compFilter.dipendente = e.target.value; updateClearBtn(); renderAll(); });
  $("filter-mansione").addEventListener("change", (e) => { state.compFilter.mansione = e.target.value; updateClearBtn(); renderAll(); });
  $("filter-incarico").addEventListener("change", (e) => { state.compFilter.incarico = e.target.value; updateClearBtn(); renderAll(); });
  els('#view-compliance .kpi').forEach((k) => k.addEventListener("click", () => {
    const s = k.dataset.cstatus;
    state.compFilter.stato = (s === "all") ? "" : (state.compFilter.stato === s ? "" : s);
    updateClearBtn(); renderCompliance();
  }));

  // Toggle Lista / Calendario dentro il tab Scadenze (ex-Compliance).
  els("#comp-view-toggle .vt-btn").forEach((b) => b.addEventListener("click", () => {
    state.compView = b.dataset.compview;
    els("#comp-view-toggle .vt-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderCompliance();
  }));
  $("cal-prev").addEventListener("click", () => { state.calRef = new Date(state.calRef.getFullYear(), state.calRef.getMonth() - 1, 1); renderCompliance(); });
  $("cal-next").addEventListener("click", () => { state.calRef = new Date(state.calRef.getFullYear(), state.calRef.getMonth() + 1, 1); renderCompliance(); });
  $("cal-today").addEventListener("click", () => { state.calRef = new Date(); renderCompliance(); });

  // Storico filtri + export.
  ["filter-st-dipendente", "filter-st-tipo", "filter-st-categoria", "filter-st-anno", "filter-st-mese"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      const key = id.replace("filter-st-", "");
      state.storicoFilter[key] = e.target.value;
      renderStorico();
    });
  });
  $("storico-excel").addEventListener("click", exportStoricoExcel);

  // Config tabs.
  els(".ct-btn").forEach((b) => b.addEventListener("click", () => { state.configTab = b.dataset.ctab; renderConfig(); }));
  $("add-ruolo").addEventListener("click", () => openRuoloModal(null));
  $("add-categoria").addEventListener("click", () => openCategoriaModal(null));
  $("add-tipo").addEventListener("click", () => openTipoModal(null));
  $("add-requisito").addEventListener("click", () => openReqModal(null));

  // Modale parametro (3.1).
  $("param-form").addEventListener("submit", saveParametro);
  $("param-close").addEventListener("click", () => closeModal("modal-parametro"));
  $("param-cancel").addEventListener("click", () => closeModal("modal-parametro"));

  // Modale categoria.
  $("cat-form").addEventListener("submit", saveCategoria);
  $("cat-close").addEventListener("click", () => closeModal("modal-categoria"));
  $("cat-cancel").addEventListener("click", () => closeModal("modal-categoria"));
  $("cat-delete").addEventListener("click", deleteCategoria);

  // Modale dipendente.
  $("dip-form").addEventListener("submit", saveDip);
  // 2.3 · Le linguette.
  els("#modal-dip .dt-btn").forEach((b) => b.addEventListener("click", () => mostraLinguetta(b.dataset.dtab)));
  // 2.3 · Un campo `required` dentro un contenitore nascosto blocca l'invio del
  // form E il browser non riesce nemmeno a metterci il fuoco: il bottone Salva
  // smetterebbe di funzionare senza dire niente (stessa trappola gia' pagata in
  // openOnboardModal). Qui la linguetta del campo non valido si apre PRIMA che
  // il browser provi a dargli il fuoco. L'evento `invalid` non fa bubbling:
  // senza `true` (cattura) al form non arriverebbe mai.
  // Conta SOLO il primo campo non valido: gli `invalid` di una stessa
  // validazione arrivano tutti in fila, in ordine di documento, e il browser
  // mette a fuoco il PRIMO. Ubbidendo all'ultimo, un dipendente nuovo con nome,
  // cognome e mansione vuoti aprirebbe la linguetta Sicurezza mentre il browser
  // cerca "dip-nome" nell'Anagrafica ormai nascosta: nessun messaggio, nessun
  // campo evidenziato, e il Salva che sembra non funzionare.
  let linguettaGiaScelta = false;
  $("dip-form").addEventListener("invalid", (ev) => {
    if (linguettaGiaScelta) return;
    linguettaGiaScelta = true;
    setTimeout(() => { linguettaGiaScelta = false; }, 0);   // fine di questa validazione
    const panel = ev.target.closest(".dip-tab-panel");
    if (panel && panel.dataset.dtab !== state.dipTab) mostraLinguetta(panel.dataset.dtab);
  }, true);
  // 1.5 · Cambiare mansione apre una riga nuova: la sua data di ingresso e' oggi,
  // a meno che quella mansione fosse gia' attiva (allora si riprende la sua data).
  // Non si tocca mai il campo senza che l'utente abbia cambiato la tendina: e'
  // cosi' che si evita di stampare una data falsa su un'assegnazione vecchia.
  $("dip-mansione").addEventListener("change", (e) => {
    const dipId = $("dip-id").value;
    const gia = dipId ? assegnazioniOfDip(dipId).find((a) => a.ruolo_id === e.target.value) : null;
    $("dip-mansione-dal").value = gia ? (gia.dal || "") : (e.target.value ? localISO(new Date()) : "");
  });
  $("dip-close").addEventListener("click", () => closeModal("modal-dip"));
  $("dip-cancel").addEventListener("click", () => closeModal("modal-dip"));
  $("dip-delete").addEventListener("click", deleteDip);
  $("dip-add-adempimento").addEventListener("change", async (e) => {
    const tipoId = e.target.value;
    const dipId = $("dip-id").value;
    if (!tipoId || !dipId) return;
    // Crea un adempimento MANCANTE per quel tipo (data_rilascio/scadenza null).
    // Poi l'utente lo registrerà cliccandolo (apre la modale e ✓ Fatto).
    await sbUpsert("adempimenti", {
      id: uid(),
      dipendente_id: dipId,
      tipo_requisito_id: tipoId,
      corrente: true,
      data_rilascio: null,
      data_scadenza: null,
      documento_url: null,
      documento_path: null,
      done: false,
      history: [],
      note: null,
    });
    e.target.value = "";
    renderDipAdempimenti(dipId);
  });
  $("dip-backup-zip").addEventListener("click", () => { const id = $("dip-id").value; if (id) exportBackupZip(id); });
  $("dip-invite").addEventListener("click", inviaInvitoSelfService);
  $("invite-close").addEventListener("click", () => closeModal("modal-invite"));
  $("invite-done").addEventListener("click", () => closeModal("modal-invite"));
  $("invite-copy").addEventListener("click", copyInviteLink);
  // 3.1 · "Rigenera link" chiama LA STESSA funzione del bottone della scheda:
  // create_invite_token cancella gia' il token precedente, quindi "genera" e
  // "rigenera" sono la stessa azione. Il bottone qui evita di dover chiudere e
  // riaprire la scheda per rifarlo.
  $("invite-rigenera").addEventListener("click", inviaInvitoSelfService);
  $("invite-link").addEventListener("focus", (e) => e.target.select());
  $("dip-history-toggle").addEventListener("click", () => toggleSection("dip-history-toggle", "dip-history-list"));
  $("dip-modifiche-toggle").addEventListener("click", () => toggleSection("dip-modifiche-toggle", "dip-modifiche-list"));
  // Onboarding (scheda dipendente)
  $("dip-onboard-toggle").addEventListener("click", () => toggleSection("dip-onboard-toggle", "dip-onboard-list"));
  $("dip-uscita-toggle").addEventListener("click", () => toggleSection("dip-uscita-toggle", "dip-uscita-list"));
  $("onboard-form").addEventListener("submit", saveOnboardProgresso);
  $("onboard-close").addEventListener("click", () => closeModal("modal-onboard"));
  $("onboard-cancel").addEventListener("click", () => closeModal("modal-onboard"));
  $("onboard-doc-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0] || null;
    pendingOnboardFile = file;
    $("onboard-doc-upload-label").textContent = file ? `📄 ${file.name} (salva per caricare)` : "Carica un file";
  });
  $("onboard-fatto").addEventListener("change", (e) => {
    if (e.target.checked && !$("onboard-fatto-il").value) $("onboard-fatto-il").value = localISO(new Date());
  });
  $("onboard-genera-btn").addEventListener("click", () => {
    const dipId = $("onboard-dip-id").value;
    const tplId = $("onboard-tpl-id").value;
    if (!tplId) { alert("Scegli prima un modello dalla tendina."); return; }
    const dip = dipById(dipId);
    const tpl = state.modelli.find((m) => m.id === tplId);
    if (!dip || !tpl) return;
    const html = applicaTemplate(tpl.contenuto, dip);
    apriDocumentoStampabile(`${tpl.nome} — ${dip.cognome} ${dip.nome}`, html);
  });
  $("onboard-doc-open").addEventListener("click", async () => {
    const progrId = $("onboard-progr-id").value;
    const p = state.onboardProgressi.find((x) => x.id === progrId);
    await openSignedDoc(p?.documento_path);
  });

  // Modelli documento (Configurazione)
  $("add-modello").addEventListener("click", () => openModelloModal(null));
  $("modello-form").addEventListener("submit", saveModello);
  $("modello-close").addEventListener("click", () => closeModal("modal-modello"));
  $("modello-cancel").addEventListener("click", () => closeModal("modal-modello"));
  $("modello-delete").addEventListener("click", deleteModello);
  $("modello-preview").addEventListener("click", previewModello);

  // Onboarding template (Configurazione)
  $("add-onboard-item").addEventListener("click", () => openOnboardItemModal(null));
  $("onbi-form").addEventListener("submit", saveOnboardItem);
  $("onbi-workflow").addEventListener("change", aggiornaCampiWorkflowOnboarding);
  $("onbi-fase").addEventListener("change", aggiornaEtichettaGiorniOnboarding);
  $("onbi-close").addEventListener("click", () => closeModal("modal-onboard-item"));
  $("onbi-cancel").addEventListener("click", () => closeModal("modal-onboard-item"));
  $("onbi-delete").addEventListener("click", deleteOnboardItem);

  // DPI (scheda dipendente)
  $("dip-dpi-toggle").addEventListener("click", () => toggleSection("dip-dpi-toggle", "dip-dpi-list"));
  $("dip-dpi-add").addEventListener("click", (e) => {
    e.stopPropagation();
    const id = $("dip-id").value;
    if (id) openDpiModal(id, null);
  });
  $("dpi-form").addEventListener("submit", saveDpiConsegna);
  $("dpi-close").addEventListener("click", () => closeModal("modal-dpi"));
  $("dpi-cancel").addEventListener("click", () => closeModal("modal-dpi"));
  $("dpi-delete").addEventListener("click", deleteDpiConsegna);
  $("dpi-tipo").addEventListener("change", () => {
    aggiornaTaglieDpi();
    // Suggerisci la taglia preferita del dipendente per quel tipo.
    const dipId = $("dpi-dip-id").value;
    const dip = dipById(dipId);
    const suggerita = tagliaSuggeritaDip(dip, $("dpi-tipo").value);
    if (suggerita) $("dpi-taglia").value = suggerita;
  });
  $("dpi-doc-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0] || null;
    pendingDpiFile = file;
    $("dpi-doc-upload-label").textContent = file ? `📄 ${file.name} (salva per caricare)` : "Carica un file";
  });
  $("dpi-doc-open").addEventListener("click", async () => {
    const id = $("dpi-id").value;
    const c = state.dpiConsegne.find((x) => x.id === id);
    await openSignedDoc(c?.modulo_path);
  });

  // Provvedimenti
  $("dip-provv-toggle").addEventListener("click", () => toggleSection("dip-provv-toggle", "dip-provv-list"));
  $("dip-provv-add").addEventListener("click", (e) => {
    e.stopPropagation();
    const id = $("dip-id").value;
    if (id) openProvvModal(id, null);
  });
  $("provv-form").addEventListener("submit", saveProvvedimento);
  $("provv-close").addEventListener("click", () => closeModal("modal-provv"));
  $("provv-cancel").addEventListener("click", () => closeModal("modal-provv"));
  $("provv-delete").addEventListener("click", deleteProvvedimento);
  $("provv-doc-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0] || null;
    pendingProvvFile = file;
    $("provv-doc-upload-label").textContent = file ? `📄 ${file.name} (salva per caricare)` : "Carica un file";
  });
  $("provv-doc-open").addEventListener("click", async () => {
    const id = $("provv-id").value;
    const p = state.provvedimenti.find((x) => x.id === id);
    await openSignedDoc(p?.documento_path);
  });
  // Toggle delle sezioni collassabili anagrafica estesa.
  els(".dip-section-toggle").forEach((btn) => btn.addEventListener("click", () => {
    const body = btn.nextElementSibling;
    const arrow = el(".history-arrow", btn);
    const willShow = body.hidden;
    body.hidden = !willShow;
    if (arrow) arrow.classList.toggle("expanded", willShow);
  }));
  // Visibilita' condizionale.
  $("dip-dom-diverso").addEventListener("change", (e) => { $("dip-dom-block").hidden = !e.target.checked; });
  $("dip-tipo-contratto").addEventListener("change", (e) => { $("dip-fine-contr-wrap").hidden = e.target.value !== CONTRATTO_DETERMINATO; });
  $("dip-attivo").addEventListener("change", (e) => { $("dip-cessazione-section").hidden = e.target.checked; });

  // Modale adempimento (sola lettura: Fatto + Chiudi + apertura PDF).
  $("adm-form").addEventListener("submit", (e) => e.preventDefault()); // no save da qua
  $("adm-close").addEventListener("click", () => closeModal("modal-adempimento"));
  $("adm-cancel").addEventListener("click", () => closeModal("modal-adempimento"));
  $("adm-doc-open").addEventListener("click", async () => {
    const id = $("adm-id").value;
    const adm = state.adempimenti.find((a) => a.id === id);
    if (adm) await openDoc(adm);
  });
  $("adm-rinnova").addEventListener("click", () => {
    const id = $("adm-id").value;
    const dipId = $("adm-dip-id").value;
    const tipoId = $("adm-tipo").value;
    openFattoModal(id, dipId, tipoId);
  });
  $("adm-history-toggle").addEventListener("click", () => toggleSection("adm-history-toggle", "adm-history-list"));

  // Mini-modale "Fatto" (rinnovo con 1 click).
  $("fatto-form").addEventListener("submit", applyFatto);
  $("fatto-close").addEventListener("click", () => closeModal("modal-fatto"));
  $("fatto-cancel").addEventListener("click", () => closeModal("modal-fatto"));
  // Cambiare la data dell'evento riporta la scadenza al valore della regola;
  // scriverla a mano aggiorna solo l'avviso.
  $("fatto-data").addEventListener("change", precompilaScadenzaFatto);
  $("fatto-scadenza").addEventListener("input", aggiornaHintFatto);

  // Modale ruolo.
  $("ruolo-form").addEventListener("submit", saveRuolo);
  $("ruolo-close").addEventListener("click", () => closeModal("modal-ruolo"));
  $("ruolo-cancel").addEventListener("click", () => closeModal("modal-ruolo"));
  $("ruolo-delete").addEventListener("click", deleteRuolo);
  $("ruolo-tipo").addEventListener("change", (e) => {
    $("ruolo-minimo-wrap").hidden = e.target.value !== "incarico";
  });

  // Modale tipo.
  $("tipo-form").addEventListener("submit", saveTipo);
  $("tipo-close").addEventListener("click", () => closeModal("modal-tipo"));
  $("tipo-cancel").addEventListener("click", () => closeModal("modal-tipo"));
  $("tipo-delete").addEventListener("click", deleteTipo);

  // Modale regola.
  $("req-form").addEventListener("submit", saveReq);
  $("req-validita").addEventListener("input", aggiornaHintRicalcolo);
  $("req-close").addEventListener("click", () => closeModal("modal-requisito"));
  $("req-cancel").addEventListener("click", () => closeModal("modal-requisito"));
  $("req-delete").addEventListener("click", deleteReq);

  // Chiusura modale cliccando sul backdrop.
  els(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") els(".modal").forEach((m) => (m.hidden = true)); });
}

function hasActiveFilters() {
  const f = state.compFilter;
  return !!(f.dipendente || f.mansione || f.incarico || f.stato);
}
function updateClearBtn() { $("btn-clear-filters").hidden = !state.search && !hasActiveFilters(); }

// ============================================================
// BOOT
// ============================================================
async function startApp() {
  $("user-email").textContent = state.user?.email || "—";
  await sbLoadAll();
  await syncAllDipendenti();
  subscribeRealtime();
  populateFilters();
  setView("compliance");
}

// 1.4 · Se l'avvio fallisce, la pagina NON resta bianca.
// wireEvents() collega ~130 id a mano: un id sbagliato lancia alla prima riga
// che lo tocca, init() muore a meta' e l'unica utente dell'app si trova davanti
// uno schermo vuoto, senza nulla da leggere e nulla da riferire.
// Il test tests/test-dom-ids.mjs previene la causa piu' probabile; questo
// riquadro copre tutte le altre.
function mostraErroreFatale(err) {
  console.error("Avvio fallito:", err);
  const box = document.getElementById("fatal-error");
  const msg = document.getElementById("fatal-error-msg");
  if (!box || !msg) return;   // se manca anche il riquadro non c'e' altro da fare
  msg.textContent = [
    String(err && err.message ? err.message : err),
    err && err.stack ? "\n" + err.stack : "",
    "\nPagina: " + location.href,
    "Data: " + new Date().toISOString(),
  ].join("\n");
  box.hidden = false;
}

async function init() {
  try {
    wireEvents();
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      state.user = data.session.user;
      hideLogin();
      await startApp();
    } else {
      showLogin();
    }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") showLogin();
    });
  } catch (err) {
    mostraErroreFatale(err);
  }
}

document.addEventListener("DOMContentLoaded", init);
