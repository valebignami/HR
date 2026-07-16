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

const { classificaStato, parseISO, fmtDate, localISO, fmtDateTime, daysUntil, addDays, GG_SCAD } =
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
console.log("OK tutti i test common.js");
