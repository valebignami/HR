import assert from "node:assert/strict";

// common.js legge GIORNI_SCADENZA_IMMINENTE/GIORNI_ONBOARDING da `window` (impostati da
// data.js nel browser) con fallback 30/60 se `window` non esiste (Node "nudo"). Per testare
// il comportamento REALE del sito dobbiamo simulare `window` con gli stessi valori di data.js
// PRIMA di importare common.js, altrimenti il test verifica soglie che il browser non usa mai.
//
// Attenzione: se `window` esiste ma `window.supabase.createClient` no, common.js imbocca il
// ramo "CDN bloccato" (document.addEventListener + throw). Va quindi fornito anche un
// `window.supabase.createClient` fittizio e un `document.addEventListener` no-op.
globalThis.window = {
  GIORNI_SCADENZA_IMMINENTE: 60, // vedi data.js
  GIORNI_ONBOARDING: 60,         // vedi data.js
  supabase: { createClient: () => null },
};
globalThis.document = { addEventListener: () => {} };

const { classificaStato, calcolaGap, avvisoScadenza,
        assegnazioneAttiva, calcolaCariche, caricheScoperte, ricalcolaScadenze,
        righeContrattuali,
        parseISO, fmtDate, localISO, fmtDateTime,
        daysUntil, addDays, addMonths, GG_SCAD, GG_ONBOARD } =
  await import("../common.js");

// GG_SCAD deve corrispondere al valore reale iniettato sopra (data.js), non al fallback Node.
assert.equal(GG_SCAD, 60);

const iso = (giorniDaOggi) => localISO(addDays(new Date(), giorniDaOggi));

// classificaStato — registrato
assert.equal(classificaStato(true, null), "ok");                    // rilasciato, non scade
assert.equal(classificaStato(true, iso(GG_SCAD)), "in_scadenza");   // esattamente alla soglia: dentro
assert.equal(classificaStato(true, iso(GG_SCAD + 1)), "ok");        // appena sopra la soglia: fuori
assert.equal(classificaStato(true, iso(10)), "in_scadenza");        // ben dentro la soglia
assert.equal(classificaStato(true, iso(-1)), "scaduto");
// classificaStato — mai registrato: mai "ok"
assert.equal(classificaStato(false, null), "scaduto");
assert.equal(classificaStato(false, iso(40)), "in_scadenza");
assert.equal(classificaStato(false, iso(-5)), "scaduto");
// date
assert.equal(fmtDate("2026-07-16"), "16/07/2026");
assert.equal(fmtDate(null), "—");
assert.equal(daysUntil(localISO(new Date())), 0);
assert.doesNotThrow(() => parseISO("2026-02-30")); // non-crash su input strani
// fmtDateTime: un timestamptz UTC deve mostrare la data LOCALE, non quella UTC troncata
const t = new Date(); t.setHours(0, 30, 0, 0); // 00:30 locale
assert.ok(fmtDateTime(t.toISOString()).startsWith(fmtDate(localISO(t))));
// ============================================================
// addMonths — decide TUTTE le scadenze dei corsi e delle visite, e fino al
// 2026-09 non aveva una sola asserzione.
// ============================================================
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");  // clamp a fine mese, non 03/03
assert.equal(addMonths("2028-01-31", 1), "2028-02-29");  // stesso caso in anno bisestile
assert.equal(addMonths("2026-12-31", 2), "2027-02-28");  // attraversa l'anno e clampa
assert.equal(addMonths("2026-05-15", 12), "2027-05-15"); // idoneita' annuale
assert.equal(addMonths("2026-05-15", 60), "2031-05-15"); // aggiornamento quinquennale
assert.equal(addMonths("2026-05-15", 24), "2028-05-15"); // preposto, biennale
assert.equal(addMonths("2026-05-15", 0), "2026-05-15");
assert.equal(addMonths("2026-05-15", null), null);       // regola senza validita'
assert.equal(addMonths(null, 12), null);

