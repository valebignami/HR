// ============================================================
// HR Overland — common.js
// Helper condivisi app HR + portale (config Supabase, DOM helpers,
// date helpers, classificazione stato adempimenti).
// ============================================================

// ---------- Config Supabase (progetto condiviso, anon key pubblica) ----------
const SUPABASE_URL = "https://cqdmfhdcdvaezmexzxrq.supabase.co";
const SUPABASE_KEY = "sb_publishable_1ECriACxKWx6_4GPxyMXVQ_MPVc2GYy";
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { classificaStato, daysUntil, parseISO, localISO, fmtDate, fmtDateTime, addDays, addMonths, esc, uid, GG_SCAD, GG_ONBOARD };
}
