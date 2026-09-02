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

const { classificaStato, calcolaGap, parseISO, fmtDate, localISO, fmtDateTime, daysUntil,
        addDays, addMonths, GG_SCAD, GG_ONBOARD } =
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
