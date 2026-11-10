/* OS_FIT Diario — web app personale per il diario dei pasti.
 * Nessuna dipendenza obbligatoria. Dati in IndexedDB sul dispositivo.
 * Ad ogni rilascio: aggiorna APP_VERSION qui e VERSION in sw.js (stesso valore).
 */
'use strict';

const APP_VERSION = '1.4.0';
const DB_NAME = 'osfit-diario';
const DB_VERSION = 2;        // struttura del database (cambia solo con una migrazione)
const BACKUP_FORMAT = 2;     // formato del file di backup (il ripristino accetta anche 1)
const SLOTS = ['Colazione', 'Spuntino', 'Pranzo', 'Merenda', 'Cena'];
const DAY_TYPES = { pesi: 'Pesi', cardio: 'Cardio', riposo: 'Riposo' };
const WEEKDAY_LONG = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const BACKUP_WARN_DAYS = 7;
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = 'product_name,product_name_it,brands,quantity,product_quantity_unit,nutriments';

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const NUTR = ['kcal', 'prot', 'carb', 'fat'];
const NUTR_LABEL = { kcal: 'kcal', prot: 'proteine', carb: 'carboidrati', fat: 'grassi' };
const NUTR_SHORT = { kcal: 'kcal', prot: 'P', carb: 'C', fat: 'G' };

