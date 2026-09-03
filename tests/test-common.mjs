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

const { classificaStato, calcolaGap, avvisoScadenza, raggruppaGapPerTipo,
        statoAdempimentoAzienda, prossimaEsecuzioneAzienda, coperturaCompetenze,
        conteggioColloquiAnno, scadenzaConservazioneCandidatura, candidatureDaCancellare,
        CARTELLE_FASCICOLO, nomeFileSicuro, nomeFascicolo, nomeDocumentoFascicolo,
        nomeUnicoNellaCartella,
        assegnazioneAttiva, calcolaCariche, caricheScoperte, ricalcolaScadenze,
        righeContrattuali,
        isDatoDiProva, isDipendenteDiCollaudo, dipendentiDiProva, NOTA_DATI_PROVA,
        scadenzaOnboardingItem, itemsOnboardingDaSincronizzare, incarichiDaRevocare,
        parametroInt,
        normalizzaPeriodoCedolino, linkCedolinoDaRinnovare, cedoliniDaRinnovare,
        contieneDelimitato, abbinaCedoliniPerMatricola, inForzaNelMese, inForzaNellAnno, conteggioCedoliniDelMese,
        grigliaScambi, scambiMancanti,
        giorniDiEvento, contaGiorniEvento, eventiDelMese, richiesteDaApprovare,
        promemoriaInail, validaRichiesta, conteggioComporto, saldoDichiarato,
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
// ============================================================
// 5 · Il terzo argomento "oggi" di daysUntil e classificaStato.
// Serve ai test delle regole nuove della Fase 5, che altrimenti dipenderebbero
// dal giorno in cui girano. Qui si prova che NON cambia niente per chi non lo
// passa: e' la stessa regola, resa provabile.
// ============================================================
const oggiVero = localISO(new Date());
assert.equal(daysUntil("2026-11-30", "2026-11-20"), 10);
assert.equal(daysUntil("2026-11-30", "2026-12-01"), -1);
assert.equal(daysUntil("2026-11-30", "2026-11-30"), 0);
// Senza il terzo argomento si legge la data vera, esattamente come prima.
assert.equal(daysUntil("2026-11-30"), daysUntil("2026-11-30", oggiVero));
// Una data di riferimento illeggibile non diventa "oggi": diventa null.
assert.equal(daysUntil("2026-11-30", "non-una-data"), null);
// classificaStato: passare la data vera da' lo stesso risultato che non passarla.
for (const gg of [-5, 0, 10, GG_SCAD, GG_SCAD + 1]) {
  assert.equal(classificaStato(true, iso(gg)), classificaStato(true, iso(gg), oggiVero));
  assert.equal(classificaStato(false, iso(gg)), classificaStato(false, iso(gg), oggiVero));
}
// E con una data fissata risponde su quella, non su oggi.
assert.equal(classificaStato(true, "2026-11-30", "2026-01-01"), "ok");            // lontano
assert.equal(classificaStato(true, "2026-11-30", "2026-10-01"), "in_scadenza");   // dentro i 60gg
assert.equal(classificaStato(true, "2026-11-30", "2026-12-01"), "scaduto");
assert.equal(classificaStato(false, "2026-11-30", "2026-01-01"), "in_scadenza");  // mai "ok"

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

// ============================================================
// 1c · isDatoDiProva / dipendentiDiProva
// Questo test protegge una cosa sola, ma grossa: il bottone "Elimina i dati di
// prova" cancella otto persone in un colpo, con tutti i loro documenti. Se il
// riconoscimento fosse largo, cancellerebbe una persona vera.
// ============================================================
const NOTA_COLLAUDO = "FAC-SIMILE di collaudo: stessa persona di esempio dell'archivio 11_Personale.";

// Riconosciuti: la nota esatta, oppure l'id che lo script assegna.
assert.equal(isDatoDiProva({ id: "dip-prova-01", note: NOTA_DATI_PROVA }), true);
assert.equal(isDatoDiProva({ id: "9e1c-uuid-vero", note: NOTA_DATI_PROVA }), true);
// Il caso per cui l'id esiste: l'HR si esercita sulla scheda e riscrive la nota.
assert.equal(isDatoDiProva({ id: "dip-prova-01", note: "visita prenotata per lunedi" }), true);
assert.equal(isDatoDiProva({ id: "dip-prova-08", note: null }), true);

// NON riconosciuti. Il dipendente di collaudo per primo: e' l'unica persona che
// il bottone non deve toccare mai.
assert.equal(isDatoDiProva({ id: "71cf86f3-3c44-4f87", note: NOTA_COLLAUDO }), false);
// "Contiene" non basta: il confronto sulla nota e' esatto.
assert.equal(isDatoDiProva({ id: "u1", note: "attenzione: DATI DI PROVA vecchi da rivedere" }), false);
assert.equal(isDatoDiProva({ id: "u1", note: "dati di prova" }), false);   // minuscolo: altra cosa
assert.equal(isDatoDiProva({ id: "u1", note: " DATI DI PROVA" }), false);  // spazio davanti: altra cosa
// Un uuid vero non assomiglia mai al prefisso, comunque lo si guardi.
assert.equal(isDatoDiProva({ id: "dipendente-prova-01", note: null }), false);
assert.equal(isDatoDiProva({ id: "71cf86f3-3c44-4f87-892b-7c2e28f63f9b", note: null }), false);
// Input degeneri: non deve esplodere e non deve dire di si'.
assert.equal(isDatoDiProva({ id: "u1" }), false);
assert.equal(isDatoDiProva({ note: null, id: null }), false);
assert.equal(isDatoDiProva({}), false);
assert.equal(isDatoDiProva(null), false);
assert.equal(isDatoDiProva(undefined), false);

// isDipendenteDiCollaudo — la persona che il bottone non deve toccare mai.
// Qui il confronto e' "contiene", perche' la nota vera e' una frase intera.
assert.equal(isDipendenteDiCollaudo({ note: NOTA_COLLAUDO }), true);
assert.equal(isDipendenteDiCollaudo({ note: "dipendente di COLLAUDO, non cancellare" }), true);
assert.equal(isDipendenteDiCollaudo({ note: "Fac-Simile" }), true);        // maiuscole indifferenti
assert.equal(isDipendenteDiCollaudo({ note: NOTA_DATI_PROVA }), false);
assert.equal(isDipendenteDiCollaudo({ note: "Assunto tramite agenzia" }), false);
assert.equal(isDipendenteDiCollaudo({ note: null }), false);
assert.equal(isDipendenteDiCollaudo({}), false);
assert.equal(isDipendenteDiCollaudo(null), false);

// dipendentiDiProva: le finte MENO quella di collaudo, e su niente non esplode.
const misti = [
  { id: "dip-prova-01", note: NOTA_DATI_PROVA },
  { id: "71cf86f3", note: NOTA_COLLAUDO },
  { id: "abc", note: "Assunto tramite agenzia" },
  { id: "dip-prova-05", note: "nota riscritta dall'HR" },
];
assert.deepEqual(dipendentiDiProva(misti).map((d) => d.id), ["dip-prova-01", "dip-prova-05"]);
// Le due guardie insieme: anche se qualcuno scrivesse la nota dei dati di prova
// sulla scheda del dipendente di collaudo, o gli desse un id dip-prova-*, il
// bottone continuerebbe a saltarlo. E' l'unico caso in cui vince il "contiene".
assert.deepEqual(dipendentiDiProva([{ id: "71cf86f3", note: NOTA_DATI_PROVA + " (collaudo)" }]), []);
assert.deepEqual(dipendentiDiProva([{ id: "dip-prova-01", note: "FAC-SIMILE di collaudo" }]), []);
assert.deepEqual(dipendentiDiProva([]), []);
assert.deepEqual(dipendentiDiProva(undefined), []);
assert.deepEqual(dipendentiDiProva(null), []);

// ============================================================
// 2.1 · Checklist di ingresso e di uscita
// ============================================================

// --- scadenzaOnboardingItem: da quale data si contano i giorni ---
const dipEntrato = { data_assunzione: "2015-03-10", data_cessazione: null, attivo: true };
const dipUscito  = { data_assunzione: "2015-03-10", data_cessazione: "2026-07-29", attivo: false };

// Voce d'ingresso: si conta dall'assunzione. (Nessuna `fase` = ingresso, come le
// otto voci lette prima della migrazione.)
assert.equal(scadenzaOnboardingItem(dipEntrato, { giorni_da_assunzione: 30 }), "2015-04-09");
assert.equal(scadenzaOnboardingItem(dipEntrato, { fase: "ingresso", giorni_da_assunzione: 0 }), "2015-03-10");

// Voce d'uscita: si conta dalla CESSAZIONE. E' il difetto che il piano descrive:
// contandola dall'assunzione, l'UNILAV di chi esce oggi risulterebbe da fare nel
// 2015, cioe' "scaduto da anni" per tutti.
assert.equal(scadenzaOnboardingItem(dipUscito, { fase: "uscita", giorni_da_assunzione: 5 }), "2026-08-03");
assert.notEqual(scadenzaOnboardingItem(dipUscito, { fase: "uscita", giorni_da_assunzione: 5 }),
                scadenzaOnboardingItem(dipUscito, { fase: "ingresso", giorni_da_assunzione: 5 }));

// Giorni NEGATIVI: la lettera di dimissioni arriva prima dell'ultimo giorno.
// Il campo Giorni ha perso min="0" apposta. Qui si torna anche al mese prima.
assert.equal(scadenzaOnboardingItem(dipUscito, { fase: "uscita", giorni_da_assunzione: -7 }), "2026-07-22");
assert.equal(scadenzaOnboardingItem({ data_cessazione: "2026-03-05", attivo: false },
                                    { fase: "uscita", giorni_da_assunzione: -10 }), "2026-02-23");

// Manca la data di base: nessun termine. NON si ripiega sull'altra data.
assert.equal(scadenzaOnboardingItem({ data_assunzione: "2015-03-10", data_cessazione: null },
                                    { fase: "uscita", giorni_da_assunzione: 5 }), null);
assert.equal(scadenzaOnboardingItem({ data_assunzione: null }, { giorni_da_assunzione: 30 }), null);
// Voce senza giorni, e input degeneri.
assert.equal(scadenzaOnboardingItem(dipUscito, { fase: "uscita", giorni_da_assunzione: null }), null);
assert.equal(scadenzaOnboardingItem(dipUscito, {}), null);
assert.equal(scadenzaOnboardingItem(null, { giorni_da_assunzione: 0 }), null);
assert.equal(scadenzaOnboardingItem(dipUscito, null), null);

// --- itemsOnboardingDaSincronizzare: quali righe nascono, e per chi ---
const vociCatalogo = [
  { id: "onb-contratto",     fase: "ingresso", tipo_workflow: "genera_pdf_template" },
  { id: "onb-badge",         fase: "ingresso", tipo_workflow: "dati_specifici" },
  { id: "onb-visita",        fase: "ingresso", tipo_workflow: "crea_adempimento" },
  { id: "onb-usc-unilav",    fase: "uscita",   tipo_workflow: "semplice" },
  { id: "onb-usc-riconsegna",fase: "uscita",   tipo_workflow: "semplice" },
];
const ids = (arr) => arr.map((x) => x.id);

// In forza: solo ingresso. Le voci d'uscita non esistono finche' la persona c'e'.
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: { attivo: true }, items: vociCatalogo, itemIdEsistenti: [] })),
  ["onb-contratto", "onb-badge"]);