// ============================================================
// avvisoScadenza (1.1) — la scadenza si corregge a mano, ma l'app deve dire
// quando la correzione si allontana dalla regola. Il medico competente decide
// la periodicita' della visita: l'avviso informa, non impedisce.
// ============================================================
// Coincide con la regola: nessun avviso.
assert.equal(avvisoScadenza("2026-05-15", 12, "2027-05-15"), null);
// Diversa: avviso che nomina i mesi della regola e la data attesa in italiano.
let av = avvisoScadenza("2026-05-15", 12, "2026-11-15");
assert.ok(av && av.includes("12 mesi") && av.includes("15/05/2027"), av);
// Regola senza validita' ("non scade"): non c'e' niente da confrontare.
assert.equal(avvisoScadenza("2026-05-15", null, "2027-05-15"), null);
assert.equal(avvisoScadenza("2026-05-15", undefined, "2027-05-15"), null);
assert.equal(avvisoScadenza("2026-05-15", Infinity, "2027-05-15"), null);
// Campi mancanti: l'obbligatorieta' e' una guardia del form, non di qui.
assert.equal(avvisoScadenza("2026-05-15", 12, ""), null);
assert.equal(avvisoScadenza("", 12, "2027-05-15"), null);
// Il clamp di fine mese vale anche qui: 31/01 + 1 mese = 28/02, non 03/03.
// Se l'avviso non usasse addMonths, contraddirebbe la scadenza che l'app scrive.
assert.equal(avvisoScadenza("2026-01-31", 1, "2026-02-28"), null);
assert.ok(avvisoScadenza("2026-01-31", 1, "2026-03-03"));

// ============================================================
// calcolaCariche / caricheScoperte (1.2) — l'azienda non deve scoprirsi senza
// accorgersene. Cessare l'unico addetto antincendio MIGLIORA il cruscotto:
// e' l'unico caso in cui un numero che sale e' una cattiva notizia.
// ============================================================
const RUOLI_C = [
  { id: "anti", nome: "Addetto antincendio", tipo: "incarico", minimo_richiesto: 3 },
  { id: "rls",  nome: "RLS",                 tipo: "incarico", minimo_richiesto: 1 },
  { id: "jolly", nome: "Incarico senza minimo", tipo: "incarico", minimo_richiesto: 0 },
  { id: "oper", nome: "Operatore",           tipo: "mansione",  minimo_richiesto: 0 },
];
const DIP_C = [
  { id: "d1", nome: "Anna",  cognome: "Rossi",  attivo: true },
  { id: "d2", nome: "Bruno", cognome: "Bianchi", attivo: true },
  { id: "d3", nome: "Carla", cognome: "Verdi",  attivo: true },
  { id: "d4", nome: "Dario", cognome: "Neri",   attivo: false },  // cessato
];
const dr = (id, dip, ruolo, extra = {}) => ({ id, dipendente_id: dip, ruolo_id: ruolo, ...extra });
const cariche = (dipRuoli, dipendenti = DIP_C) => calcolaCariche({ ruoli: RUOLI_C, dipRuoli, dipendenti });
const perId = (lista, id) => lista.find((c) => c.ruolo.id === id);

// assegnazioneAttiva: prima di 1.5 la colonna `al` non esiste, e le righe vecchie
// devono restare attive.
assert.equal(assegnazioneAttiva({ id: "x" }), true);
assert.equal(assegnazioneAttiva({ id: "x", al: null }), true);
assert.equal(assegnazioneAttiva({ id: "x", al: "2026-01-01" }), false);
assert.equal(assegnazioneAttiva(null), false);

// Tre nominati su tre: in regola. L'incarico con minimo 0 non compare affatto,
// e nemmeno le mansioni.
let c = cariche([dr("a1", "d1", "anti"), dr("a2", "d2", "anti"), dr("a3", "d3", "anti"),
                 dr("j1", "d1", "jolly"), dr("m1", "d1", "oper")]);
