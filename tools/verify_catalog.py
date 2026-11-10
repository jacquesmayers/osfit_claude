#!/usr/bin/env python3
"""Verifica che catalog.js riporti esattamente i valori della tabella Ciqual 2025 originale.

Uso: python3 tools/verify_catalog.py <CIQUAL2025_ENG_2025_11_03.csv>
Controlla, per ogni alimento e nutriente: valore identico alla fonte, "-" omesso (dato non disponibile, mai 0),
"traces" -> "tr", "< x" -> "<x"; identificativi unici e stabili; porzioni e mesi validi; impronta del file sorgente.
"""
import csv, hashlib, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_catalog as B  # noqa: E402

src = Path(sys.argv[1])
cat_js = (Path(__file__).resolve().parent.parent / 'catalog.js').read_text(encoding='utf-8')
cat = json.loads(cat_js[cat_js.index('{'):cat_js.rindex('}') + 1])
rows = list(csv.reader(open(src, encoding='utf-8', newline=''), delimiter='\t'))
hdr = [B.norm(h) for h in rows[0]]
by = {r[6]: r for r in rows[1:]}
col = {k: next(i for i, h in enumerate(hdr) if h.startswith(p)) for k, p in B.COLS.items()}

errors, checked, nd = [], 0, 0
assert cat['source']['sha256'] == hashlib.sha256(src.read_bytes()).hexdigest(), 'impronta del file sorgente diversa'
ids = [f['id'] for f in cat['foods']]
assert len(ids) == len(set(ids)), 'id duplicati'
for f in cat['foods']:
    assert re.fullmatch(r'ciqual:\d+', f['id']), f['id']
    r = by[str(f['src']['code'])]
    assert r[7] == f['src']['en'], (f['id'], 'nome sorgente diverso')
    for k, i in col.items():
        if k == 'b9tot':
            continue
        raw = r[i].strip()
        got = f['v'].get(k)
        if k == 'b9' and raw == '-':
            raw = r[col['b9tot']].strip()  # fallback documentato: folati totali
        exp = B.parse_value(raw)
        if exp is None:
            nd += 1
            if got is not None:
                errors.append(f"{f['id']} {k}: atteso dato non disponibile, trovato {got}")
        elif got != exp:
            errors.append(f"{f['id']} {k}: fonte {raw!r}, catalogo {got!r}")
        checked += 1
    for u in f.get('u', []):
        assert (u.get('g') or u.get('ml')) and u['l'], (f['id'], u)
    s = f.get('s')
    assert s is None or s == 'imp' or (isinstance(s, list) and all(1 <= m <= 12 for m in s)), (f['id'], s)
print(f"{len(cat['foods'])} alimenti, {checked} valori confrontati con la fonte, {nd} 'dato non disponibile' rispettati, errori: {len(errors)}")
if errors:
    print('\n'.join(errors[:30])); sys.exit(1)