// `attivo` assente (riga vecchia) vale "in forza": e' come si comporta oggi.
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: {}, items: vociCatalogo, itemIdEsistenti: [] })),
  ["onb-contratto", "onb-badge"]);

// Cessato CON data: solo uscita, e NESSUNA voce d'ingresso in piu' (difetto n. 3
// del §2 del piano: i progressi continuavano a generarsi anche per i cessati).
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: { attivo: false, data_cessazione: "2026-07-29" },
                                       items: vociCatalogo, itemIdEsistenti: [] })),
  ["onb-usc-unilav", "onb-usc-riconsegna"]);

// Cessato SENZA data: niente. Sette termini calcolati sul nulla sarebbero falsi.
assert.deepEqual(
  itemsOnboardingDaSincronizzare({ dip: { attivo: false, data_cessazione: null },
                                   items: vociCatalogo, itemIdEsistenti: [] }), []);

// Le voci "crea_adempimento" non hanno mai un progresso proprio.
assert.equal(ids(itemsOnboardingDaSincronizzare({ dip: { attivo: true }, items: vociCatalogo, itemIdEsistenti: [] }))
  .includes("onb-visita"), false);

// Le righe gia' esistenti non si ricreano (Set o array indifferente).
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: { attivo: true }, items: vociCatalogo,
                                       itemIdEsistenti: new Set(["onb-contratto"]) })),
  ["onb-badge"]);
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: { attivo: true }, items: vociCatalogo,
                                       itemIdEsistenti: ["onb-contratto", "onb-badge"] })), []);

// Voce SENZA `fase` (letta prima della migrazione): conta come ingresso.
assert.deepEqual(
  ids(itemsOnboardingDaSincronizzare({ dip: { attivo: true },
                                       items: [{ id: "onb-vecchia", tipo_workflow: "semplice" }],
                                       itemIdEsistenti: [] })), ["onb-vecchia"]);
assert.deepEqual(
  itemsOnboardingDaSincronizzare({ dip: { attivo: false, data_cessazione: "2026-07-29" },
                                   items: [{ id: "onb-vecchia", tipo_workflow: "semplice" }],
                                   itemIdEsistenti: [] }), []);

// Input degeneri.
assert.deepEqual(itemsOnboardingDaSincronizzare({ dip: null, items: vociCatalogo, itemIdEsistenti: [] }), []);
assert.deepEqual(itemsOnboardingDaSincronizzare({ dip: { attivo: true }, items: null }), []);

// --- incarichiDaRevocare: cosa si propone di chiudere alla cessazione ---
const ruoliCat = [
  { id: "ruolo-man-uff", tipo: "mansione" },
  { id: "ruolo-antinc",  tipo: "incarico" },
  { id: "ruolo-rls",     tipo: "incarico" },
];
const assegnazioni = [
  { id: "dr1", dipendente_id: "d1", ruolo_id: "ruolo-man-uff", al: null },   // mansione attiva
  { id: "dr2", dipendente_id: "d1", ruolo_id: "ruolo-antinc",  al: null },   // incarico attivo
  { id: "dr3", dipendente_id: "d1", ruolo_id: "ruolo-rls",     al: "2026-06-01" }, // gia' revocato
  { id: "dr4", dipendente_id: "d2", ruolo_id: "ruolo-antinc",  al: null },   // un'altra persona
  { id: "dr5", dipendente_id: "d1", ruolo_id: "ruolo-sparito", al: null },   // ruolo non in catalogo
];
// Solo l'incarico attivo di quella persona: MAI la mansione (chiuderla renderebbe
// la scheda del cessato non piu' salvabile, perche' il campo e' required).
assert.deepEqual(
  incarichiDaRevocare({ dipRuoli: assegnazioni, ruoli: ruoliCat, dipId: "d1" }).map((a) => a.id),
  ["dr2"]);
assert.deepEqual(
  incarichiDaRevocare({ dipRuoli: assegnazioni, ruoli: ruoliCat, dipId: "d2" }).map((a) => a.id),
  ["dr4"]);
assert.deepEqual(incarichiDaRevocare({ dipRuoli: assegnazioni, ruoli: ruoliCat, dipId: "ignoto" }), []);
assert.deepEqual(incarichiDaRevocare({ dipRuoli: [], ruoli: ruoliCat, dipId: "d1" }), []);
assert.deepEqual(incarichiDaRevocare({ dipRuoli: null, ruoli: null, dipId: "d1" }), []);

// ============================================================
// 3.1 · parametroInt — la lettura di un parametro con ripiego.
// I parametri li scrive l'HR a mano da Configurazione: un valore sbagliato non
// deve diventare NaN nel calcolo della durata dei link, deve tornare al ripiego.
// ============================================================
const par = [
  { chiave: "portale_giorni_link", valore: "365" },
  { chiave: "cedolino_giorni_link", valore: " 396 " },   // spazi intorno: si accettano
  { chiave: "vuoto", valore: "" },
  { chiave: "parole", valore: "trecento" },
  { chiave: "misto", valore: "365 giorni" },
  { chiave: "decimale", valore: "12.9" },
  { chiave: "negativo", valore: "-7" },
  { chiave: "nullo", valore: null },
];
assert.equal(parametroInt(par, "portale_giorni_link", 30), 365);
assert.equal(parametroInt(par, "cedolino_giorni_link", 30), 396);
assert.equal(parametroInt(par, "assente", 30), 30);          // chiave che non c'e'
assert.equal(parametroInt(par, "vuoto", 30), 30);
assert.equal(parametroInt(par, "parole", 30), 30);
assert.equal(parametroInt(par, "misto", 30), 30);            // NON 365: "365 giorni" non e' un intero
assert.equal(parametroInt(par, "decimale", 30), 30);         // niente decimali: troncare o arrotondare sarebbe una scelta nascosta
assert.equal(parametroInt(par, "negativo", 30), -7);         // un intero negativo e' un intero
assert.equal(parametroInt(par, "nullo", 30), 30);
assert.equal(parametroInt([], "portale_giorni_link", 30), 30);
assert.equal(parametroInt(null, "portale_giorni_link", 30), 30);
assert.equal(parametroInt(undefined, "x", 365), 365);

