/* OS_FIT Diario — lettore di codici a barre integrato (EAN-13, UPC-A, EAN-8).
 * JavaScript puro, nessuna dipendenza, funziona offline e su tutti i browser (anche iPhone).
 * Legge le righe dell'immagine, misura la larghezza di barre e spazi e le confronta con le
 * tabelle dello standard EAN. Ogni lettura è controllata con la cifra di controllo.
 */
(function (root) {
  'use strict';

  // Larghezze (in moduli) dei codici L: spazio-barra-spazio-barra. R ha le stesse larghezze (barra-spazio-barra-spazio).
  const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(s => s.split('').map(Number));
  const G = L.map(p => p.slice().reverse());
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const LEFT = [['L', L], ['G', G]];
  const RIGHT = [['R', L]];

  function checkDigitOk(code) {
    const d = code.split('').map(Number);
    const check = d.pop();
    const s = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (s % 10)) % 10 === check;
  }

  // Confronta 4 larghezze con le tabelle; null se la lettura è incerta.
  // Usa sia le larghezze (corrette per l'allargamento delle barre) sia le distanze tra bordi simili,
  // che non cambiano se le barre si allargano o si restringono per sfocatura o inchiostro.
  // Coppie che hanno le stesse distanze tra bordi simili e si distinguono solo dallo spessore delle barre.
  const TWINS = new Set(['1-7', '7-1', '2-8', '8-2']);
  const TUNE = { wWidth: 0.5, twinGap: 0.6 };
  function matchDigit(r, k, tables, maxErr, minGap) {
    const s = r[k] + r[k + 1] + r[k + 2] + r[k + 3];
    if (!(s > 0)) return null;
    const w0 = r[k] * 7 / s, w1 = r[k + 1] * 7 / s, w2 = r[k + 2] * 7 / s, w3 = r[k + 3] * 7 / s;
    const t1 = w0 + w1, t2 = w1 + w2;
    let best = null, bestErr = Infinity, sec = null, second = Infinity;
    for (const [tag, tab] of tables) {
      for (let d = 0; d < 10; d++) {
        const p = tab[d];
        const e = TUNE.wWidth * (Math.abs(w0 - p[0]) + Math.abs(w1 - p[1]) + Math.abs(w2 - p[2]) + Math.abs(w3 - p[3]))
          + Math.abs(t1 - p[0] - p[1]) + Math.abs(t2 - p[1] - p[2]);
        if (e < bestErr) { second = bestErr; sec = best; bestErr = e; best = { d, tag }; }
        else if (e < second) { second = e; sec = { d, tag }; }
      }
    }
    if (bestErr > maxErr || second - bestErr < minGap) return null;
    // 1/7 e 2/8 con la stessa codifica: serve una differenza netta di spessore
    if (sec && sec.tag === best.tag && TWINS.has(best.d + '-' + sec.d) && second - bestErr < TUNE.twinGap) return null;
    return best;
  }

  // Stima quanto le barre risultano più larghe degli spazi (sfocatura, inchiostro) usando le barre di guardia,
  // che per standard sono tutte larghe 1 modulo, e corregge tutte le larghezze.
  function correctSpread(r, k, count, guardIdx) {
    let bars = 0, nb = 0, spaces = 0, ns = 0;
    for (const i of guardIdx) { if (i % 2 === 0) { bars += r[k + i]; nb++; } else { spaces += r[k + i]; ns++; } }
    const delta = (bars / nb - spaces / ns) / 2;
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = Math.max(0.05, r[k + i] + (i % 2 === 0 ? -delta : delta));
    return out;
  }
  const G13 = [0, 1, 2, 27, 28, 29, 30, 31, 56, 57, 58];
  const G8 = [0, 1, 2, 19, 20, 21, 22, 23, 40, 41, 42];

  const guardOk = (r, k, n, m) => { for (let i = 0; i < n; i++) { const w = r[k + i] / m; if (w < 0.35 || w > 2.2) return false; } return true; };
  const quietOk = (r, i, m) => i < 0 || i >= r.length || r[i] >= 2.5 * m;

  // r: larghezze delle "run", r[k] è una barra scura.
  function decodeEAN13(r, k) {
    if (k + 59 > r.length) return null;
    let T = 0; for (let i = 0; i < 59; i++) T += r[k + i];
    const m = T / 95;
    if (!guardOk(r, k, 3, m) || !guardOk(r, k + 27, 5, m) || !guardOk(r, k + 56, 3, m)) return null;
    if (!quietOk(r, k - 1, m) || !quietOk(r, k + 59, m)) return null;
    const c = correctSpread(r, k, 59, G13);
    let digits = '', parity = '';
    for (let j = 0; j < 6; j++) {
      const x = matchDigit(c, 3 + 4 * j, LEFT, 1.6, 0.12);
      if (!x) return null;
      digits += x.d; parity += x.tag;
    }
    const first = PARITY.indexOf(parity);
    if (first < 0) return null;
    for (let j = 0; j < 6; j++) {
      const x = matchDigit(c, 32 + 4 * j, RIGHT, 1.6, 0.12);
      if (!x) return null;
      digits += x.d;
    }
    const code = first + digits;
    return checkDigitOk(code) ? code : null;
  }

  function decodeEAN8(r, k) {
    if (k + 43 > r.length) return null;
    let T = 0; for (let i = 0; i < 43; i++) T += r[k + i];
    const m = T / 67;
    if (!guardOk(r, k, 3, m) || !guardOk(r, k + 19, 5, m) || !guardOk(r, k + 40, 3, m)) return null;
    if (!quietOk(r, k - 1, m) || !quietOk(r, k + 43, m)) return null;
    if (!quietOk(r, k - 1, 1.4 * m) || !quietOk(r, k + 43, 1.4 * m)) return null; // EAN-8 ha meno controlli: margini più severi
    const c = correctSpread(r, k, 43, G8);
    let code = '';
    for (let j = 0; j < 4; j++) { const x = matchDigit(c, 3 + 4 * j, [['L', L]], 0.9, 0.35); if (!x) return null; code += x.d; }
    for (let j = 0; j < 4; j++) { const x = matchDigit(c, 24 + 4 * j, RIGHT, 0.9, 0.35); if (!x) return null; code += x.d; }
    return checkDigitOk(code) ? code : null;
  }

  // Da una riga di luminosità alle larghezze delle run, con soglia adattiva e bordi interpolati.
  function lineRuns(lum) {
    const n = lum.length;
    if (n < 60) return null;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = lum[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 30) return null;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + lum[i];
    const w = Math.max(12, Math.round(n / 12));
    const thr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const mean = (pre[b] - pre[a]) / (b - a);
      thr[i] = (mean + (mn + mx) / 2) / 2; // media locale e globale: stabile su sfondi non uniformi
    }
    const edges = [];
    let dark = lum[0] < thr[0];
    const firstDark = dark;
    for (let i = 1; i < n; i++) {
      const d = lum[i] < thr[i];
      if (d !== dark) {
        const a = lum[i - 1] - thr[i - 1], b = lum[i] - thr[i];
        edges.push(i - 1 + (a === b ? 0.5 : a / (a - b)));
        dark = d;
      }
    }
    if (edges.length < 44) return null;
    const runs = new Float32Array(edges.length - 1);
    for (let i = 0; i < runs.length; i++) runs[i] = edges[i + 1] - edges[i];
    // la prima run (tra edges[0] e edges[1]) ha colore opposto al primo pixel
    return { runs, firstBarIndex: firstDark ? 1 : 0 };
  }

  // Secondo metodo, robusto alla sfocatura: i bordi sono i picchi della derivata (con posizione sub-pixel).
  function gradRuns(lum, smooth) {
    const n = lum.length;
    if (n < 60) return null;
    let s = lum;
    for (let pass = 0; pass < smooth; pass++) {
      const t = new Float32Array(n);
      t[0] = s[0]; t[n - 1] = s[n - 1];
      for (let i = 1; i < n - 1; i++) t[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
      s = t;
    }
    const g = new Float32Array(n);
    let gmax = 0;
    for (let i = 1; i < n - 1; i++) { g[i] = (s[i + 1] - s[i - 1]) / 2; const a = Math.abs(g[i]); if (a > gmax) gmax = a; }
    if (gmax < 4) return null;
    const T = Math.max(2, gmax * 0.12);
    const edges = []; const signs = [];
    for (let i = 2; i < n - 2; i++) {
      const v = g[i], a = Math.abs(v);
      if (a < T || a < Math.abs(g[i - 1]) || a < Math.abs(g[i + 1]) || (a === Math.abs(g[i - 1]))) continue;
      const sign = v > 0 ? 1 : -1;
      if ((g[i - 1] > 0 ? 1 : -1) !== sign && Math.abs(g[i - 1]) > 0) { /* picco isolato */ }
      const y0 = Math.abs(g[i - 1]), y1 = a, y2 = Math.abs(g[i + 1]);
      const den = y0 - 2 * y1 + y2;
      const pos = i + (den !== 0 ? 0.5 * (y0 - y2) / den : 0);
      if (signs.length && signs[signs.length - 1] === sign) {
        // due bordi dello stesso verso: tieni il più forte
        if (a > edges[edges.length - 1].a) edges[edges.length - 1] = { pos, a };
        continue;
      }
      edges.push({ pos, a }); signs.push(sign);
    }
    if (edges.length < 44) return null;
    const runs = new Float32Array(edges.length - 1);
    for (let i = 0; i < runs.length; i++) runs[i] = edges[i + 1].pos - edges[i].pos;
    // un bordo con derivata negativa (chiaro → scuro) apre una barra
    return { runs, firstBarIndex: signs[0] < 0 ? 0 : 1 };
  }

  // Rende più netti i bordi (maschera di contrasto): recupera barre sottili in immagini sfocate.
  function sharpen(lum, radius, amount) {
    const n = lum.length, pre = new Float64Array(n + 1), out = new Float32Array(n);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + lum[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - radius), b = Math.min(n, i + radius + 1);
      out[i] = lum[i] + amount * (lum[i] - (pre[b] - pre[a]) / (b - a));
    }
    return out;
  }

  function decodeRuns(lr) {
    if (!lr) return null;
    const { runs, firstBarIndex } = lr;
    for (let k = firstBarIndex; k < runs.length; k += 2) {
      const c = decodeEAN13(runs, k) || decodeEAN8(runs, k);
      if (c) return c;
    }
    return null;
  }
  function decodeLine(lum) {
    let c = decodeRuns(lineRuns(lum)) || decodeRuns(gradRuns(lum, 1)) || decodeRuns(gradRuns(lum, 3));
    if (c) return c;
    for (const [r, a] of [[3, 1.5], [5, 2.5]]) {
      const sh = sharpen(lum, r, a);
      c = decodeRuns(lineRuns(sh)) || decodeRuns(gradRuns(sh, 1));
      if (c) return c;
    }
    return null;
  }

  const Y = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  function lumRow(data, w, h, y) { // media di 3 righe vicine contro il rumore
    const out = new Float32Array(w);
    const ys = [Math.max(0, y - 1), y, Math.min(h - 1, y + 1)];
    for (const yy of ys) for (let x = 0, i = yy * w * 4; x < w; x++, i += 4) out[x] += Y(data, i) / 3;
    return out;
  }
  function lumCol(data, w, h, x) {
    const out = new Float32Array(h);
    const xs = [Math.max(0, x - 1), x, Math.min(w - 1, x + 1)];
    for (const xx of xs) for (let y = 0, i = xx * 4; y < h; y++, i += w * 4) out[y] += Y(data, i) / 3;
    return out;
  }
  const rev = a => { const b = new Float32Array(a.length); for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i]; return b; };

  /**
   * Cerca un codice in un'immagine RGBA ({data, width, height}).
   * opts.lines: righe da analizzare; opts.vertical: prova anche in verticale; opts.band: [inizio, fine] della fascia (0–1).
   * Restituisce { code, votes, lines } oppure null.
   */
  function scanImageData(img, opts = {}) {
    const { data, width: w, height: h } = img;
    const lines = opts.lines || 25;
    const [b0, b1] = opts.band || [0.1, 0.9];
    const votes = new Map();
    let tried = 0;
    const tryLum = lum => {
      tried++;
      const c = decodeLine(lum) || decodeLine(rev(lum));
      if (c) votes.set(c, (votes.get(c) || 0) + 1);
    };
    for (let i = 0; i < lines; i++) tryLum(lumRow(data, w, h, Math.round(h * (b0 + (b1 - b0) * i / (lines - 1)))));
    if (opts.vertical && !votes.size) for (let i = 0; i < lines; i++) tryLum(lumCol(data, w, h, Math.round(w * (b0 + (b1 - b0) * i / (lines - 1)))));
    let best = null;
    for (const [code, v] of votes) if (!best || v > best.votes) best = { code, votes: v };
    return best ? { ...best, lines: tried } : null;
  }

  const api = { scanImageData, decodeLine, checkDigitOk, _lineRuns: lineRuns, _gradRuns: gradRuns, _tune: TUNE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OSFScanner = api;
})(typeof self !== 'undefined' ? self : this);
