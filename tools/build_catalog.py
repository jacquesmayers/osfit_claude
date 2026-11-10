#!/usr/bin/env python3
"""Genera catalog.js (catalogo alimentare di OS_FIT Diario) dalla tabella Ciqual 2025 originale.

Uso:
  python3 tools/build_catalog.py <CIQUAL2025_ENG_2025_11_03.csv> [<CIQUAL2025_FR_2025_11_03.csv>]

- I valori nutrizionali vengono copiati dalla fonte senza modifiche (solo conversione del separatore decimale).
  "-" (dato assente) -> campo omesso = "dato non disponibile"; "traces" -> "tr"; "< x" -> "<x".
- Identificativi stabili "ciqual:<codice>": rigenerando il catalogo gli alimenti non si duplicano.
- Fonti:
  * Ciqual 2025, ANSES (Licence Ouverte / Open Licence Etalab), file del 03/11/2025.
  * Porzioni standard: LARN 2024 (SINU), "Standard quantitativi delle porzioni".
  * Stagionalità: "Calendario stagionalità di frutta e verdura", ASL VCO (Piemonte), campagna MIPAAF "Sai quel che mangi".
"""
import csv, hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEL = ROOT / 'tools' / 'catalog_selection.txt'
OUT = ROOT / 'catalog.js'

# Colonne Ciqual -> chiavi OS_FIT (si cerca il prefisso del nome di colonna, spazi normalizzati)
COLS = {
    'kcal': 'Energy, Regulation EU No 1169 2011 (kcal 100g)',
    'prot': 'Protein (g 100g)',
    'carb': 'Carbohydrate (g 100g)',
    'sugar': 'Sugars (g 100g)',
    'fat': 'Fat (g 100g)',
    'sat': 'FA saturated (g 100g)',
    'fiber': 'Fibres (g 100g)',
    'salt': 'Salt (g 100g)',
    'na': 'Sodium (mg 100g)',
    'k': 'Potassium (mg 100g)',
    'ca': 'Calcium (mg 100g)',
    'mg': 'Magnesium (mg 100g)',
    'fe': 'Iron (mg 100g)',
    'zn': 'Zinc (mg 100g)',
    'p': 'Phosphorus (mg 100g)',
    'vitA': 'Vitamin A activity, retinol equivalent',
    'vitC': 'Vitamin C (mg 100g)',
    'vitD': 'Vitamin D (µg 100g)',
    'vitE': 'Alpha-tocopherol (vitamine E)',
    'vitK': 'Vitamin K1 (µg 100g)',
    'b1': 'Vitamin B1 or Thiamin',
    'b2': 'Vitamin B2 or Riboflavin',
    'b3': 'Vitamin B3 or Niacin',
    'b5': 'Vitamin B5 or Pantothenic acid',
    'b6': 'Vitamin B6 (mg 100g)',
    'b9': 'Vitamin B9 or total folates, dietary folate equivalents',
    'b9tot': 'Vitamin B9 or total folates (µg 100g)',
    'b12': 'Vitamin B12 (µg 100g)',
}
REQUIRED = ['kcal', 'prot', 'carb', 'fat']

CATEGORIES = [
    ('frutta', 'Frutta fresca'), ('frutta_secca', 'Frutta secca e semi'), ('verdura', 'Verdure e ortaggi'),
    ('legumi', 'Legumi'), ('cereali', 'Cereali, pasta, riso'), ('pane', 'Pane e forno'), ('carne', 'Carne'),
    ('salumi', 'Salumi'), ('pesce', 'Pesce'), ('uova', 'Uova'), ('latte', 'Latte e yogurt'), ('formaggi', 'Formaggi'),
    ('grassi', 'Oli e grassi'), ('condimenti', 'Condimenti'), ('dolci', 'Dolci e colazione'), ('bevande', 'Bevande'),
]