// ============================================================
// 3.2 · Cedolini.
// ============================================================

// --- normalizzaPeriodoCedolino: il mese non e' libero ---
assert.deepEqual(normalizzaPeriodoCedolino({ anno: 2026, mese: 7, tipo: "mensile" }),
  { anno: 2026, mese: 7, tipo: "mensile" });
// La tredicesima e' SEMPRE il mese 13, qualunque cosa arrivi dalla tendina:
// senza, esisterebbero una "tredicesima di marzo" e una "tredicesima di dicembre"
// per la stessa persona, e l'unicita' non se ne accorgerebbe.
assert.deepEqual(normalizzaPeriodoCedolino({ anno: 2026, mese: 3, tipo: "tredicesima" }),
  { anno: 2026, mese: 13, tipo: "tredicesima" });
assert.deepEqual(normalizzaPeriodoCedolino({ anno: 2026, mese: 9, tipo: "cu" }),
  { anno: 2026, mese: 0, tipo: "cu" });
// anno e mese arrivano da <input>/<select>: sono stringhe, devono uscire numeri.
assert.deepEqual(normalizzaPeriodoCedolino({ anno: "2026", mese: "7", tipo: "mensile" }),
  { anno: 2026, mese: 7, tipo: "mensile" });
assert.deepEqual(normalizzaPeriodoCedolino({ anno: 2026, mese: 5 }),
  { anno: 2026, mese: 5, tipo: "mensile" });

// --- linkCedolinoDaRinnovare ---
const fraGiorniLink = (n) => localISO(addDays(new Date(), n)) + "T10:00:00+00:00";
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: fraGiorniLink(200) }, 30), false);
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: fraGiorniLink(31) }, 30), false);
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: fraGiorniLink(30) }, 30), true);  // alla soglia: dentro
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: fraGiorniLink(-1) }, 30), true);  // gia' scaduto
// Senza link, o senza sapere quando scade: da rinnovare. Una riga che non si sa
// se funziona non e' una riga a posto.
assert.equal(linkCedolinoDaRinnovare({ url_firmato: null, url_scade_il: fraGiorniLink(200) }, 30), true);
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: null }, 30), true);
assert.equal(linkCedolinoDaRinnovare({ url_firmato: "https://x", url_scade_il: "non-una-data" }, 30), true);
assert.equal(linkCedolinoDaRinnovare(null, 30), false);

// --- cedoliniDaRinnovare: il numero sul bottone E l'elenco che si rinnova ---
const cedRinnovo = [
  { id: "c1", url_firmato: "https://x", url_scade_il: fraGiorniLink(200) },
  { id: "c2", url_firmato: "https://x", url_scade_il: fraGiorniLink(5) },
  { id: "c3", url_firmato: null,        url_scade_il: null },
];
assert.deepEqual(cedoliniDaRinnovare(cedRinnovo, 30).map((c) => c.id), ["c2", "c3"]);
assert.deepEqual(cedoliniDaRinnovare([], 30), []);
assert.deepEqual(cedoliniDaRinnovare(null, 30), []);

// I CESSATI restano fuori. Alla cessazione il collegamento dei loro cedolini
// viene spento apposta: contandoli, il badge mostrerebbe per sempre un numero che
// non si spegne, e "Rinnova i link" rifirmerebbe proprio quello che la cessazione
// aveva chiuso — un bottone che disfa quello che ne fa un altro.
const cedDiCessati = [
  { id: "x1", dipendente_id: "d1", url_firmato: null, url_scade_il: null },
  { id: "x2", dipendente_id: "d2", url_firmato: null, url_scade_il: null },
];
const dipConCessato = [{ id: "d1", attivo: true }, { id: "d2", attivo: false }];
assert.deepEqual(cedoliniDaRinnovare(cedDiCessati, 30, dipConCessato).map((c) => c.id), ["x1"]);
// Senza l'elenco delle persone il filtro non si applica: la firma resta compatibile.
assert.deepEqual(cedoliniDaRinnovare(cedDiCessati, 30).map((c) => c.id), ["x1", "x2"]);
assert.deepEqual(cedoliniDaRinnovare(cedDiCessati, 30, []).map((c) => c.id), ["x1", "x2"]);

// --- inForzaNellAnno: tredicesima e CU sono dell'ANNO, non di un mese ---
// La CU del 2026 spetta anche a chi se n'e' andato a luglio: con "chi era in
// forza a dicembre" quella persona non comparirebbe nella modale, e la modale e'
// l'unico posto da cui si caricano i cedolini.
assert.equal(inForzaNellAnno({ attivo: false, data_assunzione: "2015-01-01", data_cessazione: "2026-07-29" }, 2026), true);
assert.equal(inForzaNellAnno({ attivo: false, data_assunzione: "2015-01-01", data_cessazione: "2025-07-29" }, 2026), false);
assert.equal(inForzaNellAnno({ attivo: true, data_assunzione: "2026-12-31" }, 2026), true);
assert.equal(inForzaNellAnno({ attivo: true, data_assunzione: "2027-01-01" }, 2026), false);
assert.equal(inForzaNellAnno({ attivo: false }, 2026), false);   // cessato senza data
assert.equal(inForzaNellAnno(null, 2026), false);

// --- contieneDelimitato: la regola sotto l'abbinamento ---
assert.equal(contieneDelimitato("004_2026-07.pdf", "004"), true);
assert.equal(contieneDelimitato("cedolino-004.pdf", "004"), true);
assert.equal(contieneDelimitato("004", "004"), true);
// I due casi che il piano teme: una matricola corta che pesca dentro un numero piu' lungo.
assert.equal(contieneDelimitato("1004_2026-07.pdf", "004"), false);
assert.equal(contieneDelimitato("PROVA-01_luglio.pdf", "1"), false);
assert.equal(contieneDelimitato("PROVA-012_luglio.pdf", "PROVA-01"), false);
// Il trattino e' un delimitatore, quindi "01" dentro "PROVA-01" corrisponde: e'
// voluto, ed e' la ragione per cui due persone che corrispondono allo stesso
// file rendono il file ambiguo invece di sceglierne una.
assert.equal(contieneDelimitato("PROVA-01_luglio.pdf", "01"), true);
assert.equal(contieneDelimitato("prova-01.pdf", "PROVA-01"), true);   // maiuscole/minuscole indifferenti
assert.equal(contieneDelimitato("qualsiasi.pdf", ""), false);

// --- abbinaCedoliniPerMatricola ---
const personeMatricola = [
  { id: "d1", matricola: "001" },
  { id: "d2", matricola: "002" },
  { id: "d3", matricola: "PROVA-01" },
  { id: "d4", matricola: "   " },   // matricola vuota: non abbina mai
  { id: "d5" },                     // senza matricola
];
let abb = abbinaCedoliniPerMatricola(["001_luglio.pdf", "002_luglio.pdf", "sconosciuto.pdf"], personeMatricola);
assert.deepEqual(abb.abbinati, [
  { nomeFile: "001_luglio.pdf", dipendenteId: "d1" },
  { nomeFile: "002_luglio.pdf", dipendenteId: "d2" },
]);
assert.deepEqual(abb.ambigui, []);
assert.deepEqual(abb.nonAbbinati, ["sconosciuto.pdf"]);

// Un file che corrisponde a DUE persone non si assegna a nessuna.
abb = abbinaCedoliniPerMatricola(["001-002-insieme.pdf"], personeMatricola);
assert.deepEqual(abb.abbinati, []);
assert.deepEqual(abb.ambigui, ["001-002-insieme.pdf"]);

// DUE file per la stessa persona: ambigui TUTTI E DUE, non "vince l'ultimo".
// E' il caso che consegnerebbe in silenzio il cedolino sbagliato.
abb = abbinaCedoliniPerMatricola(["001_luglio.pdf", "001_agosto.pdf", "002_luglio.pdf"], personeMatricola);
assert.deepEqual(abb.abbinati, [{ nomeFile: "002_luglio.pdf", dipendenteId: "d2" }]);
assert.deepEqual(abb.ambigui.slice().sort(), ["001_agosto.pdf", "001_luglio.pdf"]);

assert.deepEqual(abbinaCedoliniPerMatricola([], personeMatricola), { abbinati: [], ambigui: [], nonAbbinati: [] });
assert.deepEqual(abbinaCedoliniPerMatricola(null, null), { abbinati: [], ambigui: [], nonAbbinati: [] });