assert.equal(c.length, 2);                       // anti + rls, non jolly, non oper
assert.equal(perId(c, "anti").nominati.length, 3);
assert.equal(perId(c, "anti").sottoSoglia, false); // esattamente al minimo = in regola
assert.equal(perId(c, "rls").sottoSoglia, true);   // nessun RLS nominato

// Un CESSATO non conta, anche se la riga di assegnazione c'e' ancora.
c = cariche([dr("a1", "d1", "anti"), dr("a2", "d2", "anti"), dr("a3", "d4", "anti")]);
assert.equal(perId(c, "anti").nominati.length, 2);
assert.equal(perId(c, "anti").sottoSoglia, true);

// Un incarico REVOCATO non conta: e' la trappola della 1.5. Se questo filtro
// sparisse, un preposto revocato continuerebbe a coprire il minimo e il
// cruscotto direbbe "in regola" senza che nessuno lo sia.
c = cariche([dr("a1", "d1", "anti"), dr("a2", "d2", "anti"),
             dr("a3", "d3", "anti", { al: "2026-08-31" })]);
assert.equal(perId(c, "anti").nominati.length, 2);

// caricheScoperte: da 3/3 a 2/3 si segnala.
const tutti = [dr("a1", "d1", "anti"), dr("a2", "d2", "anti"), dr("a3", "d3", "anti")];
let scoperte = caricheScoperte(cariche(tutti),
  cariche(tutti, DIP_C.map((d) => (d.id === "d3" ? { ...d, attivo: false } : d))));
assert.equal(scoperte.length, 1);
assert.equal(scoperte[0].ruolo.id, "anti");
assert.equal(scoperte[0].prima, 3);
assert.equal(scoperte[0].dopo, 2);

// Da 3/3 a 2/3 per REVOCA (non per cessazione): stesso avviso.
scoperte = caricheScoperte(cariche(tutti),
  cariche([tutti[0], tutti[1], { ...tutti[2], al: "2026-09-02" }]));
assert.equal(scoperte.length, 1);

// Scende ma resta sopra il minimo: nessun avviso (RLS minimo 1, da 2 a 1).
const dueRls = [dr("r1", "d1", "rls"), dr("r2", "d2", "rls")];
assert.equal(caricheScoperte(cariche(dueRls), cariche([dueRls[0]])).length, 0);

// Era gia' scoperta e peggiora ancora: si segnala (2/3 -> 1/3).
const dueAnti = [dr("a1", "d1", "anti"), dr("a2", "d2", "anti")];
assert.equal(caricheScoperte(cariche(dueAnti), cariche([dueAnti[0]])).length, 1);

// Niente cambia: niente da dire.
assert.equal(caricheScoperte(cariche(tutti), cariche(tutti)).length, 0);

// ============================================================
// ricalcolaScadenze (1.3) — cambiare una validita' in matrice non deve
// riscrivere la data che ha messo il medico, ne' inventarne una dove non c'e'.
// ============================================================
const riga = (o = {}) => ({ id: "a1", data_rilascio: "2026-05-15", data_scadenza: "2027-05-15",
                            validitaVecchia: 12, validitaNuova: 24, ...o });

// Registrata e coerente col vecchio calcolo: si aggiorna.
let ric = ricalcolaScadenze([riga()]);
assert.equal(ric.length, 1);
assert.equal(ric[0].data_scadenza, "2028-05-15");

// Mai registrata: niente da ricalcolare (la sua scadenza e' quella dell'onboarding).
assert.equal(ricalcolaScadenze([riga({ data_rilascio: null, data_scadenza: "2026-07-01" })]).length, 0);

// Corretta a mano (1.1): la data del medico non si tocca.
assert.equal(ricalcolaScadenze([riga({ data_scadenza: "2026-11-15" })]).length, 0);

// Da "12 mesi" a "non scade": la scadenza si azzera.
ric = ricalcolaScadenze([riga({ validitaNuova: null })]);
assert.equal(ric.length, 1);
assert.equal(ric[0].data_scadenza, null);

