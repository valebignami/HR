// ============================================================
// test-dom-ids — gli id che il JS cerca esistono davvero nell'HTML?
//
// Perche' esiste (voce 1.4 del piano): wireEvents() collega ~130 id a mano e
// gira dentro init(). Un id sbagliato lancia "Cannot read properties of null"
// alla prima riga che lo tocca, init() muore, e la pagina resta BIANCA. Non c'e'
// build, non c'e' type checking, e l'unica utente dell'app non puo' farci nulla.
// Dalla Fase 2 in poi ogni fase sposta pezzi della modale dipendente: questo
// test e' l'unica rete sotto quel lavoro.
//
// Cosa controlla: i soli id LETTERALI, cioe' quelli scritti nel codice fra
// virgolette. Gli id calcolati (`$("dip-" + campo)`) non sono verificabili senza
// eseguire la pagina, e non vengono contati.
//
// Uso:  node tests/test-dom-ids.mjs
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (f) => fs.readFileSync(path.join(radice, f), "utf8");

// Coppie: quale file JS deve trovare i suoi id in quale pagina.
const COPPIE = [
  { js: "app.js", html: "index.html" },
  { js: "me.js", html: "me.html" },
];

// Estrae gli id letterali usati dal JS.
//   $("x")                     -> x
//   openModal("x") / closeModal("x") / bottoneOccupato("x", …) -> x
//   toggleSection("x", "y")    -> x e y (sono due id)
// Tutte queste strade finiscono in $() dentro common.js o app.js.
function idUsati(sorgente) {
  const trovati = new Map(); // id -> numero di riga della prima occorrenza
  const righe = sorgente.split(/\r?\n/);

  const segna = (id, numeroRiga) => {
    if (!trovati.has(id)) trovati.set(id, numeroRiga + 1);
  };

  righe.forEach((riga, i) => {
    for (const m of riga.matchAll(/\$\(\s*(["'])([^"'`\n]+)\1\s*\)/g)) segna(m[2], i);
    for (const m of riga.matchAll(/\b(?:openModal|closeModal|bottoneOccupato)\(\s*(["'])([^"'`\n]+)\1/g)) segna(m[2], i);
    for (const m of riga.matchAll(/\btoggleSection\(\s*(["'])([^"'`\n]+)\1\s*,\s*(["'])([^"'`\n]+)\3/g)) {
      segna(m[2], i);
      segna(m[4], i);
    }
  });
  return trovati;
}

// Estrae gli id dichiarati nell'HTML.
function idDichiarati(sorgente) {
  const trovati = new Set();
  for (const m of sorgente.matchAll(/\sid\s*=\s*"([^"]+)"/g)) trovati.add(m[1]);
  for (const m of sorgente.matchAll(/\sid\s*=\s*'([^']+)'/g)) trovati.add(m[1]);
  return trovati;
}

let mancantiTotali = 0;
for (const { js, html } of COPPIE) {
  const usati = idUsati(leggi(js));
  const dichiarati = idDichiarati(leggi(html));
  const mancanti = [...usati.entries()].filter(([id]) => !dichiarati.has(id));

  if (mancanti.length) {
    mancantiTotali += mancanti.length;
    console.error(`\n${js} cerca ${mancanti.length} id che ${html} non ha:`);
    for (const [id, riga] of mancanti) console.error(`  ${js}:${riga}  id="${id}"`);
  } else {
    console.log(`${js} → ${html}: ${usati.size} id letterali, tutti presenti.`);
  }
}

if (mancantiTotali) {
  console.error(
    `\n${mancantiTotali} id mancanti. In produzione questo significa una pagina bianca:` +
    `\naggiungi l'elemento all'HTML, oppure correggi l'id nel JS.`
  );
  process.exit(1);
}
console.log("OK tutti gli id del JS esistono nell'HTML");