// --- inForzaNelMese: chi conta nel denominatore ---
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2020-01-01" }, 2026, 7), true);
// Assunto DOPO la fine del mese: quel mese non gli spetta.
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2026-08-01" }, 2026, 7), false);
// Assunto l'ultimo giorno del mese: un giorno basta.
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2026-07-31" }, 2026, 7), true);
// Cessato in agosto: il cedolino di luglio gli spetta ancora. E' il caso per cui
// "chi e' in forza oggi" sarebbe la regola sbagliata.
assert.equal(inForzaNelMese({ attivo: false, data_cessazione: "2026-08-15" }, 2026, 7), true);
assert.equal(inForzaNelMese({ attivo: false, data_cessazione: "2026-07-01" }, 2026, 7), true);
assert.equal(inForzaNelMese({ attivo: false, data_cessazione: "2026-06-30" }, 2026, 7), false);
// Cessato senza data: non si sa quando, non si conta (o il contatore non si spegne piu').
assert.equal(inForzaNelMese({ attivo: false }, 2026, 7), false);
// Febbraio bisestile: l'ultimo giorno e' il 29, non il 28.
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2024-02-29" }, 2024, 2), true);
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2023-03-01" }, 2023, 2), false);
assert.equal(inForzaNelMese(null, 2026, 7), false);
// I mesi "finti" dei cedolini (13 = tredicesima, 0 = CU) NON sono mesi: passandoli
// si costruirebbero date come "2026-00-01" e il confronto fra stringhe
// scarterebbe chiunque, cioe' un contatore "0 su 0" che dichiara tutto a posto.
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2020-01-01" }, 2026, 0), false);
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2020-01-01" }, 2026, 13), false);
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2020-01-01" }, 2026, null), false);
assert.equal(inForzaNelMese({ attivo: true, data_assunzione: "2020-01-01" }, 2026, "7"), true);   // stringa da un select: ok

// --- conteggioCedoliniDelMese ---
const dipCedolini = [
  { id: "d1", attivo: true,  data_assunzione: "2020-01-01" },
  { id: "d2", attivo: true,  data_assunzione: "2020-01-01" },
  { id: "d3", attivo: false, data_cessazione: "2026-08-15" },   // esce ad agosto: luglio gli spetta
  { id: "d4", attivo: true,  data_assunzione: "2026-09-01" },   // assunto dopo: non conta
];
const cedCedolini = [
  { dipendente_id: "d1", anno: 2026, mese: 7,  tipo: "mensile" },
  { dipendente_id: "d3", anno: 2026, mese: 7,  tipo: "mensile" },
  { dipendente_id: "d2", anno: 2026, mese: 6,  tipo: "mensile" },      // mese diverso
  { dipendente_id: "d2", anno: 2026, mese: 13, tipo: "tredicesima" },  // tipo diverso
];
assert.deepEqual(conteggioCedoliniDelMese({ dipendenti: dipCedolini, cedolini: cedCedolini, anno: 2026, mese: 7 }),
  { presenti: 2, attesi: 3 });
assert.deepEqual(conteggioCedoliniDelMese({ dipendenti: dipCedolini, cedolini: cedCedolini, anno: 2026, mese: 6 }),
  { presenti: 1, attesi: 3 });
// Anche i numeri che arrivano come stringhe dai select devono contare.
assert.deepEqual(conteggioCedoliniDelMese({ dipendenti: dipCedolini, cedolini: cedCedolini, anno: "2026", mese: "7" }),
  { presenti: 2, attesi: 3 });
assert.deepEqual(conteggioCedoliniDelMese({ dipendenti: [], cedolini: [], anno: 2026, mese: 7 }),
  { presenti: 0, attesi: 0 });

// ============================================================
// 3.3 · grigliaScambi — un mese non ancora finito non e' "mancante".
// ============================================================
const tipiScambio = [
  { key: "lul",       label: "LUL",                direzione: "entrata", periodicita: "mensile" },
  { key: "variabili", label: "Variabili del mese", direzione: "uscita",  periodicita: "mensile" },
  { key: "cu",        label: "CU",                 direzione: "entrata", periodicita: "annuale" },
];

// Siamo il 15 luglio 2026: gennaio-giugno sono finiti, luglio no.
const gr = grigliaScambi({
  anno: 2026,
  tipi: tipiScambio,
  righe: [
    { anno: 2026, mese: 1, tipo: "lul", direzione: "entrata", data: "2026-02-10" },
    { anno: 2026, mese: 3, tipo: "lul", direzione: "entrata", data: "2026-04-10" },
    { anno: 2025, mese: 4, tipo: "lul", direzione: "entrata" },              // altro anno: ignorata
    { anno: 2026, mese: 4, tipo: "lul", direzione: "uscita" },               // direzione diversa: ignorata
  ],
  oggiISO: "2026-07-15",
});

const rigaLul = gr.find((r) => r.tipo === "lul");
assert.equal(rigaLul.celle.length, 12);
assert.equal(rigaLul.celle[0].stato, "presente");      // gennaio: c'e'
assert.equal(rigaLul.celle[1].stato, "mancante");      // febbraio: finito e non c'e'
assert.equal(rigaLul.celle[2].stato, "presente");      // marzo: c'e'
// Aprile ha una riga con la direzione SBAGLIATA: non conta, la casella manca.
assert.equal(rigaLul.celle[3].stato, "mancante");
assert.equal(rigaLul.celle[5].stato, "mancante");      // giugno: finito il 30, oggi e' il 15/07
// Luglio non e' ancora finito: NON e' mancante. E' la regola che questo test difende.
assert.equal(rigaLul.celle[6].stato, "futuro");
assert.equal(rigaLul.celle[11].stato, "futuro");       // dicembre
assert.equal(rigaLul.mancanti, 4);                     // feb, apr, mag, giu — e NON luglio
assert.deepEqual(rigaLul.celle.filter((c) => c.stato === "mancante").map((c) => c.mese),
  [2, 4, 5, 6]);

// Le voci annuali hanno UNA casella sola (mese 0) e restano "future" per tutto l'anno.
const rigaCu = gr.find((r) => r.tipo === "cu");
assert.equal(rigaCu.annuale, true);
assert.equal(rigaCu.celle.length, 1);
assert.equal(rigaCu.celle[0].mese, 0);
assert.equal(rigaCu.celle[0].stato, "futuro");
assert.equal(rigaCu.mancanti, 0);

// La riga trovata viene restituita, non solo il suo stato: la modale la apre.
assert.equal(rigaLul.celle[0].riga.data, "2026-02-10");
assert.equal(rigaLul.celle[1].riga, null);

// Un anno gia' passato: tutto quello che non c'e' e' mancante, annuali comprese.
const grVecchio = grigliaScambi({ anno: 2025, tipi: tipiScambio, righe: [], oggiISO: "2026-07-15" });
assert.equal(scambiMancanti(grVecchio), 12 + 12 + 1);

// Un anno futuro: niente e' mancante.
const grFuturo = grigliaScambi({ anno: 2027, tipi: tipiScambio, righe: [], oggiISO: "2026-07-15" });
assert.equal(scambiMancanti(grFuturo), 0);

// L'ultimo giorno del mese il mese non e' ancora finito.
const grUltimo = grigliaScambi({ anno: 2026, tipi: [tipiScambio[0]], righe: [], oggiISO: "2026-02-28" });
assert.equal(grUltimo[0].celle[1].stato, "futuro");
const grPrimo = grigliaScambi({ anno: 2026, tipi: [tipiScambio[0]], righe: [], oggiISO: "2026-03-01" });
assert.equal(grPrimo[0].celle[1].stato, "mancante");
// Febbraio bisestile: il 29 esiste, e il mese non e' finito il 28.
const grBis = grigliaScambi({ anno: 2024, tipi: [tipiScambio[0]], righe: [], oggiISO: "2024-02-29" });
assert.equal(grBis[0].celle[1].stato, "futuro");

assert.deepEqual(grigliaScambi({ anno: 2026, tipi: [], righe: [], oggiISO: "2026-07-15" }), []);
assert.equal(scambiMancanti([]), 0);
assert.equal(scambiMancanti(null), 0);

// ============================================================
// 4.1-4.5 · Eventi del mese.
// Ogni numero qui sotto finisce o sul file che va al consulente del lavoro, o
// nella riga del comporto che l'HR guarda prima di una decisione grave. Nessuno
// di questi errori darebbe un messaggio: darebbe un numero sbagliato.
// ============================================================