// Da "non scade" a "24 mesi": la riga senza scadenza ne prende una.
ric = ricalcolaScadenze([riga({ data_scadenza: null, validitaVecchia: null, validitaNuova: 24 })]);
assert.equal(ric.length, 1);
assert.equal(ric[0].data_scadenza, "2028-05-15");

// Stessa validita': niente da fare.
assert.equal(ricalcolaScadenze([riga({ validitaNuova: 12 })]).length, 0);
assert.equal(ricalcolaScadenze([]).length, 0);
assert.equal(ricalcolaScadenze(null).length, 0);

// Il clamp vale anche qui: rilascio 31/01, da 1 a 2 mesi.
ric = ricalcolaScadenze([{ id: "a2", data_rilascio: "2026-01-31", data_scadenza: "2026-02-28",
                           validitaVecchia: 1, validitaNuova: 2 }]);
assert.equal(ric[0].data_scadenza, "2026-03-31");

// ============================================================
// righeContrattuali (1.7) — fine prova e fine contratto non comparivano in
// nessuna vista. Un contratto a termine che scade inosservato si trasforma per
// legge, e una prova che scade senza decisione conferma l'assunzione.
// ============================================================
const dipC = (o = {}) => ({ id: "dc", nome: "Ada", cognome: "Bianchi", attivo: true, ...o });

// Nessuna data: nessuna riga.
assert.equal(righeContrattuali(dipC()).length, 0);
assert.equal(righeContrattuali(null).length, 0);

// Solo la fine prova.
let rc = righeContrattuali(dipC({ data_fine_prova: iso(20) }));
assert.equal(rc.length, 1);
assert.equal(rc[0].campo, "data_fine_prova");
assert.equal(rc[0].etichetta, "Fine periodo di prova");
assert.equal(rc[0].stato, "in_scadenza");        // entro GG_SCAD

// Solo la fine contratto, lontana: compare, ma in regola.
rc = righeContrattuali(dipC({ data_fine_contratto: iso(200) }));
assert.equal(rc.length, 1);
assert.equal(rc[0].stato, "ok");

// Tutte e due.
assert.equal(righeContrattuali(dipC({ data_fine_prova: iso(5), data_fine_contratto: iso(300) })).length, 2);

// Scaduta da poco: si vede ancora, ed e' rossa.
rc = righeContrattuali(dipC({ data_fine_contratto: iso(-10) }));
assert.equal(rc.length, 1);
assert.equal(rc[0].stato, "scaduto");

// Il confine esatto e' incluso, un giorno oltre no.
assert.equal(righeContrattuali(dipC({ data_fine_contratto: iso(-GG_SCAD) })).length, 1);
assert.equal(righeContrattuali(dipC({ data_fine_contratto: iso(-GG_SCAD - 1) })).length, 0);

// Un cessato non ha piu' scadenze contrattuali da sorvegliare.
assert.equal(righeContrattuali(dipC({ attivo: false, data_fine_contratto: iso(10) })).length, 0);

// ============================================================
// calcolaGap — il nucleo: cosa deve avere una persona e come sta messa.
// ============================================================
const TIPI = new Map([
  ["t-gen",  { id: "t-gen",  nome: "Sicurezza generale lavoratori" }],
  ["t-idon", { id: "t-idon", nome: "Idoneita' sanitaria" }],
]);
const trovaTipo = (id) => TIPI.get(id) || null;
const req = (o) => ({ ruolo_id: "r1", tipo_requisito_id: "t-gen", obbligatorio: true, validita_mesi: null, ...o });
const adm = (o) => ({ dipendente_id: "d1", tipo_requisito_id: "t-gen", data_rilascio: null, data_scadenza: null, ...o });
const gap = ({ dip = { id: "d1" }, ruoli = ["r1"], requisiti = [req()], adempimenti = [] } = {}) =>
  calcolaGap({ dip, ruoloIds: new Set(ruoli), requisiti, adempimenti, trovaTipo });

