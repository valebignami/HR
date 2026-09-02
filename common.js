// ============================================================
// HR Overland — common.js
// Helper condivisi app HR + portale (config Supabase, DOM helpers,
// date helpers, classificazione stato adempimenti).
// ============================================================

// ---------- Config Supabase (progetto DEDICATO all'HR, chiave publishable) ----------
// Dal 2026-09 l'app HR ha un progetto suo: "Overland HR" (eu-central-1).
// Prima condivideva il progetto "Scadenziario", e le due app si contendevano la
// tabella `dipendenti`: quella in produzione era dello Scadenziario (id, nome,
// email, ruolo, attivo, ordine), quindi il `create table if not exists` dell'HR
// non faceva nulla e meta' delle colonne attese non e' mai esistita.
// Non tornare al progetto condiviso: non e' un dettaglio di configurazione.
const SUPABASE_URL = "https://tbaagbngpxibllftsgoh.supabase.co";
const SUPABASE_KEY = "sb_publishable_J9KU1PHWz9igxYG6SfIyDw_cjTeBwNM";
const STORAGE_BUCKET = "hr-documenti";
let sb = null;
if (typeof window !== "undefined") {
  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:sans-serif;color:#991b1b">' +
        "Impossibile caricare la libreria Supabase (CDN bloccato?). Ricarica la pagina.</div>";
    });
    throw new Error("supabase-js non disponibile");
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
const GG_SCAD = (typeof window !== "undefined" && window.GIORNI_SCADENZA_IMMINENTE) || 30;
const GG_ONBOARD = (typeof window !== "undefined" && window.GIORNI_ONBOARDING) || 60;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function localISO(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return "";
  const off = x.getTimezoneOffset();
  const local = new Date(x.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtDate(s) {
  const d = parseISO(s);
  if (!d) return "—";
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}
function addMonths(s, months) {
  const d = parseISO(s);
  if (!d || months == null) return null;
  // Clamp al fine mese: 31/01 + 1 mese → 28/02 (o 29/02 in bisestile), NON 03/03.
  // Evita overflow JS che farebbe scadere una visita medica in un mese sbagliato.
  const targetY = d.getFullYear();
  const targetM = d.getMonth() + Number(months);
  const lastDayOfTarget = new Date(targetY, targetM + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDayOfTarget);
  return localISO(new Date(targetY, targetM, day));
}
function addDays(date, days) {
  const r = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return r;
}
function todayMid() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysUntil(s) {
  const d = parseISO(s);
  if (!d) return null;
  return Math.round((d - todayMid()) / 86400000);
}

// Timestamp con orario (timestamptz): converte al fuso locale.
// NON usare fmtDate sui timestamptz: tronca la data UTC (giorno sbagliato di notte).
function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return "—";
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear()
    + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Classificazione unica dello stato di un adempimento (era duplicata in 3 punti).
// hasRilascio: il ciclo è stato registrato dall'HR. scadenza: ISO o null.
function classificaStato(hasRilascio, scadenza) {
  if (!hasRilascio) {
    if (!scadenza) return "scaduto";                 // nessuna scadenza nota: visibile subito
    return daysUntil(scadenza) < 0 ? "scaduto" : "in_scadenza"; // mai "ok" se non registrato
  }
  if (!scadenza) return "ok";                        // rilasciato e non scade
  const gg = daysUntil(scadenza);
  if (gg < 0) return "scaduto";
  if (gg <= GG_SCAD) return "in_scadenza";
  return "ok";
}

// 1.1 · Confronta la scadenza scritta a mano con quella che la regola calcolerebbe.
// Nasce da un difetto vero: il catalogo dice che la periodicita' della visita la
// decide il medico competente, ma l'app scriveva sempre quella della matrice, con
// l'aria di avere ragione. Ora la data si corregge, e questa funzione dice quando
// la correzione si allontana dalla regola — senza impedirla.
// null = nessun avviso da mostrare.
function avvisoScadenza(dataRilascio, validitaMesi, scadenzaInserita) {
  if (validitaMesi == null || !Number.isFinite(Number(validitaMesi))) return null;
  if (!dataRilascio || !scadenzaInserita) return null;
  const attesa = addMonths(dataRilascio, Number(validitaMesi));
  if (!attesa || attesa === scadenzaInserita) return null;
  return `Diversa dalla regola (${validitaMesi} mesi → ${fmtDate(attesa)}).`;
}

// ============================================================
// 1.2 · Cariche aziendali — quanti sono e quanti dovrebbero essere.
// Era in app.js e leggeva lo stato globale, quindi non era provabile. E' una
// regola su stati (chi conta e chi no), quindi sta qui, con un test.
// NON ordina: l'ordine e' presentazione e resta in app.js.
// ============================================================

// Un'assegnazione ruolo→dipendente e' attiva finche' non e' stata revocata.
// Regola unica: la usano sia calcolaCariche qui sia assegnazioniOfDip in app.js.
// Prima della Fase 1.5 la colonna `al` non esisteva: undefined == null e' vero,
// quindi le righe vecchie risultano attive, che e' esattamente quello che erano.
function assegnazioneAttiva(a) {
  return !!a && a.al == null;
}

function calcolaCariche({ ruoli, dipRuoli, dipendenti }) {
  return ruoli
    .filter((r) => r.tipo === "incarico" && (r.minimo_richiesto || 0) > 0)
    .map((r) => {
      const nominati = dipendenti.filter((d) => d.attivo !== false &&
        dipRuoli.some((dr) => dr.dipendente_id === d.id && dr.ruolo_id === r.id && assegnazioneAttiva(dr)));
      const minimo = r.minimo_richiesto || 0;
      return { ruolo: r, nominati, minimo, sottoSoglia: nominati.length < minimo };
    });
}

// Quali cariche PEGGIORANO passando da uno stato all'altro: meno nominati e
// sotto il minimo. Serve a chiedere conferma prima di cessare una persona o di
// toglierle un incarico — l'unico momento in cui l'azienda si scopre senza
// accorgersene, perche' il cruscotto migliora.
function caricheScoperte(prima, dopo) {
  const primaById = new Map(prima.map((c) => [c.ruolo.id, c]));
  const out = [];
  for (const d of dopo) {
    const p = primaById.get(d.ruolo.id);
    if (!p) continue;
    if (d.nominati.length < p.nominati.length && d.sottoSoglia) {
      out.push({ ruolo: d.ruolo, minimo: d.minimo, prima: p.nominati.length, dopo: d.nominati.length });
    }
  }
  return out;
}

// ============================================================
// 1.3 · Ricalcolo delle scadenze dopo un cambio di validita' in matrice.
// Chi chiama passa, per ogni adempimento candidato:
//   { id, data_rilascio, data_scadenza, validitaVecchia, validitaNuova }
// dove le due validita' sono quelle EFFETTIVE della persona (che tengono conto
// degli altri suoi ruoli), non la regola da sola; null = "non scade".
// Ritorna solo le righe da aggiornare: [{ id, data_scadenza }].
//
// Due cose che questa funzione NON tocca, ed e' il punto:
//   - le righe mai registrate (senza data_rilascio): non c'e' niente da cui
//     ricalcolare, e la loro scadenza e' quella dell'onboarding;
//   - le righe la cui scadenza NON coincide col vecchio calcolo: sono quelle
//     corrette a mano (1.1), cioe' la data che ha scritto il medico. Riscriverle
//     disferebbe esattamente il lavoro che la 1.1 rende possibile.
// ============================================================
function ricalcolaScadenze(righe) {
  const out = [];
  for (const r of righe || []) {
    if (!r || !r.data_rilascio) continue;
    const attesaVecchia = r.validitaVecchia == null ? null : addMonths(r.data_rilascio, r.validitaVecchia);
    if ((r.data_scadenza || null) !== attesaVecchia) continue;   // corretta a mano
    const nuova = r.validitaNuova == null ? null : addMonths(r.data_rilascio, r.validitaNuova);
    if ((r.data_scadenza || null) === nuova) continue;           // gia' giusta
    out.push({ id: r.id, data_scadenza: nuova });
  }
  return out;
}

// ============================================================
// 1.7 · Scadenze contrattuali.
// Fine periodo di prova e fine contratto erano solo campi del form: non
// comparivano in NESSUNA vista. Un contratto a termine che scade inosservato si
// trasforma per legge; una prova che scade senza decisione conferma l'assunzione.
// Stesso semaforo del resto dell'app: classificaStato con hasRilascio = true,
// perche' la data c'e' ed e' certa — non e' un adempimento da registrare.
// (Il permesso di soggiorno NON sta qui: e' un tipo di requisito e passa dal
// motore gap come tutti gli altri.)
// ============================================================
const CAMPI_CONTRATTUALI = [
  { campo: "data_fine_prova", etichetta: "Fine periodo di prova" },
  { campo: "data_fine_contratto", etichetta: "Fine contratto" },
];

function righeContrattuali(dip, giorniSoglia = GG_SCAD) {
  if (!dip || dip.attivo === false) return [];   // di un cessato non importa piu'
  const out = [];
  for (const { campo, etichetta } of CAMPI_CONTRATTUALI) {
    const data = dip[campo] || null;
    if (!data) continue;
    const gg = daysUntil(data);
    // Futura, o passata da non piu' di `giorniSoglia` giorni: piu' indietro di
    // cosi' la decisione e' stata presa (o il danno e' fatto) e la riga sarebbe
    // solo rumore permanente.
    if (gg == null || gg < -giorniSoglia) continue;
    out.push({ dip, campo, etichetta, data, stato: classificaStato(true, data) });
  }
  return out;
}

// ============================================================
// Motore gap — nucleo puro.
// Estratto da app.js nel 2026-09 per una ragione sola: era la logica piu'
// importante dell'app e l'unica non testabile, perche' leggeva lo stato
// globale. Qui non legge niente: riceve tutto e restituisce le righe.
// L'ORDINAMENTO NON STA QUI: e' una scelta di presentazione e resta in app.js.
//
//   dip               il dipendente (serve data_assunzione e id)
//   ruoloIds          Set degli id di ruolo assegnati alla persona
//   requisiti         tutte le righe di requisiti_ruolo
//   adempimenti       tutte le righe di adempimenti
//   trovaTipo(id)     lookup del tipo di requisito, o null se non esiste
//   giorniOnboarding  scadenza implicita per chi non ha ancora registrato
//   oggiISO           solo per i test: forza la data di riferimento
// ============================================================
function calcolaGap({ dip, ruoloIds, requisiti, adempimenti, trovaTipo, giorniOnboarding = GG_ONBOARD }) {
  // Requisiti dovuti, dedup per tipo: vince la regola con la validita' piu'
  // stringente (null = non scade = la meno stringente di tutte).
  const dovutiByTipo = new Map();
  for (const req of requisiti) {
    if (!ruoloIds.has(req.ruolo_id) || !req.obbligatorio) continue;
    const prev = dovutiByTipo.get(req.tipo_requisito_id);
    if (!prev) { dovutiByTipo.set(req.tipo_requisito_id, req); continue; }
    const a = req.validita_mesi == null ? Infinity : req.validita_mesi;
    const b = prev.validita_mesi == null ? Infinity : prev.validita_mesi;
    if (a < b) dovutiByTipo.set(req.tipo_requisito_id, req);
  }

  // Neoassunto: finche' non registra, la scadenza implicita e' assunzione + N giorni.
  const onboardDeadline = dip.data_assunzione
    ? localISO(addDays(parseISO(dip.data_assunzione), giorniOnboarding))
    : null;

  const rows = [];
  for (const [tipoId, req] of dovutiByTipo) {
    const tipo = trovaTipo(tipoId);
    if (!tipo) continue;
    // corrente === false = ciclo superato, tenuto come prova storica: non deve
    // mai diventare "l'adempimento piu' recente", o un attestato del 2016
    // farebbe sembrare coperto un obbligo scoperto.
    const insts = adempimenti
      .filter((a) => a.dipendente_id === dip.id && a.tipo_requisito_id === tipoId && a.corrente !== false)
      .sort((a, b) => (b.data_scadenza || b.data_rilascio || "").localeCompare(a.data_scadenza || a.data_rilascio || ""));
    const inst = insts[0];

    const hasRilascio = !!(inst && inst.data_rilascio);
    const scadenza = hasRilascio
      ? (inst.data_scadenza || null)
      : ((inst?.data_scadenza) || onboardDeadline || null);
    rows.push({ dip, tipo, req, stato: classificaStato(hasRilascio, scadenza), scadenza, adempimento: inst || null });
  }
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { classificaStato, calcolaGap, avvisoScadenza,
    assegnazioneAttiva, calcolaCariche, caricheScoperte, ricalcolaScadenze, righeContrattuali, daysUntil, parseISO, localISO, fmtDate, fmtDateTime, addDays, addMonths, esc, uid, GG_SCAD, GG_ONBOARD };
}