// --- giorniDiEvento: `al` vuoto = UN GIORNO SOLO, non "ancora in corso" ---
assert.deepEqual(giorniDiEvento({ dal: "2026-07-10" }), ["2026-07-10"]);
assert.deepEqual(giorniDiEvento({ dal: "2026-07-10", al: null }), ["2026-07-10"]);
assert.deepEqual(giorniDiEvento({ dal: "2026-07-10", al: "2026-07-12" }),
  ["2026-07-10", "2026-07-11", "2026-07-12"]);
// Estremi COMPRESI: una settimana lunedi'-domenica vale 7 giorni di calendario.
assert.equal(contaGiorniEvento({ dal: "2026-07-06", al: "2026-07-12" }), 7);
// Attraversa il mese e l'anno, e il 29 febbraio esiste.
assert.equal(contaGiorniEvento({ dal: "2026-12-30", al: "2027-01-02" }), 4);
assert.equal(contaGiorniEvento({ dal: "2024-02-28", al: "2024-03-01" }), 3);
// Riga incoerente (al prima di dal): nessun giorno, non un ciclo infinito.
assert.deepEqual(giorniDiEvento({ dal: "2026-07-10", al: "2026-07-01" }), []);
assert.deepEqual(giorniDiEvento(null), []);
assert.deepEqual(giorniDiEvento({ dal: null }), []);
// La finestra taglia, non sposta: e' quello che fanno il calendario, l'export e
// il comporto, e i tre devono dare lo stesso numero.
assert.equal(contaGiorniEvento({ dal: "2026-06-28", al: "2026-07-04" }, "2026-07-01", "2026-07-31"), 4);
assert.equal(contaGiorniEvento({ dal: "2026-06-28", al: "2026-07-04" }, "2026-06-01", "2026-06-30"), 3);
// Evento tutto fuori dalla finestra.
assert.deepEqual(giorniDiEvento({ dal: "2026-05-01", al: "2026-05-03" }, "2026-07-01", "2026-07-31"), []);
// Un anno sbagliato non blocca la pagina: il ciclo ha un tetto.
assert.ok(giorniDiEvento({ dal: "2026-01-01", al: "2999-12-31" }).length <= 1100);

// --- eventiDelMese: TOCCANO il mese, non ci cominciano ---
const evMese = [
  { id: "a", dal: "2026-06-28", al: "2026-07-04" },   // a cavallo: dentro
  { id: "b", dal: "2026-07-15", al: null },           // un giorno solo: dentro
  { id: "c", dal: "2026-08-01", al: "2026-08-03" },   // mese dopo: fuori
  { id: "d", dal: "2026-05-01", al: "2026-06-30" },   // finisce il giorno prima: fuori
  { id: "e", dal: "2026-07-31", al: "2026-08-10" },   // comincia l'ultimo giorno: dentro
];
assert.deepEqual(eventiDelMese(evMese, 2026, 7).map((e) => e.id), ["a", "b", "e"]);
assert.deepEqual(eventiDelMese(evMese, 2026, 13), []);   // mese finto: niente
assert.deepEqual(eventiDelMese(evMese, 2026, 0), []);
assert.deepEqual(eventiDelMese(null, 2026, 7), []);
// Febbraio bisestile: l'ultimo giorno del mese e' dentro.
assert.equal(eventiDelMese([{ id: "f", dal: "2024-02-29" }], 2024, 2).length, 1);

// --- richiesteDaApprovare: una lista sola per il contatore e per l'elenco ---
const evStati = [{ stato: "richiesto" }, { stato: "approvato" }, { stato: "richiesto" }, { stato: "rifiutato" }];
assert.equal(richiesteDaApprovare(evStati).length, 2);
assert.equal(richiesteDaApprovare([]).length, 0);
assert.equal(richiesteDaApprovare(null).length, 0);

// --- promemoriaInail: l'allegato lo spegne, e resta spento per sempre ---
assert.equal(promemoriaInail({ tipo: "ferie", dal: iso(-1) }, 2), null);
assert.equal(promemoriaInail(null, 2), null);
const inailIeri = promemoriaInail({ tipo: "infortunio", dal: iso(-10) }, 2);
assert.equal(inailIeri.scadenza, iso(-8));
assert.equal(inailIeri.stato, "scaduto");                       // termine passato, niente scheda
const inailFatto = promemoriaInail({ tipo: "infortunio", dal: iso(-10), documento_path: "eventi/x/1.pdf" }, 2);
assert.equal(inailFatto.stato, "ok");                           // allegata DOPO il termine: ok lo stesso
// La trappola che questo test esiste per impedire: con classificaStato(true, ...)
// e la soglia a 60 giorni, "ok" non sarebbe mai uscito.
assert.notEqual(inailFatto.stato, classificaStato(true, inailFatto.scadenza));
const inailOggi = promemoriaInail({ tipo: "infortunio", dal: iso(0) }, 2);
assert.equal(inailOggi.stato, "in_scadenza");                   // termine non ancora passato
assert.equal(promemoriaInail({ tipo: "infortunio", dal: iso(0) }, null).scadenza, iso(2)); // ripiego 2

// --- validaRichiesta: la stessa regola della RPC, dal lato di chi scrive ---
const CONSENTITI = ["ferie", "permesso"];
const vr = (o) => validaRichiesta({ tipiConsentiti: CONSENTITI, giorniIndietro: 30, oggiISO: "2026-07-15", ...o });
assert.equal(vr({ tipo: "ferie", dal: "2026-07-20", al: "2026-07-24" }), null);
assert.equal(vr({ tipo: "ferie", dal: "2026-07-20" }), null);                    // al vuoto: un giorno
assert.ok(vr({ tipo: "malattia", dal: "2026-07-20" }));                          // tipo non consentito
assert.ok(vr({ tipo: "", dal: "2026-07-20" }));
assert.ok(vr({ tipo: "ferie", dal: "" }));                                       // manca il primo giorno
assert.ok(vr({ tipo: "ferie", dal: "2026-07-24", al: "2026-07-20" }));           // al prima di dal
assert.ok(vr({ tipo: "ferie", dal: "2026-06-14" }));                             // 31 giorni indietro: no
assert.equal(vr({ tipo: "ferie", dal: "2026-06-15" }), null);                    // 30 esatti: si'
assert.ok(vr({ tipo: "ferie", dal: "2026-07-20", al: "2027-08-01" }));           // periodo troppo lungo
// Senza il limite (non ancora arrivato da self_get) la regola non inventa numeri.
assert.equal(validaRichiesta({ tipo: "ferie", dal: "2020-01-01", tipiConsentiti: CONSENTITI,
  giorniIndietro: null, oggiISO: "2026-07-15" }), null);

// --- conteggioComporto: giorni nella finestra mobile, senza doppioni ---
const comporto = (eventi, o = {}) => conteggioComporto({
  eventiDellaPersona: eventi, finestraMesi: 12, soglia: 180, percentuale: 80,
  oggiISO: "2026-07-15", ...o,
});
assert.equal(comporto([]).giorni, 0);
assert.equal(comporto([]).stato, "ok");
assert.equal(comporto([{ tipo: "malattia", stato: "approvato", dal: "2026-07-01", al: "2026-07-05" }]).giorni, 5);
// Solo malattia, solo approvata.
assert.equal(comporto([{ tipo: "ferie", stato: "approvato", dal: "2026-07-01", al: "2026-07-05" }]).giorni, 0);
assert.equal(comporto([{ tipo: "malattia", stato: "richiesto", dal: "2026-07-01", al: "2026-07-05" }]).giorni, 0);
// A cavallo dell'inizio della finestra: contano solo i giorni dentro.
// Finestra: dal 2025-07-15 al 2026-07-15.
assert.equal(comporto([{ tipo: "malattia", stato: "approvato", dal: "2025-07-10", al: "2025-07-20" }]).giorni, 6);
// Tutta prima della finestra: zero.
assert.equal(comporto([{ tipo: "malattia", stato: "approvato", dal: "2025-01-01", al: "2025-01-31" }]).giorni, 0);
// Due malattie sovrapposte non contano due volte lo stesso giorno.
assert.equal(comporto([
  { tipo: "malattia", stato: "approvato", dal: "2026-07-01", al: "2026-07-05" },
  { tipo: "malattia", stato: "approvato", dal: "2026-07-03", al: "2026-07-07" },
]).giorni, 7);
// Un giorno solo con `al` vuoto.
assert.equal(comporto([{ tipo: "malattia", stato: "approvato", dal: "2026-07-02" }]).giorni, 1);
// Le tre soglie: 143 = ok, 144 = avviso (80% di 180), 180 = superato.
const malattiaDi = (n) => [{ tipo: "malattia", stato: "approvato", dal: "2026-07-15", al: localISO(addDays(parseISO("2026-07-15"), n - 1)) }];
const finestraLunga = { finestraMesi: 12, oggiISO: "2027-07-14" };
assert.equal(comporto(malattiaDi(143), finestraLunga).giorni, 143);
assert.equal(comporto(malattiaDi(143), finestraLunga).stato, "ok");
assert.equal(comporto(malattiaDi(144), finestraLunga).stato, "avviso");
assert.equal(comporto(malattiaDi(180), finestraLunga).stato, "superato");
// Senza soglia non si inventa uno stato.
assert.equal(comporto(malattiaDi(10), { soglia: null }).stato, "ok");
// La finestra dichiara i propri estremi (servono all'etichetta della scheda).
assert.equal(comporto([]).dal, "2025-07-15");
assert.equal(comporto([]).al, "2026-07-15");
assert.equal(comporto([], { finestraMesi: null }).dal, "2025-07-15");   // ripiego 12 mesi

