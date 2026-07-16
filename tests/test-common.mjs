import assert from "node:assert/strict";
import { classificaStato, parseISO, fmtDate, localISO, fmtDateTime, daysUntil, addDays } from "../common.js";

const iso = (giorniDaOggi) => localISO(addDays(new Date(), giorniDaOggi));

// classificaStato — registrato
assert.equal(classificaStato(true, null), "ok");                 // rilasciato, non scade
assert.equal(classificaStato(true, iso(60)), "ok");
assert.equal(classificaStato(true, iso(10)), "in_scadenza");     // entro 30gg
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