/* ---------- utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const r1 = n => Math.round(n * 10) / 10;
const fmt0 = n => Math.round(n).toLocaleString('it-IT');
const fmt1 = n => r1(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const byName = (a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
const byRecent = (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || byName(a, b);
const unitOf = x => (x && x.unit === 'ml' ? 'ml' : 'g');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const fullName = f => (f.state && !norm(f.name).includes(f.state) ? `${f.name} (${f.state})` : f.name);

const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const today = () => isoDate(new Date());
const mondayOf = s => addDays(s, -((parseDate(s).getDay() + 6) % 7));
const isoWeekday = s => ((parseDate(s).getDay() + 6) % 7) + 1; // 1 = lunedì
const labelDay = s => { const d = parseDate(s); return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/* ---------- interfaccia: icone e animazioni ---------- */
const ic = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = () => { try { navigator.vibrate?.(8); } catch { /* facoltativo */ } };
function countUp(n, a, b, ms) {
  if (!ms || a === b) { n.textContent = fmt0(b); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3); n.textContent = fmt0(a + (b - a) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { n.textContent = fmt0(b); }, ms + 120);  // valore finale garantito anche se l'animazione viene sospesa
}
// Anelli, barre e numeri passano dal valore precedente al nuovo (data-to / data-count)
function runAnimations(root) {
  const apply = () => {
    root.querySelectorAll('[data-to]').forEach(n => { if (n.tagName.toLowerCase() === 'circle') n.style.strokeDashoffset = n.dataset.to; else n.style.width = n.dataset.to; });
    root.querySelectorAll('[data-count]').forEach(n => countUp(n, +n.dataset.from || 0, +n.dataset.count, reduceMotion() ? 0 : 450));
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(() => root.querySelectorAll('[data-to]').forEach(n => { if (n.tagName.toLowerCase() === 'circle') n.style.strokeDashoffset = n.dataset.to; else n.style.width = n.dataset.to; }), 120);
}

/* ---------- calcolo nutrienti ---------- */
// Valori per 100 g/ml: macro principali come numeri (compatibili con le versioni precedenti) + tutti i nutrienti disponibili
const per100Of = f => {
  const o = {};
  if (f.nutr) for (const k of NUTR_KEYS) if (hasVal(f.nutr[k])) o[k] = f.nutr[k];
  // i macro principali restano numeri per i calcoli; "tracce"/"< x" della fonte si conservano a parte per la visualizzazione
  const q = {};
  for (const k of ['kcal', 'prot', 'carb', 'fat']) if (typeof o[k] === 'string' && nv(o[k]) === nv(f[k])) q[k] = o[k];
  o.kcal = nv(f.kcal); o.prot = nv(f.prot); o.carb = nv(f.carb); o.fat = nv(f.fat);
  if (Object.keys(q).length) o.q = q;
  return o;
};
function calc(per100, grams) {
  const k = grams / 100;
  return { kcal: Math.round(per100.kcal * k), prot: r1(per100.prot * k), carb: r1(per100.carb * k), fat: r1(per100.fat * k) };
}
function sum(list) {
  const t = { kcal: 0, prot: 0, carb: 0, fat: 0 };
  for (const e of list) for (const k of NUTR) t[k] += e[k] || 0;
  for (const k of NUTR) t[k] = k === 'kcal' ? Math.round(t[k]) : r1(t[k]);
  return t;
}
// Somma esatta (senza arrotondamenti intermedi) di ingredienti {per100, grams}
function rawTotals(items) {
  const t = { kcal: 0, prot: 0, carb: 0, fat: 0 };
  for (const it of items) for (const k of NUTR) t[k] += (it.per100[k] || 0) * (it.grams || 0) / 100;
  return t;
}
function makeEntry(src, grams, date, slot, extra = {}) {
  return { id: uid(), date, slot, foodId: src.foodId || null, name: src.name, grams, unit: unitOf(src), per100: src.per100,
    ...calc(src.per100, grams), createdAt: Date.now(), ...extra };
}
const macroLine = t => `<span><b>${fmt0(t.kcal)}</b> kcal</span><span>P <b>${fmt1(t.prot)}</b></span><span>C <b>${fmt1(t.carb)}</b></span><span>G <b>${fmt1(t.fat)}</b></span>`;
function cloneEntries(list, date, slotOverride) {
  const groups = new Map();
  const now = Date.now();
  return list.map((e, i) => {
    const c = { ...e, id: uid(), date, slot: slotOverride || e.slot, createdAt: now + i };
    if (e.groupId) { if (!groups.has(e.groupId)) groups.set(e.groupId, uid()); c.groupId = groups.get(e.groupId); }
    return c;
  });
}

/* ---------- nutrienti estesi, catalogo, unità di misura ---------- */
const CAT = self.OSF_CATALOG || { version: '', foods: [], categories: [] };
const CAT_BY_ID = new Map(CAT.foods.map(f => [f.id, f]));
const CAT_NAMES = Object.fromEntries((CAT.categories || []).map(c => [c.id, c.n]));
const MONTH_NAMES = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const NUTRIENTS = [
  { k: 'kcal', l: 'Energia', u: 'kcal', g: 'macro' },
  { k: 'prot', l: 'Proteine', u: 'g', g: 'macro' },
  { k: 'carb', l: 'Carboidrati', u: 'g', g: 'macro' },
  { k: 'sugar', l: 'di cui zuccheri', u: 'g', g: 'macro', sub: true },
  { k: 'fat', l: 'Grassi', u: 'g', g: 'macro' },
  { k: 'sat', l: 'di cui saturi', u: 'g', g: 'macro', sub: true },
  { k: 'fiber', l: 'Fibre', u: 'g', g: 'macro' },
  { k: 'salt', l: 'Sale', u: 'g', g: 'min' },
  { k: 'na', l: 'Sodio', u: 'mg', g: 'min' },
  { k: 'k', l: 'Potassio', u: 'mg', g: 'min' },
  { k: 'ca', l: 'Calcio', u: 'mg', g: 'min' },
  { k: 'mg', l: 'Magnesio', u: 'mg', g: 'min' },
  { k: 'fe', l: 'Ferro', u: 'mg', g: 'min' },
  { k: 'zn', l: 'Zinco', u: 'mg', g: 'min' },
  { k: 'p', l: 'Fosforo', u: 'mg', g: 'min' },
  { k: 'vitA', l: 'Vitamina A (retinolo eq.)', u: 'µg', g: 'vit' },
  { k: 'vitC', l: 'Vitamina C', u: 'mg', g: 'vit' },
  { k: 'vitD', l: 'Vitamina D', u: 'µg', g: 'vit' },
  { k: 'vitE', l: 'Vitamina E', u: 'mg', g: 'vit' },
  { k: 'vitK', l: 'Vitamina K1', u: 'µg', g: 'vit' },
  { k: 'b1', l: 'Tiamina (B1)', u: 'mg', g: 'vit' },
  { k: 'b2', l: 'Riboflavina (B2)', u: 'mg', g: 'vit' },
  { k: 'b3', l: 'Niacina (B3)', u: 'mg', g: 'vit' },
  { k: 'b5', l: 'Acido pantotenico (B5)', u: 'mg', g: 'vit' },
  { k: 'b6', l: 'Vitamina B6', u: 'mg', g: 'vit' },
  { k: 'b9', l: 'Folati (B9)', u: 'µg', g: 'vit' },
  { k: 'b12', l: 'Vitamina B12', u: 'µg', g: 'vit' },
];
const NUTR_KEYS = NUTRIENTS.map(n => n.k);
const NUTR_GROUPS = [['macro', 'Macronutrienti'], ['min', 'Minerali'], ['vit', 'Vitamine']];
const EXTRA_FORM = [['sugar', 'di cui zuccheri'], ['sat', 'di cui saturi'], ['fiber', 'Fibre'], ['salt', 'Sale']];

// Un valore è: numero, 'tr' (tracce), '<x' (sotto il limite di rilevazione) oppure assente (= dato non disponibile, mai zero).
const hasVal = v => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const nv = v => (typeof v === 'number' ? v : v === 'tr' || String(v).startsWith('<') ? 0 : Number.isFinite(+v) ? +v : 0);
function fmtN(x) {
  const a = Math.abs(x);
  return x.toLocaleString('it-IT', { maximumFractionDigits: a >= 100 ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3 });
}
const ND = '<span class="nd">dato non disponibile</span>';
function cellRaw(v, u) {
  if (!hasVal(v)) return ND;
  if (v === 'tr') return 'tracce';
  if (String(v).startsWith('<')) return `&lt; ${fmtN(+String(v).slice(1))} ${u}`;
  return `${fmtN(+v)} ${u}`;
}
// Quantità di un nutriente per "grams" (grammi, o ml per gli alimenti espressi per 100 ml): valore per 100 × quantità / 100
function amountOf(per100, k, grams) {
  const v = per100?.q?.[k] ?? per100?.[k];
  if (!hasVal(v)) return null;
  const q = typeof v === 'string' ? v : null;
  return { v: nv(v) * grams / 100, q, lim: q && q.startsWith('<') ? +q.slice(1) * grams / 100 : null };
}
function cellAmount(a, u) {
  if (!a) return ND;
  if (a.q === 'tr') return 'tracce';
  if (a.lim != null) return `&lt; ${fmtN(a.lim)} ${u}`;
  return `${fmtN(a.v)} ${u}`;
}
function totalsFull(entries) {
  const out = {};
  for (const n of NUTRIENTS) {
    let v = 0, have = 0, miss = 0;
    for (const e of entries) {
      const a = amountOf(e.per100, n.k, e.grams);
      if (a) { v += a.v; have++; } else miss++;
    }
    out[n.k] = { v, have, miss };
  }
  return out;
}
// Riga compatta di kcal e macro che rispetta "tracce" e "< x" della fonte
function macroLineQ(per100, g) {
  const f = (k, lab, u) => { const a = amountOf(per100, k, g); const t = !a ? '–' : a.q === 'tr' ? 'tr.' : a.lim != null ? `&lt;${fmtN(a.lim)}` : (k === 'kcal' ? fmt0(a.v) : fmt1(a.v));
    return k === 'kcal' ? `<span><b>${t}</b> kcal</span>` : `<span>${lab} <b>${t}</b></span>`; };
  return f('kcal') + f('prot', 'P') + f('carb', 'C') + f('fat', 'G');
}
const cellTotal = (t, u) => (!t.have ? ND : `${fmtN(t.v)} ${u}${t.miss ? ` <small class="nd">(${t.miss} ${t.miss === 1 ? 'voce' : 'voci'} senza dato)</small>` : ''}`);
function panelHTML(cell, openMicro) {
  return NUTR_GROUPS.map(([g, title]) => {
    const rows = NUTRIENTS.filter(n => n.g === g).map(n => `<tr class="${n.sub ? 'sub' : ''}" data-k="${n.k}"><th>${n.l}</th><td>${cell(n)}</td></tr>`).join('');
    const body = `<table class="nutr">${rows}</table>`;
    return g === 'macro' ? `<h3>${title}</h3>${body}` : `<details class="more nutr-d" ${openMicro ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
  }).join('');
}

// Stagionalità (calendario ASL VCO / MIPAAF). 'imp' = esotico importato; assente = non indicata dalla fonte.
const curMonth = () => new Date().getMonth() + 1;
const seasonOf = f => (f.season !== undefined ? f.season : f.s);
const inSeason = s => Array.isArray(s) && s.includes(curMonth());
function seasonBadge(s) {
  if (s === 'imp') return '<small class="sb imp" title="Importato, disponibile tutto l\'anno">importato</small>';
  if (!Array.isArray(s)) return '';
  if (s.length === 12) return '<small class="sb ok">tutto l\'anno</small>';
  return inSeason(s) ? '<small class="sb ok">di stagione</small>' : '<small class="sb off">fuori stagione</small>';
}
function seasonText(s) {
  if (s === 'imp') return 'Prodotto esotico importato: disponibile tutto l\'anno, non coltivato localmente.';
  if (!Array.isArray(s)) return 'Stagionalità non indicata dalla fonte.';
  return `Di stagione: ${s.map(m => MONTH_NAMES[m - 1]).join(', ')}${inSeason(s) ? ' — <b>ora è di stagione</b>' : ' — ora fuori stagione (reperibile da conservazione o importazione)'}.`;
}

// Catalogo → record alimento (entra nel database solo quando lo usi, lo segni preferito o lo modifichi)
function catalogAsFood(c) {
  return { id: c.id, catalogId: c.id, catalogVersion: CAT.version, name: c.n, brand: '', unit: 'g', state: '',
    kcal: nv(c.v.kcal), prot: nv(c.v.prot), carb: nv(c.v.carb), fat: nv(c.v.fat), nutr: { ...c.v },
    units: (c.u || []).map(u => ({ ...u })), density: c.d || null, category: c.c, season: c.s ?? null, note: c.t || '',
    source: 'ciqual', srcInfo: c.src, dayPortions: {}, fav: false, createdAt: Date.now() };
}
async function getFoodOrCatalog(id) {
  const f = await get('foods', id);
  if (f) return { food: f, stored: true };
  const c = CAT_BY_ID.get(id);
  return c ? { food: catalogAsFood(c), stored: false } : { food: null, stored: false };
}
async function adopt(id) {
  const { food, stored } = await getFoodOrCatalog(id);
  if (food && !stored) await put('foods', food);
  return food;
}
// Aggiorna i valori degli alimenti del catalogo già usati quando cambia la versione del catalogo (stesso id: nessun doppione).
async function syncCatalog() {
  if (!CAT.version || (await getMeta('catalogVersion')) === CAT.version) return;
  const foods = (await getAll('foods')).filter(f => f.catalogId && CAT_BY_ID.has(f.catalogId) && f.catalogVersion !== CAT.version);
  const upd = foods.map(f => {
    const c = catalogAsFood(CAT_BY_ID.get(f.catalogId));
    const keep = (f.units || []).filter(u => u.custom || u.edited);
    const units = [...keep, ...c.units.filter(u => !keep.some(k => k.id === u.id))];
    const base = { ...f, units, category: c.category, season: c.season, note: c.note, srcInfo: c.srcInfo, catalogVersion: CAT.version };
    return f.customized ? base : { ...base, name: c.name, kcal: c.kcal, prot: c.prot, carb: c.carb, fat: c.fat, nutr: c.nutr, density: f.densityCustom ? f.density : c.density };
  });
  if (upd.length) await putMany('foods', upd);
  await setMeta('catalogVersion', CAT.version);
}

// Unità disponibili per un alimento. Il valore registrato è sempre nella base dell'alimento (g, o ml se i valori sono per 100 ml).
function foodUnits(f) {
  const base = unitOf(f);
  const d = f.density > 0 ? f.density : null;
  const list = [{ id: base, l: base, base: true }];
  list.push(base === 'g' ? { id: 'ml', l: 'ml', ml: 1, needD: !d, conv: true } : { id: 'g', l: 'g', g: 1, needD: !d, conv: true });
  for (const u of f.units || []) {
    const needD = base === 'g' ? (!u.g && !!u.ml && !d) : (!u.ml && !!u.g && !d);
    list.push({ ...u, needD });
  }
  return list;
}
function toBase(f, u, qty) {
  if (u.base) return qty;
  const d = f.density > 0 ? f.density : null;
  if (unitOf(f) === 'g') {
    if (u.g) return qty * u.g;
    if (u.ml && d) return qty * u.ml * d;
  } else {
    if (u.ml) return qty * u.ml;
    if (u.g && d) return qty * u.g / d;
  }
  return NaN;
}
const unitDesc = (f, u) => (u.base || u.conv ? '' : u.g ? `${fmtN(u.g)} g` : u.ml ? `${fmtN(u.ml)} ml${f.density > 0 && unitOf(f) === 'g' ? ` = ${fmtN(u.ml * f.density)} g` : ''}` : '');
// Quantità proposta: porzione del tipo di giornata > porzione abituale > ultima porzione usata > porzione standard > 100
function proposeQty(f, type) {
  const units = foodUnits(f);
  const dp = type ? f.dayPortions?.[type] : null;
  if (dp > 0) return { u: units[0], qty: dp, why: `porzione ${DAY_TYPES[type]}` };
  if (f.portion > 0) return { u: units[0], qty: f.portion, why: 'porzione abituale' };
  if (f.lastUnit) {
    const u = units.find(x => x.id === f.lastUnit && !x.needD);
    if (u && f.lastQty > 0) return { u, qty: f.lastQty, why: 'ultima porzione usata' };
  }
  if (f.lastGrams > 0) return { u: units[0], qty: f.lastGrams, why: 'ultima quantità' };
  const std = units.find(x => !x.base && !x.conv && !x.needD);
  if (std) return { u: std, qty: 1, why: std.src ? `porzione standard ${std.src}` : '' };
  return { u: units[0], qty: 100, why: '' };
}
function proposeGrams(f, type) {
  const p = proposeQty(f, type);
  return { g: toBase(f, p.u, p.qty), why: p.why };
}

// Ricerca: tutte le parole devono comparire (accenti ignorati; "mele" trova "Mela", "uova" trova "Uovo").
const SYN = { evo: 'extravergine', yoghurt: 'yogurt', parmigiano: 'parmigiano', petto: 'petto', grana: 'grana' };
function searchScore(hay, name, tokens) {
  const find = (txt, t) => { let i = txt.indexOf(t); if (i < 0 && t.length >= 4) i = txt.indexOf(t.slice(0, -1)); return i; };
  let score = 0;
  for (const t0 of tokens) {
    const t = SYN[t0] || t0;
    const i = find(name, t);  // prima nel nome (a inizio parola è meglio)…
    if (i >= 0) { score += i === 0 ? 0 : name[i - 1] === ' ' ? 1 : 3; continue; }
    if (find(hay, t) < 0) return -1;  // …poi in marca, categoria e note
    score += 6;
  }
  return score * 100 + name.length;
}
function searchList(items, q, hayOf) {
  const tokens = norm(q).split(' ').filter(Boolean);
  if (!tokens.length) return items;
  return items.map(x => ({ x, s: searchScore(hayOf(x), norm(x.name || x.n), tokens) })).filter(o => o.s >= 0).sort((a, b) => a.s - b.s).map(o => o.x);
}
const hayFood = f => norm(`${f.name || f.n} ${f.brand || ''} ${CAT_NAMES[f.category || f.c] || ''} ${f.note || f.t || ''}`);
function catChips(sel, season, act) {
  return `<div class="chips" role="group" aria-label="Categorie">
    <button class="chip ${season ? 'on' : ''}" data-act="${act}-season" aria-pressed="${!!season}">${ic('leaf')} Di stagione</button>
    <button class="chip ${!sel ? 'on' : ''}" data-act="${act}-cat" data-c="" aria-pressed="${!sel}">Tutto</button>
    ${(CAT.categories || []).map(c => `<button class="chip ${sel === c.id ? 'on' : ''}" data-act="${act}-cat" data-c="${c.id}" aria-pressed="${sel === c.id}">${esc(c.n)}</button>`).join('')}</div>`;
}
function filterBrowse(list, cat, season) {
  return list.filter(x => (!cat || (x.category || x.c) === cat) && (!season || inSeason(seasonOf(x))));
}

/* ---------- database ---------- */
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = e => {
      const d = rq.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('foods', { keyPath: 'id' });
        d.createObjectStore('combos', { keyPath: 'id' });
        d.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        // v1.1.0: solo aggiunte, nessun dato esistente viene modificato o cancellato.
        rq.transaction.objectStore('foods').createIndex('barcode', 'barcode', { unique: false });
        d.createObjectStore('days', { keyPath: 'date' });       // tipo di giornata e peso
        d.createObjectStore('templates', { keyPath: 'id' });    // giornate tipo
      }
      // Migrazioni future: if (e.oldVersion < 3) { ... } — mai cancellare gli archivi esistenti.
    };
    rq.onsuccess = () => {
      const d = rq.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      resolve(d);
    };
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => toast("Chiudi le altre finestre dell'app per completare l'aggiornamento.");
  });
}
const P = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transazione annullata')); });
const store = (s, mode) => db.transaction(s, mode).objectStore(s);
const getAll = s => P(store(s).getAll());
const get = (s, k) => P(store(s).get(k));
const count = s => P(store(s).count());
async function putMany(s, items) { const t = db.transaction(s, 'readwrite'); const o = t.objectStore(s); items.forEach(i => o.put(i)); return done(t); }
const put = (s, item) => putMany(s, [item]);
async function removeMany(s, keys) { const t = db.transaction(s, 'readwrite'); const o = t.objectStore(s); keys.forEach(k => o.delete(k)); return done(t); }
const remove = (s, k) => removeMany(s, [k]);
const entriesOn = d => P(store('entries').index('date').getAll(d));
const entriesBetween = (a, b) => P(store('entries').index('date').getAll(IDBKeyRange.bound(a, b)));
const daysBetween = (a, b) => P(store('days').getAll(IDBKeyRange.bound(a, b)));
const foodsByBarcode = code => P(store('foods').index('barcode').getAll(code));
const getMeta = async k => (await get('meta', k))?.value;
const setMeta = (k, value) => put('meta', { key: k, value });

/* ---------- giornata: tipo, peso, obiettivi ---------- */
// Il tipo esplicito del giorno vince sul programma settimanale. type '' = "nessuno" scelto a mano; null/assente = usa programma.
function resolveDay(date, rec, plan) {
  const explicit = rec && rec.type != null;
  const planned = plan?.[isoWeekday(date)] || '';
  return { type: explicit ? rec.type : planned, fromPlan: !explicit && !!planned, explicit, planned, weight: rec?.weight ?? null };
}
async function dayInfo(date) {
  const [rec, plan] = await Promise.all([get('days', date), getMeta('plan')]);
  return resolveDay(date, rec, plan);
}
async function setDay(date, patch) {
  const rec = (await get('days', date)) || { date };
  await put('days', { ...rec, ...patch });
}
const itemGrams = (it, v) => (!v || v === 'base' ? it.grams : (it.dayGrams?.[v] ?? it.grams));

/* ---------- stato e navigazione ---------- */
const state = { view: 'oggi', day: today(), followToday: true, week: mondayOf(today()), alimTab: 'catalog', persisted: null, catSel: '', catSeason: false, anim: {}, flash: new Set(), chart: { days: 7, metric: 'kcal', sel: null } };

function showView(v) {
  state.view = v;
  for (const s of $$('.view')) s.hidden = s.id !== 'view-' + v;
  $$('.tabs button').forEach(b => b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('#fab').hidden = v !== 'oggi';
  window.scrollTo(0, 0);
  return render();
}
function render() {
  if (state.view === 'oggi') return renderOggi();
  if (state.view === 'alimenti') return renderAlimenti();
  return renderSettimana();
}

/* ---------- OGGI ---------- */
async function renderOggi() {
  const el = $('#view-oggi');
  const [entries, prev, foodsN, lastBackup, totalEntries, info, goals, tplN] = await Promise.all([
    entriesOn(state.day), entriesOn(addDays(state.day, -1)), count('foods'), getMeta('lastBackup'), count('entries'),
    dayInfo(state.day), getMeta('goals'), count('templates')]);
  const isToday = state.day === today();
  const tot = sum(entries);
  const goal = info.type && goals?.[info.type] && NUTR.some(k => goals[info.type][k] > 0) ? goals[info.type] : null;
  let h = `<div class="daynav">
    <button class="icon" data-act="day" data-d="-1" aria-label="Giorno precedente">${ic('left')}</button>
    <div class="daylabel"><strong>${isToday ? 'Oggi' : esc(labelDay(state.day))}</strong>
      ${isToday ? `<span>${esc(labelDay(state.day))}</span>` : `<button class="link" data-act="day-today">Torna a oggi</button>`}</div>
    <button class="icon" data-act="day" data-d="1" aria-label="Giorno successivo">${ic('right')}</button></div>`;
  h += backupNotice(lastBackup, totalEntries);
  if (!foodsN && !totalEntries) h += welcomeCard();
  else h += installHint();
  h += `<div class="daytype" role="group" aria-label="Tipo di giornata">${Object.entries(DAY_TYPES).map(([k, l]) =>
      `<button data-act="set-type" data-type="${k}" aria-pressed="${info.type === k}"><span class="dot"></span>${l}</button>`).join('')}</div>`;
  if (info.fromPlan) h += `<p class="tiny">Tipo dal programma settimanale</p>`;
  else if (info.explicit && info.planned && info.planned !== info.type) h += `<p class="tiny">Modificato a mano · <button class="link tiny-link" data-act="type-plan">usa il programma (${DAY_TYPES[info.planned]})</button></p>`;
  h += totalsHTML(tot, goal);
  h += `<div class="quickrow"><button class="weight" data-act="weight">${ic('scale')}${info.weight ? `Peso <b>${fmt1(info.weight)} kg</b>` : 'Aggiungi peso corporeo'}</button></div>`;
  if (!foodsN) h += `<p class="hint">Inizia creando i tuoi alimenti: tocca <b>+</b> su un pasto e poi “Nuovo alimento” o “Scansiona codice”.</p>`;
  SLOTS.forEach((name, i) => {
    const slot = i + 1;
    const list = entries.filter(e => e.slot === slot).sort((a, b) => a.createdAt - b.createdAt);
    const prevList = prev.filter(e => e.slot === slot);
    const st = sum(list);
    h += `<article class="card meal" data-slot="${slot}">
      <header><span class="mi">${ic('m' + slot)}</span><div class="mt"><h2>${esc(name)}</h2><span class="sub">${list.length
        ? `<b>${fmt0(st.kcal)}</b> kcal <span class="mdots"><span class="p">${fmt0(st.prot)}</span><span class="c">${fmt0(st.carb)}</span><span class="f">${fmt0(st.fat)}</span></span>`
        : 'Nessun alimento'}</span></div>
      <button class="add" data-act="pick" data-slot="${slot}" aria-label="Aggiungi a ${esc(name)}">${ic('plus')}</button></header>`;
    if (list.length) {
      h += `<ul class="rows">${rowsHTML(list)}</ul>
        <footer><button class="link" data-act="save-combo" data-slot="${slot}">${ic('star', 'sm')} Salva come piatto</button></footer>`;
    } else if (prevList.length) {
      h += `<footer><button class="link" data-act="repeat" data-slot="${slot}">${ic('copy', 'sm')} Ripeti da ieri · ${prevList.length} ${prevList.length === 1 ? 'voce' : 'voci'}, ${fmt0(sum(prevList).kcal)} kcal</button></footer>`;
    }
    h += `</article>`;
  });
  h += `<div class="dayactions">
    ${tplN ? `<button class="btn" data-act="apply-template">${ic('dish', 'sm')} Applica giornata tipo</button>` : ''}
    <button class="btn" data-act="copy-from">${ic('copy', 'sm')} Copia da un altro giorno</button>
    ${entries.length ? `<button class="btn" data-act="save-template">${ic('star', 'sm')} Salva come giornata tipo</button>` : ''}</div>`;
  el.innerHTML = h;
  el.removeAttribute('aria-busy');
  state.flash.clear();
  runAnimations(el);
}

const entryRow = (e, cls = '') => `<li class="${cls}${state.flash.has(e.id) ? ' new' : ''}"><button class="row" data-act="edit-entry" data-id="${e.id}">
  <span class="nm">${esc(e.name)}${e.uLabel ? ` <small>${fmtN(e.qty)} × ${esc(e.uLabel)}</small>` : ''}</span><span class="g">${fmt0(e.grams)} ${unitOf(e)}</span><span class="k">${fmt0(e.kcal)}</span></button></li>`;
function rowsHTML(list) {
  let h = '';
  const seen = new Set();
  for (const e of list) {
    if (!e.groupId) { h += entryRow(e); continue; }
    if (seen.has(e.groupId)) continue;
    seen.add(e.groupId);
    const g = list.filter(x => x.groupId === e.groupId);
    h += `<li class="grp"><button class="row grp-h" data-act="edit-group" data-gid="${e.groupId}"><span class="nm">${ic('dish', 'sm')} ${esc(e.dishName || 'Piatto')}</span>
      <span class="g">${g.length} ingr.</span><span class="k">${fmt0(sum(g).kcal)}</span></button></li>` + g.map(x => entryRow(x, 'sub')).join('');
  }
  return h;
}

function totalsHTML(t, goal) {
  const C = 326.73;  // circonferenza dell'anello (r = 52)
  const key = state.day;
  const prev = state.anim.day === key ? state.anim : { kcal: 0, off: C, bars: {} };
  const g = goal?.kcal > 0 ? goal.kcal : 0;
  const off = g ? C * (1 - Math.min(1, t.kcal / g)) : C;
  const energy = t.prot * 4 + t.carb * 4 + t.fat * 9;
  const lab = { prot: 'Proteine', carb: 'Carboidrati', fat: 'Grassi' };
  const bars = {};
  const macroRow = k => {
    const gk = goal?.[k] > 0 ? goal[k] : 0;
    const share = energy > 0 ? (t[k] * (k === 'fat' ? 9 : 4)) / energy : 0;
    const pct = gk ? Math.min(100, t[k] / gk * 100) : share * 100;
    bars[k] = pct;
    return `<div class="mrow m-${k} ${gk && t[k] > gk ? 'over' : ''}"><span class="ml"><i></i>${lab[k]}</span>
      <span class="mv"><b>${fmt0(t[k])}</b>${gk ? ` / ${fmt0(gk)} g` : ` g · ${Math.round(share * 100)}%`}</span>
      <div class="mbar" role="progressbar" aria-label="${lab[k]}" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><em style="width:${prev.bars[k] ?? 0}%" data-to="${pct.toFixed(1)}%"></em></div></div>`;
  };
  let h = `<div class="totals" data-testid="totals">
    <div class="ring ${g && t.kcal > g ? 'over' : ''} ${g ? '' : 'nogoal'}" role="img" aria-label="${fmt0(t.kcal)} kcal${g ? ` su ${fmt0(g)}` : ''}">
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="11"/>
      <circle class="bar" cx="60" cy="60" r="52" fill="none" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" style="stroke-dashoffset:${prev.off}" data-to="${off.toFixed(2)}"/></svg>
      <div class="kcal"><b data-count="${t.kcal}" data-from="${prev.kcal}">${fmt0(prev.kcal)}</b><span>${g ? `di ${fmt0(g)} kcal` : 'kcal'}</span></div>
    </div>
    <div class="macros">${['prot', 'carb', 'fat'].map(macroRow).join('')}</div>
    <div class="totals-foot">`;
  if (goal) {
    const rem = [], over = [];
    for (const k of NUTR) {
      if (!(goal[k] > 0)) continue;
      const d = goal[k] - t[k];
      const txt = k === 'kcal' ? `${fmt0(Math.abs(d))} kcal` : `${NUTR_SHORT[k]} ${fmt0(Math.abs(d))} g`;
      (d >= 0 ? rem : over).push(txt);
    }
    h += `<p class="remain" data-testid="remain">${rem.length ? `Mancano: ${rem.join(' · ')}` : ''}${rem.length && over.length ? '<br>' : ''}${over.length ? `<span class="warn">Oltre: ${over.join(' · ')}</span>` : ''}</p>`;
  } else {
    h += `<button class="link nutr-link" data-act="set-goals">${ic('target', 'sm')} Imposta un obiettivo</button>`;
  }
  state.anim = { day: key, kcal: t.kcal, off, bars };
  return h + `<button class="link nutr-link" data-act="day-nutr">Fibre, sale, vitamine e minerali ${ic('right', 'sm')}</button></div></div>`;
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const installSteps = () => isIOS()
  ? 'In <b>Safari</b>: tocca <b>Condividi</b> (quadrato con freccia) → <b>Aggiungi alla schermata Home</b>.'
  : 'In <b>Chrome</b>: menu <b>⋮</b> → <b>Installa app</b> (o <i>Aggiungi a schermata Home</i>).';
function welcomeCard() {
  return `<div class="card pad welcome" data-testid="welcome"><p><b>Benvenuto in OS_FIT Diario.</b></p>
    <p class="sub">Hai un file di backup (per esempio dopo aver reinstallato l'app o cambiato telefono)? Ripristinalo qui e ritrovi alimenti, piatti e diario.</p>
    <div class="actions"><button class="btn primary" data-act="restore">Ripristina un backup</button><button class="btn" data-act="pick" data-slot="1">Inizia da zero</button></div>
    ${isStandalone() ? '' : `<p class="tiny">Per usarla offline aggiungila alla schermata Home. ${installSteps()}</p>`}</div>`;
}
function installHint() {
  if (isStandalone()) return '';
  try { if (localStorage.getItem('osfit-install-hint')) return ''; } catch { /* facoltativo */ }
  return `<div class="notice"><span>Installa l'app per usarla offline. ${installSteps()}</span><button class="link" data-act="dismiss-install" aria-label="Nascondi">${ic('close', 'sm')}</button></div>`;
}

function backupNotice(lastBackup, totalEntries) {
  if (!totalEntries) return '';
  const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 864e5) : null;
  if (days !== null && days < BACKUP_WARN_DAYS) return '';
  const msg = days === null ? 'Non hai ancora fatto un backup.' : `Ultimo backup ${days} giorni fa.`;
  return `<div class="notice"><span>${msg}</span><button class="link" data-act="goto-data">Fai backup</button></div>`;
}

async function setType(type) {
  const info = await dayInfo(state.day);
  await setDay(state.day, { type: info.type === type ? '' : type });
  render();
}

/* --- scelta alimento / piatto: ricerca unica su recenti, piatti, tuoi alimenti e catalogo --- */
async function openPicker(slot) {
  const [foods, combos, info] = await Promise.all([getAll('foods'), getAll('combos'), dayInfo(state.day)]);
  openSheet(`Aggiungi a ${SLOTS[slot - 1]}`, `
    <input type="search" id="pick-q" placeholder="Cerca: tuoi alimenti, piatti e catalogo" autocomplete="off" aria-label="Cerca">
    <div id="pick-cats"></div>
    <div class="pick-tools"><button class="btn" data-act="scan" data-slot="${slot}">${ic('scan')} Scansiona</button>
      <button class="btn" data-act="off-search" data-slot="${slot}">${ic('globe')} Cerca online</button>
      <button class="btn" data-act="copy-from" data-slot="${slot}">${ic('copy')} Copia giorno</button></div>
    <div id="pick-results"></div>
    <button class="btn ghost full" data-act="food-form" data-slot="${slot}">+ Nuovo alimento</button>`, { slot, cat: '', season: false, foods, combos, type: info.type });
  $('#pick-q').addEventListener('input', () => drawPicker());
  drawPicker();
}
function pickFoodLi(f, t) {
  const p = proposeGrams(f, t);
  return `<li><button data-act="pick-food" data-id="${f.id}"><span class="nm">${f.fav ? `<span class="star on">${ic('star', 'sm')}</span>` : ''}${esc(fullName(f))}${f.brand ? ` <small>${esc(f.brand)}</small>` : ''} ${seasonBadge(seasonOf(f))}</span>
    <span class="k">${fmt0(f.kcal)} kcal/100 ${unitOf(f)}${p.why && p.g > 0 ? ` · ${fmt0(p.g)} ${unitOf(f)} (${p.why})` : ''}</span></button></li>`;
}
function pickCatLi(c) {
  return `<li><button data-act="pick-food" data-id="${c.id}" data-catalog="1"><span class="nm">${esc(c.n)} ${seasonBadge(c.s)}</span>
    <span class="k">${fmt0(nv(c.v.kcal))} kcal/100 g · ${esc(CAT_NAMES[c.c] || '')}</span></button></li>`;
}
function drawPicker() {
  const ctx = sheetCtx;
  if (!$('#pick-results')) return;
  const { slot, foods, combos, type: t, cat, season } = ctx;
  const q = $('#pick-q').value.trim();
  $('#pick-cats').innerHTML = catChips(cat, season, 'pick');
  const mineIds = new Set(foods.map(f => f.id));
  let h = '';
  if (!q && !cat && !season) {
    // Vista rapida: recenti, piatti, preferiti, altri tuoi alimenti (ognuno compare una volta sola)
    const recent = foods.filter(f => f.lastUsed).sort(byRecent).slice(0, 8);
    const shown = new Set(recent.map(f => f.id));
    const fav = foods.filter(f => f.fav && !shown.has(f.id)).sort(byRecent);
    fav.forEach(f => shown.add(f.id));
    const rest = foods.filter(f => !shown.has(f.id)).sort(byRecent);
    if (recent.length) h += `<h3>Recenti</h3><ul class="pick">${recent.map(f => pickFoodLi(f, t)).join('')}</ul>`;
    if (combos.length) h += `<h3>Piatti</h3><ul class="pick">${[...combos].sort(byRecent).map(c => comboLi(c, t)).join('')}</ul>`;
    if (fav.length) h += `<h3>Alimenti preferiti</h3><ul class="pick">${fav.map(f => pickFoodLi(f, t)).join('')}</ul>`;
    if (rest.length) h += `<h3>${recent.length || fav.length ? 'Altri tuoi alimenti' : 'I tuoi alimenti'}</h3><ul class="pick">${rest.map(f => pickFoodLi(f, t)).join('')}</ul>`;
    h += `<p class="hint">Catalogo: ${CAT.foods.length} alimenti con valori Ciqual. Scrivi il nome o scegli una categoria.</p>`;
  } else {
    const cs = q ? searchList(combos, q, c => norm(c.name)) : [];
    const mine = searchList(filterBrowse(foods, cat, season), q, hayFood);
    const catalog = searchList(filterBrowse(CAT.foods.filter(c => !mineIds.has(c.id)), cat, season), q, hayFood);
    if (cs.length) h += `<h3>Piatti</h3><ul class="pick">${cs.map(c => comboLi(c, t)).join('')}</ul>`;
    if (mine.length) h += `<h3>I tuoi alimenti</h3><ul class="pick">${mine.slice(0, 40).map(f => pickFoodLi(f, t)).join('')}</ul>`;
    if (catalog.length) h += `<h3>Catalogo${cat ? ' · ' + esc(CAT_NAMES[cat]) : ''}${season ? ' · di stagione' : ''} <small>(${catalog.length})</small></h3><ul class="pick" data-testid="pick-catalog">${catalog.slice(0, 60).map(pickCatLi).join('')}</ul>`;
    if (!cs.length && !mine.length && !catalog.length) h += `<p class="empty">Nessun risultato.</p>`;
    if (q.length >= 2) h += `<button class="btn ghost full" data-act="off-search" data-q="${esc(q)}" data-slot="${slot}">${ic('globe', 'sm')} Cerca “${esc(q)}” tra i prodotti confezionati online</button>`;
  }
  $('#pick-results').innerHTML = h;
}
const comboLi = (c, t) => `<li><button data-act="pick-combo" data-id="${c.id}">
  <span class="nm">${ic('dish', 'sm')} ${esc(c.name)}</span><span class="k">${c.items.length} ingredienti · ${fmt0(sum(c.items.map(i => calc(i.per100, itemGrams(i, t)))).kcal)} kcal${t && c.items.some(i => i.dayGrams?.[t] != null) ? ` (${DAY_TYPES[t]})` : ''}</span></button></li>`;

/* --- quantità e unità: un solo foglio con calcolo immediato di calorie, macro e micro --- */
async function openGrams(foodId, slot) {
  const [{ food: f, stored }, info] = await Promise.all([getFoodOrCatalog(foodId), dayInfo(state.day)]);
  if (!f) return toast('Alimento non trovato.');
  const p = proposeQty(f, info.type);
  const per100 = per100Of(f);
  const nowSlot = slot || defaultSlot();
  openSheet(fullName(f), `
    <p class="sub per100">Per 100 ${unitOf(f)}: ${macroLineQ(per100, 100)} ${seasonBadge(seasonOf(f))}</p>
    <div class="units" id="g-units" role="group" aria-label="Unità di misura"></div>
    <div class="field big"><label for="g-in">Quantità (<span id="q-u"></span>)</label>
      <div class="stepper"><button class="icon" data-act="qty-step" data-d="-1" aria-label="Diminuisci">${ic('minus')}</button>
      <input id="g-in" type="text" inputmode="decimal" value="${String(p.qty).replace('.', ',')}" autocomplete="off">
      <button class="icon" data-act="qty-step" data-d="1" aria-label="Aumenta">${ic('plus')}</button></div></div>
    <p class="tiny" data-testid="why" id="q-why">${p.why ? `Proposta: ${esc(p.why)}. Se la cambi, vale solo per questa voce.` : ''}</p>
    <div id="g-prev" class="preview" data-testid="g-prev"></div>
    <details class="more" id="g-more"><summary>Tutti i nutrienti per questa quantità</summary><div id="g-nutr"></div></details>
    <details class="more"><summary>+ Nuova unità di misura</summary>
      <div class="grid2"><label class="field">Nome (es. “1 banana media”)<input id="nu-l" type="text" autocomplete="off"></label>
      <label class="field">Vale (${unitOf(f)})<input id="nu-v" type="text" inputmode="decimal" autocomplete="off"></label></div>
      <p class="tiny">Pesa una volta l'alimento e salva la sua unità: la ritrovi le prossime volte.</p>
      <button class="btn small" data-act="add-unit">Salva unità</button></details>
    ${slot ? '' : `<label class="field">Pasto<select id="g-slot">${SLOTS.map((s, i) => `<option value="${i + 1}" ${i + 1 === nowSlot ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`}
    <button class="btn primary full" data-act="save-grams">Salva in ${slot ? esc(SLOTS[slot - 1]) : 'diario'}</button>`,
    { slot, food: f, stored, unitId: p.u.id, per100 });
  const inp = $('#g-in');
  inp.addEventListener('input', updGrams);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveGrams(); });
  $('#g-more').addEventListener('toggle', updGrams);
  drawUnits(); updGrams(); inp.focus(); inp.select();
}
function defaultSlot() {
  const h = new Date().getHours();
  return h < 10 ? 1 : h < 12 ? 2 : h < 15 ? 3 : h < 18 ? 4 : 5;
}
function curUnit() { const f = sheetCtx.food; return foodUnits(f).find(u => u.id === sheetCtx.unitId) || foodUnits(f)[0]; }
function drawUnits() {
  const f = sheetCtx.food;
  $('#g-units').innerHTML = foodUnits(f).map(u => `<button class="chip ${u.id === sheetCtx.unitId ? 'on' : ''} ${u.needD ? 'dis' : ''}" data-act="pick-unit" data-u="${esc(u.id)}" aria-pressed="${u.id === sheetCtx.unitId}"
    title="${u.needD ? 'Serve la densità per convertire' : esc(unitDesc(f, u))}">${esc(u.l)}${unitDesc(f, u) ? ` <small>${esc(unitDesc(f, u))}</small>` : ''}</button>`).join('');
  $('#q-u').textContent = curUnit().base || curUnit().conv ? curUnit().l : 'n.';
}
function updGrams() {
  const f = sheetCtx.food;
  if (!f || !$('#g-prev')) return;
  const u = curUnit();
  const qty = num($('#g-in').value);
  const g = qty > 0 ? toBase(f, u, qty) : NaN;
  sheetCtx.grams = g;
  if (!(g > 0)) { $('#g-prev').innerHTML = '<span class="warn">Inserisci la quantità</span>'; $('#g-nutr').innerHTML = ''; return; }
  const pv = $('#g-prev'); pv.classList.remove('flash'); void pv.offsetWidth; pv.classList.add('flash');
  $('#g-prev').innerHTML = macroLineQ(sheetCtx.per100, g) + (u.base ? '' : `<span class="eq">= ${fmtN(g)} ${unitOf(f)}</span>`);
  if ($('#g-more').open) $('#g-nutr').innerHTML = panelHTML(n => cellAmount(amountOf(sheetCtx.per100, n.k, g), n.u), true);
}
function pickUnit(id) {
  const f = sheetCtx.food;
  const prev = curUnit();
  const u = foodUnits(f).find(x => x.id === id);
  if (!u) return;
  if (u.needD) return toast(`Per usare “${u.l}” serve la densità di questo alimento (g/ml): impostala in Modifica alimento, se è nota.`);
  const g = toBase(f, prev, num($('#g-in').value));
  sheetCtx.unitId = u.id;
  // passando a g/ml si mantiene la stessa quantità; passando a un'unità domestica si parte da 1
  const qty = (u.base || u.conv) && g > 0 ? r1(u.base ? g : (unitOf(f) === 'g' ? g / f.density : g * f.density)) : 1;
  $('#g-in').value = String(qty).replace('.', ',');
  $('#q-why').textContent = '';
  drawUnits(); updGrams();
}
async function addUnit() {
  const f = sheetCtx.food;
  const l = $('#nu-l').value.trim();
  const v = num($('#nu-v').value);
  if (!l) return toast('Dai un nome all\'unità.');
  if (!(v > 0 && v <= 5000)) return toast('Valore non valido.');
  const u = { id: 'u' + Date.now().toString(36), l, [unitOf(f) === 'ml' ? 'ml' : 'g']: v, custom: true, src: 'personalizzata' };
  f.units = [...(f.units || []), u];
  await put('foods', f);
  sheetCtx.stored = true;
  sheetCtx.unitId = u.id;
  $('#g-in').value = '1';
  $('#nu-l').value = ''; $('#nu-v').value = '';
  toast(`Unità “${l}” salvata`);
  drawUnits(); updGrams();
}
async function saveGrams() {
  const { slot, food: f } = sheetCtx;
  const u = curUnit();
  const qty = num($('#g-in').value);
  const g = qty > 0 ? toBase(f, u, qty) : NaN;
  if (!(g > 0 && g <= 5000)) return toast('Quantità non valida (1–5000).');
  const target = slot || +$('#g-slot').value;
  const extra = u.base ? {} : { qty, uLabel: u.l };
  const e = makeEntry({ foodId: f.id, name: fullName(f), per100: per100Of(f), unit: unitOf(f) }, r1(g), state.day, target, extra);
  await put('entries', e);
  state.flash.add(e.id); haptic();
  // ricorda l'ultima porzione usata; le porzioni configurate non vengono toccate
  const cur = (await get('foods', f.id)) || f;
  await put('foods', { ...cur, lastGrams: r1(g), lastUnit: u.id, lastQty: qty, lastUsed: Date.now() });
  closeSheet();
  toast(`${f.name} aggiunto`, () => remove('entries', e.id).then(render));
  if (!slot && state.view !== 'oggi') { state.day = today(); state.followToday = true; }
  render();
}

/* --- catalogo (scheda Alimenti → Catalogo) e scheda alimento --- */
function drawCatalogBrowse() {
  const q = $('#alim-q')?.value.trim() || '';
  const { catSel: cat, catSeason: season } = state;
  $('#alim-cats').innerHTML = catChips(cat, season, 'cb');
  const list = searchList(filterBrowse(CAT.foods, cat, season), q, hayFood);
  const shown = (q || cat || season) ? list.slice(0, 120) : list.slice(0, 40);
  $('#alim-list').innerHTML = shown.length ? shown.map(c => `<li class="item"><button class="main" data-act="food-info" data-id="${c.id}">
      <span class="nm">${esc(c.n)} ${seasonBadge(c.s)}</span>
      <span class="k">${fmt0(nv(c.v.kcal))} kcal · P ${fmt1(nv(c.v.prot))} · C ${fmt1(nv(c.v.carb))} · G ${fmt1(nv(c.v.fat))} <small>/100 g · ${esc(CAT_NAMES[c.c] || '')}</small></span></button></li>`).join('')
    + (list.length > shown.length ? `<li class="empty">Altri ${list.length - shown.length}: affina la ricerca o scegli una categoria.</li>` : '')
    : '<li class="empty">Nessun alimento trovato.</li>';
}
async function openFoodInfo(id) {
  const { food: f, stored } = await getFoodOrCatalog(id);
  if (!f) return;
  const per100 = per100Of(f);
  const raw = f.nutr || per100;
  const src = f.srcInfo ? `Ciqual 2025 (ANSES), codice ${f.srcInfo.code} — “${esc(f.srcInfo.en)}”` : f.source === 'off' ? 'Open Food Facts (verificare con l\'etichetta)' : 'Inserito da te';
  const units = foodUnits(f).filter(u => !u.base && !u.conv);
  openSheet(fullName(f), `
    <p class="sub">${esc(CAT_NAMES[f.category] || '')}${f.customized ? ' · <b>valori modificati da te</b>' : ''}</p>
    ${f.note ? `<p class="notice-in">${esc(f.note)}</p>` : ''}
    <p class="tiny">Valori per 100 ${unitOf(f)}${f.srcInfo ? ' di parte edibile' : ''}. Fonte: ${src}.</p>
    <p class="season-line">${seasonText(seasonOf(f))}</p>
    ${units.length ? `<p class="sub">Unità: ${units.map(u => `${esc(u.l)}${unitDesc(f, u) ? ` = ${esc(unitDesc(f, u))}` : ''}${u.needD ? ' (serve la densità)' : ''}`).join(' · ')}</p>` : ''}
    <div data-testid="food-panel">${panelHTML(n => cellRaw(raw[n.k] ?? per100[n.k], n.u), true)}</div>
    <div class="actions">
      <button class="btn" data-act="info-fav" data-id="${esc(f.id)}">${ic('star', 'sm')} ${f.fav ? 'Preferito' : 'Aggiungi ai preferiti'}</button>
      <button class="btn" data-act="info-edit" data-id="${esc(f.id)}">Porzioni e dati</button>
      <button class="btn primary" data-act="info-add" data-id="${esc(f.id)}">Aggiungi al diario</button>
    </div>`, { infoId: f.id, stored });
}
async function infoFav(id) {
  const f = await adopt(id);
  await put('foods', { ...f, fav: !f.fav });
  toast(f.fav ? 'Tolto dai preferiti' : 'Aggiunto ai preferiti');
  openFoodInfo(id); render();
}

/* --- nutrienti del giorno --- */
async function openDayNutr() {
  const entries = await entriesOn(state.day);
  const t = totalsFull(entries);
  const partial = entries.filter(e => NUTR_KEYS.some(k => !hasVal(e.per100?.[k]))).length;
  openSheet(`Nutrienti · ${state.day === today() ? 'oggi' : labelDay(state.day)}`, `
    <p class="tiny">${entries.length} voci. Ogni totale somma solo le voci che hanno il dato: un dato non disponibile non viene contato come zero.${partial ? ` ${partial} ${partial === 1 ? 'voce non ha' : 'voci non hanno'} tutti i micronutrienti (alimenti inseriti a mano, da etichetta o registrati con versioni precedenti).` : ''}</p>
    <div data-testid="day-panel">${panelHTML(n => cellTotal(t[n.k], n.u), true)}</div>`);
}

/* --- piatto nel diario --- */
async function openComboUse(comboId, slot) {
  const [c, info] = await Promise.all([get('combos', comboId), dayInfo(state.day)]);
  if (!c) return;
  const v = info.type || 'base';
  const items = [];
  for (const it of c.items) {
    const f = it.foodId ? await get('foods', it.foodId) : null; // valori aggiornati se l'alimento esiste ancora
    items.push({ ...it, foodId: f ? f.id : null, name: f ? fullName(f) : it.name, per100: f ? per100Of(f) : it.per100, unit: f ? unitOf(f) : unitOf(it), g: itemGrams(it, v) });
  }
  const hasVar = v !== 'base' && c.items.some(it => it.dayGrams?.[v] != null);
  openSheet(c.name, `
    ${c.cookedWeight ? `<div class="seg" role="tablist"><button data-act="cu-mode" data-m="ingr" aria-selected="true">Per ingredienti</button><button data-act="cu-mode" data-m="cooked" aria-selected="false">Porzione di piatto cotto</button></div>` : ''}
    <div id="cu"></div>
    <button class="btn primary full" data-act="save-combo-use">Salva in ${esc(SLOTS[slot - 1])}</button>`, { slot, combo: c, items, mode: 'ingr', v, hasVar });
  drawComboUse();
}
function drawComboUse() {
  const { combo: c, items, mode, v, hasVar } = sheetCtx;
  $$('[data-act="cu-mode"]').forEach(b => b.setAttribute('aria-selected', b.dataset.m === mode));
  const box = $('#cu');
  if (mode === 'cooked') {
    const base = rawTotals(items.map(it => ({ per100: it.per100, grams: it.grams })));
    const per100 = Object.fromEntries(NUTR.map(k => [k, base[k] * 100 / c.cookedWeight]));
    sheetCtx.cookedPer100 = per100;
    box.innerHTML = `<p class="sub">Ricetta base: ${fmt0(c.items.reduce((s, i) => s + i.grams, 0))} g di ingredienti → ${fmt0(c.cookedWeight)} g di piatto cotto.
      Per 100 g di piatto cotto: ${fmt0(per100.kcal)} kcal · P ${fmt1(per100.prot)} · C ${fmt1(per100.carb)} · G ${fmt1(per100.fat)}</p>
      <label class="field big">Porzione cotta (g)<input id="cu-g" type="text" inputmode="decimal" value="" autocomplete="off"></label>
      <div id="c-prev" class="preview"></div>`;
    const inp = $('#cu-g');
    const upd = () => { const g = num(inp.value); $('#c-prev').innerHTML = g > 0 ? macroLine(calc(per100, g)) : '<span class="warn">Inserisci i grammi</span>'; };
    inp.addEventListener('input', upd); upd(); inp.focus();
    return;
  }
  box.innerHTML = `<p class="sub">${hasVar ? `Quantità per giorno <b>${DAY_TYPES[v]}</b>` : 'Quantità della ricetta'} · modificabili solo per questa volta</p>
    <ul class="combo-items">${items.map((it, i) => `<li><span class="nm">${esc(it.name)}</span>
      <label class="g-inline"><input type="text" inputmode="decimal" data-i="${i}" value="${it.g}" aria-label="Quantità ${esc(it.name)}"> ${unitOf(it)}</label></li>`).join('')}</ul>
    <div id="c-prev" class="preview"></div>`;
  const upd = () => { $('#c-prev').innerHTML = macroLine(sum(items.map((it, i) => calc(it.per100, num($(`[data-i="${i}"]`).value) || 0)))); };
  $$('#cu [data-i]').forEach(i => i.addEventListener('input', upd));
  upd();
}
async function saveComboUse() {
  const { slot, combo, items, mode } = sheetCtx;
  if (mode === 'cooked') {
    const g = num($('#cu-g').value);
    if (!(g > 0 && g <= 5000)) return toast('Porzione non valida.');
    const e = makeEntry({ name: `${combo.name} (cotto)`, per100: sheetCtx.cookedPer100, unit: 'g' }, g, state.day, slot, { dishId: combo.id, dishName: combo.name });
    await put('entries', e);
    await put('combos', { ...combo, lastUsed: Date.now() });
    closeSheet(); toast(`${combo.name} aggiunto`, () => remove('entries', e.id).then(render)); render();
    return;
  }
  const groupId = uid();
  const entries = [];
  for (const [i, it] of items.entries()) {
    const g = num($(`[data-i="${i}"]`).value);
    if (!(g >= 0 && g <= 5000)) return toast(`Quantità non valida per ${it.name}.`);
    if (g === 0) continue;
    entries.push(makeEntry(it, g, state.day, slot, { dishId: combo.id, dishName: combo.name, groupId }));
  }
  if (!entries.length) return toast('Nessuna quantità inserita.');
  entries.forEach((e, i) => { e.createdAt += i; state.flash.add(e.id); });
  await putMany('entries', entries); haptic();
  await put('combos', { ...combo, lastUsed: Date.now() });
  closeSheet();
  toast(`${combo.name} aggiunto`, () => removeMany('entries', entries.map(e => e.id)).then(render));
  render();
}

async function openGroup(gid) {
  const list = (await entriesOn(state.day)).filter(e => e.groupId === gid).sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) return;
  openSheet(list[0].dishName || 'Piatto', `
    <ul class="mini">${list.map(e => `<li>${esc(e.name)} — ${fmt0(e.grams)} ${unitOf(e)} · ${fmt0(e.kcal)} kcal</li>`).join('')}</ul>
    <div class="preview">${macroLine(sum(list))}</div>
    <p class="sub">Per cambiare un ingrediente toccalo nell'elenco del pasto.</p>
    <button class="btn danger full" data-act="del-group">Elimina il piatto da questo pasto</button>`, { list });
}
async function delGroup() {
  const { list } = sheetCtx;
  await removeMany('entries', list.map(e => e.id));
  closeSheet(); toast('Piatto eliminato', () => putMany('entries', list).then(render)); render();
}

async function openEntryEdit(id) {
  const e = await get('entries', id);
  if (!e) return;
  const u = unitOf(e);
  openSheet(e.name, `
    <p class="sub">${esc(labelDay(e.date))}${e.dishName ? ` · nel piatto “${esc(e.dishName)}”` : ''}</p>
    <label class="field big">Quantità (${u})<input id="e-g" type="text" inputmode="decimal" value="${e.grams}" autocomplete="off"></label>
    <label class="field">Pasto<select id="e-slot">${SLOTS.map((s, i) => `<option value="${i + 1}" ${e.slot === i + 1 ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <div id="e-prev" class="preview"></div>
    <div class="actions"><button class="btn danger" data-act="del-entry">Elimina</button><button class="btn primary" data-act="save-entry">Salva</button></div>`, { entry: e });
  const upd = () => { const g = num($('#e-g').value); $('#e-prev').innerHTML = g > 0 ? macroLine(calc(e.per100, g)) : '<span class="warn">Inserisci la quantità</span>'; };
  $('#e-g').addEventListener('input', upd); upd();
}
async function saveEntry() {
  const e = sheetCtx.entry;
  const g = num($('#e-g').value);
  if (!(g > 0 && g <= 5000)) return toast('Quantità non valida (1–5000).');
  const slot = +$('#e-slot').value;
  const moved = slot !== e.slot;
  await put('entries', { ...e, grams: g, slot, ...calc(e.per100, g), ...(moved ? { groupId: undefined } : {}) });
  closeSheet(); toast('Voce aggiornata'); render();
}
async function delEntry() {
  const e = sheetCtx.entry;
  await remove('entries', e.id);
  closeSheet();
  toast('Voce eliminata', () => put('entries', e).then(render));
  render();
}

async function repeatYesterday(slot) {
  const prev = (await entriesOn(addDays(state.day, -1))).filter(e => e.slot === slot).sort((a, b) => a.createdAt - b.createdAt);
  const copies = cloneEntries(prev, state.day);
  await putMany('entries', copies);
  toast(`${copies.length} ${copies.length === 1 ? 'voce copiata' : 'voci copiate'}`, () => removeMany('entries', copies.map(c => c.id)).then(render));
  render();
}

/* --- copia da un giorno qualsiasi --- */
async function openCopy(slot) {
  openSheet(slot ? `Copia in ${SLOTS[slot - 1]}` : 'Copia da un altro giorno', `
    <label class="field">Da quale giorno<input id="cp-date" type="date" value="${addDays(state.day, -1)}"></label>
    ${slot ? `<label class="field">Quale pasto<select id="cp-slot">${SLOTS.map((s, i) => `<option value="${i + 1}" ${i + 1 === slot ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}
    <div id="cp-prev"></div>
    <button class="btn primary full" data-act="copy-do">Copia ${slot ? `in ${esc(SLOTS[slot - 1])}` : 'nel giorno mostrato'}</button>`, { slot, list: [] });
  const upd = async () => {
    const d = $('#cp-date').value;
    let list = /^\d{4}-\d{2}-\d{2}$/.test(d) ? await entriesOn(d) : [];
    if (slot) list = list.filter(e => e.slot === +$('#cp-slot').value);
    list.sort((a, b) => a.slot - b.slot || a.createdAt - b.createdAt);
    sheetCtx.list = list;
    $('#cp-prev').innerHTML = list.length
      ? `<p class="sub">${list.length} ${list.length === 1 ? 'voce' : 'voci'} · ${fmt0(sum(list).kcal)} kcal</p><ul class="mini">${list.map(e => `<li>${slot ? '' : `<b>${SLOTS[e.slot - 1]}</b> `}${esc(e.name)} ${fmt0(e.grams)} ${unitOf(e)}</li>`).join('')}</ul>`
      : '<p class="empty">Nessuna voce da copiare in quel giorno.</p>';
  };
  $('#cp-date').addEventListener('change', upd);
  $('#cp-slot')?.addEventListener('change', upd);
  await upd();
}
async function copyDo() {
  const { list, slot } = sheetCtx;
  if (!list.length) return toast('Niente da copiare.');
  const copies = cloneEntries(list, state.day, slot);
  await putMany('entries', copies);
  closeSheet();
  toast(`${copies.length} ${copies.length === 1 ? 'voce copiata' : 'voci copiate'}`, () => removeMany('entries', copies.map(c => c.id)).then(render));
  render();
}

/* --- piatto creato da un pasto registrato --- */
async function openSaveCombo(slot) {
  const list = (await entriesOn(state.day)).filter(e => e.slot === slot).sort((a, b) => a.createdAt - b.createdAt);
  openSheet('Salva come piatto', `
    <p class="sub">${list.map(e => `${esc(e.name)} ${fmt0(e.grams)} ${unitOf(e)}`).join(' · ')}</p>
    <label class="field">Nome<input id="combo-name" type="text" value="${esc(SLOTS[slot - 1])} abituale" autocomplete="off"></label>
    <button class="btn primary full" data-act="save-combo-new">Salva</button>`, { list });
  $('#combo-name').select();
}
async function saveComboNew() {
  const name = $('#combo-name').value.trim();
  if (!name) return toast('Dai un nome al piatto.');
  const items = sheetCtx.list.filter(e => e.foodId || !e.dishId).map(e => ({ foodId: e.foodId, name: e.name, per100: e.per100, unit: unitOf(e), grams: e.grams, dayGrams: {} }));
  if (!items.length) return toast('Nessun ingrediente utilizzabile.');
  await put('combos', { id: uid(), name, items, createdAt: Date.now(), lastUsed: Date.now() });
  closeSheet(); toast(`Piatto “${name}” salvato`);
}

/* --- giornate tipo --- */
async function openSaveTemplate() {
  const [list, info] = await Promise.all([entriesOn(state.day), dayInfo(state.day)]);
  openSheet('Salva come giornata tipo', `
    <p class="sub">${list.length} voci · ${fmt0(sum(list).kcal)} kcal. La potrai applicare a un altro giorno con un tocco.</p>
    <label class="field">Nome<input id="tpl-name" type="text" value="Giornata ${info.type ? DAY_TYPES[info.type].toLowerCase() : 'tipo'}" autocomplete="off"></label>
    <label class="field">Tipo di giornata<select id="tpl-type"><option value="">—</option>${Object.entries(DAY_TYPES).map(([k, l]) => `<option value="${k}" ${info.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="btn primary full" data-act="save-template-do">Salva</button>`, { list });
}
async function saveTemplateDo() {
  const name = $('#tpl-name').value.trim();
  if (!name) return toast('Dai un nome alla giornata tipo.');
  const entries = sheetCtx.list.sort((a, b) => a.slot - b.slot || a.createdAt - b.createdAt)
    .map(({ id, date, createdAt, ...rest }) => rest);
  await put('templates', { id: uid(), name, type: $('#tpl-type').value, entries, createdAt: Date.now() });
  closeSheet(); toast(`Giornata tipo “${name}” salvata`); render();
}
async function openTemplates() {
  const [tpls, info, cur] = await Promise.all([getAll('templates'), dayInfo(state.day), entriesOn(state.day)]);
  tpls.sort((a, b) => (b.type === info.type) - (a.type === info.type) || byName(a, b));
  openSheet('Applica giornata tipo', `
    ${cur.length ? `<p class="sub">Questo giorno ha già ${cur.length} voci: quelle della giornata tipo verranno aggiunte.</p>` : ''}
    <ul class="pick">${tpls.map(t => `<li><button data-act="use-template" data-id="${t.id}"><span class="nm">${esc(t.name)}${t.type ? ` <small class="tb tb-${t.type}">${DAY_TYPES[t.type]}</small>` : ''}</span>
      <span class="k">${t.entries.length} voci · ${fmt0(sum(t.entries).kcal)} kcal</span></button></li>`).join('')}</ul>`);
}
async function useTemplate(id) {
  const t = await get('templates', id);
  const copies = cloneEntries(t.entries, state.day);
  await putMany('entries', copies);
  if (t.type) { const info = await dayInfo(state.day); if (!info.type) await setDay(state.day, { type: t.type }); }
  closeSheet();
  toast(`“${t.name}” applicata`, () => removeMany('entries', copies.map(c => c.id)).then(render));
  render();
}
async function openTemplateForm(id) {
  const t = await get('templates', id);
  if (!t) return;
  openSheet('Giornata tipo', `
    <label class="field">Nome<input id="tpl-name" type="text" value="${esc(t.name)}" autocomplete="off"></label>
    <label class="field">Tipo di giornata<select id="tpl-type"><option value="">—</option>${Object.entries(DAY_TYPES).map(([k, l]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <ul class="mini">${t.entries.map(e => `<li><b>${SLOTS[e.slot - 1]}</b> ${esc(e.name)} ${fmt0(e.grams)} ${unitOf(e)}</li>`).join('')}</ul>
    <div class="preview">${macroLine(sum(t.entries))}</div>
    <p class="sub">Per cambiare le voci: applicala a un giorno, modificala e salvala di nuovo come giornata tipo.</p>
    <div class="actions"><button class="btn danger" data-act="del-template">Elimina</button><button class="btn primary" data-act="save-template-edit">Salva</button></div>`, { tpl: t });
}
async function saveTemplateEdit() {
  const name = $('#tpl-name').value.trim();
  if (!name) return toast('Dai un nome alla giornata tipo.');
  await put('templates', { ...sheetCtx.tpl, name, type: $('#tpl-type').value });
  closeSheet(); toast('Giornata tipo aggiornata'); render();
}
async function delTemplate() {
  const t = sheetCtx.tpl;
  if (!confirm(`Eliminare la giornata tipo “${t.name}”? Il diario non cambia.`)) return;
  await remove('templates', t.id);
  closeSheet(); toast('Giornata tipo eliminata', () => put('templates', t).then(render)); render();
}

/* --- peso --- */
async function openWeight() {
  const info = await dayInfo(state.day);
  openSheet('Peso corporeo', `
    <p class="sub">${esc(labelDay(state.day))}</p>
    <label class="field big">Peso (kg)<input id="w-in" type="text" inputmode="decimal" value="${info.weight ?? ''}" autocomplete="off"></label>
    <div class="actions">${info.weight ? '<button class="btn danger" data-act="weight-clear">Rimuovi</button>' : ''}<button class="btn primary" data-act="weight-save">Salva</button></div>`);
  $('#w-in').focus();
}
async function saveWeight(clear) {
  let w = null;
  if (!clear) {
    w = num($('#w-in').value);
    if (!(w >= 20 && w <= 400)) return toast('Peso non valido (20–400 kg).');
    w = r1(w);
  }
  await setDay(state.day, { weight: w });
  closeSheet(); toast(clear ? 'Peso rimosso' : 'Peso salvato'); render();
}

/* ---------- ALIMENTI ---------- */
async function renderAlimenti() {
  const el = $('#view-alimenti');
  const tab = state.alimTab;
  el.innerHTML = `
    <div class="seg seg4" role="tablist">
      <button role="tab" data-act="alim-tab" data-tab="catalog" aria-selected="${tab === 'catalog'}">Catalogo</button>
      <button role="tab" data-act="alim-tab" data-tab="foods" aria-selected="${tab === 'foods'}">I miei</button>
      <button role="tab" data-act="alim-tab" data-tab="combos" aria-selected="${tab === 'combos'}">Piatti</button>
      <button role="tab" data-act="alim-tab" data-tab="templates" aria-selected="${tab === 'templates'}">Giornate</button>
    </div>
    <div class="toolbar"><input type="search" id="alim-q" placeholder="${tab === 'catalog' ? `Cerca nel catalogo (${CAT.foods.length} alimenti)` : 'Cerca'}" aria-label="Cerca" autocomplete="off">
      ${tab === 'foods' ? `<button class="btn" data-act="scan" aria-label="Scansiona codice">${ic('scan')}</button><button class="btn" data-act="off-search" aria-label="Cerca prodotti online">${ic('globe')}</button><button class="btn primary" data-act="food-form">+ Nuovo</button>` : ''}
      ${tab === 'combos' ? `<button class="btn primary" data-act="dish-form">+ Nuovo</button>` : ''}</div>
    ${tab === 'catalog' ? '<div id="alim-cats"></div>' : ''}
    <ul class="list" id="alim-list"></ul>
    ${tab === 'catalog' ? `<p class="tiny">Valori: ${esc(CAT.source?.name || '')} (${esc(CAT.source?.licence || '')}), per 100 g di parte edibile. Porzioni: ${esc(CAT.portions || '')}. Stagionalità: ${esc(CAT.seasons || '')}.</p>` : ''}
    ${tab === 'combos' ? `<p class="hint">Un piatto si crea da qui scegliendo gli ingredienti, oppure da Oggi con “Salva come piatto”. Le quantità per Pesi, Cardio e Riposo si impostano nel piatto.</p>` : ''}
    ${tab === 'templates' ? `<p class="hint">Una giornata tipo si crea da Oggi con “Salva come giornata tipo” e si applica con “Applica giornata tipo”.</p>` : ''}`;
  if (tab === 'catalog') {
    $('#alim-q').addEventListener('input', drawCatalogBrowse);
    drawCatalogBrowse();
    return;
  }
  const all = await getAll(tab);
  const row = x => {
    if (tab === 'foods') return `<li class="item"><button class="star" data-act="toggle-fav" data-id="${x.id}" aria-label="${x.fav ? 'Togli dai' : 'Aggiungi ai'} preferiti" aria-pressed="${!!x.fav}">${ic('star')}</button>
      <button class="main" data-act="food-form" data-id="${x.id}"><span class="nm">${esc(fullName(x))}${x.brand ? ` <small>${esc(x.brand)}</small>` : ''}${x.barcode ? ' <small title="Con codice a barre">▥</small>' : ''}${x.catalogId ? ' <small title="Dal catalogo">◆</small>' : ''}</span>
      <span class="k">${fmt0(x.kcal)} kcal · P ${fmt1(x.prot)} · C ${fmt1(x.carb)} · G ${fmt1(x.fat)} <small>/100 ${unitOf(x)}</small></span></button></li>`;
    if (tab === 'combos') return `<li class="item"><span class="star on">${ic('dish')}</span><button class="main" data-act="combo-form" data-id="${x.id}"><span class="nm">${esc(x.name)}</span>
      <span class="k">${fmt0(sum(x.items.map(i => calc(i.per100, i.grams))).kcal)} kcal · ${x.items.map(i => esc(i.name)).join(', ')}</span></button></li>`;
    return `<li class="item"><span class="star on">${ic('today')}</span><button class="main" data-act="template-form" data-id="${x.id}"><span class="nm">${esc(x.name)}${x.type ? ` <small class="tb tb-${x.type}">${DAY_TYPES[x.type]}</small>` : ''}</span>
      <span class="k">${x.entries.length} voci · ${fmt0(sum(x.entries).kcal)} kcal</span></button></li>`;
  };
  const empty = { foods: 'Nessun alimento. Tocca “+ Nuovo”, scansiona un codice o cerca un prodotto online.', combos: 'Nessun piatto. Tocca “+ Nuovo”.', templates: 'Nessuna giornata tipo.' };
  const draw = q => {
    const ql = norm(q);
    const items = all.filter(x => !ql || norm(x.name + ' ' + (x.brand || '')).includes(ql)).sort(byName);
    $('#alim-list').innerHTML = items.length ? items.map(row).join('') : `<li class="empty">${all.length ? 'Nessun risultato.' : empty[tab]}${tab === 'foods' && ql.length >= 2 ? ` <button class="link" data-act="off-search" data-q="${esc(q.trim())}">Cerca “${esc(q.trim())}” online</button>` : ''}</li>`;
  };
  $('#alim-q').addEventListener('input', e => draw(e.target.value));
  draw('');
}

async function openFoodForm(id, slot, prefill) {
  const base = { name: '', brand: '', unit: 'g', state: '', kcal: '', prot: '', carb: '', fat: '', portion: '', fav: false, barcode: '', dayPortions: {}, units: [], density: null };
  let f, stored = false;
  if (id) {
    const r = await getFoodOrCatalog(id);
    if (!r.food) return toast('Alimento non trovato.');
    f = { ...base, ...r.food }; stored = r.stored;
  } else f = { ...base, ...(prefill || {}) };
  const notes = prefill?.notes || {};
  const n = v => (v === '' || v == null || Number.isNaN(v) ? '' : String(v).replace('.', ','));
  const rawN = v => (typeof v === 'string' && (v === 'tr' || v.startsWith('<')) ? (v === 'tr' ? 'tracce' : v.replace('.', ',')) : n(v));
  const note = k => notes[k] ? `<small class="${notes[k].startsWith('Calcolato') ? 'info' : 'warn'}" data-testid="note-${k}">${esc(notes[k])}</small>` : '';
  const hasDP = Object.values(f.dayPortions || {}).some(v => v > 0);
  const nutr = f.nutr || {};
  const extraVal = k => rawN(nutr[k] ?? f[k]);
  const fromCat = !!f.catalogId;
  openSheet(id ? 'Modifica alimento' : 'Nuovo alimento', `
    ${prefill?.note ? `<p class="notice-in" data-testid="prefill-note">${esc(prefill.note)}${prefill.offLink ? `<br><a href="https://world.openfoodfacts.org/product/${esc(prefill.offLink)}" target="_blank" rel="noopener">Apri la scheda del prodotto su Open Food Facts</a>` : ''}</p>` : ''}
    ${fromCat ? `<p class="tiny">Dal catalogo: Ciqual 2025 (ANSES), codice ${f.srcInfo?.code ?? ''}. Se modifichi i valori nutrizionali l'alimento diventa “personalizzato” e non verrà più aggiornato dal catalogo. <button class="link tiny-link" data-act="food-info" data-id="${esc(f.id)}">Scheda nutrizionale completa</button></p>` : ''}
    <label class="field">Nome<input id="f-name" type="text" value="${esc(f.name)}" autocomplete="off">${note('name')}</label>
    <label class="field">Marca (facoltativa)<input id="f-brand" type="text" value="${esc(f.brand || '')}" autocomplete="off"></label>
    <div class="grid2">
      <label class="field">Valori riferiti a<select id="f-unit" ${fromCat ? 'disabled' : ''}><option value="g">100 grammi (g)</option><option value="ml">100 millilitri (ml)</option></select></label>
      <label class="field">Crudo / cotto<select id="f-state"><option value="">—</option><option value="crudo">crudo</option><option value="cotto">cotto</option></select></label>
    </div>
    <p class="sub">Valori per 100 <span id="f-u">${unitOf(f)}</span></p>
    <div class="grid4">
      <label class="field">kcal<input id="f-kcal" type="text" inputmode="decimal" value="${n(f.kcal)}">${note('kcal')}</label>
      <label class="field">Proteine<input id="f-prot" type="text" inputmode="decimal" value="${n(f.prot)}">${note('prot')}</label>
      <label class="field">Carboidrati<input id="f-carb" type="text" inputmode="decimal" value="${n(f.carb)}">${note('carb')}</label>
      <label class="field">Grassi<input id="f-fat" type="text" inputmode="decimal" value="${n(f.fat)}">${note('fat')}</label>
    </div>
    <details class="more" ${EXTRA_FORM.some(([k]) => hasVal(nutr[k] ?? f[k])) ? 'open' : ''}><summary>Zuccheri, saturi, fibre, sale (facoltativi)</summary>
      <div class="grid4">${EXTRA_FORM.map(([k, l]) => `<label class="field">${l}<input id="f-${k}" type="text" inputmode="decimal" value="${extraVal(k)}" placeholder="n.d."></label>`).join('')}</div>
      <p class="tiny">Lascia vuoto se il dato non è disponibile: non verrà contato come zero.</p>
    </details>
    <label class="field">Porzione abituale (facoltativa)<input id="f-portion" type="text" inputmode="decimal" value="${n(f.portion)}"></label>
    <details class="more" ${hasDP ? 'open' : ''}><summary>Porzioni per tipo di giornata</summary>
      <p class="sub">Proposte automaticamente quando il giorno è Pesi, Cardio o Riposo.</p>
      <div class="grid3">${Object.entries(DAY_TYPES).map(([k, l]) => `<label class="field">${l}<input id="f-dp-${k}" type="text" inputmode="decimal" value="${n(f.dayPortions?.[k])}"></label>`).join('')}</div>
    </details>
    <details class="more" ${(f.units || []).length || f.density ? 'open' : ''} id="f-units-box"><summary>Unità di misura e conversioni</summary>
      <div id="f-units"></div>
      <button class="btn small" data-act="fu-add">+ Aggiungi unità</button>
      <label class="field">Densità (g per ml), solo se nota<input id="f-density" type="text" inputmode="decimal" value="${n(f.density)}" placeholder="es. dall'etichetta o da una fonte"></label>
      <p class="tiny">La densità serve per passare da ml a grammi (o viceversa). Senza densità le unità in volume restano disattivate.</p>
    </details>
    <details class="more" ${f.barcode ? 'open' : ''}><summary>Codice a barre</summary>
      <label class="field">EAN / UPC<input id="f-barcode" type="text" inputmode="numeric" value="${esc(f.barcode || '')}" autocomplete="off"></label>
    </details>
    <label class="check"><input id="f-fav" type="checkbox" ${f.fav ? 'checked' : ''}> Preferito</label>
    ${f.source === 'off' ? `<p class="tiny">Dati iniziali da Open Food Facts (licenza ODbL). Verificali con l'etichetta.</p>` : ''}
    <div class="actions">${stored ? `<button class="btn danger" data-act="del-food">Elimina</button>` : ''}
      <button class="btn primary" data-act="save-food">${slot ? 'Salva e aggiungi' : 'Salva'}</button></div>`,
    { food: stored ? f : null, catalogFood: !stored && fromCat ? f : null, slot, source: f.source || 'manuale', units: (f.units || []).map(u => ({ ...u })) });
  $('#f-unit').value = unitOf(f);
  $('#f-state').value = f.state || '';
  $('#f-unit').addEventListener('change', e => { $('#f-u').textContent = e.target.value; drawFormUnits(); });
  drawFormUnits();
  if (!id && !f.name) $('#f-name').focus();
}
function drawFormUnits() {
  const box = $('#f-units');
  if (!box) return;
  const u0 = $('#f-unit').value;
  box.innerHTML = sheetCtx.units.length ? sheetCtx.units.map((u, i) => `<div class="urow">
      <input type="text" data-ul="${i}" value="${esc(u.l)}" aria-label="Nome unità">
      <input type="text" inputmode="decimal" data-uv="${i}" value="${String(u.g ?? u.ml ?? '').replace('.', ',')}" aria-label="Quantità">
      <select data-uk="${i}" aria-label="Unità"><option value="g" ${u.g != null || (u.ml == null && u0 === 'g') ? 'selected' : ''}>g</option><option value="ml" ${u.ml != null && u.g == null ? 'selected' : ''}>ml</option></select>
      <button class="icon" data-act="fu-del" data-i="${i}" aria-label="Elimina ${esc(u.l)}">${ic('close', 'sm')}</button></div>`).join('')
    : '<p class="tiny">Nessuna unità oltre a grammi/ml.</p>';
  $$('#f-units [data-ul],#f-units [data-uv],#f-units [data-uk]').forEach(inp => inp.addEventListener('change', readFormUnits));
}
function readFormUnits() {
  sheetCtx.units = sheetCtx.units.map((u, i) => {
    const l = $(`[data-ul="${i}"]`).value.trim();
    const v = num($(`[data-uv="${i}"]`).value);
    const kind = $(`[data-uk="${i}"]`).value;
    const changed = l !== u.l || v !== (u.g ?? u.ml) || (kind === 'g') !== (u.g != null);
    const nu = { ...u, l };
    delete nu.g; delete nu.ml;
    nu[kind] = v;
    if (changed && !u.custom) { nu.edited = true; nu.src = 'modificata da te'; }
    return nu;
  });
}
async function saveFood() {
  readFormUnits();
  const name = $('#f-name').value.trim();
  if (!name) return toast('Inserisci il nome.');
  const vals = {};
  for (const k of NUTR) {
    vals[k] = num($('#f-' + k).value);
    if (!(vals[k] >= 0) || vals[k] > (k === 'kcal' ? 1000 : 100)) return toast(`Valore mancante o non valido: ${NUTR_LABEL[k]}.`);
  }
  const optNum = (sel, max) => { const raw = $(sel).value.trim(); if (!raw) return null; const v = num(raw); return v > 0 && v <= max ? v : NaN; };
  const portion = optNum('#f-portion', 5000);
  if (Number.isNaN(portion)) return toast('Porzione non valida.');
  const dayPortions = {};
  for (const k of Object.keys(DAY_TYPES)) {
    const v = optNum('#f-dp-' + k, 5000);
    if (Number.isNaN(v)) return toast(`Porzione ${DAY_TYPES[k]} non valida.`);
    if (v) dayPortions[k] = v;
  }
  for (const u of sheetCtx.units) {
    if (!u.l) return toast('Ogni unità deve avere un nome.');
    if (!((u.g ?? u.ml) > 0 && (u.g ?? u.ml) <= 5000)) return toast(`Valore non valido per l'unità “${u.l}”.`);
  }
  const densRaw = $('#f-density').value.trim();
  const density = densRaw ? num(densRaw) : null;
  if (densRaw && !(density > 0.2 && density < 3)) return toast('Densità non valida (es. 0,92 o 1,03 g/ml).');
  const rawCode = $('#f-barcode').value.trim();
  const barcode = rawCode ? normCode(rawCode) : '';
  if (barcode && !validGTIN(barcode)) return toast('Codice a barre non valido: controlla le cifre.');
  const old = sheetCtx.food || sheetCtx.catalogFood;
  const myId = old?.id;
  if (barcode) {
    const other = (await foodsByBarcode(barcode)).find(x => x.id !== myId);
    if (other) return toast(`Codice già associato a “${other.name}”.`);
  }
  const brand = $('#f-brand').value.trim();
  const twin = (await getAll('foods')).find(x => x.id !== myId && norm(x.name) === norm(name) && norm(x.brand) === norm(brand));
  if (twin && !confirm(`Esiste già “${twin.name}”${twin.brand ? ` (${twin.brand})` : ''}. Salvare comunque un secondo alimento?`)) return;
  // Nutrienti aggiuntivi: un campo vuoto resta "dato non disponibile"; "tracce" o "< x" vengono mantenuti.
  const nutr = { ...(old?.nutr || {}) };
  let customized = old?.customized || false;
  for (const k of NUTR) {
    if (old?.nutr && nv(old.nutr[k]) !== vals[k]) customized = true;
    if (!(old?.nutr && typeof old.nutr[k] === 'string' && nv(old.nutr[k]) === vals[k])) nutr[k] = vals[k];
  }
  for (const [k] of EXTRA_FORM) {
    const raw = $('#f-' + k).value.trim();
    const prev = nutr[k];
    if (!raw) { if (hasVal(prev)) customized = true; delete nutr[k]; continue; }
    if (raw === 'tracce' && prev === 'tr') continue;
    if (raw.startsWith('<') && typeof prev === 'string' && prev.startsWith('<') && num(raw.slice(1)) === nv(prev.slice(1))) continue;
    const v = num(raw);
    if (!(v >= 0 && v <= 100)) return toast(`Valore non valido: ${k === 'salt' ? 'sale' : k === 'fiber' ? 'fibre' : k === 'sat' ? 'grassi saturi' : 'zuccheri'}.`);
    if (old?.nutr && nv(prev) !== v) customized = true;
    nutr[k] = v;
  }
  const f = { ...(old || { id: uid(), createdAt: Date.now(), source: sheetCtx.source }), name, brand, ...vals, nutr,
    unit: old?.catalogId ? 'g' : ($('#f-unit').value === 'ml' ? 'ml' : 'g'), state: $('#f-state').value, portion, dayPortions,
    units: sheetCtx.units, density, fav: $('#f-fav').checked, updatedAt: Date.now() };
  if (old?.catalogId) {
    if (name !== old.name) customized = true;
    f.customized = customized;
    if (density !== old.density) f.densityCustom = true;
  }
  if (barcode) f.barcode = barcode; else delete f.barcode; // senza codice non entra nell'indice
  await put('foods', f);
  const slot = sheetCtx.slot, wasStored = !!sheetCtx.food;
  closeSheet();
  if (slot) return openGrams(f.id, slot);
  toast(old && wasStored ? 'Alimento aggiornato' : 'Alimento salvato');
  render();
}
async function delFood() {
  const f = sheetCtx.food;
  if (!confirm(`Eliminare “${f.name}”? Le voci già registrate nel diario restano.`)) return;
  await remove('foods', f.id);
  closeSheet(); toast('Alimento eliminato', () => put('foods', f).then(render)); render();
}
async function toggleFav(id) {
  const f = await get('foods', id);
  await put('foods', { ...f, fav: !f.fav });
  render();
}

/* --- editor dei piatti --- */
async function openDishForm(id) {
  let dish;
  if (id) {
    const c = await get('combos', id);
    if (!c) return;
    dish = JSON.parse(JSON.stringify(c));
  } else dish = { id: uid(), name: '', items: [], cookedWeight: null, createdAt: Date.now(), isNew: true };
  for (const it of dish.items) {
    it.dayGrams = it.dayGrams || {};
    const f = it.foodId ? await get('foods', it.foodId) : null;
    if (f) { it.name = fullName(f); it.per100 = per100Of(f); it.unit = unitOf(f); }
  }
  openSheet(id ? 'Modifica piatto' : 'Nuovo piatto', '<div id="dish"></div>', { dish, variant: 'base', adding: false });
  drawDish();
}
async function drawDish() {
  const { dish, variant, adding } = sheetCtx;
  const box = $('#dish');
  if (!box) return;
  if (adding) {
    const foods = (await getAll('foods')).sort(byRecent);
    box.innerHTML = `<input type="search" id="dish-q" placeholder="Cerca ingrediente" autocomplete="off" aria-label="Cerca ingrediente">
      <ul class="pick" id="dish-foods"></ul><button class="btn full" data-act="dish-back">${ic('left', 'sm')} Torna al piatto</button>`;
    const draw = q => {
      const list = searchList(foods, q, hayFood);
      const ids = new Set(foods.map(f => f.id));
      const cat = q.trim().length >= 2 ? searchList(CAT.foods.filter(c => !ids.has(c.id)), q, hayFood).slice(0, 40) : [];
      $('#dish-foods').innerHTML = (list.length || cat.length) ? list.map(f => `<li><button data-act="dish-add-food" data-id="${f.id}"><span class="nm">${esc(fullName(f))}</span>
        <span class="k">${fmt0(f.kcal)} kcal/100 ${unitOf(f)}</span></button></li>`).join('')
        + (cat.length ? `<li class="sep">Dal catalogo</li>` + cat.map(c => `<li><button data-act="dish-add-food" data-id="${c.id}"><span class="nm">${esc(c.n)}</span>
        <span class="k">${fmt0(nv(c.v.kcal))} kcal/100 g · catalogo</span></button></li>`).join('') : '')
        : '<li class="empty">Nessun alimento. Scrivi per cercare anche nel catalogo.</li>';
    };
    $('#dish-q').addEventListener('input', e => draw(e.target.value));
    draw('');
    return;
  }
  const totalOf = v => sum(dish.items.map(it => calc(it.per100, itemGrams(it, v) || 0)));
  const rawW = dish.items.reduce((s, it) => s + (it.grams || 0), 0);
  box.innerHTML = `
    <label class="field">Nome<input id="d-name" type="text" value="${esc(dish.name)}" placeholder="Es. Riso, pollo e peperoni" autocomplete="off"></label>
    <div class="seg seg4" role="tablist" aria-label="Quantità per tipo di giornata">${['base', ...Object.keys(DAY_TYPES)].map(v =>
      `<button data-act="dish-variant" data-v="${v}" aria-selected="${v === variant}">${v === 'base' ? 'Base' : DAY_TYPES[v]}</button>`).join('')}</div>
    <p class="sub">${variant === 'base' ? 'Quantità della ricetta.' : `Quantità per i giorni <b>${DAY_TYPES[variant]}</b>. Lascia vuoto per usare la quantità base.`}</p>
    <ul class="combo-items">${dish.items.map((it, i) => `<li><span class="nm">${esc(it.name)}</span>
      <label class="g-inline"><input type="text" inputmode="decimal" data-i="${i}" value="${variant === 'base' ? (it.grams ?? '') : (it.dayGrams?.[variant] ?? '')}" placeholder="${variant === 'base' ? '' : it.grams}" aria-label="Quantità ${esc(it.name)}"> ${unitOf(it)}</label>
      <button class="icon" data-act="dish-remove" data-ri="${i}" aria-label="Togli ${esc(it.name)}">${ic('close', 'sm')}</button></li>`).join('') || '<li class="empty">Nessun ingrediente.</li>'}</ul>
    <button class="btn ghost full" data-act="dish-add">+ Aggiungi ingrediente</button>
    <div class="preview" id="d-prev" data-testid="dish-total">${macroLine(totalOf(variant))}</div>
    <details class="more" ${dish.cookedWeight ? 'open' : ''}><summary>Peso del piatto cotto (facoltativo)</summary>
      <p class="sub">Se pesi il piatto finito potrai registrarne una porzione in grammi: i valori si calcolano dagli ingredienti della ricetta base (${fmt0(rawW)} g).</p>
      <label class="field">Peso finale cotto (g)<input id="d-cooked" type="text" inputmode="decimal" value="${dish.cookedWeight ?? ''}"></label></details>
    <div class="actions">${dish.isNew ? '' : '<button class="btn danger" data-act="del-combo">Elimina</button>'}<button class="btn primary" data-act="save-dish">Salva piatto</button></div>`;
  $('#d-name').addEventListener('input', e => { dish.name = e.target.value; });
  $$('#dish input[data-i]').forEach(inp => inp.addEventListener('input', () => {
    const it = dish.items[+inp.dataset.i];
    const raw = inp.value.trim();
    if (variant === 'base') it.grams = num(raw);
    else if (raw === '') delete it.dayGrams[variant];
    else it.dayGrams[variant] = num(raw);
    $('#d-prev').innerHTML = macroLine(totalOf(variant));
  }));
  $('#d-cooked').addEventListener('input', e => { const raw = e.target.value.trim(); dish.cookedWeight = raw === '' ? null : num(raw); });
}
async function dishAddFood(id) {
  const f = await adopt(id);
  const dayGrams = Object.fromEntries(Object.entries(f.dayPortions || {}).filter(([, v]) => v > 0));
  sheetCtx.dish.items.push({ foodId: f.id, name: fullName(f), per100: per100Of(f), unit: unitOf(f), grams: f.portion || 100, dayGrams });
  sheetCtx.adding = false;
  drawDish();
}
async function saveDish() {
  const { dish } = sheetCtx;
  const name = (dish.name || '').trim();
  if (!name) return toast('Dai un nome al piatto.');
  if (!dish.items.length) return toast('Aggiungi almeno un ingrediente.');
  for (const it of dish.items) {
    if (!(it.grams > 0 && it.grams <= 5000)) return toast(`Quantità base non valida per ${it.name}.`);
    for (const [v, g] of Object.entries(it.dayGrams || {})) if (!(g > 0 && g <= 5000)) return toast(`Quantità ${DAY_TYPES[v]} non valida per ${it.name}.`);
  }
  if (dish.cookedWeight != null && !(dish.cookedWeight > 0 && dish.cookedWeight <= 20000)) return toast('Peso cotto non valido.');
  const { isNew, ...rest } = dish;
  await put('combos', { ...rest, name, updatedAt: Date.now() });
  closeSheet(); toast(isNew ? `Piatto “${name}” creato` : 'Piatto aggiornato'); render();
}
async function delCombo() {
  const c = sheetCtx.dish;
  if (!confirm(`Eliminare il piatto “${c.name}”? Le voci già registrate restano.`)) return;
  await remove('combos', c.id);
  closeSheet(); toast('Piatto eliminato', () => { const { isNew, ...rest } = c; return put('combos', rest).then(render); }); render();
}

/* ---------- SETTIMANA ---------- */
async function weekData(start) {
  const end = addDays(start, 6);
  const [entries, dayRecs, plan] = await Promise.all([entriesBetween(start, end), daysBetween(start, end), getMeta('plan')]);
  const recs = Object.fromEntries(dayRecs.map(r => [r.date, r]));
  const t = today();
  const days = [...Array(7)].map((_, i) => {
    const date = addDays(start, i);
    const list = entries.filter(e => e.date === date);
    const info = resolveDay(date, recs[date], plan);
    return { date, n: list.length, future: date > t, type: info.type, weight: info.weight, ...sum(list) };
  });
  return { start, end, entries, days };
}


/* ---------- andamento: grafico interattivo (SVG, nessuna libreria) ---------- */
const METRICS = { kcal: { l: 'Calorie', u: 'kcal', col: 'var(--kcal)' }, prot: { l: 'Proteine', u: 'g', col: 'var(--prot)' }, weight: { l: 'Peso', u: 'kg', col: 'var(--accent)' } };
async function chartData(n) {
  const end = today(), start = addDays(end, -(n - 1));
  const [entries, recs, plan, goals] = await Promise.all([entriesBetween(start, end), daysBetween(start, end), getMeta('plan'), getMeta('goals')]);
  const byDate = Object.fromEntries(recs.map(r => [r.date, r]));
  return [...Array(n)].map((_, i) => {
    const date = addDays(start, i);
    const list = entries.filter(e => e.date === date);
    const info = resolveDay(date, byDate[date], plan);
    return { date, n: list.length, type: info.type, weight: info.weight, goal: info.type ? goals?.[info.type] || null : null, ...sum(list) };
  });
}
function chartSVG(data, metric) {
  const W = 320, H = 150, L = 30, B = 18, n = data.length;
  const bw = (W - L) / n;
  const val = d => (metric === 'weight' ? d.weight || null : d.n ? d[metric] : null);
  const vals = data.map(val).filter(v => v != null);
  let lo = 0, hi = Math.max(1, ...vals, ...data.map(d => (metric !== 'weight' && d.goal?.[metric]) || 0));
  if (metric === 'weight' && vals.length) { lo = Math.floor(Math.min(...vals) - 1); hi = Math.ceil(Math.max(...vals) + 1); }
  hi = metric === 'weight' ? hi : Math.ceil(hi * 1.12 / 100) * 100 || 100;
  const y = v => H - B - (v - lo) / (hi - lo || 1) * (H - B - 8);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  let g = `<g class="grid">${ticks.map(t => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 5}" y="${y(t) + 3}" text-anchor="end">${fmt0(t)}</text>`).join('')}</g>`;
  const every = n <= 7 ? 1 : n <= 31 ? 5 : 15;
  data.forEach((d, i) => {
    const x = L + i * bw, v = val(d), sel = state.chart.sel === d.date;
    const pd = parseDate(d.date);
    const lab = n <= 7 ? DAY_NAMES[pd.getDay()] : (i % every === 0 || i === n - 1) ? `${pd.getDate()}/${pd.getMonth() + 1}` : '';
    let inner = `<rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"/>`;
    if (metric !== 'weight') {
      if (v == null) inner += `<circle class="nodata" cx="${x + bw / 2}" cy="${H - B - 2}" r="${Math.min(2.5, bw / 3)}"/>`;
      else {
        const goal = d.goal?.[metric];
        const col = goal && v > goal * 1.05 ? 'var(--danger)' : METRICS[metric].col;
        inner += `<rect class="v" x="${x + bw * .18}" y="${y(v)}" width="${bw * .64}" height="${Math.max(1, H - B - y(v))}" rx="${Math.min(4, bw * .25)}" fill="${col}" style="animation-delay:${Math.min(i * 18, 300)}ms"/>`;
        if (goal) inner += `<line class="goal" x1="${x + bw * .1}" x2="${x + bw * .9}" y1="${y(goal)}" y2="${y(goal)}"/>`;
      }
    }
    if (lab) inner += `<text class="xl" x="${x + bw / 2}" y="${H - 4}">${lab}</text>`;
    g += `<g class="b ${state.chart.sel && !sel ? 'dim' : ''} ${sel ? 'sel' : ''}" data-act="chart-sel" data-date="${d.date}" role="button" tabindex="0" aria-label="${esc(labelDay(d.date))}">${inner}</g>`;
  });
  if (metric === 'weight') {
    const pts = data.map((d, i) => d.weight ? [L + i * bw + bw / 2, y(d.weight)] : null).filter(Boolean);
    if (pts.length > 1) g += `<polyline class="wline" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
    g += pts.map(([cx, cy]) => `<circle class="wdot" cx="${cx}" cy="${cy}" r="3.2"/>`).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Andamento ${METRICS[metric].l.toLowerCase()}">${g}</svg>`;
}
async function drawChart() {
  const box = $('#chart-card');
  if (!box) return;
  const { days: n, metric } = state.chart;
  const data = await chartData(n);
  state.chart.data = data;
  const m = METRICS[metric];
  const withData = data.filter(d => (metric === 'weight' ? d.weight : d.n));
  const avg = withData.length ? withData.reduce((a, d) => a + (metric === 'weight' ? d.weight : d[metric]), 0) / withData.length : null;
  const ws = data.filter(d => d.weight);
  const delta = ws.length > 1 ? ws[ws.length - 1].weight - ws[0].weight : null;
  const inGoal = metric !== 'weight' ? withData.filter(d => d.goal?.[metric] && Math.abs(d[metric] - d.goal[metric]) <= d.goal[metric] * .05).length : 0;
  box.innerHTML = `
    <div class="chart-head"><h2>Andamento</h2>
      <div class="seg seg3" role="tablist" aria-label="Periodo">${[7, 30, 90].map(d => `<button role="tab" data-act="chart-days" data-n="${d}" aria-selected="${n === d}">${d} g</button>`).join('')}</div></div>
    <div class="chart-metrics">${Object.entries(METRICS).map(([k, v]) => `<button class="chip ${k === metric ? 'on' : ''}" data-act="chart-metric" data-m="${k}" aria-pressed="${k === metric}">${v.l}</button>`).join('')}</div>
    <div class="chart-sum">
      <div><b>${avg == null ? '–' : metric === 'weight' ? fmt1(avg) : fmt0(avg)}</b>media ${m.u}${metric === 'weight' ? '' : ' (giorni con dati)'}</div>
      ${metric === 'weight' ? `<div><b>${delta == null ? '–' : (delta > 0 ? '+' : '') + fmt1(delta)}</b>variazione kg</div>` : `<div><b>${withData.length}/${n}</b>giorni registrati</div><div><b>${inGoal}</b>giorni in obiettivo ±5%</div>`}
    </div>
    <div class="chart">${chartSVG(data, metric)}</div>
    <div class="legend">${metric === 'weight' ? '<span><i style="background:var(--accent)"></i>peso registrato</span>'
      : `<span><i style="background:${m.col}"></i>${m.l.toLowerCase()}</span><span><i style="background:var(--ink-2);height:3px;vertical-align:3px"></i>obiettivo del tipo di giornata</span><span><i style="background:var(--danger)"></i>oltre il 5%</span><span><i style="background:var(--line);border-radius:50%"></i>nessuna registrazione</span>`}</div>
    <div class="chart-tip" id="chart-tip" aria-live="polite">${chartTip()}</div>`;
}
function chartTip() {
  const d = state.chart.data?.find(x => x.date === state.chart.sel);
  if (!d) return '<span>Tocca una barra per vedere il giorno.</span>';
  const m = state.chart.metric;
  const v = m === 'weight' ? (d.weight ? `<b>${fmt1(d.weight)} kg</b>` : 'peso non registrato') : d.n ? `<b>${fmt0(d[m])} ${METRICS[m].u}</b>${d.goal?.[m] ? ` di ${fmt0(d.goal[m])}` : ''}` : 'nessuna registrazione';
  return `<span>${esc(labelDay(d.date))}${d.type ? ` <small class="tb tb-${d.type}">${DAY_TYPES[d.type]}</small>` : ''} · ${v}</span><button class="link" data-act="open-day" data-date="${d.date}">Apri ${ic('right', 'sm')}</button>`;
}
function setTheme(t) {
  try { t === 'auto' ? localStorage.removeItem('osfit-theme') : localStorage.setItem('osfit-theme', t); } catch { /* facoltativo */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  render();
}
const curTheme = () => document.documentElement.dataset.theme || 'auto';

async function renderSettimana() {
  const el = $('#view-settimana');
  const w = await weekData(state.week);
  const withData = w.days.filter(d => d.n);
  const avg = withData.length ? sum(withData) : null;
  if (avg) for (const k of NUTR) avg[k] = k === 'kcal' ? Math.round(avg[k] / withData.length) : r1(avg[k] / withData.length);
  const weights = w.days.filter(d => d.weight);
  const isCurrent = state.week === mondayOf(today());
  const lastBackup = await getMeta('lastBackup');
  const persisted = state.persisted;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  el.innerHTML = `
    <div class="card chart-card" id="chart-card"><div class="skel" style="height:240px;margin:0"></div></div>
    <h2 class="section">Settimana</h2>
    <div class="daynav">
      <button class="icon" data-act="week" data-d="-7" aria-label="Settimana precedente">${ic('left')}</button>
      <div class="daylabel"><strong>${isCurrent ? 'Questa settimana' : 'Settimana'}</strong>
        <span>${esc(labelDay(w.start))} – ${esc(labelDay(w.end))}</span>
        ${isCurrent ? '' : `<button class="link" data-act="week-now">Torna a questa settimana</button>`}</div>
      <button class="icon" data-act="week" data-d="7" aria-label="Settimana successiva">${ic('right')}</button>
    </div>
    <div class="card">
      <table class="week" data-testid="week-table">
        <thead><tr><th>Giorno</th><th>kcal</th><th>P</th><th>C</th><th>G</th></tr></thead>
        <tbody>${w.days.map(d => `<tr class="${d.n ? 'has' : d.future ? 'future' : 'none'}" data-date="${d.date}">
          <th><button class="link" data-act="open-day" data-date="${d.date}">${esc(labelDay(d.date))}</button>${d.type ? `<small class="tb tb-${d.type}">${DAY_TYPES[d.type]}</small>` : ''}</th>
          ${d.n ? `<td>${fmt0(d.kcal)}</td><td>${fmt1(d.prot)}</td><td>${fmt1(d.carb)}</td><td>${fmt1(d.fat)}</td>`
               : `<td colspan="4" class="nodata">${d.future ? '—' : 'nessuna registrazione'}</td>`}</tr>`).join('')}</tbody>
      </table>
      <div class="weeksum">
        <div><b>${withData.length}</b>/7 giorni con dati</div>
        ${avg ? `<div>Media sui giorni con dati: <b>${fmt0(avg.kcal)}</b> kcal · P ${fmt1(avg.prot)} · C ${fmt1(avg.carb)} · G ${fmt1(avg.fat)}</div>` : '<div>Nessun dato in questa settimana.</div>'}
        ${weights.length ? `<div>Peso medio: <b>${fmt1(weights.reduce((s, d) => s + d.weight, 0) / weights.length)} kg</b> (${weights.length} ${weights.length === 1 ? 'misura' : 'misure'})</div>` : ''}
      </div>
    </div>

    <h2 class="section">Esporta per OS_FIT</h2>
    <div class="card pad">
      <p class="sub">CSV della settimana mostrata. “Giorni” contiene anche i giorni senza registrazioni (<i>vuoto</i>), il tipo di giornata e il peso.</p>
      <div class="actions"><button class="btn" data-act="csv-days">${ic('download', 'sm')} CSV giorni</button><button class="btn" data-act="csv-entries">${ic('download', 'sm')} CSV voci</button></div>
    </div>

    <h2 class="section">Obiettivi e programma</h2>
    <div class="card pad">
      <p class="sub">Obiettivi di kcal e macro per Pesi, Cardio e Riposo, e il tipo di giornata per ogni giorno della settimana.</p>
      <button class="btn full" data-act="goals">${ic('target', 'sm')} Imposta obiettivi e programma</button>
    </div>

    <h2 class="section" id="data">Dati e backup</h2>
    <div class="card pad">
      <p>Ultimo backup: <b>${lastBackup ? new Date(lastBackup).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : 'mai'}</b></p>
      <p class="sub">Il backup contiene alimenti, piatti, giornate tipo, obiettivi, programma, pesi e tutto il diario.</p>
      <div class="actions"><button class="btn primary" data-act="backup">${ic('download', 'sm')} Scarica backup</button><button class="btn" data-act="restore">${ic('upload', 'sm')} Ripristina…</button></div>
    </div>
    <div class="card pad info">
      <div class="themepick"><span>Tema</span><div class="seg seg3" role="tablist" aria-label="Tema">${[['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => `<button role="tab" data-act="theme" data-t="${k}" aria-selected="${curTheme() === k}">${l}</button>`).join('')}</div></div>
      <p>Memoria persistente: <b data-testid="persist">${persisted === null ? 'non supportata' : persisted ? 'sì' : 'no'}</b>
        ${persisted === false ? `<button class="link" data-act="persist">Richiedi</button>` : ''}</p>
      <p>Modalità: <b>${standalone ? 'app installata' : 'browser'}</b>${standalone ? '' : ' — per usarla offline aggiungila alla schermata Home.'}</p>
      <p>Versione app: <b>${APP_VERSION}</b> · Rete: <b>${navigator.onLine ? 'online' : 'offline'}</b></p>
      <button class="btn danger small" data-act="wipe">Cancella tutti i dati…</button>
    </div>
    <details class="more guide"><summary>Guida rapida</summary>
      <ul class="mini">
        <li><b>Installare:</b> ${installSteps()}</li>
        <li><b>Backup:</b> “Scarica backup” una volta a settimana e prima di ogni aggiornamento. Se elimini l'app dalla schermata Home o cancelli i dati del sito, il diario si recupera solo dal backup.</li>
        <li><b>Aggiornare:</b> quando compare “Nuova versione disponibile” tocca <b>Aggiorna</b>: i dati restano.</li>
        <li><b>Scanner:</b> codice orizzontale nel riquadro, a 10–20 cm, con buona luce. Se non legge: “Fai una foto al codice” oppure digita le cifre.</li>
        <li><b>Andamento:</b> tocca una barra per vedere il giorno; i pallini grigi sono giorni senza registrazioni (non zero).</li>
        <li><b>Prodotti senza codice:</b> “Cerca online” cerca per nome tra i prodotti di Open Food Facts.</li>
        <li><b>Giornate pesi/cardio/riposo:</b> imposta porzioni negli alimenti e nei piatti, obiettivi e programma qui sopra.</li>
      </ul>
    </details>`;
  drawChart();
}

async function openGoals() {
  const [goals, plan] = await Promise.all([getMeta('goals'), getMeta('plan')]);
  const g = goals || {}, p = plan || {};
  openSheet('Obiettivi e programma', `
    <h3>Obiettivi giornalieri</h3>
    <table class="goals"><thead><tr><th></th><th>kcal</th><th>P g</th><th>C g</th><th>G g</th></tr></thead>
      <tbody>${Object.entries(DAY_TYPES).map(([t, l]) => `<tr><th>${l}</th>${NUTR.map(k => `<td><input id="goal-${t}-${k}" type="text" inputmode="decimal" value="${g[t]?.[k] ?? ''}" aria-label="${l} ${NUTR_LABEL[k]}"></td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="tiny">Lascia vuoto quello che non vuoi monitorare.</p>
    <h3>Programma settimanale</h3>
    <div class="plan">${[1, 2, 3, 4, 5, 6, 7].map(d => `<label class="planrow"><span>${WEEKDAY_LONG[d]}</span><select id="plan-${d}"><option value="">—</option>${Object.entries(DAY_TYPES).map(([k, l]) => `<option value="${k}" ${p[d] === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
    <p class="tiny">Il tipo scelto a mano in Oggi vale solo per quel giorno e ha la precedenza sul programma.</p>
    <button class="btn primary full" data-act="save-goals">Salva</button>`);
}
async function saveGoals() {
  const goals = {};
  for (const t of Object.keys(DAY_TYPES)) {
    for (const k of NUTR) {
      const raw = $(`#goal-${t}-${k}`).value.trim();
      if (!raw) continue;
      const v = num(raw);
      if (!(v > 0 && v <= (k === 'kcal' ? 10000 : 1000))) return toast(`Obiettivo non valido: ${DAY_TYPES[t]} ${NUTR_LABEL[k]}.`);
      (goals[t] ||= {})[k] = v;
    }
  }
  const plan = {};
  for (let d = 1; d <= 7; d++) { const v = $(`#plan-${d}`).value; if (v) plan[d] = v; }
  await setMeta('goals', goals);
  await setMeta('plan', plan);
  closeSheet(); toast('Obiettivi e programma salvati'); render();
}

/* ---------- CSV, backup, ripristino ---------- */
const csvCell = v => { const s = v == null ? '' : String(v); return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

async function exportCSV(kind) {
  const w = await weekData(state.week);
  let rows, name;
  if (kind === 'days') {
    // Colonne nuove (tipo_giornata, peso_kg) aggiunte in fondo: le prime 7 restano come nella 1.0.0.
    // Colonne aggiunte nel tempo sempre in fondo. Zuccheri/saturi/fibre/sale sommano solo le voci con il dato.
    const EXTRA = ['sugar', 'sat', 'fiber', 'salt'];
    rows = [['data', 'stato', 'voci', 'kcal', 'proteine_g', 'carboidrati_g', 'grassi_g', 'tipo_giornata', 'peso_kg', 'zuccheri_g', 'grassi_saturi_g', 'fibre_g', 'sale_g', 'voci_senza_dati_extra']];
    for (const d of w.days) {
      if (!d.n) { rows.push([d.date, 'vuoto', 0, '', '', '', '', d.type || '', d.weight ?? '', '', '', '', '', '']); continue; }
      const list = w.entries.filter(e => e.date === d.date);
      const t = totalsFull(list);
      const incompl = list.filter(e => EXTRA.some(k => !hasVal(e.per100?.[k]))).length;
      rows.push([d.date, 'registrato', d.n, d.kcal, d.prot, d.carb, d.fat, d.type || '', d.weight ?? '',
        ...EXTRA.map(k => (t[k].have ? r1(t[k].v * 100) / 100 : '')), incompl]);
    }
    name = `osfit-giorni_${w.start}_${w.end}.csv`;
  } else {
    rows = [['data', 'pasto_n', 'pasto', 'alimento', 'grammi', 'kcal', 'proteine_g', 'carboidrati_g', 'grassi_g', 'unita', 'piatto', 'zuccheri_g', 'grassi_saturi_g', 'fibre_g', 'sale_g', 'quantita_domestica']];
    const list = [...w.entries].sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot || a.createdAt - b.createdAt);
    const ex = (e, k) => { const a = amountOf(e.per100, k, e.grams); return a ? r1(a.v * 100) / 100 : ''; };
    for (const e of list) rows.push([e.date, e.slot, SLOTS[e.slot - 1], e.name, e.grams, e.kcal, e.prot, e.carb, e.fat, unitOf(e), e.dishName || '',
      ex(e, 'sugar'), ex(e, 'sat'), ex(e, 'fiber'), ex(e, 'salt'), e.uLabel ? `${e.qty} × ${e.uLabel}` : '']);
    name = `osfit-voci_${w.start}_${w.end}.csv`;
  }
  await saveFile(name, 'text/csv', toCSV(rows));
}

const DATA_STORES = ['foods', 'combos', 'entries', 'days', 'templates'];
async function doBackup() {
  const [foods, combos, entries, days, templates, goals, plan] = await Promise.all([
    ...DATA_STORES.map(getAll), getMeta('goals'), getMeta('plan')]);
  const data = { app: 'OS_FIT Diario', format: BACKUP_FORMAT, dbVersion: DB_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    counts: { foods: foods.length, combos: combos.length, entries: entries.length, days: days.length, templates: templates.length },
    foods, combos, entries, days, templates, settings: { goals: goals || {}, plan: plan || {} } };
  await saveFile(`osfit-diario-backup_${today()}.json`, 'application/json', JSON.stringify(data, null, 1));
  await setMeta('lastBackup', Date.now());
  toast('Backup creato'); render();
}

function validateBackup(d) {
  if (!d || d.app !== 'OS_FIT Diario') return 'Non è un backup di OS_FIT Diario.';
  if (!(d.format >= 1)) return 'Formato del backup sconosciuto.';
  if (d.format > BACKUP_FORMAT) return "Backup creato da una versione più recente: aggiorna prima l'app.";
  for (const k of ['foods', 'combos', 'entries']) {
    if (!Array.isArray(d[k]) || d[k].some(x => !x || typeof x.id !== 'string')) return `Sezione “${k}” non valida.`;
  }
  if (d.days != null && (!Array.isArray(d.days) || d.days.some(x => !x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)))) return 'Sezione “days” non valida.';
  if (d.templates != null && (!Array.isArray(d.templates) || d.templates.some(x => !x || typeof x.id !== 'string' || !Array.isArray(x.entries)))) return 'Sezione “templates” non valida.';
  if (d.entries.some(e => !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(e.slot >= 1 && e.slot <= 5) || !e.per100)) return 'Voci del diario non valide.';
  return null;
}

async function onRestoreFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Il file non è un JSON valido.'); }
  const err = validateBackup(data);
  if (err) return toast(err);
  data.days ||= []; data.templates ||= [];
  const [nf, nc, ne] = await Promise.all([count('foods'), count('combos'), count('entries')]);
  openSheet('Ripristina backup', `
    <p>Backup del <b>${esc(new Date(data.exportedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }))}</b>${data.appVersion ? ` (versione ${esc(data.appVersion)})` : ''}:
      ${data.foods.length} alimenti, ${data.combos.length} piatti, ${data.entries.length} voci${data.templates.length ? `, ${data.templates.length} giornate tipo` : ''}.</p>
    <p class="sub">Ora sul telefono: ${nf} alimenti, ${nc} piatti, ${ne} voci.</p>
    <button class="btn primary full" data-act="restore-replace">Sostituisci tutto con il backup</button>
    <button class="btn full" data-act="restore-merge">Unisci (aggiunge e aggiorna, non cancella)</button>`, { backup: data });
}
async function restore(mode) {
  const data = sheetCtx.backup;
  const t = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
  for (const s of DATA_STORES) {
    const o = t.objectStore(s);
    if (mode === 'replace') o.clear();
    (data[s] || []).forEach(x => o.put(x));
  }
  const m = t.objectStore('meta');
  if (data.settings) {
    if (data.settings.goals) m.put({ key: 'goals', value: data.settings.goals });
    if (data.settings.plan) m.put({ key: 'plan', value: data.settings.plan });
  } else if (mode === 'replace') { m.delete('goals'); m.delete('plan'); }
  await done(t); // tutto o niente: se qualcosa fallisce, nessuna modifica
  closeSheet(); toast('Ripristino completato'); render();
}

function openWipe() {
  openSheet('Cancella tutti i dati', `
    <p>Elimina alimenti, piatti, giornate tipo, obiettivi e diario da questo dispositivo. <b>Non si può annullare.</b> Fai prima un backup.</p>
    <label class="field">Scrivi CANCELLA per confermare<input id="wipe-in" type="text" autocomplete="off" autocapitalize="characters"></label>
    <button class="btn danger full" data-act="wipe-confirm">Cancella tutto</button>`);
}
async function wipe() {
  if ($('#wipe-in').value.trim().toUpperCase() !== 'CANCELLA') return toast('Scrivi CANCELLA per confermare.');
  const all = [...DATA_STORES, 'meta'];
  const t = db.transaction(all, 'readwrite');
  all.forEach(s => t.objectStore(s).clear());
  await done(t);
  closeSheet(); toast('Dati cancellati'); render();
}

async function saveFile(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.canShare) {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') throw e; /* altrimenti prova il download */ }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- CODICI A BARRE ---------- */
// Lettori: quello integrato del browser quando esiste (Android/Chrome) e sempre il lettore interno
// di scanner.js (JavaScript puro, funziona anche su iPhone e offline). Nessuna libreria esterna.
function normCode(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 12 ? '0' + d : d; // UPC-A → EAN-13
}
function validGTIN(d) {
  if (![8, 13, 14].includes(d.length)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop();
  const s = digits.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10 === check;
}

const diag = { camera: '—', resolution: '—', readers: '—', frames: 0, last: '—', off: '—' };
function drawDiag() {
  const el = $('#scan-diag-body');
  if (!el) return;
  el.innerHTML = `<li>Fotocamera: <b>${esc(diag.camera)}</b></li><li>Risoluzione: <b>${esc(diag.resolution)}</b></li>
    <li>Lettori: <b>${esc(diag.readers)}</b></li><li>Fotogrammi analizzati: <b>${diag.frames}</b></li>
    <li>Ultimo esito: <b>${esc(diag.last)}</b></li><li>Open Food Facts: <b data-testid="diag-off">${esc(diag.off)}</b></li>
    <li>Pagina sicura (HTTPS): <b>${window.isSecureContext ? 'sì' : 'no'}</b> · App installata: <b>${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'sì' : 'no'}</b></li>`;
}

let nativeDetPromise = null;
function getNativeDetector() {
  nativeDetPromise ||= (async () => {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const f = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(x => sup.includes(x));
      return f.length ? new window.BarcodeDetector({ formats: f }) : null;
    } catch { return null; }
  })();
  return nativeDetPromise;
}

let cam = null; // { stream, track, timer, stopped }
function stopCamera() {
  if (!cam) return;
  cam.stopped = true;
  clearTimeout(cam.timer);
  cam.stream?.getTracks().forEach(t => t.stop());
  cam = null;
}
const scanStatus = (msg, warn) => { const s = $('#scan-status'); if (s) { s.textContent = msg; s.className = warn ? 'warn' : 'sub'; } };

function openScan(slot) {
  openSheet('Scansiona codice a barre', `
    <div class="scanbox"><video id="scan-video" playsinline muted autoplay></video><div class="scanframe"></div>
      <button class="torch" id="scan-torch" data-act="torch" hidden aria-label="Torcia">${ic('torch')}</button></div>
    <p id="scan-status" class="sub">Avvio della fotocamera…</p>
    <p class="tiny">Tieni il codice orizzontale dentro il riquadro, a 10–20 cm, con buona luce.</p>
    <div class="scan-alt">
      <label class="btn" for="scan-photo">${ic('camera')} Fai una foto al codice</label>
      <input id="scan-photo" type="file" accept="image/*" capture="environment" hidden>
    </div>
    <label class="field">Oppure digita il codice (8 o 13 cifre)<input id="scan-code" type="text" inputmode="numeric" autocomplete="off"></label>
    <button class="btn primary full" data-act="scan-search">Cerca</button>
    <details class="more diag"><summary>Lo scanner non funziona?</summary>
      <ul class="mini" id="scan-diag-body"></ul>
      <button class="btn small" data-act="test-off">Prova la connessione a Open Food Facts</button>
      <p class="tiny">Se la fotocamera non si avvia, controlla il permesso: iPhone → Impostazioni → Safari → Fotocamera; Android → tieni premuta l'icona → Info app → Autorizzazioni. La foto e il codice digitato funzionano sempre.</p>
    </details>`, { slot, scanning: true });
  Object.assign(diag, { camera: 'avvio…', resolution: '—', frames: 0, last: '—' });
  drawDiag();
  $('#scan-code').addEventListener('keydown', e => { if (e.key === 'Enter') onCode($('#scan-code').value); });
  $('#scan-photo').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) scanPhoto(f); });
  startCamera();
}

async function startCamera() {
  const native = await getNativeDetector();
  diag.readers = native ? 'integrato nel browser + interno' : 'interno (JavaScript)';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    diag.camera = 'non disponibile in questo browser'; drawDiag();
    return scanStatus('Fotocamera non disponibile qui: usa la foto o digita il codice.', true);
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    diag.camera = `errore: ${e.name}`; drawDiag();
    return scanStatus(e.name === 'NotAllowedError'
      ? 'Permesso fotocamera negato. Usa la foto o digita il codice (vedi “Lo scanner non funziona?”).'
      : 'Fotocamera non disponibile: usa la foto o digita il codice.', true);
  }
  if (!sheetCtx.scanning) { stream.getTracks().forEach(t => t.stop()); return; }
  const video = $('#scan-video');
  video.srcObject = stream;
  try { await video.play(); } catch { /* alcuni browser partono comunque */ }
  const track = stream.getVideoTracks()[0];
  cam = { stream, track, timer: 0, stopped: false, prev: null, torch: false };
  try { // messa a fuoco continua dove supportata
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    if (caps.torch) $('#scan-torch').hidden = false;
  } catch { /* opzionale */ }
  diag.camera = 'attiva';
  scanStatus('Inquadra il codice a barre nel riquadro.');
  const canvas = document.createElement('canvas');
  const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
  let turn = 0;
  const tick = async () => {
    if (!cam || cam.stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      diag.resolution = `${video.videoWidth}×${video.videoHeight}`;
      let code = null;
      try {
        if (native && turn % 2 === 0) {
          const found = await native.detect(video);
          code = found.map(c => normCode(c.rawValue)).find(validGTIN) || null;
        }
        if (!code) {
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx2.drawImage(video, 0, 0, canvas.width, canvas.height);
          const r = OSFScanner.scanImageData(ctx2.getImageData(0, 0, canvas.width, canvas.height), { lines: 21, band: [0.2, 0.8], vertical: turn % 4 === 3 });
          // conferma: 2 righe nello stesso fotogramma, oppure lo stesso codice in 2 fotogrammi di fila
          if (r && (r.votes >= 2 || cam.prev === r.code)) code = r.code;
          cam.prev = r ? r.code : null;
        }
      } catch (e) { diag.last = 'errore lettore: ' + e.message; }
      diag.frames++; turn++;
      if (diag.frames % 5 === 0) drawDiag();
      if (code && cam && !cam.stopped) {
        diag.last = 'letto ' + code; drawDiag();
        stopCamera(); navigator.vibrate?.(60);
        return onCode(code);
      }
    }
    if (cam && !cam.stopped) cam.timer = setTimeout(tick, 120);
  };
  tick();
}

async function toggleTorch() {
  if (!cam?.track) return;
  cam.torch = !cam.torch;
  try { await cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }); } catch { toast('Torcia non disponibile.'); }
}

async function scanPhoto(file) {
  scanStatus('Analizzo la foto…');
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch {
    try { // Safari meno recenti
      bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    } catch { return scanStatus('Foto non leggibile.', true); }
  }
  const w0 = bmp.width, h0 = bmp.height;
  let code = null;
  const native = await getNativeDetector();
  if (native) { try { code = (await native.detect(bmp)).map(c => normCode(c.rawValue)).find(validGTIN) || null; } catch { /* prova il lettore interno */ } }
  for (const maxW of [1600, 1000, 2400]) { // più scale: aiuta sia con codici piccoli sia con foto sfocate
    if (code) break;
    const s = Math.min(1, maxW / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const r = OSFScanner.scanImageData(g.getImageData(0, 0, c.width, c.height), { lines: 61, band: [0.03, 0.97], vertical: true });
    if (r && r.votes >= 2) code = r.code;
  }
  diag.last = code ? 'foto: letto ' + code : 'foto: nessun codice'; drawDiag();
  if (!code) return scanStatus('Non trovo un codice nella foto. Riprova più vicino, a fuoco e con il codice dritto, oppure digitalo.', true);
  stopCamera();
  onCode(code);
}

async function onCode(raw) {
  const slot = sheetCtx.slot;
  const code = normCode(raw);
  if (!validGTIN(code)) return scanStatus('Codice non valido: controlla le cifre.', true);
  stopCamera();
  sheetCtx.scanning = false;
  const local = (await foodsByBarcode(code))[0];
  if (local) return slot ? openGrams(local.id, slot) : openFoodForm(local.id); // nessun duplicato
  if (!navigator.onLine) return openFoodForm(null, slot, { barcode: code, note: 'Sei offline: inserisci i valori dall\'etichetta. Il codice resta associato all\'alimento.' });
  scanStatus('Cerco il prodotto su Open Food Facts…');
  let res;
  try { res = await fetchOFF(code); }
  catch (e) { return openFoodForm(null, slot, { barcode: code, note: `Ricerca online non riuscita (${e.message}). Puoi aprire la scheda del prodotto e copiare i valori, oppure leggerli dall'etichetta.`, offLink: code }); }
  if (!res) return openFoodForm(null, slot, { barcode: code, note: 'Prodotto non trovato su Open Food Facts. Inserisci i valori dall\'etichetta.' });
  openFoodForm(null, slot, res);
}

async function offFetchJSON(url, ms = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return { notFound: true };
    if (r.status === 429) throw new Error('troppe richieste, riprova tra un minuto');
    if (!r.ok) throw new Error('errore ' + r.status);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('tempo scaduto');
    if (e instanceof TypeError) throw new Error(navigator.onLine ? 'collegamento bloccato o non raggiungibile' : 'sei offline');
    throw e;
  } finally { clearTimeout(timer); }
}
async function fetchOFF(code) {
  const j = await offFetchJSON(`${OFF_URL}${code}.json?fields=${OFF_FIELDS}`);
  if (j.notFound || !j.product || j.status === 0 || j.status === 'failure') return null;
  return mapOFF(j.product, code);
}
async function testOFF() {
  diag.off = 'prova in corso…'; drawDiag();
  const t = performance.now();
  try {
    const j = await offFetchJSON(`${OFF_URL}3017620422003.json?fields=product_name`, 8000);
    diag.off = j.product ? `funziona (${Math.round(performance.now() - t)} ms)` : 'risponde, ma senza dati';
  } catch (e) { diag.off = 'non raggiungibile: ' + e.message; }
  drawDiag();
}
// Converte la risposta di Open Food Facts senza inventare dati: i valori mancanti restano vuoti e segnalati.
function mapOFF(p, code) {
  const nu = p.nutriments || {};
  const v = k => { const x = Number(nu[k]); return nu[k] !== '' && nu[k] != null && Number.isFinite(x) && x >= 0 ? r1(x) : null; };
  const notes = {};
  let kcal = v('energy-kcal_100g');
  if (kcal == null) {
    const kj = v('energy-kj_100g') ?? v('energy_100g');
    if (kj != null) { kcal = Math.round(kj / 4.184); notes.kcal = `Calcolato da ${fmt1(kj)} kJ (÷ 4,184): verifica`; }
  }
  const out = { prot: v('proteins_100g'), carb: v('carbohydrates_100g'), fat: v('fat_100g') };
  if (kcal == null) notes.kcal = 'Dato mancante: copialo dall\'etichetta';
  for (const k of ['prot', 'carb', 'fat']) if (out[k] == null) notes[k] = 'Dato mancante';
  const name = (p.product_name_it || p.product_name || '').trim();
  if (!name) notes.name = 'Nome mancante';
  const q = String(p.quantity || '').toLowerCase();
  const unit = p.product_quantity_unit === 'ml' || /\d\s*(ml|cl|l)\b/.test(q) ? 'ml' : 'g';
  const nutr = {};
  for (const [k, key] of [['sugar', 'sugars_100g'], ['sat', 'saturated-fat_100g'], ['fiber', 'fiber_100g'], ['salt', 'salt_100g']]) { const x = v(key); if (x != null) nutr[k] = x; }
  const sod = v('sodium_100g');
  if (sod != null) nutr.na = r1(sod * 1000);
  return { barcode: code, name, brand: String(p.brands || '').split(',')[0].trim(), unit, nutr, kcal: kcal ?? '', prot: out.prot ?? '', carb: out.carb ?? '', fat: out.fat ?? '',
    source: 'off', notes, note: `Dati trovati su Open Food Facts (valori per 100 ${unit}). Controllali con l'etichetta prima di salvare.` };
}

/* --- ricerca dei prodotti per nome su Open Food Facts --- */
async function openOffSearch(q, slot) {
  q = (q || '').trim();
  openSheet('Cerca prodotti online', `
    <div class="toolbar"><input type="search" id="offs-q" value="${esc(q)}" placeholder="Es. yogurt greco, pasta integrale" autocomplete="off" aria-label="Cerca prodotti">
      <button class="btn primary" data-act="off-search-go">Cerca</button></div>
    <div id="offs-res"><p class="sub">Cerca tra i prodotti confezionati di Open Food Facts. Scegli quello giusto e controlla i valori.</p></div>`, { slot });
  $('#offs-q').addEventListener('keydown', e => { if (e.key === 'Enter') offSearchGo(); });
  if (q.length >= 2) offSearchGo();
}
async function offSearchGo() {
  const q = $('#offs-q').value.trim();
  if (q.length < 2) return toast('Scrivi almeno 2 lettere.');
  if (!navigator.onLine) { $('#offs-res').innerHTML = '<p class="warn">Sei offline: la ricerca online non è disponibile.</p>'; return; }
  $('#offs-res').innerHTML = '<p class="sub">Ricerca in corso…</p>';
  let j;
  try {
    j = await offFetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&sort_by=unique_scans_n&fields=code,${OFF_FIELDS}`, 15000);
  } catch (e) {
    $('#offs-res').innerHTML = `<p class="warn">Ricerca non riuscita: ${esc(e.message)}.</p><p><a href="https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process" target="_blank" rel="noopener">Apri la ricerca sul sito di Open Food Facts</a></p>`;
    return;
  }
  const prods = (j.products || []).filter(p => p.code && (p.product_name_it || p.product_name));
  sheetCtx.offResults = prods;
  $('#offs-res').innerHTML = prods.length ? `<ul class="pick">${prods.map((p, i) => {
    const kc = p.nutriments?.['energy-kcal_100g'];
    return `<li><button data-act="off-pick" data-i="${i}"><span class="nm">${esc(p.product_name_it || p.product_name)}${p.brands ? ` <small>${esc(String(p.brands).split(',')[0])}</small>` : ''}</span>
      <span class="k">${kc != null && kc !== '' ? fmt0(+kc) + ' kcal/100' : 'kcal mancanti'}${p.quantity ? ' · ' + esc(p.quantity) : ''} · ${esc(p.code)}</span></button></li>`;
  }).join('')}</ul><p class="tiny">Dati di Open Food Facts (licenza ODbL), inseriti da volontari: verifica con l'etichetta.</p>`
    : '<p class="empty">Nessun prodotto trovato. Prova con parole diverse o con il codice a barre.</p>';
}
async function offPick(i) {
  const p = sheetCtx.offResults?.[i];
  if (!p) return;
  const code = normCode(p.code);
  const slot = sheetCtx.slot;
  if (validGTIN(code)) {
    const local = (await foodsByBarcode(code))[0];
    if (local) { toast('Prodotto già tra i tuoi alimenti'); return slot ? openGrams(local.id, slot) : openFoodForm(local.id); }
  }
  const data = mapOFF(p, validGTIN(code) ? code : '');
  if (!validGTIN(code)) delete data.barcode;
  openFoodForm(null, slot, data);
}

/* ---------- foglio, avvisi ---------- */
let sheetCtx = {};
let lastFocus = null;
function openSheet(title, html, ctx = {}) {
  stopCamera();
  const sh = $('#sheet');
  sheetCtx = ctx;
  lastFocus = lastFocus || document.activeElement;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  sh.hidden = false;
  $('#sheet .panel').scrollTop = 0;
  document.body.classList.add('locked');
}
function closeSheet() {
  stopCamera();
  sheetCtx = {};
  document.body.classList.remove('locked');
  lastFocus?.focus?.();
  lastFocus = null;
  const sh = $('#sheet');
  if (sh.hidden) return;
  // L'animazione di chiusura usa una copia "fantasma" senza id né azioni: il pannello vero
  // sparisce subito, così nessun campo del foglio chiuso resta raggiungibile.
  if (!reduceMotion()) {
    const ghost = sh.cloneNode(true);
    const src = sh.querySelectorAll('input, select, textarea'), dst = ghost.querySelectorAll('input, select, textarea');
    dst.forEach((el, i) => { if (el.type === 'checkbox' || el.type === 'radio') el.checked = src[i].checked; else el.value = src[i].value; });
    for (const el of [ghost, ...ghost.querySelectorAll('[id], [data-act], [data-testid], [for], [name]')])
      ['id', 'data-act', 'data-testid', 'for', 'name', 'role', 'aria-labelledby'].forEach(a => el.removeAttribute(a));
    ghost.classList.add('closing', 'sheet-ghost');
    ghost.inert = true; ghost.setAttribute('aria-hidden', 'true');
    sh.before(ghost);
    setTimeout(() => ghost.remove(), 200);
  }
  sh.hidden = true;
  $('#sheet-body').innerHTML = '';
}

let toastTimer;
const ERR_RX = /non valid|errore|mancant|non trovat|impossibil|negat|non riuscit|serve la densit|già associat|scrivi |inserisci|dai un nome|almeno|niente da|nessun/i;
function toast(msg, undo) {
  const t = $('#toast');
  const err = !undo && ERR_RX.test(msg);
  t.className = 'toast' + (err ? ' err' : '');
  t.setAttribute('role', err ? 'alert' : 'status');
  t.innerHTML = `${ic(err ? 'alert' : 'check')}<span>${esc(msg)}</span>${undo ? '<button class="link" data-act="undo">Annulla</button>' : ''}`;
  t.hidden = false;
  t._undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; t._undo = null; }, undo ? 5000 : 2500);
}

/* ---------- azioni ---------- */
const actions = {
  'tab': b => showView(b.dataset.view),
  'day': b => { state.day = addDays(state.day, +b.dataset.d); state.followToday = state.day === today(); render(); },
  'day-today': () => { state.day = today(); state.followToday = true; render(); },
  'week': b => { state.week = addDays(state.week, +b.dataset.d); render(); },
  'week-now': () => { state.week = mondayOf(today()); render(); },
  'open-day': b => { state.day = b.dataset.date; state.followToday = state.day === today(); showView('oggi'); },
  'goto-data': async () => { await showView('settimana'); $('#data')?.scrollIntoView(); },
  'set-type': b => setType(b.dataset.type),
  'type-plan': async () => { await setDay(state.day, { type: null }); render(); },
  'weight': openWeight,
  'weight-save': () => saveWeight(false),
  'weight-clear': () => saveWeight(true),
  'pick': b => openPicker(+b.dataset.slot),
  'pick-food': b => openGrams(b.dataset.id, sheetCtx.slot),
  'pick-combo': b => openComboUse(b.dataset.id, sheetCtx.slot),
  'save-grams': saveGrams,
  'quick-add': () => openPicker(defaultSlot()),
  'qty-step': b => {
    const u = curUnit(), inp = $('#g-in'), q = num(inp.value) || 0;
    const step = u.base || u.conv ? (q >= 100 ? 10 : 5) : 0.5;
    const nq = Math.max(step, Math.round((q + (+b.dataset.d) * step) / step) * step);
    inp.value = String(r1(nq)).replace('.', ','); $('#q-why').textContent = ''; updGrams();
  },
  'chart-days': b => { state.chart.days = +b.dataset.n; state.chart.sel = null; drawChart(); },
  'chart-metric': b => { state.chart.metric = b.dataset.m; drawChart(); },
  'chart-sel': b => { state.chart.sel = state.chart.sel === b.dataset.date ? null : b.dataset.date; $$('#chart-card .b').forEach(g => { g.classList.toggle('sel', g.dataset.date === state.chart.sel); g.classList.toggle('dim', !!state.chart.sel && g.dataset.date !== state.chart.sel); }); $('#chart-tip').innerHTML = chartTip(); },
  'theme': b => setTheme(b.dataset.t),
  'pick-unit': b => pickUnit(b.dataset.u),
  'add-unit': addUnit,
  'pick-cat': b => { sheetCtx.cat = b.dataset.c; drawPicker(); },
  'pick-season': () => { sheetCtx.season = !sheetCtx.season; drawPicker(); },
  'cb-cat': b => { state.catSel = b.dataset.c; drawCatalogBrowse(); },
  'cb-season': () => { state.catSeason = !state.catSeason; drawCatalogBrowse(); },
  'food-info': b => openFoodInfo(b.dataset.id),
  'info-fav': b => infoFav(b.dataset.id),
  'info-edit': b => openFoodForm(b.dataset.id),
  'info-add': b => openGrams(b.dataset.id, null),
  'day-nutr': openDayNutr,
  'fu-add': () => { readFormUnits(); sheetCtx.units.push({ id: 'u' + Date.now().toString(36), l: '', [$('#f-unit').value === 'ml' ? 'ml' : 'g']: '', custom: true, src: 'personalizzata' }); drawFormUnits(); $('#f-units [data-ul]:last-of-type')?.focus(); },
  'fu-del': b => { readFormUnits(); sheetCtx.units.splice(+b.dataset.i, 1); drawFormUnits(); },
  'cu-mode': b => { sheetCtx.mode = b.dataset.m; drawComboUse(); },
  'save-combo-use': saveComboUse,
  'edit-entry': b => openEntryEdit(b.dataset.id),
  'edit-group': b => openGroup(b.dataset.gid),
  'del-group': delGroup,
  'save-entry': saveEntry,
  'del-entry': delEntry,
  'repeat': b => repeatYesterday(+b.dataset.slot),
  'copy-from': b => openCopy(b.dataset.slot ? +b.dataset.slot : null),
  'copy-do': copyDo,
  'save-combo': b => openSaveCombo(+b.dataset.slot),
  'save-combo-new': saveComboNew,
  'save-template': openSaveTemplate,
  'save-template-do': saveTemplateDo,
  'apply-template': openTemplates,
  'use-template': b => useTemplate(b.dataset.id),
  'template-form': b => openTemplateForm(b.dataset.id),
  'save-template-edit': saveTemplateEdit,
  'del-template': delTemplate,
  'alim-tab': b => { state.alimTab = b.dataset.tab; render(); },
  'food-form': b => openFoodForm(b.dataset.id, b.dataset.slot ? +b.dataset.slot : sheetCtx.slot),
  'save-food': saveFood,
  'del-food': delFood,
  'toggle-fav': b => toggleFav(b.dataset.id),
  'combo-form': b => openDishForm(b.dataset.id),
  'dish-form': () => openDishForm(null),
  'dish-variant': b => { sheetCtx.variant = b.dataset.v; drawDish(); },
  'dish-add': () => { sheetCtx.adding = true; drawDish(); },
  'dish-back': () => { sheetCtx.adding = false; drawDish(); },
  'dish-add-food': b => dishAddFood(b.dataset.id),
  'dish-remove': b => { sheetCtx.dish.items.splice(+b.dataset.ri, 1); drawDish(); },
  'save-dish': saveDish,
  'del-combo': delCombo,
  'scan': b => openScan(b.dataset.slot ? +b.dataset.slot : null),
  'scan-search': () => onCode($('#scan-code').value),
  'torch': toggleTorch,
  'test-off': testOFF,
  'off-search': b => openOffSearch(b.dataset.q ?? ($('#pick-q')?.value || $('#alim-q')?.value || ''), b.dataset.slot ? +b.dataset.slot : sheetCtx.slot),
  'off-search-go': offSearchGo,
  'off-pick': b => offPick(+b.dataset.i),
  'dismiss-install': () => { try { localStorage.setItem('osfit-install-hint', '1'); } catch { /* facoltativo */ } render(); },
  'goals': openGoals,
  'set-goals': openGoals,
  'save-goals': saveGoals,
  'csv-days': () => exportCSV('days'),
  'csv-entries': () => exportCSV('entries'),
  'backup': doBackup,
  'restore': () => { const i = $('#restore-file'); i.value = ''; i.click(); },
  'restore-replace': () => restore('replace'),
  'restore-merge': () => restore('merge'),
  'wipe': openWipe,
  'wipe-confirm': wipe,
  'persist': async () => { state.persisted = await navigator.storage.persist(); render(); },
  'close-sheet': closeSheet,
  'undo': () => { const t = $('#toast'); const fn = t._undo; t.hidden = true; t._undo = null; fn?.(); },
  'apply-update': () => { swReg?.waiting?.postMessage('skipWaiting'); },
};

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const fn = actions[b.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(b); } catch (err) { if (err?.name !== 'AbortError') { console.error(err); toast('Errore: ' + (err?.message || err)); } }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#sheet').hidden) return closeSheet();
  // elementi non-<button> con ruolo di pulsante (barre del grafico): Invio e Spazio come un tocco
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"][data-act]:not(button)')) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
$('#restore-file').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) onRestoreFile(f); });

/* ---------- service worker e aggiornamenti ---------- */
let swReg = null;
function setupSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // prima installazione: niente ricarica
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    const show = () => { if (reg.waiting && navigator.serviceWorker.controller) $('#update').hidden = false; };
    show();
    reg.installing?.addEventListener('statechange', show);
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', show);
    });
  }).catch(err => console.warn('Service worker non registrato', err));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { stopCamera(); return; }
  swReg?.update().catch(() => {});
  if (state.followToday && state.day !== today()) { state.day = today(); }
  if (state.view !== 'alimenti' && $('#sheet').hidden) render();
});
addEventListener('online', () => { if (state.view === 'settimana') render(); });
addEventListener('offline', () => { if (state.view === 'settimana') render(); });

/* ---------- avvio ---------- */
(async function init() {
  $('#ver').textContent = 'v' + APP_VERSION;
  setupSW();
  try {
    db = await openDB();
  } catch (err) {
    $('#view-oggi').innerHTML = `<div class="card pad"><p><b>Impossibile aprire il database.</b></p><p class="sub">Forse il browser è in navigazione privata o lo spazio è esaurito. (${esc(err?.message || err)})</p></div>`;
    return;
  }
  if (navigator.storage?.persisted) {
    try {
      state.persisted = await navigator.storage.persisted();
      if (!state.persisted) state.persisted = await navigator.storage.persist();
    } catch { state.persisted = false; }
  }
  try { await syncCatalog(); } catch (e) { console.warn('Catalogo non sincronizzato', e); }
  await render();
  $('#fab').hidden = state.view !== 'oggi';
  document.body.dataset.ready = '1';
})();