// --- saldoDichiarato: due numeri accanto, MAI sommati ---
const dipSaldo = { id: "d1", saldo_ferie: 12.5, saldo_par: 8, saldo_al: "2026-06-30" };
assert.equal(saldoDichiarato({ dip: { id: "d1" }, eventiDellaPersona: [] }), null);   // senza data: niente
assert.equal(saldoDichiarato({ dip: null, eventiDellaPersona: [] }), null);
const s1 = saldoDichiarato({
  dip: dipSaldo,
  eventiDellaPersona: [
    { tipo: "ferie", stato: "approvato", dal: "2026-07-06", al: "2026-07-10" },   // dopo: 5 giorni
    { tipo: "ferie", stato: "approvato", dal: "2026-06-01", al: "2026-06-05" },   // prima: non conta
    { tipo: "ferie", stato: "richiesto", dal: "2026-07-20", al: "2026-07-24" },   // non approvata
    { tipo: "permesso", stato: "approvato", dal: "2026-07-08", ore: 4 },          // dopo: 4 ore
    { tipo: "permesso", stato: "approvato", dal: "2026-07-09", ore: null },       // ore mancanti: 0
    { tipo: "malattia", stato: "approvato", dal: "2026-07-11", al: "2026-07-13" },// non e' ferie
  ],
});
assert.equal(s1.al, "2026-06-30");
assert.equal(s1.ferie, 12.5);
assert.equal(s1.par, 8);
assert.equal(s1.ferieDopo, 5);
assert.equal(s1.oreDopo, 4);
// Un evento che comincia ESATTAMENTE il giorno del saldo e' gia' compreso nel saldo.
assert.equal(saldoDichiarato({ dip: dipSaldo,
  eventiDellaPersona: [{ tipo: "ferie", stato: "approvato", dal: "2026-06-30" }] }).ferieDopo, 0);
// La data c'e' ma i numeri no: si mostra comunque cosa e' successo dopo.
const s2 = saldoDichiarato({ dip: { id: "d1", saldo_al: "2026-06-30" },
  eventiDellaPersona: [{ tipo: "ferie", stato: "approvato", dal: "2026-07-01", al: "2026-07-02" }] });
assert.equal(s2.ferie, null);
assert.equal(s2.par, null);
assert.equal(s2.ferieDopo, 2);

// ============================================================
// 5.1 · raggruppaGapPerTipo — le righe del motore gap, per corso.
// La cosa che si puo' sbagliare in silenzio e' "la scadenza piu' vicina":
// sbagliata, da' all'ente una data di prenotazione sbagliata e nessuno se ne
// accorge, perche' la pagina si disegna lo stesso.
// ============================================================
const tCarr = { id: "t-carr", nome: "Carrelli", categoria: "abilitazione" };
const tVis = { id: "t-vis", nome: "Visita medica", categoria: "sanitario" };
const righeGap = [
  { dip: { id: "d1" }, tipo: tCarr, stato: "scaduto",     scadenza: "2026-03-01" },
  { dip: { id: "d2" }, tipo: tCarr, stato: "in_scadenza", scadenza: "2026-10-15" },
  { dip: { id: "d3" }, tipo: tCarr, stato: "ok",          scadenza: null },
  { dip: { id: "d1" }, tipo: tVis,  stato: "ok",          scadenza: "2027-01-01" },
];
const gruppi = raggruppaGapPerTipo(righeGap);
assert.equal(gruppi.length, 2);                       // due corsi, non quattro righe
const gCarr = gruppi.find((g) => g.tipo.id === "t-carr");
assert.equal(gCarr.totale, 3);
assert.equal(gCarr.righe.length, 3);
assert.equal(gCarr.scaduti, 1);
assert.equal(gCarr.inScadenza, 1);
assert.equal(gCarr.ok, 1);
// I conteggi per stato sommano al totale: nessuna riga si perde per strada.
assert.equal(gCarr.scaduti + gCarr.inScadenza + gCarr.ok, gCarr.totale);
// La prima scadenza e' la minore, e la riga SENZA scadenza non la abbassa.
assert.equal(gCarr.primaScadenza, "2026-03-01");
// Un gruppo di sole righe senza scadenza non ne ha una.
const soloSenzaData = raggruppaGapPerTipo([
  { dip: { id: "d1" }, tipo: tVis, stato: "scaduto", scadenza: null },
  { dip: { id: "d2" }, tipo: tVis, stato: "scaduto", scadenza: null },
]);
assert.equal(soloSenzaData.length, 1);
assert.equal(soloSenzaData[0].primaScadenza, null);
assert.equal(soloSenzaData[0].totale, 2);
// L'ordine in cui arrivano le righe non cambia la prima scadenza.
const alContrario = raggruppaGapPerTipo(righeGap.slice().reverse());
assert.equal(alContrario.find((g) => g.tipo.id === "t-carr").primaScadenza, "2026-03-01");
// Elenco vuoto, e input strani, non fanno cadere la pagina.
assert.deepEqual(raggruppaGapPerTipo([]), []);
assert.deepEqual(raggruppaGapPerTipo(null), []);
assert.deepEqual(raggruppaGapPerTipo([null, { dip: {} }]), []);   // righe senza tipo: ignorate

// ============================================================
// 5.2 · Adempimenti aziendali. Tutti i casi con una data passano `oggiISO`
// esplicito: senza, questi test comincerebbero a fallire da soli il giorno in
// cui la scadenza scritta qui entra nei 60 giorni.
// ============================================================
const OGGI_AZ = "2026-09-03";
// Mai fatta e senza data: e' una cosa da fare, e sta in cima.
assert.equal(statoAdempimentoAzienda({ nome: "x" }, OGGI_AZ), "scaduto");
assert.equal(statoAdempimentoAzienda(null, OGGI_AZ), "scaduto");
// Mai fatta ma con una data: MAI verde, come per le persone.
assert.equal(statoAdempimentoAzienda({ prossima: "2027-01-31" }, OGGI_AZ), "in_scadenza");
assert.equal(statoAdempimentoAzienda({ prossima: "2026-01-31" }, OGGI_AZ), "scaduto");
// Fatta, con la prossima lontana: verde.
assert.equal(statoAdempimentoAzienda(
  { ultima_esecuzione: "2026-01-31", prossima: "2027-01-31" }, OGGI_AZ), "ok");
// Fatta, con la prossima dentro i 60 giorni: gialla.
assert.equal(statoAdempimentoAzienda(
  { ultima_esecuzione: "2025-10-31", prossima: "2026-10-31" }, OGGI_AZ), "in_scadenza");
// Fatta, con la prossima passata: rossa.
assert.equal(statoAdempimentoAzienda(
  { ultima_esecuzione: "2025-01-31", prossima: "2026-01-31" }, OGGI_AZ), "scaduto");
// Una tantum gia' fatta: nessuna prossima, ed e' a posto.
assert.equal(statoAdempimentoAzienda(
  { ultima_esecuzione: "2025-06-01", prossima: null }, OGGI_AZ), "ok");

// prossimaEsecuzioneAzienda
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2026-10-20", periodicitaMesi: 12 }), "2027-10-20");
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2026-09-03", periodicitaMesi: 6 }), "2027-03-03");
// Una tantum: fatta una volta, non torna.
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2026-10-20", periodicitaMesi: null }), null);
// Senza la data del fatto non c'e' niente da calcolare.
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: null, periodicitaMesi: 12 }), null);
// Una periodicita' non numerica non diventa "fra zero mesi": non si calcola.
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2026-10-20", periodicitaMesi: "boh" }), null);
// Il clamp a fine mese di addMonths vale anche qui: 31/01 + 1 mese = 28/02.
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2026-01-31", periodicitaMesi: 1 }), "2026-02-28");
assert.equal(prossimaEsecuzioneAzienda({ dataFatto: "2028-01-31", periodicitaMesi: 1 }), "2028-02-29");

