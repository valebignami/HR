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

// Tipi di provvedimento disciplinare (art. 7 Statuto dei Lavoratori, CCNL).
window.TIPI_PROVVEDIMENTO = [
  { key: "richiamo_verbale",  label: "Richiamo verbale",  icon: "💬" },
  { key: "richiamo_scritto",  label: "Richiamo scritto",  icon: "📝" },
  { key: "multa",             label: "Multa",             icon: "💸" },
  { key: "sospensione",       label: "Sospensione",       icon: "⏸" },
  { key: "licenziamento",     label: "Licenziamento",     icon: "🚫" }
];