# Calendario ASL VCO (Piemonte) / MIPAAF: mesi (1-12) in cui il prodotto è indicato di stagione.
SEASONS = {
    'arance': [1, 2, 3, 4, 11, 12], 'clementine': [1, 2, 10, 11, 12], 'kiwi': [1, 2, 3, 4, 5, 11, 12],
    'limoni': [1, 2, 3, 4, 10, 11, 12], 'mele': [1, 2, 3, 4, 5, 8, 9, 10, 11, 12], 'pere': [1, 2, 3, 4, 5, 8, 9, 10, 11, 12],
    'pompelmi': [1, 2, 3, 4, 5, 11, 12], 'ciliegie': [5, 6, 7], 'fragole': [4, 5, 6, 7, 8], 'nespole': [4, 5],
    'lamponi': [5, 6, 7, 8, 9, 10], 'meloni': [5, 6, 7, 8, 9], 'albicocche': [6, 7], 'fichi': [6, 7, 8, 9],
    'pesche': [6, 7, 8, 9], 'susine': [6, 7, 8, 9], 'anguria': [7, 8], 'mirtilli': [7, 8, 9],
    'uva': [8, 9, 10, 11, 12], 'castagne': [10, 11, 12], 'kaki': [10, 11, 12],
    'aglio': [4, 5, 6, 7, 8, 9, 10, 11], 'asparagi': [3, 4, 5, 6], 'bietole': list(range(1, 13)), 'carciofi': [1, 2, 3, 4],
    'carote': list(range(1, 13)), 'broccoli': [1, 2, 3, 9, 10, 11, 12], 'cavolfiori': [1, 2, 3, 4, 10, 11, 12],
    'cavoli': list(range(1, 13)), 'finocchi': [1, 2, 3, 4, 5, 10, 11, 12], 'insalate': list(range(3, 13)),
    'patate': list(range(1, 13)), 'rape': [1, 2, 3, 10, 11, 12], 'ravanelli': [4, 5, 6, 7, 8, 9, 10],
    'sedano': [3, 4, 5, 6, 7, 8, 9, 10, 11], 'spinaci': [1, 2, 3, 4, 5, 9, 10, 11, 12], 'zucche': [1, 2, 8, 9, 10, 11, 12],
    'cetrioli': [6, 7, 8, 9], 'fagiolini': [5, 6, 7, 8, 9], 'fave': [5, 6, 7], 'melanzane': [6, 7, 8, 9, 10],
    'peperoni': [6, 7, 8, 9, 10], 'piselli': [5, 6], 'pomodori': [5, 6, 7, 8, 9], 'zucchine': [6, 7, 8, 9],
}

LARN = 'LARN 2024'
# Porzioni standard LARN 2024: (id, etichetta, grammi, millilitri)
PORTIONS = {
    'F': [('larn', '1 frutto medio (porzione LARN)', 150, None)],
    'FS': [('larn', 'porzione (LARN)', 30, None)],
    'V': [('larn', 'porzione di verdura (LARN)', 200, None)],
    'I': [('larn', 'porzione di insalata (LARN)', 80, None)],
    'LS': [('larn', 'porzione (LARN)', 50, None)],
    'LC': [('larn', 'porzione (LARN)', 150, None)],
    'C': [('larn', 'porzione (LARN)', 80, None)],
    'PF': [('larn', 'porzione (LARN)', 100, None)],
    'PR': [('larn', 'porzione (LARN)', 125, None)],
    'GN': [('larn', 'porzione (LARN)', 200, None)],
    'PT': [('larn', 'porzione: 2 patate piccole (LARN)', 200, None)],
    'P': [('larn', '1 fetta media o panino piccolo (LARN)', 50, None)],
    'SP': [('larn', 'porzione (LARN)', 30, None)],
    'CO': [('larn', 'porzione (LARN)', 30, None)],
    'DO': [('larn', 'porzione (LARN)', 30, None)],
    'M': [('larn', 'porzione (LARN)', 100, None)],
    'SA': [('larn', 'porzione (LARN)', 50, None)],
    'PE': [('larn', 'porzione (LARN)', 150, None)],
    'PC': [('larn', 'porzione (LARN)', 50, None)],
    'U': [('uovo', '1 uovo (LARN)', 50, None)],
    'L': [('bicchiere', 'bicchiere piccolo (LARN)', None, 125)],
    'Y': [('vasetto', '1 vasetto (LARN)', 125, None)],
    'FF': [('larn', 'porzione (LARN)', 100, None)],
    'FST': [('larn', 'porzione (LARN)', 50, None)],
    'R': [('larn', 'porzione (LARN)', 150, None)],
    'O': [('cucchiaio', '1 cucchiaio (LARN: 10 ml = 9 g)', None, 10), ('cucchiaino', '1 cucchiaino (5 ml)', None, 5)],
    'B': [('larn', 'porzione (LARN)', 10, None)],
    'PZ': [('larn', '½ pizza (LARN)', 200, None)],
}
# Densità note da fonte (g/ml). Olio EVO: LARN 2024 indica 1 cucchiaio = 10 ml = 9 g.
DENSITY = {'O': 0.9}


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def parse_value(v):
    v = v.strip()
    if v in ('-', ''):
        return None  # dato non disponibile
    if v.lower() == 'traces':
        return 'tr'
    m = re.fullmatch(r'<\s*([\d,\.]+)', v)
    if m:
        return '<' + m.group(1).replace(',', '.')
    x = float(v.replace(',', '.'))
    return int(x) if x == int(x) and 'e' not in v else x