// ============================================================
// 5.3 · coperturaCompetenze. Decide un rosso, e sbagliata non da' nessun
// errore: da' una lavorazione che sembra coperta e non lo e'.
// ============================================================
const catalogoCmp = [
  { id: "c-imp", nome: "Conduzione Imp1500", ordine: 1 },
  { id: "c-car", nome: "Carroponte", ordine: 2 },
  { id: "c-lab", nome: "Controlli di laboratorio", ordine: 3 },
];
const dipCmp = [
  { id: "d1", cognome: "Rossi", nome: "Ada", attivo: true },
  { id: "d2", cognome: "Bianchi", nome: "Bea", attivo: true },
  { id: "d3", cognome: "Verdi", nome: "Ciro", attivo: false },   // cessato
];
const livelli = [
  { dipendente_id: "d1", competenza_id: "c-imp", livello: 3 },   // autonomo e forma
  { dipendente_id: "d2", competenza_id: "c-imp", livello: 2 },   // autonomo
  { dipendente_id: "d1", competenza_id: "c-car", livello: 1 },   // in affiancamento: NON autonomo
  { dipendente_id: "d3", competenza_id: "c-car", livello: 3 },   // cessato: non conta
];
const cop = coperturaCompetenze({ dipendenti: dipCmp, competenze: livelli, catalogo: catalogoCmp });
assert.equal(cop.length, 3);
// L'ordine del catalogo e' rispettato: la vista non rimescola le lavorazioni.
assert.deepEqual(cop.map((x) => x.competenza.id), ["c-imp", "c-car", "c-lab"]);
// Due autonomi (livello 2 e livello 3): esattamente alla soglia, NON scoperta.
assert.equal(cop[0].autonomi, 2);
assert.equal(cop[0].scoperta, false);
assert.deepEqual(cop[0].persone.map((p) => p.id).sort(), ["d1", "d2"]);
// Un livello 1 non e' autonomo, e un livello 3 di un CESSATO non conta.
assert.equal(cop[1].autonomi, 0);
assert.equal(cop[1].scoperta, true);
// Una competenza senza nessuna riga: zero autonomi, scoperta.
assert.equal(cop[2].autonomi, 0);
assert.equal(cop[2].scoperta, true);
// Un solo autonomo e' ancora scoperto ("in rosso dove e' zero o uno").
const unSolo = coperturaCompetenze({
  dipendenti: dipCmp, catalogo: [catalogoCmp[0]],
  competenze: [{ dipendente_id: "d1", competenza_id: "c-imp", livello: 2 }],
});
assert.equal(unSolo[0].autonomi, 1);
assert.equal(unSolo[0].scoperta, true);
// La soglia e' un argomento: con 3 (il criterio del foglio) due autonomi non bastano.
const soglia3 = coperturaCompetenze({
  dipendenti: dipCmp, competenze: livelli, catalogo: catalogoCmp, sogliaAutonomi: 3,
});
assert.equal(soglia3[0].scoperta, true);
// Elenchi vuoti o mancanti non fanno cadere la pagina.
assert.deepEqual(coperturaCompetenze({ dipendenti: null, competenze: null, catalogo: null }), []);

// ============================================================
// 5.4 · conteggioColloquiAnno. Tutti i casi passano `oggiISO`: senza, il caso
// "tutti fatti prima del limite e' verde" comincerebbe a fallire da solo il
// giorno in cui il 30 novembre entra nei 60 giorni della soglia.
// ============================================================
const dipColl = [
  { id: "d1", cognome: "Rossi", nome: "Ada", attivo: true },
  { id: "d2", cognome: "Bianchi", nome: "Bea", attivo: true },
  { id: "d3", cognome: "Verdi", nome: "Ciro", attivo: false },   // cessato
];
// Nessun colloquio: nessuno fatto, e non e' verde.
const c0 = conteggioColloquiAnno({
  dipendenti: dipColl, colloqui: [], anno: 2026, meseLimite: 11, oggiISO: "2026-09-03" });
assert.equal(c0.attesi, 2);          // il cessato non e' atteso
assert.equal(c0.fatti, 0);
assert.deepEqual(c0.mancanti.map((d) => d.id), ["d1", "d2"]);
assert.equal(c0.scadenza, "2026-11-30");   // ULTIMO giorno del mese limite
assert.notEqual(c0.stato, "ok");

// Tutti fatti, ben prima del limite: verde.
const c1 = conteggioColloquiAnno({
  dipendenti: dipColl,
  colloqui: [{ dipendente_id: "d1", data: "2026-03-10" }, { dipendente_id: "d2", data: "2026-04-02" }],
  anno: 2026, meseLimite: 11, oggiISO: "2026-05-01" });
assert.equal(c1.fatti, 2);
assert.equal(c1.mancanti.length, 0);
assert.equal(c1.stato, "ok");

// Due colloqui alla STESSA persona non coprono il collega: si contano le
// persone, non le righe.
const c2 = conteggioColloquiAnno({
  dipendenti: dipColl,
  colloqui: [{ dipendente_id: "d1", data: "2026-03-10" }, { dipendente_id: "d1", data: "2026-09-01" }],
  anno: 2026, meseLimite: 11, oggiISO: "2026-09-03" });
assert.equal(c2.fatti, 1);
assert.deepEqual(c2.mancanti.map((d) => d.id), ["d2"]);

// Un colloquio dell'anno PRECEDENTE non copre quest'anno.
const c3 = conteggioColloquiAnno({
  dipendenti: dipColl, colloqui: [{ dipendente_id: "d1", data: "2025-11-20" }],
  anno: 2026, meseLimite: 11, oggiISO: "2026-09-03" });
assert.equal(c3.fatti, 0);

// Il colloquio di un CESSATO non conta ne' come fatto ne' come mancante.
const c4 = conteggioColloquiAnno({
  dipendenti: dipColl,
  colloqui: [{ dipendente_id: "d1", data: "2026-01-10" }, { dipendente_id: "d2", data: "2026-01-11" },
             { dipendente_id: "d3", data: "2026-01-12" }],
  anno: 2026, meseLimite: 11, oggiISO: "2026-05-01" });
assert.equal(c4.attesi, 2);
assert.equal(c4.fatti, 2);

// Nessuno in forza: non e' "tutto fatto", e la riga non diventa verde.
const c5 = conteggioColloquiAnno({
  dipendenti: [{ id: "d3", attivo: false }], colloqui: [], anno: 2026, meseLimite: 11,
  oggiISO: "2026-05-01" });
assert.equal(c5.attesi, 0);
assert.notEqual(c5.stato, "ok");

// Passato il limite con qualcuno che manca: rossa.
const c6 = conteggioColloquiAnno({
  dipendenti: dipColl, colloqui: [{ dipendente_id: "d1", data: "2026-02-02" }],
  anno: 2026, meseLimite: 11, oggiISO: "2026-12-15" });
assert.equal(c6.stato, "scaduto");

// La scadenza in un anno bisestile, con febbraio come limite: 29, non 28.
assert.equal(conteggioColloquiAnno({
  dipendenti: dipColl, colloqui: [], anno: 2028, meseLimite: 2, oggiISO: "2028-01-01" }).scadenza,
  "2028-02-29");
// Un mese limite fuori scala non inventa una data.
assert.equal(conteggioColloquiAnno({
  dipendenti: dipColl, colloqui: [], anno: 2026, meseLimite: 0, oggiISO: "2026-01-01" }).scadenza, null);

// ============================================================
// 5.5 · Candidature da cancellare. La riga sbagliata qui non da' nessun
// errore: da' un CV conservato oltre il termine dichiarato al candidato,
// oppure uno cancellato prima del tempo.
// ============================================================
assert.equal(scadenzaConservazioneCandidatura("2026-01-15", 12), "2027-01-15");
// Il clamp a fine mese di addMonths vale anche qui.
assert.equal(scadenzaConservazioneCandidatura("2028-02-29", 12), "2029-02-28");
assert.equal(scadenzaConservazioneCandidatura("2026-08-31", 12), "2027-08-31");
// Senza data di ricezione non si sa niente: non si inventa una scadenza.
assert.equal(scadenzaConservazioneCandidatura(null, 12), null);
assert.equal(scadenzaConservazioneCandidatura("2026-01-15", null), null);

