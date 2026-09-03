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
// Giorni che mancano a una data. `oggiISO` e' facoltativo e serve SOLO ai test
// (Fase 5): senza, si legge la data vera, come ha sempre fatto. Esiste perche'
// tre regole della Fase 5 passano di qui, e un test che dipende dal giorno in
// cui gira e' un test che un giorno fallisce da solo — "tutti i colloqui fatti
// entro novembre 2026 e' verde" e' vero a settembre e falso a ottobre.
// Una data di riferimento illeggibile NON diventa "oggi": diventa null, perche'
// rispondere "mancano 40 giorni" partendo da una data che non si e' capita e'
// peggio che non rispondere.
function daysUntil(s, oggiISO) {
  const d = parseISO(s);
  if (!d) return null;
  let base = todayMid();
  if (oggiISO != null) {
    base = parseISO(oggiISO);
    if (!base) return null;
  }
  return Math.round((d - base) / 86400000);
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
// `oggiISO` (Fase 5) e' facoltativo e in coda: tutte le chiamate che esistevano
// prima ne passano due e continuano a leggere la data vera. Non e' una regola
// nuova, e' la stessa regola resa provabile.
function classificaStato(hasRilascio, scadenza, oggiISO) {
  if (!hasRilascio) {
    if (!scadenza) return "scaduto";                 // nessuna scadenza nota: visibile subito
    return daysUntil(scadenza, oggiISO) < 0 ? "scaduto" : "in_scadenza"; // mai "ok" se non registrato
  }
  if (!scadenza) return "ok";                        // rilasciato e non scade
  const gg = daysUntil(scadenza, oggiISO);
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
// 1c · Chi e' un dato di prova, e chi no.
// Otto persone finte caricate per far esercitare l'HR prima dei dati veri
// (sql/fase_1c_2026-09-02_dati_prova.sql). Il bottone "Elimina i dati di prova"
// in Configurazione le cancella tutte insieme, quindi la domanda "questa e'
// finta?" e' una regola su stati come le altre: sta qui, con un test.
//
// Due chiavi, e non una per sfizio:
//   - la NOTA e' il criterio dichiarato dal piano, confrontato in modo ESATTO.
//     Non "contiene": una persona vera la cui nota citasse per caso quelle
//     parole non deve finire nel mucchio, e il dipendente di collaudo (nota
//     "FAC-SIMILE di collaudo: ...") non deve mai essere toccato.
//   - l'ID e' la cintura. La nota e' un campo della scheda che saveDip
//     riscrive a ogni salvataggio, e queste persone esistono APPOSTA perche'
//     l'HR ci si eserciti sopra: basterebbe scrivere "visita prenotata" nella
//     nota di una di loro perche' smetta di essere riconosciuta, sparisca dal
//     conteggio del bottone e resti in mezzo alle persone vere, in silenzio.
//     L'id non e' modificabile da nessuna vista, e nessuna persona vera puo'
//     averlo: chi nasce dall'app prende un uuid casuale.
// ============================================================
const NOTA_DATI_PROVA = "DATI DI PROVA";
const PREFISSO_ID_PROVA = "dip-prova-";

function isDatoDiProva(dip) {
  if (!dip) return false;
  return String(dip.id || "").startsWith(PREFISSO_ID_PROVA) || dip.note === NOTA_DATI_PROVA;
}

// Il dipendente di collaudo della procedura NON e' un dato di prova, e il
// bottone non deve toccarlo mai. Oggi non ci finirebbe comunque (nota diversa,
// id uuid), ma un bottone che cancella otto persone in un colpo deve dire per
// iscritto chi salta, invece di fidarsi di una differenza. Qui il confronto e'
// per forza "contiene": la nota vera e' una frase intera
// ("FAC-SIMILE di collaudo: stessa persona di esempio ..."), non un'etichetta.
function isDipendenteDiCollaudo(dip) {
  const note = String(dip?.note || "").toLowerCase();
  return note.includes("collaudo") || note.includes("fac-simile");
}

// Chi il bottone "Elimina i dati di prova" cancella davvero: le persone finte,
// meno quella di collaudo. Una regola sola, in un posto solo: e' lo stesso
// elenco che si conta per il numero sul bottone e che si scorre per cancellare,
// e se i due divergessero il bottone direbbe un numero e ne cancellerebbe un
// altro.
function dipendentiDiProva(dipendenti) {
  return (dipendenti || []).filter((d) => isDatoDiProva(d) && !isDipendenteDiCollaudo(d));
}

// ============================================================
// 2.1 · Checklist di ingresso e di uscita.
// La stessa tabella `onboarding_items` porta le due checklist, distinte dalla
// colonna `fase`. Le tre regole qui sotto sono regole su date e su stati: stanno
// in common.js con i loro test, perche' sbagliarne una non da' nessun errore —
// da' una checklist che sembra giusta e non lo e'.
// ============================================================

// Entro quando va fatta una voce di checklist.
// La data di base NON e' la stessa per le due fasi: per l'ingresso e' la data di
// assunzione, per l'uscita la data di cessazione. Calcolare una voce d'uscita
// dall'assunzione e' il difetto che il piano descrive con parole precise: "tutto
// risulta scaduto da anni", perche' una persona assunta nel 2015 avrebbe la
// riconsegna del badge attesa per il 2015.
// I giorni possono essere NEGATIVI (la lettera di dimissioni arriva prima
// dell'ultimo giorno): addDays li regge, e il campo Giorni non ha piu' min="0".
// null = nessun termine da mostrare (manca la data di base, o la voce non ne ha).
function scadenzaOnboardingItem(dip, item) {
  if (!dip || !item) return null;
  const base = item.fase === "uscita" ? dip.data_cessazione : dip.data_assunzione;
  if (!base || item.giorni_da_assunzione == null) return null;
  const d = parseISO(base);
  if (!d) return null;
  return localISO(addDays(d, Number(item.giorni_da_assunzione)));
}

// Quali voci di checklist vanno create per questa persona, adesso.
// Ritorna gli ITEM, non le righe: chi chiama costruisce le righe e le scrive.
//
// Tre proprieta', che prima non valevano:
//   - chi e' IN FORZA riceve solo voci d'ingresso: la sua uscita non esiste;
//   - chi e' CESSATO riceve solo voci d'uscita, e non se ne creano piu'
//     d'ingresso (era il difetto n. 3 del §2 del piano: "i progressi di
//     onboarding continuano a generarsi anche per i cessati");
//   - un cessato SENZA data di cessazione non riceve niente: senza quella data
//     i termini delle sette voci sarebbero tutti falsi.
// Le righe gia' esistenti non si toccano mai: l'ingresso di un cessato resta
// come storia di quando quella persona e' entrata.
function itemsOnboardingDaSincronizzare({ dip, items, itemIdEsistenti }) {
  if (!dip) return [];
  const gia = itemIdEsistenti instanceof Set ? itemIdEsistenti : new Set(itemIdEsistenti || []);
  const cessato = dip.attivo === false;
  if (cessato && !dip.data_cessazione) return [];
  const faseVoluta = cessato ? "uscita" : "ingresso";
  return (items || []).filter((it) => {
    if (!it || gia.has(it.id)) return false;
    // Le voci "crea_adempimento" non hanno un progresso proprio: il loro stato
    // e' derivato dall'adempimento in Scadenze (singola fonte di verita').
    if (it.tipo_workflow === "crea_adempimento") return false;
    // Le voci lette prima della migrazione non hanno `fase`: sono d'ingresso,
    // che e' esattamente come si comportano oggi.
    return (it.fase || "ingresso") === faseVoluta;
  });
}

// Cosa si propone di chiudere quando una persona viene cessata: i suoi
// INCARICHI ancora aperti, mai la mansione.
// La mansione e' `required` nella scheda e viene precompilata dalle sole
// assegnazioni attive: chiuderla renderebbe la scheda del cessato non piu'
// salvabile, e l'unica via d'uscita sarebbe riscegliere una mansione, che
// verrebbe scritta come riga NUOVA e attiva — un'assegnazione inventata per chi
// non lavora piu'. La mansione di un cessato resta aperta di proposito: e' la
// riga che dice che mestiere faceva quando e' uscito.
function incarichiDaRevocare({ dipRuoli, ruoli, dipId }) {
  const tipoDelRuolo = new Map((ruoli || []).map((r) => [r.id, r.tipo]));
  return (dipRuoli || []).filter((dr) =>
    dr && dr.dipendente_id === dipId && assegnazioneAttiva(dr) &&
    tipoDelRuolo.get(dr.ruolo_id) === "incarico");
}

// ============================================================
// 3.1 · I numeri che cambiano con le norme sono DATI, non codice.
// La tabella `parametri` nasce in questa fase (durata del link del portale,
// durata e preavviso dei link dei cedolini) e le fasi 4 e 5 la riusano per i
// giorni di comporto, la denuncia INAIL e il mese dei colloqui.
//
// Perche' questa lettura sta qui e non in app.js: e' una regola con RIPIEGO, la
// stessa che il database applica in `parametro_int`. I parametri li scrive l'HR
// da Configurazione, cioe' a mano: un "trecento" o un "365 giorni" scritti per
// sbaglio non devono diventare NaN nel calcolo della scadenza dei link — devono
// far tornare il valore di ripiego, in silenzio e sempre nello stesso modo nelle
// due metà dell'app.
// Solo interi: nessun parametro di questa fase e' un decimale, e accettare
// "12.9" vorrebbe dire decidere se troncare o arrotondare.
function parametroInt(parametri, chiave, valoreDiRipiego) {
  const riga = (parametri || []).find((p) => p && p.chiave === chiave);
  if (!riga) return valoreDiRipiego;
  const testo = String(riga.valore == null ? "" : riga.valore).trim();
  if (!/^-?\d+$/.test(testo)) return valoreDiRipiego;
  const n = Number(testo);
  return Number.isFinite(n) ? n : valoreDiRipiego;
}

// ============================================================
// 3.2 · Cedolini — le cinque regole che non si vedono sbagliare.
// Nessuna di queste da' un errore quando e' sbagliata: da' un cedolino
// consegnato alla persona sbagliata, un link scaduto senza che nessuno se ne
// accorga, o un contatore che dice "tutti fatti" mentre ne manca uno. Per questo
// stanno qui, con i loro test, e non dentro una modale.
// ============================================================

// Il MESE non e' libero: 1-12 e' un cedolino mensile, 13 e' la tredicesima, 0 e'
// la Certificazione Unica. Il piano lo impone per una ragione precisa: con
// `mese null` l'unicita' (persona, anno, mese, tipo) non scatterebbe MAI, perche'
// in Postgres null non e' uguale a null, e la stessa CU si potrebbe caricare
// dieci volte. Il database ha lo stesso vincolo come `check`: questa funzione
// serve a non farlo scattare, non a sostituirlo.
const MESE_TREDICESIMA = 13;
const MESE_CU = 0;

function normalizzaPeriodoCedolino({ anno, mese, tipo }) {
  const t = String(tipo || "mensile");
  const a = Number(anno);
  if (t === "tredicesima") return { anno: a, mese: MESE_TREDICESIMA, tipo: t };
  if (t === "cu") return { anno: a, mese: MESE_CU, tipo: t };
  return { anno: a, mese: Number(mese), tipo: "mensile" };
}

// Un link firmato va rinnovato se non c'e', se non si sa quando scade, o se
// scade entro N giorni. "Non si sa quando scade" conta come da rinnovare: una
// riga senza scadenza nota non e' una riga a posto.
// La data si confronta al giorno: url_scade_il e' un timestamptz, e per una
// scadenza a tredici mesi un giorno in piu' o in meno non cambia niente.
function linkCedolinoDaRinnovare(ced, giorniPreavviso) {
  if (!ced) return false;
  if (!ced.url_firmato || !ced.url_scade_il) return true;
  const gg = daysUntil(String(ced.url_scade_il).slice(0, 10));
  if (gg == null) return true;
  return gg <= Number(giorniPreavviso);
}

// L'elenco per il bottone "Rinnova i link" e per il contatore in barra laterale.
// UNA lista sola, come dipendentiDiProva: se il numero mostrato e l'elenco
// rigenerato venissero da due filtri diversi, il bottone direbbe un numero e ne
// rinnoverebbe un altro.
//
// I CESSATI restano fuori, e non e' un dettaglio: alla cessazione il collegamento
// dei loro cedolini viene spento apposta. Contandoli, il badge mostrerebbe per
// sempre un numero che non si spegne, e il primo "Rinnova i link" rifirmerebbe
// proprio i collegamenti che la cessazione aveva chiuso — un bottone che disfa
// quello che ne fa un altro.
// `dipendenti` e' facoltativo: senza, il filtro non si applica.
function cedoliniDaRinnovare(cedolini, giorniPreavviso, dipendenti) {
  const cessati = new Set((dipendenti || []).filter((d) => d && d.attivo === false).map((d) => d.id));
  return (cedolini || []).filter((c) =>
    !cessati.has(c?.dipendente_id) && linkCedolinoDaRinnovare(c, giorniPreavviso));
}

// "Questo nome di file contiene questa matricola, delimitata?"
// Delimitata = all'inizio o alla fine del nome, oppure fra caratteri non
// alfanumerici. E' la regola che impedisce a "1" di pescare "PROVA-01" e a "004"
// di pescare "1004". Scritta a mano invece che con un'espressione regolare
// perche' una matricola puo' contenere qualunque carattere, e costruire un
// pattern a partire da un dato dell'utente vuol dire ricordarsi di neutralizzarlo
// ogni volta.
function contieneDelimitato(testo, ago) {
  const t = String(testo).toUpperCase();
  const a = String(ago).toUpperCase();
  if (!a) return false;
  const alfanumerico = (ch) => !!ch && ((ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z"));
  for (let i = t.indexOf(a); i !== -1; i = t.indexOf(a, i + 1)) {
    const prima = i === 0 ? "" : t[i - 1];
    const dopo = i + a.length >= t.length ? "" : t[i + a.length];
    if (!alfanumerico(prima) && !alfanumerico(dopo)) return true;
  }
  return false;
}

// Quale file va a quale persona, guardando la matricola nel nome del file.
// E' un SUGGERIMENTO: riempie le righe della modale, poi l'HR vede nome,
// matricola e nome del file accanto a ciascuna e conferma.
//
// Tre regole, e la terza e' quella che conta:
//   - la matricola deve comparire delimitata (vedi contieneDelimitato);
//   - un file che corrisponde a due persone e' AMBIGUO e non si assegna;
//   - due file che corrispondono alla stessa persona sono AMBIGUI TUTTI E DUE.
//     "L'ultimo vince" qui vorrebbe dire consegnare in silenzio il cedolino
//     sbagliato, che e' il danno peggiore che questa fase possa fare.
function abbinaCedoliniPerMatricola(nomiFile, dipendenti) {
  const persone = (dipendenti || []).filter((d) => d && String(d.matricola || "").trim() !== "");
  const perFile = new Map();       // nome del file -> id delle persone che corrispondono
  const nonAbbinati = [];
  for (const nome of nomiFile || []) {
    const trovate = persone
      .filter((d) => contieneDelimitato(nome, String(d.matricola).trim()))
      .map((d) => d.id);
    if (!trovate.length) { nonAbbinati.push(nome); continue; }
    perFile.set(nome, trovate);
  }

  const ambigui = [];
  const candidati = new Map();      // id persona -> nomi dei file che le corrispondono
  for (const [nome, ids] of perFile) {
    if (ids.length > 1) { ambigui.push(nome); continue; }
    const lista = candidati.get(ids[0]) || [];
    lista.push(nome);
    candidati.set(ids[0], lista);
  }

  const abbinati = [];
  for (const [dipendenteId, nomi] of candidati) {
    if (nomi.length > 1) { ambigui.push(...nomi); continue; }
    abbinati.push({ nomeFile: nomi[0], dipendenteId });
  }
  return { abbinati, ambigui, nonAbbinati };
}

// "Cedolini di luglio: 12/15". Chi entra nel denominatore: chi e' stato in forza
// ALMENO UN GIORNO del mese, non "chi e' in forza oggi". Chi cessa in agosto
// riceve il cedolino di luglio e quello finale: con "in forza oggi" il suo
// cedolino mancante sparirebbe dal conteggio proprio nel mese in cui e' piu'
// facile dimenticarlo.
// Un cessato SENZA data di cessazione non si conta: non si sa quando se ne sia
// andato, e contarlo per sempre terrebbe acceso un contatore che non si spegne.
function inForzaNelMese(dip, anno, mese) {
  if (!dip) return false;
  // Il mese dev'essere un mese vero. I cedolini usano anche 13 (tredicesima) e 0
  // (Certificazione Unica): passandoli qui si costruirebbero date come
  // "2026-00-01", e il confronto fra stringhe scarterebbe chiunque — un
  // contatore "0 su 0" che dichiara tutto a posto. Chi chiama deve dire di quale
  // mese vero sta parlando.
  const m = Number(mese);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  const ultimo = new Date(Number(anno), m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const inizio = `${anno}-${mm}-01`;
  const fine = `${anno}-${mm}-${String(ultimo).padStart(2, "0")}`;
  if (dip.data_assunzione && String(dip.data_assunzione).slice(0, 10) > fine) return false;
  if (dip.attivo === false && !dip.data_cessazione) return false;
  if (dip.data_cessazione && String(dip.data_cessazione).slice(0, 10) < inizio) return false;
  return true;
}

// Tredicesima e Certificazione Unica non sono di un mese: sono dell'ANNO. La CU
// del 2026 spetta anche a chi se n'e' andato a luglio, e con "chi era in forza a
// dicembre" quella persona non comparirebbe da nessuna parte — l'unico posto da
// cui si caricano i cedolini e' la modale del mese.
function inForzaNellAnno(dip, anno) {
  for (let m = 1; m <= 12; m++) if (inForzaNelMese(dip, anno, m)) return true;
  return false;
}

function conteggioCedoliniDelMese({ dipendenti, cedolini, anno, mese, tipo = "mensile" }) {
  const attesi = (dipendenti || []).filter((d) => inForzaNelMese(d, anno, mese));
  const hanno = new Set((cedolini || [])
    .filter((c) => c && Number(c.anno) === Number(anno) && Number(c.mese) === Number(mese) && c.tipo === tipo)
    .map((c) => c.dipendente_id));
  return { presenti: attesi.filter((d) => hanno.has(d.id)).length, attesi: attesi.length };
}

// ============================================================
// 3.3 · La griglia degli scambi con il consulente del lavoro.
// Una domanda sola: "con lo studio, questo mese, sono a posto?".
//
// La regola che vale la pena di scrivere qui, con un test, e' una: un mese NON
// ANCORA FINITO non e' "mancante". Senza questa distinzione la griglia sarebbe
// rossa da gennaio a dicembre il primo di gennaio, cioe' un allarme che non vuol
// dire niente e che si impara a ignorare — e il giorno in cui manca davvero il
// LUL di luglio nessuno se ne accorge.
//
//   tipi      il vocabolario da data.js: { key, label, direzione, periodicita }
//   righe     tutte le righe di scambi_consulente
//   oggiISO   solo per i test: forza la data di riferimento
//
// I mensili hanno dodici caselle (mese 1-12), gli annuali una sola (mese 0).
// ============================================================
function grigliaScambi({ anno, tipi, righe, oggiISO }) {
  const oggi = oggiISO || localISO(new Date());
  const a = Number(anno);
  const perChiave = new Map();
  for (const r of righe || []) {
    if (!r || Number(r.anno) !== a) continue;
    perChiave.set(`${r.tipo}|${Number(r.mese)}|${r.direzione}`, r);
  }

  const ultimoGiorno = (mese) => {
    const g = new Date(a, Number(mese), 0).getDate();
    return `${a}-${String(mese).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  };

  return (tipi || []).map((t) => {
    const annuale = t.periodicita === "annuale";
    const mesi = annuale ? [0] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const celle = mesi.map((mese) => {
      const riga = perChiave.get(`${t.key}|${mese}|${t.direzione}`) || null;
      // La fine del periodo: l'ultimo giorno del mese, o del dicembre dell'anno
      // per le voci annuali.
      const fine = annuale ? `${a}-12-31` : ultimoGiorno(mese);
      let stato;
      if (riga) stato = "presente";
      else if (fine >= oggi) stato = "futuro";
      else stato = "mancante";
      return { mese, riga, stato };
    });
    return {
      tipo: t.key, label: t.label, direzione: t.direzione,
      periodicita: t.periodicita, annuale, celle,
      mancanti: celle.filter((c) => c.stato === "mancante").length,
    };
  });
}

// Quante caselle mancano davvero, per il contatore in barra laterale.
function scambiMancanti(griglia) {
  return (griglia || []).reduce((n, r) => n + r.mancanti, 0);
}

// ============================================================
// 4.1-4.5 · Eventi del mese — le regole che decidono dei NUMERI.
// Nessuna di queste da' un errore quando e' sbagliata: da' un giorno di ferie in
// piu' o in meno sul file che va al consulente del lavoro, un contatore del
// comporto che dice 140 invece di 160, o un promemoria della denuncia INAIL che
// resta rosso per sempre. Per questo stanno qui, con i loro test.
// ============================================================

// Oltre questo, non e' un evento: e' un errore di battitura nell'anno. Serve
// solo a non far girare un ciclo per un milione di giorni bloccando la pagina;
// tutte le chiamate dell'app passano comunque una finestra (il mese, o la
// finestra del comporto), quindi in pratica non si raggiunge mai.
const MAX_GIORNI_EVENTO = 1100;

// I giorni ISO occupati da un evento, dentro una finestra.
//
// `al` VUOTO VUOL DIRE UN GIORNO SOLO, non "evento ancora in corso": le due
// letture danno numeri diversi nel calendario, nelle variabili del mese e nel
// comporto, e li mostrano tutti e tre come fatti. La RPC del portale scrive
// gia' `coalesce(p_al, p_dal)` e la modale dell'HR scrive `al = dal` quando il
// campo e' vuoto: qui si legge allo stesso modo, cosi' la regola e' una sola
// anche per le righe che arrivassero da altre strade.
//
// La finestra e' facoltativa (senza, vale tutto l'evento) ma l'app la passa
// sempre: e' quella che impedisce a una richiesta con l'anno sbagliato di
// riempire il calendario di un mese intero.
function giorniDiEvento(ev, daISO, aISO) {
  if (!ev || !ev.dal) return [];
  const inizio = String(ev.dal).slice(0, 10);
  const fine = String(ev.al || ev.dal).slice(0, 10);
  if (fine < inizio) return [];                      // riga incoerente: nessun giorno
  const primo = daISO && String(daISO).slice(0, 10) > inizio ? String(daISO).slice(0, 10) : inizio;
  const ultimo = aISO && String(aISO).slice(0, 10) < fine ? String(aISO).slice(0, 10) : fine;
  if (primo > ultimo) return [];
  let d = parseISO(primo);
  const stop = parseISO(ultimo);
  if (!d || !stop) return [];
  const out = [];
  while (d <= stop && out.length < MAX_GIORNI_EVENTO) {
    out.push(localISO(d));
    d = addDays(d, 1);
  }
  return out;
}

// Quanti sono. Sono GIORNI DI CALENDARIO: una settimana di ferie da lunedi' a
// domenica vale 7. I giorni lavorativi l'app non puo' calcolarli — con tre turni
// in ciclo continuo il calendario dei riposi non e' nell'app — quindi l'unita' si
// dichiara ovunque compaia il numero, invece di far finta.
function contaGiorniEvento(ev, daISO, aISO) {
  return giorniDiEvento(ev, daISO, aISO).length;
}

// Gli eventi che TOCCANO un mese, non quelli che ci cominciano: una malattia dal
// 28 giugno al 4 luglio sta nelle variabili di giugno e in quelle di luglio, per
// i giorni che le competono.
function eventiDelMese(eventi, anno, mese) {
  const m = Number(mese);
  if (!Number.isInteger(m) || m < 1 || m > 12) return [];
  const ultimo = new Date(Number(anno), m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const inizio = `${anno}-${mm}-01`;
  const fine = `${anno}-${mm}-${String(ultimo).padStart(2, "0")}`;
  return (eventi || []).filter((e) => e && e.dal
    && String(e.dal).slice(0, 10) <= fine
    && String(e.al || e.dal).slice(0, 10) >= inizio);
}

// Le richieste ancora in attesa. UNA lista sola, come dipendentiDiProva: il
// numero sul contatore in barra laterale e l'elenco che si approva devono venire
// dallo stesso filtro, o il contatore dice tre e l'elenco ne mostra due.
function richiesteDaApprovare(eventi) {
  return (eventi || []).filter((e) => e && e.stato === "richiesto");
}

// 4.2 · "Denuncia INAIL entro N giorni".
// Il promemoria e' DERIVATO: non c'e' nessuna colonna "denuncia fatta". Quello
// che lo spegne e' la scheda infortunio allegata, come dice il piano in M4.
//
// Con l'allegato lo stato e' `ok` e basta. NON si usa
// classificaStato(true, scadenza): la soglia "in scadenza" dell'app e' 60 giorni
// e il termine INAIL e' 2, quindi ogni infortunio resterebbe arancione fino al
// termine e ROSSO PER SEMPRE dopo — allegato o no. L'allegato non cambierebbe
// niente e ogni infortunio dell'anno scorso resterebbe rosso in eterno.
function promemoriaInail(ev, giorniDenuncia) {
  if (!ev || ev.tipo !== "infortunio" || !ev.dal) return null;
  const d = parseISO(String(ev.dal).slice(0, 10));
  if (!d) return null;
  // `Number(null)` fa 0, non NaN: senza questo controllo un parametro mancante
  // diventerebbe "denuncia entro zero giorni", cioe' scaduta il giorno stesso.
  const n = giorniDenuncia == null || giorniDenuncia === "" ? NaN : Number(giorniDenuncia);
  const scadenza = localISO(addDays(d, Number.isFinite(n) ? n : 2));
  return { scadenza, stato: ev.documento_path ? "ok" : classificaStato(false, scadenza) };
}

// 4.3 · La richiesta dal portale e' accettabile? null = si'.
// E' la stessa regola di self_richiedi_evento, dal lato di chi la scrive: serve
// a dire subito e in italiano cosa non va, non a fidarsi. La guardia resta la
// RPC, che ricontrolla tutto.
// `giorniIndietro` arriva da self_get (il portale gira come anon e non legge
// `parametri`): NON va scritto un numero qui dentro ne' in me.js.
function validaRichiesta({ tipo, dal, al, tipiConsentiti, giorniIndietro, oggiISO }) {
  const consentiti = tipiConsentiti || [];
  if (!tipo || !consentiti.includes(tipo)) return "Scegli che cosa vuoi chiedere.";
  if (!dal) return "Indica il primo giorno.";
  const d1 = String(dal).slice(0, 10);
  if (!parseISO(d1)) return "Il primo giorno non e' una data valida.";
  const d2 = al ? String(al).slice(0, 10) : d1;
  if (d2 < d1) return "L'ultimo giorno viene prima del primo.";
  const oggi = oggiISO ? String(oggiISO).slice(0, 10) : localISO(new Date());
  // Come sopra: `Number(null)` fa 0, e un limite "zero giorni indietro"
  // rifiuterebbe anche una richiesta per ieri. Limite assente = nessun limite:
  // lo dira' la RPC, che il numero ce l'ha davvero.
  const gg = giorniIndietro == null || giorniIndietro === "" ? NaN : Number(giorniIndietro);
  if (Number.isFinite(gg)) {
    const limite = localISO(addDays(parseISO(oggi), -gg));
    if (d1 < limite) {
      return `Non si puo' chiedere prima del ${fmtDate(limite)}: parlane con l'ufficio del personale.`;
    }
  }
  // Stesso limite della RPC: al oltre dal + 366 giorni.
  if (d2 > localISO(addDays(parseISO(d1), 366))) return "Il periodo e' troppo lungo.";
  return null;
}

// 4.5 · "Malattia: 23 giorni negli ultimi 12 mesi (soglia 180)".
// L'app CONTA, non decide (regola 1 del piano): nessun blocco, nessun
// automatismo, una riga che dice un numero.
//
// `eventiDellaPersona` sono gia' filtrati da chi chiama: nel portale gli eventi
// arrivano da una RPC che non restituisce affatto il dipendente_id, quindi un
// filtro qui dentro scarterebbe tutto in silenzio.
// I giorni si contano in un Set: due malattie che si sovrappongono non valgono
// due volte lo stesso giorno.
function conteggioComporto({ eventiDellaPersona, finestraMesi, soglia, percentuale, oggiISO }) {
  const oggi = oggiISO ? String(oggiISO).slice(0, 10) : localISO(new Date());
  const mesi = Number(finestraMesi);
  const dal = addMonths(oggi, -(Number.isFinite(mesi) && mesi > 0 ? mesi : 12));
  const giorni = new Set();
  for (const e of eventiDellaPersona || []) {
    if (!e || e.tipo !== "malattia" || e.stato !== "approvato") continue;
    for (const g of giorniDiEvento(e, dal, oggi)) giorni.add(g);
  }
  const s = Number(soglia);
  const p = Number(percentuale);
  const n = giorni.size;
  let stato = "ok";
  if (Number.isFinite(s) && s > 0) {
    if (n >= s) stato = "superato";
    else if (Number.isFinite(p) && p > 0 && n * 100 >= s * p) stato = "avviso";
  }
  return {
    giorni: n, dal, al: oggi, stato,
    soglia: Number.isFinite(s) && s > 0 ? s : null,
    percentuale: Number.isFinite(p) && p > 0 ? p : null,
  };
}

// 4.5 · Il saldo che l'HR ha copiato dal cedolino, e cosa e' successo DOPO.
// I due numeri NON si sommano, e la ragione e' scritta nel piano: l'app non
// calcola ferie maturate. Mostra il numero dichiarato, con la data a cui si
// riferisce, e accanto i movimenti approvati successivi. Chi guarda fa la
// sottrazione se vuole, sapendo che le unita' possono non coincidere.
// Senza `saldo_al` non si mostra niente: un saldo senza la sua data e' un numero
// che mente. `eventiDellaPersona` gia' filtrati, come sopra.
function saldoDichiarato({ dip, eventiDellaPersona }) {
  if (!dip || !dip.saldo_al) return null;
  const al = String(dip.saldo_al).slice(0, 10);
  let ferieDopo = 0;
  let oreDopo = 0;
  for (const e of eventiDellaPersona || []) {
    if (!e || e.stato !== "approvato" || !e.dal) continue;
    if (String(e.dal).slice(0, 10) <= al) continue;
    if (e.tipo === "ferie") ferieDopo += contaGiorniEvento(e);
    else if (e.tipo === "permesso") oreDopo += Number(e.ore) || 0;
  }
  return {
    al,
    ferie: dip.saldo_ferie == null || dip.saldo_ferie === "" ? null : Number(dip.saldo_ferie),
    par: dip.saldo_par == null || dip.saldo_par === "" ? null : Number(dip.saldo_par),
    ferieDopo,
    oreDopo,
  };
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

// ============================================================
// 5.1 · Il piano formativo: le stesse righe del motore gap, raggruppate per
// corso invece che per persona. Serve a prenotare un'edizione con l'ente per
// tutte le persone insieme, e a gennaio e' il piano formativo dell'anno.
//
// Sta qui e non in app.js per una ragione sola: "la scadenza piu' vicina" e' una
// regola su date, e sbagliarla non da' nessun errore — da' una data di
// prenotazione sbagliata all'ente, e nessuno se ne accorge.
//
// NON ordina: l'ordinamento per gravita' e' presentazione e resta in app.js,
// come gia' per calcolaGap e calcolaCariche. L'ordine dei gruppi qui e' quello
// di prima apparizione, cioe' deterministico ma senza significato.
// ============================================================
function raggruppaGapPerTipo(righe) {
  const byTipo = new Map();
  for (const r of righe || []) {
    if (!r || !r.tipo) continue;
    let g = byTipo.get(r.tipo.id);
    if (!g) {
      g = { tipo: r.tipo, righe: [], totale: 0, scaduti: 0, inScadenza: 0, ok: 0, primaScadenza: null };
      byTipo.set(r.tipo.id, g);
    }
    g.righe.push(r);
    g.totale++;
    if (r.stato === "scaduto") g.scaduti++;
    else if (r.stato === "in_scadenza") g.inScadenza++;
    else if (r.stato === "ok") g.ok++;
    // Le righe senza scadenza non abbassano la prima scadenza del gruppo: una
    // persona per cui la data non si sa ancora non anticipa il corso di tutti.
    if (r.scadenza && (g.primaScadenza === null || r.scadenza < g.primaScadenza)) {
      g.primaScadenza = r.scadenza;
    }
  }
  return [...byTipo.values()];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { classificaStato, calcolaGap, avvisoScadenza, raggruppaGapPerTipo,
    assegnazioneAttiva, calcolaCariche, caricheScoperte, ricalcolaScadenze, righeContrattuali,
    isDatoDiProva, isDipendenteDiCollaudo, dipendentiDiProva, NOTA_DATI_PROVA, PREFISSO_ID_PROVA,
    scadenzaOnboardingItem, itemsOnboardingDaSincronizzare, incarichiDaRevocare,
    parametroInt,
    normalizzaPeriodoCedolino, linkCedolinoDaRinnovare, cedoliniDaRinnovare,
    contieneDelimitato, abbinaCedoliniPerMatricola, inForzaNelMese, inForzaNellAnno, conteggioCedoliniDelMese,
    MESE_TREDICESIMA, MESE_CU,
    grigliaScambi, scambiMancanti,
    giorniDiEvento, contaGiorniEvento, eventiDelMese, richiesteDaApprovare,
    promemoriaInail, validaRichiesta, conteggioComporto, saldoDichiarato,
    daysUntil, parseISO, localISO, fmtDate, fmtDateTime, addDays, addMonths, esc, uid, GG_SCAD, GG_ONBOARD };
}