// Obbligo mai registrato: scaduto, e l'adempimento non esiste. Mai "ok".
let r = gap();
assert.equal(r.length, 1);
assert.equal(r[0].stato, "scaduto");
assert.equal(r[0].adempimento, null);

// Neoassunto: la scadenza implicita e' assunzione + GG_ONBOARD.
r = gap({ dip: { id: "d1", data_assunzione: iso(-10) } });
assert.equal(r[0].scadenza, iso(-10 + GG_ONBOARD));
assert.equal(r[0].stato, "in_scadenza");

// Registrato e lontano dalla soglia.
r = gap({ adempimenti: [adm({ data_rilascio: iso(-30), data_scadenza: iso(GG_SCAD + 10) })] });
assert.equal(r[0].stato, "ok");

// Registrato ma dentro la soglia dei 60 giorni.
r = gap({ adempimenti: [adm({ data_rilascio: iso(-30), data_scadenza: iso(10) })] });
assert.equal(r[0].stato, "in_scadenza");

// Registrato e senza scadenza (credito permanente, es. formazione generale).
r = gap({ adempimenti: [adm({ data_rilascio: iso(-800), data_scadenza: null })] });
assert.equal(r[0].stato, "ok");

// IL CASO CHE CONTA: un ciclo SUPERATO non copre nulla. Un attestato del 2018
// caricato come prova storica non deve far sembrare coperto un obbligo scoperto.
r = gap({ adempimenti: [adm({ data_rilascio: iso(-3000), data_scadenza: iso(-1000), corrente: false })] });
assert.equal(r[0].stato, "scaduto");
assert.equal(r[0].adempimento, null);

// Requisito non obbligatorio: il motore lo scarta. E' la ragione per cui le voci
// "SE PREVISTO" del catalogo sono diventate incarichi e non regole facoltative:
// come regole facoltative sarebbero state invisibili.
assert.equal(gap({ requisiti: [req({ obbligatorio: false })] }).length, 0);

// Requisito di un ruolo che la persona non ha.
assert.equal(gap({ ruoli: ["r2"] }).length, 0);

// Tipo non presente in catalogo: la riga si salta, non si crasha.
assert.equal(gap({ requisiti: [req({ tipo_requisito_id: "t-mai-esistito" })] }).length, 0);

// Dedup per tipo: due ruoli chiedono lo stesso corso, vince la validita' piu' stringente.
r = gap({ ruoli: ["r1", "r2"], requisiti: [req({ validita_mesi: 60 }), req({ ruolo_id: "r2", validita_mesi: 24 })] });
assert.equal(r.length, 1);
assert.equal(r[0].req.validita_mesi, 24);

// Dedup: "non scade" (null) e' la meno stringente di tutte, non la piu'.
r = gap({ ruoli: ["r1", "r2"], requisiti: [req({ validita_mesi: null }), req({ ruolo_id: "r2", validita_mesi: 60 })] });
assert.equal(r[0].req.validita_mesi, 60);

// Due cicli correnti per lo stesso tipo: vince quello con la scadenza piu' lontana.
r = gap({ adempimenti: [
  adm({ data_rilascio: iso(-400), data_scadenza: iso(-40) }),
  adm({ data_rilascio: iso(-40),  data_scadenza: iso(300) }),
] });
assert.equal(r[0].scadenza, iso(300));
assert.equal(r[0].stato, "ok");

// Requisiti diversi = righe diverse.
assert.equal(gap({ requisiti: [req(), req({ tipo_requisito_id: "t-idon", validita_mesi: 12 })] }).length, 2);

// Gli adempimenti di un'altra persona non contano.
r = gap({ adempimenti: [adm({ dipendente_id: "d2", data_rilascio: iso(-10), data_scadenza: iso(900) })] });
assert.equal(r[0].stato, "scaduto");

console.log("OK tutti i test common.js");