const cands = [
  { id: "k1", nominativo: "Ada",  ricevuto_il: "2025-01-10" },                        // scaduta da un pezzo
  { id: "k2", nominativo: "Bea",  ricevuto_il: "2025-09-03" },                         // scade OGGI
  { id: "k3", nominativo: "Ciro", ricevuto_il: "2026-06-01" },                         // ancora in corso
  { id: "k4", nominativo: "Dina", ricevuto_il: "2024-01-01", cancellato_il: "2025-02-01" }, // gia' cancellata
  { id: "k5", nominativo: "Ezio", ricevuto_il: null },                                 // senza data
];
const daCanc = candidatureDaCancellare(cands, 12, "2026-09-03");
// Solo la prima: quella che scade oggi NON e' ancora da cancellare, quella
// gia' cancellata non torna mai, e quella senza data non si puo' giudicare.
assert.deepEqual(daCanc.map((c) => c.id), ["k1"]);
// Il giorno DOPO la scadenza, quella di Bea entra.
assert.deepEqual(
  candidatureDaCancellare(cands, 12, "2026-09-04").map((c) => c.id).sort(), ["k1", "k2"]);
// Una gia' cancellata non compare nemmeno se scaduta da anni.
assert.equal(candidatureDaCancellare([cands[3]], 12, "2030-01-01").length, 0);
// Elenco vuoto o mancante: nessun errore.
assert.deepEqual(candidatureDaCancellare([], 12, "2026-09-03"), []);
assert.deepEqual(candidatureDaCancellare(null, 12, "2026-09-03"), []);
// Cambiare il termine cambia l'elenco: con 24 mesi Ada non e' ancora scaduta.
assert.deepEqual(candidatureDaCancellare(cands, 24, "2026-09-03").map((c) => c.id), []);

// ============================================================
// 6.1 · I nomi dei fascicoli.
// Sono regole su date e su stati (l'anno del rilascio, l'anno della scadenza,
// "(SUPERATO)" per gli archiviati) e su nomi che devono restare distinti: due
// file con lo stesso nome nella stessa cartella, nello ZIP, diventano UNO.
// Nessuno di questi test dipende dal giorno in cui gira.
// ============================================================

// --- nomeFileSicuro: toglie solo cio' che un file system rifiuta ---
assert.equal(nomeFileSicuro("Rossi Ada"), "Rossi Ada");            // spazi e maiuscole restano
assert.equal(nomeFileSicuro("Idoneita' 2026"), "Idoneita' 2026");  // l'apostrofo e' legittimo
assert.equal(nomeFileSicuro("a/b" + "\\" + "c:d*e?f" + "\"" + "g<h>i|j"), "abcdefghij");
assert.equal(nomeFileSicuro("Corso" + "\u0007" + "carrelli"), "Corsocarrelli"); // caratteri di controllo
assert.equal(nomeFileSicuro("  due   spazi  "), "due spazi");      // spazi compressi e tagliati
assert.equal(nomeFileSicuro("nome."), "nome");                     // il punto finale Windows lo toglie
assert.equal(nomeFileSicuro("nome. . "), "nome");
assert.equal(nomeFileSicuro(null), "");
assert.equal(nomeFileSicuro(""), "");
assert.equal(nomeFileSicuro("x".repeat(200)).length, 120);         // taglio a 120

// --- nomeFascicolo: la cartella della persona ---
assert.equal(nomeFascicolo({ cognome: "Bertani", nome: "Mario" }), "Bertani Mario");
assert.equal(nomeFascicolo({ cognome: "Rossi", nome: "" }), "Rossi");
assert.equal(nomeFascicolo({ cognome: "", nome: "Ada" }), "Ada");
// Senza niente NON si torna la stringa vuota: nello ZIP una cartella senza nome
// sparisce, e i file di quella persona finirebbero mescolati in radice.
assert.equal(nomeFascicolo({}), "Senza nome");
assert.equal(nomeFascicolo(null), "Senza nome");
// Una barra nel cognome creerebbe una sottocartella in piu' dentro lo ZIP.
assert.equal(nomeFascicolo({ cognome: "De/Santis", nome: "Ugo" }), "DeSantis Ugo");

// --- nomeDocumentoFascicolo: il nome dell'esempio del piano, alla lettera ---
assert.equal(nomeDocumentoFascicolo({
  persona: "Bertani Mario", descrizione: "Carrelli elevatori",
  data: "2022-06-14", scadenza: "2027-06-14", path: "adm-1/1750000000000.pdf",
}), "Bertani Mario - Carrelli elevatori 2022 (scad. 2027).pdf");

// Archiviato: "(SUPERATO)" PRIMA dell'estensione, o il file non si apre piu'.
assert.equal(nomeDocumentoFascicolo({
  persona: "Bertani Mario", descrizione: "Sicurezza generale",
  data: "2019-03-01", scadenza: "2024-03-01", superato: true, path: "a/b.pdf",
}), "Bertani Mario - Sicurezza generale 2019 (scad. 2024) (SUPERATO).pdf");

// Senza scadenza non si scrive "(scad. )".
assert.equal(nomeDocumentoFascicolo({
  persona: "Rossi Ada", descrizione: "Consegna DPI", data: "2025-04-02", path: "x/y.docx",
}), "Rossi Ada - Consegna DPI 2025.docx");

// Senza data l'anno NON si mette: per i cedolini il periodo sta gia' nella
// descrizione, e ripeterlo darebbe "Cedolino 2025-01 2025".
assert.equal(nomeDocumentoFascicolo({
  persona: "Rossi Ada", descrizione: "Cedolino 2025-01", path: "cedolini/d1/1.pdf",
}), "Rossi Ada - Cedolino 2025-01.pdf");

// Estensione: si legge dal path, si abbassa di caso, e senza punto si ripiega su pdf.
assert.equal(nomeDocumentoFascicolo({ persona: "A B", descrizione: "X", path: "c/d.PDF" }),
  "A B - X.pdf");
assert.equal(nomeDocumentoFascicolo({ persona: "A B", descrizione: "X", path: "c/senza-punto" }),
  "A B - X.pdf");
assert.equal(nomeDocumentoFascicolo({ persona: "A B", descrizione: "X" }), "A B - X.pdf");
// Una data illeggibile non diventa un anno inventato.
assert.equal(nomeDocumentoFascicolo({ persona: "A B", descrizione: "X", data: "non-una-data" }),
  "A B - X.pdf");
// Ripieghi: senza persona e senza descrizione il nome resta un nome.
assert.equal(nomeDocumentoFascicolo({ path: "a/b.pdf" }), "Senza nome - Documento.pdf");
// I caratteri illegali passano da nomeFileSicuro anche qui.
assert.equal(nomeDocumentoFascicolo({
  persona: "A B", descrizione: "Corso 1/2", data: "2024-01-01", path: "a/b.pdf",
}), "A B - Corso 12 2024.pdf");

// --- nomeUnicoNellaCartella: due file uguali nello ZIP diventano uno ---
const usati = new Set();
assert.equal(nomeUnicoNellaCartella(usati, "A - Idoneita 2026.pdf"), "A - Idoneita 2026.pdf");
assert.equal(nomeUnicoNellaCartella(usati, "A - Idoneita 2026.pdf"), "A - Idoneita 2026 (2).pdf");
assert.equal(nomeUnicoNellaCartella(usati, "A - Idoneita 2026.pdf"), "A - Idoneita 2026 (3).pdf");
// Il suffisso va PRIMA dell'estensione.
assert.ok(nomeUnicoNellaCartella(usati, "A - Idoneita 2026.pdf").endsWith(".pdf"));
// Un nome senza estensione (le cartelle degli omonimi) lo riceve in coda.
const cartelle = new Set();
assert.equal(nomeUnicoNellaCartella(cartelle, "Rossi Mario"), "Rossi Mario");
assert.equal(nomeUnicoNellaCartella(cartelle, "Rossi Mario"), "Rossi Mario (2)");
// Set condiviso: chi chiama ne tiene uno per cartella, e la funzione lo aggiorna.
assert.equal(usati.size, 4);
// Un nome che comincia per punto non si spezza sul punto sbagliato.
const nascosti = new Set();
assert.equal(nomeUnicoNellaCartella(nascosti, ".gitignore"), ".gitignore");
assert.equal(nomeUnicoNellaCartella(nascosti, ".gitignore"), ".gitignore (2)");

// --- Le cinque cartelle sono quelle dell'archivio, nome per nome ---
assert.equal(CARTELLE_FASCICOLO.contratto, "1_Contratto");
assert.equal(CARTELLE_FASCICOLO.cedolini, "2_Cedolini");
assert.equal(CARTELLE_FASCICOLO.formazione, "3_Formazione e idoneita");
assert.equal(CARTELLE_FASCICOLO.assenze, "4_Assenze e varie");
assert.equal(CARTELLE_FASCICOLO.valutazioni, "5_Valutazioni");

console.log("OK tutti i test common.js");