def main():
    src = Path(sys.argv[1])
    fr = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    raw = src.read_bytes()
    rows = list(csv.reader(raw.decode('utf-8').splitlines(), delimiter='\t'))
    # i nomi di colonna contengono a capo: ricostruisco le righe con il modulo csv sul file intero
    rows = list(csv.reader(open(src, encoding='utf-8', newline=''), delimiter='\t'))
    hdr = [norm(h) for h in rows[0]]
    idx = {}
    for key, prefix in COLS.items():
        hits = [i for i, h in enumerate(hdr) if h.startswith(prefix)]
        if len(hits) != 1:
            sys.exit(f'Colonna non trovata o ambigua per {key}: {prefix} -> {hits}')
        idx[key] = hits[0]
    by_code = {r[6]: r for r in rows[1:]}
    fr_names = {}
    if fr:
        frows = list(csv.reader(open(fr, encoding='utf-8', newline=''), delimiter='\t'))
        fr_names = {r[6]: r[7] for r in frows[1:]}

    foods, errors, seen = [], [], set()
    missing = {k: 0 for k in COLS}
    for ln, line in enumerate(SEL.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) != 6:
            errors.append(f'riga {ln}: attesi 6 campi'); continue
        code, name, cat, season, portion, note = parts
        if code in seen:
            errors.append(f'riga {ln}: codice duplicato {code}'); continue
        seen.add(code)
        r = by_code.get(code)
        if not r:
            errors.append(f'riga {ln}: codice {code} non presente in Ciqual'); continue
        if cat not in dict(CATEGORIES):
            errors.append(f'riga {ln}: categoria {cat}'); continue
        if season and season != 'imp' and season not in SEASONS:
            errors.append(f'riga {ln}: stagione {season}'); continue
        if portion and portion not in PORTIONS:
            errors.append(f'riga {ln}: porzione {portion}'); continue
        v = {}
        for key, i in idx.items():
            pv = parse_value(r[i])
            if pv is None:
                missing[key] += 1
            else:
                v[key] = pv
        # Folati: equivalenti (DFE) se presenti, altrimenti folati totali (stesso valore per alimenti non fortificati)
        tot = v.pop('b9tot', None)
        if 'b9' not in v and tot is not None:
            v['b9'] = tot
            missing['b9'] -= 1
        bad = [k for k in REQUIRED if k not in v]
        if bad:
            errors.append(f'riga {ln}: {code} {name}: mancano {bad} nella fonte'); continue
        f = {'id': f'ciqual:{code}', 'n': name, 'c': cat, 'v': v,
             'src': {'code': int(code), 'en': r[7]}}
        if fr_names.get(code):
            f['src']['fr'] = fr_names[code]
        if season == 'imp':
            f['s'] = 'imp'
        elif season:
            f['s'] = SEASONS[season]
        if portion:
            f['u'] = [{'id': uid, 'l': lab, **({'g': g} if g else {}), **({'ml': ml} if ml else {}), 'src': LARN if 'LARN' in lab else 'misura standard'}
                      for uid, lab, g, ml in PORTIONS[portion]]
            if portion in DENSITY:
                f['d'] = DENSITY[portion]
        if note:
            f['t'] = note
        foods.append(f)

    if errors:
        print('\n'.join(errors)); sys.exit(1)
    cat = {
        'version': 'ciqual2025-osfit-1',
        'generated': 'tools/build_catalog.py',
        'source': {
            'name': 'Ciqual 2025 — Table de composition nutritionnelle des aliments, ANSES',
            'file': src.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'licence': 'Licence Ouverte / Open Licence (Etalab)',
            'basis': 'per 100 g di parte edibile',
            'url': 'https://ciqual.anses.fr/',
        },
        'portions': 'LARN 2024 — Standard quantitativi delle porzioni (SINU)',
        'seasons': 'Calendario stagionalità di frutta e verdura — ASL VCO (Piemonte), campagna MIPAAF "Sai quel che mangi"',
        'categories': [{'id': a, 'n': b} for a, b in CATEGORIES],
        'foods': foods,
    }
    js = '/* Generato da tools/build_catalog.py — non modificare a mano. Fonte: Ciqual 2025 (ANSES, Licence Ouverte). */\n'
    js += 'self.OSF_CATALOG = ' + json.dumps(cat, ensure_ascii=False, separators=(',', ':')) + ';\n'
    OUT.write_text(js, encoding='utf-8')
    print(f'{len(foods)} alimenti -> {OUT} ({OUT.stat().st_size // 1024} KB)')
    print('per categoria:', {c: sum(1 for f in foods if f["c"] == c) for c, _ in CATEGORIES})
    missing.pop('b9tot', None)
    print('dati non disponibili (n. alimenti):', {k: n for k, n in missing.items() if n})


if __name__ == '__main__':
    main()
