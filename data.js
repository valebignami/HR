// ============================================================
// Configurazione "statica" della Piattaforma HR (solo costanti UI).
// NESSUNA regola di business qui: ruoli, requisiti e la matrice
// mansione->requisiti vivono su Supabase e si modificano dall'app.
// ============================================================

// Categorie dei tipi di requisito (etichette + icone per la UI).
window.CATEGORIE_REQUISITO = [
  { key: "sanitario",   label: "Sanitario",   icon: "🩺" },
  { key: "formazione",  label: "Formazione",  icon: "📚" },
  { key: "abilitazione",label: "Abilitazione",icon: "🪪" },
  { key: "dpi",         label: "DPI",         icon: "🦺" }
];

// Soglie di calcolo.
window.GIORNI_SCADENZA_IMMINENTE = 60;  // entro N giorni = "in scadenza" (copre anche i 60gg di onboarding)
window.GIORNI_ONBOARDING = 60;          // neoassunto: obbligo da assolvere entro N giorni

// Livelli CCNL Metalmeccanici Confapi (comodita' per il form anagrafica).
window.LIVELLI_CCNL = ["1", "2", "3", "4", "5", "6", "7"];

// ============================================================
// Lookup per i campi anagrafica estesa (Iterazione A).
// Sono solo etichette UI: il DB non ne forza il vocabolario.
// ============================================================
window.SESSI = [
  { key: "M", label: "Maschio" },
  { key: "F", label: "Femmina" },
  { key: "X", label: "Altro" }
];
window.STATI_CIVILI = ["Celibe/Nubile", "Coniugato/a", "Separato/a", "Divorziato/a", "Vedovo/a", "Altro"];
window.TIPI_CONTRATTO = ["Indeterminato", "Determinato", "Apprendistato", "Somministrazione", "Stagionale", "Collaborazione"];
window.QUALIFICHE = ["Operaio", "Operaio specializzato", "Impiegato", "Quadro", "Dirigente", "Apprendista"];
window.ORARI = ["Full-time", "Part-time orizzontale", "Part-time verticale", "Part-time misto"];
window.PARENTELE = ["Coniuge", "Genitore", "Figlio/a", "Fratello/Sorella", "Convivente", "Altro"];
window.MOTIVI_CESSAZIONE = ["Dimissioni", "Licenziamento", "Fine contratto", "Pensionamento", "Mutuo consenso", "Altro"];

// Nomi dei mesi: servono al contatore dei cedolini e alla griglia del consulente.
window.MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
               "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

// 3.2 · Tipi di cedolino. Il mese NON e' libero: la tredicesima e' il mese 13 e
// la Certificazione Unica il mese 0. E' quello che rende vera l'unicita'
// (persona, anno, mese, tipo): con un mese vuoto non scatterebbe mai, perche' nel
// database un valore assente non e' uguale a un altro valore assente.
window.TIPI_CEDOLINO = [
  { key: "mensile",     label: "Cedolino mensile",           meseFisso: null },
  { key: "tredicesima", label: "Tredicesima",                meseFisso: 13 },
  { key: "cu",          label: "Certificazione Unica (CU)",  meseFisso: 0 }
];

// 3.3 · Cosa ci si scambia con il consulente del lavoro, e ogni quanto.
// In ENTRATA quello che arriva dallo studio, in USCITA quello che gli si manda.
// La riga "variabili" dalla Fase 4.4 verra' scritta dall'app quando si esporta
// il riepilogo del mese; fino ad allora la spunta l'HR a mano.
window.TIPI_SCAMBIO_CONSULENTE = [
  { key: "lul",       label: "LUL (Libro Unico del Lavoro)", direzione: "entrata", periodicita: "mensile" },
  { key: "f24",       label: "F24",                          direzione: "entrata", periodicita: "mensile" },
  { key: "uniemens",  label: "Uniemens",                     direzione: "entrata", periodicita: "mensile" },
  { key: "prospetti", label: "Prospetti contabili",          direzione: "entrata", periodicita: "mensile" },
  { key: "variabili", label: "Variabili del mese",           direzione: "uscita",  periodicita: "mensile" },
  { key: "cu",        label: "Certificazione Unica (CU)",    direzione: "entrata", periodicita: "annuale" },
  { key: "mod770",    label: "Modello 770",                  direzione: "entrata", periodicita: "annuale" }
];

// Tipi di provvedimento disciplinare (art. 7 Statuto dei Lavoratori, CCNL).
window.TIPI_PROVVEDIMENTO = [
  { key: "richiamo_verbale",  label: "Richiamo verbale",  icon: "💬" },
  { key: "richiamo_scritto",  label: "Richiamo scritto",  icon: "📝" },
  { key: "multa",             label: "Multa",             icon: "💸" },
  { key: "sospensione",       label: "Sospensione",       icon: "⏸" },
  { key: "licenziamento",     label: "Licenziamento",     icon: "🚫" }
];
