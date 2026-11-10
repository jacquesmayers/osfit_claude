"""Test automatici di OS_FIT Diario (Playwright + Chrome/Chromium).

Esegue la "prova decisiva" in un browser reale con profilo persistente:
  online -> offline -> chiusura completa -> riapertura -> registrazione pasto
  -> chiusura -> riapertura -> dati presenti
più modifica/cancellazione offline, riepilogo settimanale, CSV, backup,
cancellazione totale, ripristino e aggiornamento dell'app senza perdita di dati.

Uso:  python3 tests/test_offline.py [--chrome /percorso/chrome] [--out cartella]
Richiede: pip install playwright  (e un Chrome/Chromium installato)
Limite: testa il motore Chromium, non Safari/iOS.
"""
import argparse, csv, re, functools, http.server, io, json, shutil, socket, sys, tempfile, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
APP_FILES = ['index.html', 'app.js', 'scanner.js', 'catalog.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icons']

DUMP_JS = """async () => {
  const db = await new Promise((r, j) => { const q = indexedDB.open('osfit-diario'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const names = [...db.objectStoreNames];
  const out = { foods: await all('foods'), combos: await all('combos'), entries: await all('entries') };
  if (names.includes('days')) { out.days = await all('days'); out.templates = await all('templates'); }
  db.close(); return out;
}"""

# ---- immagini di codici a barre per le prove dello scanner (richiede Pillow e numpy; il video anche ffmpeg) ----
def make_barcode(code, path, size=(1280, 720), module=4.0, blur=0.0, angle=0.0, noise=0.0, scene=True):
    import numpy as np
    from PIL import Image, ImageFilter, ImageDraw
    Lc = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
    Gc = [''.join('1' if c == '0' else '0' for c in x)[::-1] for x in Lc]
    Rc = [''.join('1' if c == '0' else '0' for c in x) for x in Lc]
    PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
    par = PAR[int(code[0])]
    mods = '101' + ''.join((Lc if par[i] == 'L' else Gc)[int(c)] for i, c in enumerate(code[1:7])) + '01010' + ''.join(Rc[int(c)] for c in code[7:]) + '101'
    ss, quiet, h = 8, 11, int(module * 55)
    W = int(round((len(mods) + 2 * quiet) * module))
    big = np.full((h, W * ss), 250, np.float32)
    for i, b in enumerate(mods):
        if b == '1':
            x0 = (quiet + i) * module * ss
            big[:, int(round(x0)):int(round(x0 + module * ss))] = 25
    label = Image.fromarray(big.reshape(h, W, ss).mean(axis=2).astype(np.uint8)).convert('RGB')
    bg = Image.new('RGB', size, (196, 150, 90) if scene else (255, 255, 255))
    if scene:  # confezione finta: riquadri e scritte attorno al codice
        d = ImageDraw.Draw(bg)
        for k in range(14):
            d.rectangle([k * 97 % size[0], k * 53 % size[1], k * 97 % size[0] + 120, k * 53 % size[1] + 18], fill=(90 + k * 9, 60, 40))
    lab = label.rotate(angle, expand=True, fillcolor=(196, 150, 90) if scene else (255, 255, 255), resample=Image.BICUBIC)
    bg.paste(lab, ((size[0] - lab.width) // 2, (size[1] - lab.height) // 2))
    if blur: bg = bg.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        a = np.asarray(bg).astype(np.float32) + np.random.default_rng(1).normal(0, noise, (size[1], size[0], 3))
        bg = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    bg.save(path)
    return path

def gtin(body):
    d = [int(c) for c in body][::-1]
    return body + str((10 - sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(d)) % 10) % 10)

results = []
CUR = {}  # pagina attiva, per lo screenshot in caso di errore
def step(name):
    def deco(fn):
        @functools.wraps(fn)
        def run(*a, **k):
            t = time.time()
            try:
                fn(*a, **k); results.append((name, True, f'{time.time()-t:.1f}s'))
                print(f'  OK   {name}')
            except Exception as e:
                results.append((name, False, (str(e) or repr(e)).splitlines()[0][:200]))
                print(f"  FAIL {name}: {e!r}")
                try: CUR['pg'].screenshot(path=str(CUR['out'] / 'errore.png'))
                except Exception: pass
                import traceback; traceback.print_exc(); raise
        return run
    return deco

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chrome', default=None, help='percorso di Chrome (facoltativo)')
    ap.add_argument('--out', default=str(ROOT / 'tests' / 'output'))
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix='osfit-test-'))
    site, profile = work / 'site', work / 'profile'
    site.mkdir()
    for f in APP_FILES:
        src = ROOT / f
        (shutil.copytree if src.is_dir() else shutil.copy)(src, site / f)

    port = free_port()
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Quiet, directory=str(site)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    URL = f'http://localhost:{port}/'

    with sync_playwright() as p:
        def launch(offline=False):
            ctx = p.chromium.launch_persistent_context(
                str(profile), headless=True, executable_path=args.chrome, offline=offline,
                viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True, locale='it-IT')
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.on('dialog', lambda d: d.accept())
            pg.on('pageerror', lambda e: print('    [errore pagina]', e))
            pg.goto(URL)
            pg.wait_for_selector('body[data-ready="1"]', timeout=15000)
            CUR['pg'], CUR['out'] = pg, out
            return ctx, pg

        def shot(pg, name):
            pg.wait_for_timeout(400)  # attende la fine delle animazioni
            pg.evaluate("document.getElementById('toast').hidden = true")
            pg.screenshot(path=str(out / f'{name}.png'))

        def add_food(pg, name, kcal, prot, carb, fat, fav=False, portion=''):
            pg.click('.tabs [data-view="alimenti"]')
            pg.click('[data-act="alim-tab"][data-tab="foods"]')
            pg.click('.toolbar [data-act="food-form"]')
            pg.fill('#f-name', name)
            for k, v in (('kcal', kcal), ('prot', prot), ('carb', carb), ('fat', fat), ('portion', portion)):
                pg.fill(f'#f-{k}', str(v))
            if fav: pg.check('#f-fav')
            pg.click('[data-act="save-food"]')
            expect(pg.locator('#alim-list')).to_contain_text(name)

        def add_entry(pg, slot, food, grams):
            pg.click('.tabs [data-view="oggi"]')
            pg.click(f'.meal[data-slot="{slot}"] .add')
            pg.click(f'[data-act="pick-food"]:has-text("{food}")')
            pg.fill('#g-in', str(grams))
            pg.click('[data-act="save-grams"]')
            expect(pg.locator(f'.meal[data-slot="{slot}"] .rows')).to_contain_text(food)

        dump = lambda pg: pg.evaluate(DUMP_JS)
        ctx = pg = None
        NEW_VER = None

        @step('1. Prima apertura online: service worker attivo e file in cache')
        def s1():
            nonlocal ctx, pg
            ctx, pg = launch()
            pg.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)')
            pg.evaluate('navigator.serviceWorker.ready')
            pg.reload(); pg.wait_for_selector('body[data-ready="1"]')
            assert pg.evaluate('!!navigator.serviceWorker.controller'), 'pagina non controllata dal service worker'
            keys = pg.evaluate('caches.keys()')
            assert any(k.startswith('osfit-diario-') for k in keys), keys
            add_food(pg, 'Yogurt greco 0%', 57, 10.3, 3.6, 0.2, fav=True, portion=170)
            add_food(pg, 'Fiocchi di avena', 372, 13.5, 58.7, 7)
            add_food(pg, 'Petto di pollo', 110, 23.3, 0, 1.2, fav=True)
            add_food(pg, 'Riso basmati', 351, 7.5, 78, 0.6)
            shot(pg, '02-alimenti')
        s1()

        @step('2. Modalità aereo + chiusura completa + riapertura offline')
        def s2():
            nonlocal ctx, pg
            ctx.set_offline(True); ctx.close()
            ctx, pg = launch(offline=True)
            assert not pg.evaluate('navigator.onLine'), 'il browser risulta online'
            expect(pg.locator('.meal[data-slot="1"]')).to_be_visible()
        s2()

        @step('3. Offline: registra un pasto (preferito + quantità modificata)')
        def s3():
            add_entry(pg, 1, 'Yogurt greco 0%', 200)
            add_entry(pg, 1, 'Fiocchi di avena', 40)
            add_entry(pg, 3, 'Petto di pollo', 150)
            add_entry(pg, 3, 'Riso basmati', 80)
            expect(pg.locator('[data-testid="totals"] .kcal b')).to_have_text('709')  # 114+149+165+281 (arrotondati per voce)
        s3()

        @step('4. Chiusura + riapertura offline: i dati ci sono')
        def s4():
            nonlocal ctx, pg
            ctx.close()
            ctx, pg = launch(offline=True)
            expect(pg.locator('.meal[data-slot="1"] .rows li')).to_have_count(2)
            expect(pg.locator('.meal[data-slot="3"] .rows li')).to_have_count(2)
            shot(pg, '01-oggi')
        s4()

        @step('5. Offline: modifica e cancella voci, crea e usa un pasto preferito')
        def s5():
            # modifica grammi
            pg.click('.meal[data-slot="1"] .row:has-text("Fiocchi di avena")')
            pg.fill('#e-g', '50'); pg.click('[data-act="save-entry"]')
            expect(pg.locator('.meal[data-slot="1"] .row:has-text("Fiocchi di avena") .g')).to_have_text('50 g')
            # salva colazione come pasto preferito
            pg.click('.meal[data-slot="1"] [data-act="save-combo"]')
            pg.fill('#combo-name', 'Colazione yogurt e avena'); pg.click('[data-act="save-combo-new"]')
            # usa il pasto preferito nello spuntino cambiando una quantità
            pg.click('.meal[data-slot="2"] .add')
            shot(pg, '03-scelta')
            pg.click('[data-act="pick-combo"]:has-text("Colazione yogurt e avena")')
            pg.fill('[data-i="0"]', '150'); pg.click('[data-act="save-combo-use"]')
            expect(pg.locator('.meal[data-slot="2"] .row[data-act="edit-entry"]')).to_have_count(2)
            # cancella una voce
            pg.click('.meal[data-slot="3"] .row:has-text("Riso basmati")')
            pg.click('[data-act="del-entry"]')
            expect(pg.locator('.meal[data-slot="3"] .rows li')).to_have_count(1)
            # modifica e cancella un alimento
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="foods"]')
            pg.click('#alim-list .main:has-text("Riso basmati")')
            pg.fill('#f-name', 'Riso basmati crudo'); pg.click('[data-act="save-food"]')
            expect(pg.locator('#alim-list')).to_contain_text('Riso basmati crudo')
            pg.click('#alim-list .main:has-text("Riso basmati crudo")'); pg.click('[data-act="del-food"]')
            expect(pg.locator('#alim-list')).not_to_contain_text('Riso basmati')
            pg.click('.tabs [data-view="oggi"]')
            pg.click('.meal[data-slot="4"] .add'); pg.click('[data-act="pick-food"]:has-text("Yogurt greco")')
            shot(pg, '04-quantita')
            pg.click('[data-act="close-sheet"] >> nth=1')
            d = dump(pg)
            assert len(d['entries']) == 5 and len(d['foods']) == 3 and len(d['combos']) == 1, {k: len(v) for k, v in d.items()}
            d0 = {k: d[k] for k in ('foods', 'combos', 'entries')}
        s5()

        @step('6. Settimana: giorni con dati distinti dai giorni vuoti')
        def s6():
            pg.click('.tabs [data-view="settimana"]')
            t = pg.evaluate("(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()")
            expect(pg.locator(f'tr[data-date="{t}"]')).to_have_class('has')
            assert pg.locator('tr.has').count() == 1
            expect(pg.locator('.weeksum')).to_contain_text('1/7 giorni con dati')
            shot(pg, '05-settimana')
        s6()

        csvs = {}
        @step('7. Esportazione CSV (giorni e voci) offline')
        def s7():
            for kind in ('days', 'entries'):
                with pg.expect_download() as dl:
                    pg.click(f'[data-act="csv-{kind}"]')
                path = out / dl.value.suggested_filename
                dl.value.save_as(path)
                csvs[kind] = list(csv.reader(io.StringIO(path.read_text(encoding='utf-8'))))
            days = csvs['days']
            # compatibilità: le colonne storiche restano nello stesso ordine, le nuove sono in fondo
            assert days[0][:9] == ['data', 'stato', 'voci', 'kcal', 'proteine_g', 'carboidrati_g', 'grassi_g', 'tipo_giornata', 'peso_kg'], days[0]
            assert days[0][9:] == ['zuccheri_g', 'grassi_saturi_g', 'fibre_g', 'sale_g', 'voci_senza_dati_extra'], days[0]
            assert len(days) == 8 and sum(r[1] == 'registrato' for r in days[1:]) == 1 and sum(r[1] == 'vuoto' for r in days[1:]) == 6
            ent = csvs['entries']
            assert ent[0][:11] == ['data', 'pasto_n', 'pasto', 'alimento', 'grammi', 'kcal', 'proteine_g', 'carboidrati_g', 'grassi_g', 'unita', 'piatto'] and len(ent) == 6, ent
            assert ent[0][11:] == ['zuccheri_g', 'grassi_saturi_g', 'fibre_g', 'sale_g', 'quantita_domestica'], ent[0]
            total_csv = sum(int(r[5]) for r in ent[1:])
            reg = next(r for r in days[1:] if r[1] == 'registrato')
            assert int(reg[3]) == total_csv, (reg, total_csv)
        s7()

        backup_path = None
        @step('8. Backup completo, cancellazione totale, ripristino identico')
        def s8():
            nonlocal backup_path
            before = dump(pg)
            with pg.expect_download() as dl:
                pg.click('[data-act="backup"]')
            backup_path = out / dl.value.suggested_filename
            dl.value.save_as(backup_path)
            data = json.loads(backup_path.read_text(encoding='utf-8'))
            assert data['app'] == 'OS_FIT Diario' and data['counts'] == {'foods': 3, 'combos': 1, 'entries': 5, 'days': 0, 'templates': 0}
            pg.click('[data-act="wipe"]'); pg.fill('#wipe-in', 'cancella'); pg.click('[data-act="wipe-confirm"]')
            empty = dump(pg)
            assert not any(empty.values()), 'dati non cancellati'
            pg.set_input_files('#restore-file', str(backup_path))
            pg.click('[data-act="restore-replace"]')
            after = dump(pg)
            key = lambda d: {k: sorted(v, key=lambda x: x['id']) for k, v in d.items()}
            assert key(before) == key(after), 'i dati ripristinati non coincidono'
            # backup non valido rifiutato
            bad = out / 'non-valido.json'; bad.write_text('{"app":"altro"}')
            pg.set_input_files('#restore-file', str(bad))
            expect(pg.locator('#toast')).to_contain_text('Non è un backup')
        s8()

        @step('9. Ripristino su installazione nuova (profilo browser vuoto, modalità Unisci)')
        def s9():
            nonlocal ctx, pg, profile
            ctx.close()
            profile = work / 'profile2'
            ctx, pg = launch()
            pg.click('.tabs [data-view="settimana"]')
            pg.set_input_files('#restore-file', str(backup_path))
            pg.click('[data-act="restore-merge"]')
            assert len(dump(pg)['entries']) == 5
        s9()

        @step('10. Aggiornamento app (nuova versione): avviso, aggiornamento, dati intatti')
        def s10():
            nonlocal NEW_VER
            cur = re.search(r"APP_VERSION = '([^']+)'", (site / 'app.js').read_text()).group(1)
            NEW_VER = cur + '-test'
            for f in ('app.js', 'sw.js'):
                fp = site / f
                fp.write_text(fp.read_text().replace(f"'{cur}'", f"'{NEW_VER}'"))
            pg.reload(); pg.wait_for_selector('body[data-ready="1"]')
            pg.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            expect(pg.locator('#update')).to_be_visible(timeout=15000)
            with pg.expect_navigation():
                pg.click('[data-act="apply-update"]')
            pg.wait_for_selector('body[data-ready="1"]')
            expect(pg.locator('#ver')).to_have_text('v' + NEW_VER)
            assert len(dump(pg)['entries']) == 5
            keys = [k for k in pg.evaluate('caches.keys()') if k.startswith('osfit-diario-')]
            assert keys == ['osfit-diario-' + NEW_VER], keys
        s10()

        @step('11. Dopo l\'aggiornamento: riapertura offline funziona')
        def s11():
            nonlocal ctx, pg
            ctx.close()
            ctx, pg = launch(offline=True)
            expect(pg.locator('#ver')).to_have_text('v' + NEW_VER)
            expect(pg.locator('.meal .row[data-act="edit-entry"]')).to_have_count(5)
            ctx.close()
        s11()

        # ---------------- v1.1.0: nuove funzioni ----------------
        def gtin(body):  # aggiunge la cifra di controllo
            d = [int(c) for c in body][::-1]
            return body + str((10 - sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(d)) % 10) % 10)
        today_js = "(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()"
        it = lambda n: f'{n:,}'.replace(',', '.') if abs(n) >= 10000 else str(n)  # formato it-IT
        def day_entries(pg, date):
            return [e for e in dump(pg)['entries'] if e['date'] == date]

        @step('12. Piatto da zero: ingredienti, totali calcolati, varianti per giorno, modifica, peso cotto')
        def s12():
            nonlocal ctx, pg
            ctx, pg = launch()
            add_food(pg, 'Riso', 351, 7.5, 78, 0.6)
            pg.click('#alim-list .main:has-text("Riso")')
            pg.select_option('#f-state', 'crudo')
            pg.click('details.more:has(#f-dp-pesi) summary')
            pg.fill('#f-dp-pesi', '120'); pg.fill('#f-dp-cardio', '100'); pg.fill('#f-dp-riposo', '90')
            pg.click('[data-act="save-food"]')
            add_food(pg, 'Peperoni', 26, 1, 4.2, 0.3)
            add_food(pg, 'Olio extravergine', 884, 0, 0, 100)
            pg.click('[data-act="alim-tab"][data-tab="combos"]')
            pg.click('[data-act="dish-form"]')
            pg.fill('#d-name', 'Riso, pollo e peperoni')
            for i, (food, g) in enumerate([('Riso (crudo)', 120), ('Petto di pollo', 180), ('Peperoni', 150), ('Olio extravergine', 10)]):
                pg.click('[data-act="dish-add"]')
                pg.click(f'[data-act="dish-add-food"]:has-text("{food}")')
                pg.fill(f'#dish [data-i="{i}"]', str(g))
            expect(pg.locator('[data-testid="dish-total"]')).to_contain_text('746 kcal')  # 421+198+39+88
            pg.click('[data-act="dish-variant"][data-v="pesi"]')
            expect(pg.locator('#dish [data-i="0"]')).to_have_value('120')  # porzione Pesi del riso già proposta
            pg.fill('#dish [data-i="1"]', '200')
            expect(pg.locator('[data-testid="dish-total"]')).to_contain_text('768 kcal')
            pg.click('[data-act="dish-variant"][data-v="base"]')
            expect(pg.locator('#dish [data-i="1"]')).to_have_value('180')
            shot(pg, '07-piatto')
            pg.click('[data-act="save-dish"]')
            # modifica: togli e rimetti l'olio, imposta il peso cotto
            pg.click('#alim-list .main:has-text("Riso, pollo e peperoni")')
            pg.click('[data-act="dish-remove"][data-ri="3"]')
            expect(pg.locator('[data-testid="dish-total"]')).to_contain_text('658 kcal')
            pg.click('[data-act="dish-add"]'); pg.click('[data-act="dish-add-food"]:has-text("Olio extravergine")')
            pg.fill('#dish [data-i="3"]', '10')
            pg.click('details.more:has(#d-cooked) summary'); pg.fill('#d-cooked', '1200')
            pg.click('[data-act="save-dish"]')
            c = [x for x in dump(pg)['combos'] if x['name'] == 'Riso, pollo e peperoni'][0]
            assert c['cookedWeight'] == 1200 and len(c['items']) == 4 and c['items'][1]['dayGrams'] == {'pesi': 200}, c
        s12()

        @step('13. Tipo di giornata: porzioni proposte, modifica manuale che non altera le impostazioni, piatto nel diario')
        def s13():
            pg.click('.tabs [data-view="oggi"]')
            pg.click('[data-act="set-type"][data-type="pesi"]')
            expect(pg.locator('[data-act="set-type"][data-type="pesi"]')).to_have_attribute('aria-pressed', 'true')
            pg.click('.meal[data-slot="3"] .add'); pg.click('[data-act="pick-food"]:has-text("Riso (crudo)")')
            expect(pg.locator('#g-in')).to_have_value('120')
            expect(pg.locator('[data-testid="why"]')).to_contain_text('porzione Pesi')
            pg.fill('#g-in', '130'); pg.click('[data-act="save-grams"]')
            expect(pg.locator('.meal[data-slot="3"] .row:has-text("Riso (crudo)") .g')).to_have_text('130 g')
            f = [x for x in dump(pg)['foods'] if x['name'] == 'Riso'][0]
            assert f['dayPortions'] == {'pesi': 120, 'cardio': 100, 'riposo': 90}, f
            pg.click('[data-act="set-type"][data-type="riposo"]')
            pg.click('.meal[data-slot="3"] .add'); pg.click('[data-act="pick-food"]:has-text("Riso (crudo)")')
            expect(pg.locator('#g-in')).to_have_value('90')
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.click('[data-act="set-type"][data-type="pesi"]')
            # piatto in giorno pesi: quantità variante
            pg.click('.meal[data-slot="5"] .add'); pg.click('[data-act="pick-combo"]:has-text("Riso, pollo e peperoni")')
            expect(pg.locator('#cu [data-i="1"]')).to_have_value('200')
            pg.click('[data-act="save-combo-use"]')
            expect(pg.locator('.meal[data-slot="5"] .grp-h')).to_contain_text('Riso, pollo e peperoni')
            expect(pg.locator('.meal[data-slot="5"] .row[data-act="edit-entry"]')).to_have_count(4)
            shot(pg, '08-oggi-piatto')
            # porzione di piatto cotto: (421,2+198+39+88,4) × 250 / 1200 = 155,5 → 156 kcal
            pg.click('.meal[data-slot="4"] .add'); pg.click('[data-act="pick-combo"]:has-text("Riso, pollo e peperoni")')
            pg.click('[data-act="cu-mode"][data-m="cooked"]')
            pg.fill('#cu-g', '250')
            expect(pg.locator('#c-prev')).to_contain_text('156 kcal')
            pg.click('[data-act="save-combo-use"]')
            expect(pg.locator('.meal[data-slot="4"] .row')).to_contain_text('(cotto)')
            # elimina il piatto intero e annulla
            pg.click('.meal[data-slot="5"] .grp-h'); pg.click('[data-act="del-group"]')
            expect(pg.locator('.meal[data-slot="5"] .row')).to_have_count(0)
            pg.click('#toast [data-act="undo"]')
            expect(pg.locator('.meal[data-slot="5"] .row[data-act="edit-entry"]')).to_have_count(4)
        s13()

        @step('14. Obiettivi per tipo di giornata e programma settimanale')
        def s14():
            t = pg.evaluate(today_js)
            wd = pg.evaluate('((new Date().getDay() + 6) % 7) + 1')
            pg.click('.tabs [data-view="settimana"]'); pg.click('[data-act="goals"]')
            pg.fill('#goal-pesi-kcal', '2600'); pg.fill('#goal-pesi-prot', '180')
            pg.select_option(f'#plan-{wd}', 'cardio')
            pg.select_option(f'#plan-{wd % 7 + 1}', 'riposo')
            shot(pg, '09-obiettivi')
            pg.click('[data-act="save-goals"]')
            pg.click('.tabs [data-view="oggi"]')
            expect(pg.locator('#view-oggi')).to_contain_text('usa il programma (Cardio)')  # il tipo scelto a mano vince
            tot = day_entries(pg, t)
            kcal = sum(e['kcal'] for e in tot); prot = round(sum(e['prot'] for e in tot))
            expect(pg.locator('[data-testid="remain"]')).to_contain_text(f'{it(2600 - kcal)} kcal')
            expect(pg.locator('[data-testid="remain"]')).to_contain_text(f'P {it(180 - prot)} g')
            pg.click('[data-act="type-plan"]')
            expect(pg.locator('[data-act="set-type"][data-type="cardio"]')).to_have_attribute('aria-pressed', 'true')
            expect(pg.locator('#view-oggi')).to_contain_text('dal programma settimanale')
            pg.click('[data-act="day"][data-d="1"]')
            expect(pg.locator('[data-act="set-type"][data-type="riposo"]')).to_have_attribute('aria-pressed', 'true')
            pg.click('[data-act="day-today"]')
            pg.click('[data-act="set-type"][data-type="pesi"]')
        s14()

        @step('15. Giornata tipo: salva, applica a un altro giorno, annulla')
        def s15():
            t = pg.evaluate(today_js)
            n = len(day_entries(pg, t))
            pg.click('[data-act="save-template"]'); pg.fill('#tpl-name', 'Giornata pesi test'); pg.click('[data-act="save-template-do"]')
            pg.click('[data-act="day"][data-d="1"]'); pg.click('[data-act="day"][data-d="1"]')  # oggi + 2
            pg.click('[data-act="apply-template"]'); pg.click('[data-act="use-template"]:has-text("Giornata pesi test")')
            expect(pg.locator('.meal .row[data-act="edit-entry"]')).to_have_count(n)
            expect(pg.locator('[data-act="set-type"][data-type="pesi"]')).to_have_attribute('aria-pressed', 'true')
            pg.click('#toast [data-act="undo"]')
            expect(pg.locator('.meal .row[data-act="edit-entry"]')).to_have_count(0)
            pg.click('[data-act="apply-template"]'); pg.click('[data-act="use-template"]:has-text("Giornata pesi test")')
            expect(pg.locator('.meal .row[data-act="edit-entry"]')).to_have_count(n)
        s15()

        @step('16. Copia da un giorno qualsiasi (giornata intera e singolo pasto)')
        def s16():
            t = pg.evaluate(today_js)
            n = len(day_entries(pg, t))
            pg.click('[data-act="day"][data-d="1"]')  # oggi + 3
            pg.click('.dayactions [data-act="copy-from"]'); pg.fill('#cp-date', t)
            expect(pg.locator('#cp-prev')).to_contain_text(f'{n} voci')
            pg.click('[data-act="copy-do"]')
            expect(pg.locator('.meal .row[data-act="edit-entry"]')).to_have_count(n)
            pg.click('[data-act="day"][data-d="1"]')  # oggi + 4
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="copy-from"]')
            pg.fill('#cp-date', t); pg.select_option('#cp-slot', '3')
            pg.click('[data-act="copy-do"]')
            expect(pg.locator('.meal[data-slot="2"] .row[data-act="edit-entry"]')).to_have_count(len([e for e in day_entries(pg, t) if e['slot'] == 3]))
            pg.click('[data-act="day-today"]')
        s16()

        @step('17. Peso corporeo e CSV con tipo di giornata, peso, unità e piatto')
        def s17():
            pg.click('[data-act="weight"]'); pg.fill('#w-in', '78,4'); pg.click('[data-act="weight-save"]')
            expect(pg.locator('[data-act="weight"]')).to_contain_text('78,4 kg')
            pg.click('.tabs [data-view="settimana"]')
            expect(pg.locator('.weeksum')).to_contain_text('Peso medio: 78,4 kg')
            t = pg.evaluate(today_js)
            with pg.expect_download() as dl:
                pg.click('[data-act="csv-days"]')
            rows = list(csv.reader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8'))))
            r = next(x for x in rows if x[0] == t)
            assert r[7] == 'pesi' and r[8] == '78.4', r
            with pg.expect_download() as dl:
                pg.click('[data-act="csv-entries"]')
            rows = list(csv.reader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8'))))
            assert any(x[10] == 'Riso, pollo e peperoni' for x in rows[1:]), rows[:3]
            shot(pg, '10-settimana')
        s17()

        @step('18. Codici a barre: ricerca online (simulata), dati mancanti non inventati, nessun duplicato, offline')
        def s18():
            A, B, C, D = gtin('800123456789'), gtin('800765432101'), gtin('800000000001'), gtin('800555555555')
            calls = []
            def off(route):
                code = route.request.url.split('/product/')[1].split('.json')[0]
                calls.append(code)
                if code == A:
                    body = {'status': 1, 'product': {'product_name_it': 'Latte parzialmente scremato', 'brands': 'Centrale, Altro', 'quantity': '1 l',
                            'nutriments': {'energy-kcal_100g': 46, 'proteins_100g': 3.3, 'carbohydrates_100g': 4.9, 'fat_100g': 1.6}}}
                elif code == B:
                    body = {'status': 1, 'product': {'product_name': 'Crackers integrali', 'brands': 'Marca B', 'quantity': '250 g',
                            'nutriments': {'energy_100g': 1800, 'proteins_100g': 11, 'carbohydrates_100g': 66}}}
                else:
                    return route.fulfill(status=404, content_type='application/json', body='{"status":0,"status_verbose":"product not found"}')
                route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
            pg.route('https://world.openfoodfacts.org/**', off)
            pg.click('.tabs [data-view="oggi"]')
            nfoods = len(dump(pg)['foods'])
            # prodotto completo, in ml
            pg.click('.meal[data-slot="1"] .add'); pg.click('.pick-tools [data-act="scan"]')
            expect(pg.locator('#scan-status')).not_to_have_text('Avvio della fotocamera…', timeout=10000)
            pg.fill('#scan-code', '12345'); pg.click('[data-act="scan-search"]')
            expect(pg.locator('#scan-status')).to_contain_text('Codice non valido')
            pg.fill('#scan-code', A); pg.click('[data-act="scan-search"]')
            expect(pg.locator('[data-testid="prefill-note"]')).to_contain_text('Open Food Facts')
            expect(pg.locator('#f-name')).to_have_value('Latte parzialmente scremato')
            expect(pg.locator('#f-brand')).to_have_value('Centrale')
            expect(pg.locator('#f-unit')).to_have_value('ml')
            expect(pg.locator('#f-kcal')).to_have_value('46')
            shot(pg, '11-scansione-modulo')
            pg.click('[data-act="save-food"]')
            expect(pg.locator('#g-in')).to_be_visible()
            pg.fill('#g-in', '200'); pg.click('[data-act="save-grams"]')
            expect(pg.locator('.meal[data-slot="1"] .row:has-text("Latte") .g')).to_have_text('200 ml')
            # stesso codice: nessuna nuova ricerca, nessun duplicato
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.fill('#scan-code', A); pg.click('[data-act="scan-search"]')
            expect(pg.locator('#sheet-title')).to_have_text('Latte parzialmente scremato')
            pg.click('[data-act="close-sheet"] >> nth=1')
            assert calls.count(A) == 1, calls
            # dati incompleti: kcal da kJ segnalate, grassi vuoti e obbligatori
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.fill('#scan-code', B); pg.click('[data-act="scan-search"]')
            expect(pg.locator('[data-testid="note-kcal"]')).to_contain_text('Calcolato da 1800 kJ')
            expect(pg.locator('#f-kcal')).to_have_value('430')
            expect(pg.locator('[data-testid="note-fat"]')).to_contain_text('Dato mancante')
            expect(pg.locator('#f-fat')).to_have_value('')
            pg.click('[data-act="save-food"]')
            expect(pg.locator('#toast')).to_contain_text('Valore mancante o non valido: grassi')
            pg.fill('#f-fat', '9'); pg.click('[data-act="save-food"]')
            pg.click('[data-act="close-sheet"] >> nth=1')
            # non trovato
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.fill('#scan-code', C); pg.click('[data-act="scan-search"]')
            expect(pg.locator('[data-testid="prefill-note"]')).to_contain_text('non trovato')
            expect(pg.locator('#f-barcode')).to_have_value(C)
            pg.click('[data-act="close-sheet"] >> nth=1')
            # offline: codice già salvato trovato in locale; codice nuovo → modulo manuale
            ctx.set_offline(True)
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.fill('#scan-code', A); pg.click('[data-act="scan-search"]')
            expect(pg.locator('#sheet-title')).to_have_text('Latte parzialmente scremato')
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.click('.meal[data-slot="2"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.fill('#scan-code', D); pg.click('[data-act="scan-search"]')
            expect(pg.locator('[data-testid="prefill-note"]')).to_contain_text('Sei offline')
            # anti-duplicato: codice già usato da un altro alimento
            pg.fill('#f-name', 'Prova'); [pg.fill(f'#f-{k}', '1') for k in ('kcal', 'prot', 'carb', 'fat')]
            pg.fill('#f-barcode', A); pg.click('[data-act="save-food"]')
            expect(pg.locator('#toast')).to_contain_text('Codice già associato a “Latte parzialmente scremato”')
            pg.click('[data-act="close-sheet"] >> nth=1')
            ctx.set_offline(False)
            assert len(dump(pg)['foods']) == nfoods + 2
            pg.unroute('https://world.openfoodfacts.org/**')
        s18()

        @step('19. Backup v2 completo e ripristino identico (piatti, giornate tipo, obiettivi, pesi)')
        def s19():
            before = dump(pg)
            pg.click('.tabs [data-view="settimana"]')
            with pg.expect_download() as dl:
                pg.click('[data-act="backup"]')
            path = out / 'backup-v2.json'; dl.value.save_as(path)
            data = json.loads(path.read_text(encoding='utf-8'))
            assert data['format'] == 2 and data['settings']['goals']['pesi']['kcal'] == 2600 and data['days'] and data['templates']
            pg.click('[data-act="wipe"]'); pg.fill('#wipe-in', 'CANCELLA'); pg.click('[data-act="wipe-confirm"]')
            pg.set_input_files('#restore-file', str(path)); pg.click('[data-act="restore-replace"]')
            after = dump(pg)
            key = lambda d: {k: sorted(v, key=lambda x: x.get('id') or x.get('date')) for k, v in d.items()}
            assert key(before) == key(after), 'ripristino v2 diverso'
            pg.click('[data-act="goals"]')
            expect(pg.locator('#goal-pesi-kcal')).to_have_value('2600')
            pg.click('[data-act="close-sheet"] >> nth=1')
        s19()

        @step('20. Chiusura e riapertura offline: tipo di giornata, peso e piatti ancora presenti')
        def s20():
            nonlocal ctx, pg
            ctx.close()
            ctx, pg = launch(offline=True)
            expect(pg.locator('[data-act="set-type"][data-type="pesi"]')).to_have_attribute('aria-pressed', 'true')
            expect(pg.locator('[data-act="weight"]')).to_contain_text('78,4 kg')
            expect(pg.locator('.meal[data-slot="5"] .grp-h')).to_contain_text('Riso, pollo e peperoni')
            pg.emulate_media(color_scheme='dark'); shot(pg, '12-oggi-scuro')
            ctx.close()
        s20()

        @step('21. Migrazione da un database della 1.0.0: dati intatti, nuove funzioni disponibili')
        def s21():
            nonlocal ctx, pg, profile
            profile = work / 'profile3'
            ctx = p.chromium.launch_persistent_context(str(profile), headless=True, executable_path=args.chrome, viewport={'width': 390, 'height': 844})
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.on('dialog', lambda d: d.accept())
            pg.goto(URL + 'manifest.webmanifest')  # stessa origine, senza avviare l'app
            pg.evaluate("""() => new Promise((res, rej) => {
              const q = indexedDB.open('osfit-diario', 1);
              q.onupgradeneeded = () => { const d = q.result;
                d.createObjectStore('foods', {keyPath: 'id'}); d.createObjectStore('combos', {keyPath: 'id'});
                d.createObjectStore('entries', {keyPath: 'id'}).createIndex('date', 'date'); d.createObjectStore('meta', {keyPath: 'key'}); };
              q.onsuccess = () => { const d = q.result; const t = d.transaction(['foods', 'combos', 'entries', 'meta'], 'readwrite');
                t.objectStore('foods').put({id: 'f1', name: 'Pane vecchio', kcal: 270, prot: 9, carb: 50, fat: 3, portion: 60, fav: true});
                t.objectStore('combos').put({id: 'c1', name: 'Colazione vecchia', items: [{foodId: 'f1', name: 'Pane vecchio', per100: {kcal: 270, prot: 9, carb: 50, fat: 3}, grams: 60}]});
                t.objectStore('entries').put({id: 'e1', date: '2026-11-02', slot: 1, foodId: 'f1', name: 'Pane vecchio', grams: 60, per100: {kcal: 270, prot: 9, carb: 50, fat: 3}, kcal: 162, prot: 5.4, carb: 30, fat: 1.8, createdAt: 1});
                t.objectStore('meta').put({key: 'lastBackup', value: 123});
                t.oncomplete = () => { d.close(); res(); }; t.onerror = () => rej(t.error); };
              q.onerror = () => rej(q.error); })""")
            before = dump(pg)
            pg.goto(URL); pg.wait_for_selector('body[data-ready="1"]')
            after = dump(pg)
            assert {k: after[k] for k in ('foods', 'combos', 'entries')} == before, 'dati 1.0.0 modificati dalla migrazione'
            assert after['days'] == [] and after['templates'] == []
            assert pg.evaluate("new Promise(r => { const q = indexedDB.open('osfit-diario'); q.onsuccess = () => { const v = q.result.version; q.result.close(); r(v); }; })") == 2
            # il piatto della 1.0.0 si usa e si modifica
            pg.click('.meal[data-slot="1"] .add'); pg.click('[data-act="pick-combo"]:has-text("Colazione vecchia")')
            expect(pg.locator('#cu [data-i="0"]')).to_have_value('60')
            pg.click('[data-act="save-combo-use"]')
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="combos"]')
            pg.click('#alim-list .main:has-text("Colazione vecchia")')
            pg.click('[data-act="dish-variant"][data-v="pesi"]'); pg.fill('#dish [data-i="0"]', '90'); pg.click('[data-act="save-dish"]')
            # backup della 1.0.0 (formato 1) ripristinabile
            v1 = {'app': 'OS_FIT Diario', 'format': 1, 'dbVersion': 1, 'appVersion': '1.0.0', 'exportedAt': '2026-11-09T10:00:00Z',
                  'counts': {}, 'foods': before['foods'], 'combos': before['combos'], 'entries': before['entries']}
            bp = out / 'backup-v1.json'; bp.write_text(json.dumps(v1), encoding='utf-8')
            pg.click('.tabs [data-view="settimana"]')
            pg.set_input_files('#restore-file', str(bp)); pg.click('[data-act="restore-replace"]')
            assert {k: dump(pg)[k] for k in ('foods', 'combos', 'entries')} == before
            ctx.close()
        s21()

        # ---------------- v1.2.0: scanner integrato, foto, ricerca, diagnostica ----------------
        import subprocess
        PRODUCT = {'status': 1, 'product': {'product_name_it': 'Ceci lessati', 'brands': 'Marca Test', 'quantity': '400 g',
                   'nutriments': {'energy-kcal_100g': 120, 'proteins_100g': 7, 'carbohydrates_100g': 16, 'fat_100g': 2.4}}}
        def mock_off(route):
            u = route.request.url
            if '/cgi/search.pl' in u:
                body = {'count': 2, 'products': [
                    {'code': gtin('800111222333'), 'product_name': 'Pasta integrale', 'brands': 'Pastificio X', 'quantity': '500 g',
                     'nutriments': {'energy-kcal_100g': 340, 'proteins_100g': 13, 'carbohydrates_100g': 64, 'fat_100g': 2.5}},
                    {'code': gtin('800111222444'), 'product_name': 'Pasta integrale fusilli', 'brands': 'Y',
                     'nutriments': {'proteins_100g': 13}}]}
            else:
                body = PRODUCT
            route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))

        def launch_cam(video, prof):
            args_ = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={video}']
            c = p.chromium.launch_persistent_context(str(prof), headless=True, executable_path=args.chrome, args=args_,
                    viewport={'width': 390, 'height': 844}, permissions=['camera'])
            c.add_init_script('delete window.BarcodeDetector;')  # come su iPhone: nessun lettore nel browser
            g = c.pages[0] if c.pages else c.new_page()
            g.route('https://world.openfoodfacts.org/**', mock_off)
            g.goto(URL); g.wait_for_selector('body[data-ready="1"]')
            return c, g

        @step('22. Fotocamera (video simulato) senza lettore del browser: codice letto dal lettore interno')
        def s22():
            code = gtin('800123987654')
            png = make_barcode(code, str(work / 'cam.png'), module=4.0, blur=1.2, angle=4, noise=6)
            y4m = work / 'cam.y4m'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', png, '-t', '2', '-r', '10', '-pix_fmt', 'yuv420p', str(y4m)], check=True)
            c, g = launch_cam(y4m, work / 'profcam')
            try:
                g.click('.meal[data-slot="1"] .add'); g.click('.pick-tools [data-act="scan"]')
                t0 = time.time()
                expect(g.locator('#f-barcode')).to_have_value(code, timeout=20000)
                print(f'    codice letto dal video in {time.time() - t0:.1f}s')
                expect(g.locator('#f-name')).to_have_value('Ceci lessati')
                g.click('[data-act="save-food"]'); g.fill('#g-in', '150'); g.click('[data-act="save-grams"]')
                expect(g.locator('.meal[data-slot="1"] .row:has-text("Ceci lessati") .g')).to_have_text('150 g')
                g.click('.meal[data-slot="2"] .add'); g.click('.pick-tools [data-act="scan"]')  # già salvato: nessun duplicato
                expect(g.locator('#sheet-title')).to_have_text('Ceci lessati', timeout=20000)
                shot(g, '13-scanner-letto')
            finally:
                c.close()
        s22()

        @step('23. Modalità foto: foto grande, inclinata e sfocata letta; foto senza codice segnalata')
        def s23():
            nonlocal ctx, pg, profile
            profile = work / 'profile4'
            ctx, pg = launch()
            pg.add_init_script('delete window.BarcodeDetector;')
            pg.reload(); pg.wait_for_selector('body[data-ready="1"]')
            pg.route('https://world.openfoodfacts.org/**', mock_off)
            code = gtin('800456456456')
            photo = make_barcode(code, str(work / 'foto.jpg'), size=(3024, 2268), module=7, blur=3.0, angle=-6, noise=8)
            pg.click('.meal[data-slot="3"] .add'); pg.click('.pick-tools [data-act="scan"]')
            shot(pg, '14-scanner')
            nocode = make_barcode('0000000000000', str(work / 'vuota.jpg'), size=(1600, 1200), module=0.01)
            pg.set_input_files('#scan-photo', nocode)
            expect(pg.locator('#scan-status')).to_contain_text('Non trovo un codice', timeout=20000)
            pg.set_input_files('#scan-photo', photo)
            expect(pg.locator('#f-barcode')).to_have_value(code, timeout=20000)
            pg.click('[data-act="close-sheet"] >> nth=1')
        s23()

        @step('24. Ricerca dei prodotti per nome (Open Food Facts simulato): risultati, scelta, dati mancanti segnalati')
        def s24():
            pg.click('.meal[data-slot="3"] .add'); pg.fill('#pick-q', 'pasta integrale')
            pg.click('#pick-results [data-act="off-search"]')
            expect(pg.locator('#offs-res [data-act="off-pick"]')).to_have_count(2)
            shot(pg, '15-ricerca-online')
            pg.click('#offs-res [data-act="off-pick"] >> nth=0')
            expect(pg.locator('#f-name')).to_have_value('Pasta integrale')
            expect(pg.locator('#f-barcode')).to_have_value(gtin('800111222333'))
            pg.click('[data-act="save-food"]'); pg.click('[data-act="save-grams"]')
            pg.click('.meal[data-slot="3"] .add'); pg.click('.pick-tools [data-act="off-search"]')
            pg.fill('#offs-q', 'pasta'); pg.click('[data-act="off-search-go"]')
            pg.click('#offs-res [data-act="off-pick"] >> nth=0')
            expect(pg.locator('#toast')).to_contain_text('già tra i tuoi alimenti')
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.click('.meal[data-slot="3"] .add'); pg.click('.pick-tools [data-act="off-search"]')
            pg.fill('#offs-q', 'fusilli'); pg.click('[data-act="off-search-go"]')
            pg.click('#offs-res [data-act="off-pick"] >> nth=1')
            expect(pg.locator('[data-testid="note-kcal"]')).to_contain_text('Dato mancante')
            expect(pg.locator('#f-kcal')).to_have_value('')
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.unroute('https://world.openfoodfacts.org/**')
        s24()

        @step('25. Open Food Facts bloccato: messaggio chiaro, link alla scheda, diagnostica')
        def s25():
            pg.route('https://world.openfoodfacts.org/**', lambda r: r.abort())
            pg.click('.meal[data-slot="4"] .add'); pg.click('.pick-tools [data-act="scan"]')
            pg.click('details.diag summary'); pg.click('[data-act="test-off"]')
            expect(pg.locator('[data-testid="diag-off"]')).to_contain_text('non raggiungibile')
            pg.fill('#scan-code', gtin('800999888777')); pg.click('[data-act="scan-search"]')
            expect(pg.locator('[data-testid="prefill-note"]')).to_contain_text('Ricerca online non riuscita')
            expect(pg.locator('[data-testid="prefill-note"] a')).to_have_attribute('href', 'https://world.openfoodfacts.org/product/' + gtin('800999888777'))
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.unroute('https://world.openfoodfacts.org/**')
            ctx.close()
        s25()

        @step('26. App reinstallata (profilo vuoto): schermata di benvenuto e ripristino del backup')
        def s26():
            nonlocal ctx, pg, profile
            profile = work / 'profile5'
            ctx, pg = launch()
            expect(pg.locator('[data-testid="welcome"]')).to_be_visible()
            shot(pg, '16-benvenuto')
            pg.set_input_files('#restore-file', str(out / 'backup-v2.json'))
            pg.click('[data-act="restore-replace"]')
            expect(pg.locator('[data-testid="welcome"]')).to_have_count(0)
            assert len(dump(pg)['entries']) > 0
            ctx.close()
        s26()

        # ---------------- v1.3.0: catalogo, unità, micronutrienti ----------------
        def num_it(txt):  # "1.234,5 kcal" -> 1234.5
            import re as _re
            m = _re.search(r'-?[\d.]*\d(?:,\d+)?', txt.replace('\xa0', ' '))
            return float(m.group(0).replace('.', '').replace(',', '.'))
        def close(txt, exact):  # confronto con l'arrotondamento mostrato (stesse regole di fmtN)
            a = abs(exact); tol = 0.5 if a >= 100 else 0.05 if a >= 1 else 0.005 if a >= 0.1 else 0.0005
            return abs(num_it(txt) - exact) <= tol + 1e-9
        def cell(pg, scope, k):
            return pg.locator(f'{scope} tr[data-k="{k}"] td').inner_text()
        def pick_catalog(pg, slot, query, name):
            pg.click(f'.meal[data-slot="{slot}"] .add')
            pg.fill('#pick-q', query)
            pg.click(f'[data-testid="pick-catalog"] [data-act="pick-food"]:has-text("{name}")')
            expect(pg.locator('#g-in')).to_be_visible()

        @step('27. Catalogo: banana 120 g = valori per 100 g × 120 / 100 (calorie, macro e micro), dati sotto soglia e mancanti')
        def s27():
            nonlocal ctx, pg, profile
            profile = work / 'profile6'
            ctx, pg = launch()
            cat = pg.evaluate("self.OSF_CATALOG.foods.find(f => f.id === 'ciqual:13005').v")
            pick_catalog(pg, 1, 'banana', 'Banana, polpa')
            expect(pg.locator('#g-units .chip.on')).to_contain_text('1 frutto medio')  # porzione standard LARN proposta
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text(f"{round(cat['kcal'] * 1.5)} kcal")  # 150 g
            pg.click('#g-units [data-u="g"]'); pg.fill('#g-in', '120')
            pg.locator('#g-in').dispatch_event('input')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text(f"{round(cat['kcal'] * 1.2)} kcal")
            pg.click('#g-more summary')
            for k in ('k', 'prot', 'carb', 'fiber', 'ca', 'mg', 'b6', 'b9', 'vitC'):
                assert close(cell(pg, '#g-nutr', k), cat[k] * 1.2), (k, cell(pg, '#g-nutr', k), cat[k] * 1.2)
            assert cell(pg, '#g-nutr', 'fat').startswith('< 0,6'), cell(pg, '#g-nutr', 'fat')  # "<0.5" per 100 g
            shot(pg, '17-banana-120g')
            pg.click('[data-act="save-grams"]')
            e = [x for x in dump(pg)['entries'] if x['foodId'] == 'ciqual:13005'][0]
            assert e['grams'] == 120 and e['kcal'] == round(cat['kcal'] * 1.2) and e['per100']['k'] == cat['k'], e
            f = [x for x in dump(pg)['foods'] if x['id'] == 'ciqual:13005'][0]
            assert f['lastUnit'] == 'g' and f['lastQty'] == 120 and f['catalogId'] == 'ciqual:13005'
            # alimento senza dato di un micronutriente: "dato non disponibile", mai 0
            nd = pg.evaluate("self.OSF_CATALOG.foods.find(f => f.v.vitD === undefined && f.c === 'verdura').id")
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="catalog"]')
            pg.evaluate(f"openFoodInfo('{nd}')")
            expect(pg.locator('[data-testid="food-panel"] tr[data-k="vitD"] td')).to_have_text('dato non disponibile')
            pg.click('[data-act="close-sheet"] >> nth=1')
        s27()

        @step('28. Unità per alimento: olio EVO (cucchiaio LARN 10 ml = 9 g, ml con densità), latte (bicchiere solo con densità)')
        def s28():
            pg.click('.tabs [data-view="oggi"]')
            pick_catalog(pg, 3, 'olio evo', 'Olio extravergine di oliva')
            pg.click('#g-units [data-u="cucchiaio"]')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('= 9 g')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('81 kcal')  # 899 × 9 / 100
            pg.click('#g-units [data-u="cucchiaino"]')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('= 4,5 g')
            pg.click('#g-units [data-u="ml"]')
            expect(pg.locator('#g-in')).to_have_value('5')  # stessa quantità espressa in ml
            pg.click('#g-units [data-u="cucchiaio"]'); pg.click('[data-act="save-grams"]')
            expect(pg.locator('.meal[data-slot="3"] .row:has-text("Olio extravergine")')).to_contain_text('1 × 1 cucchiaio')
            # latte: senza densità il bicchiere (125 ml) non è convertibile in grammi
            pick_catalog(pg, 1, 'latte parzialmente', 'Latte parzialmente scremato (media)')
            expect(pg.locator('#g-units [data-u="bicchiere"]')).to_have_class(re.compile('dis'))
            pg.click('#g-units [data-u="bicchiere"]')
            expect(pg.locator('#toast')).to_contain_text('serve la densità')
            pg.click('[data-act="close-sheet"] >> nth=1')
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="catalog"]')
            pg.fill('#alim-q', 'latte parzialmente'); pg.locator('#alim-q').dispatch_event('input')
            pg.click('#alim-list [data-act="food-info"]:has-text("Latte parzialmente scremato (media)")')
            pg.click('[data-act="info-edit"]')
            expect(pg.locator('#f-name')).to_be_visible()
            pg.evaluate("document.getElementById('f-units-box').open = true")
            pg.fill('#f-density', '1,03'); pg.click('[data-act="save-food"]')
            pg.click('.tabs [data-view="oggi"]')
            pg.click('.meal[data-slot="1"] .add'); pg.click('[data-act="pick-food"]:has-text("Latte parzialmente scremato")')
            pg.click('#g-units [data-u="bicchiere"]')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('= 129 g')   # 125 ml × 1,03 = 128,75 g
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('61 kcal')     # 47,5 × 1,2875
            pg.click('[data-act="save-grams"]')
        s28()

        @step('29. Porzione personalizzata salvata, ultima porzione ricordata, porzioni Pesi/Cardio/Riposo su alimento del catalogo')
        def s29():
            pg.click('.meal[data-slot="2"] .add'); pg.click('[data-act="pick-food"]:has-text("Banana, polpa")')
            expect(pg.locator('#g-in')).to_have_value('120')   # ultima porzione usata
            expect(pg.locator('[data-testid="why"]')).to_contain_text('ultima porzione')
            pg.click('details:has(#nu-l) summary'); pg.fill('#nu-l', '1 banana media'); pg.fill('#nu-v', '130')
            pg.click('[data-act="add-unit"]')
            expect(pg.locator('[data-testid="g-prev"]')).to_contain_text('= 130 g')
            pg.click('[data-act="save-grams"]')
            pg.click('.meal[data-slot="4"] .add'); pg.click('[data-act="pick-food"]:has-text("Banana, polpa")')
            expect(pg.locator('#g-units .chip.on')).to_contain_text('1 banana media')
            expect(pg.locator('#g-in')).to_have_value('1')
            pg.click('[data-act="close-sheet"] >> nth=1')
            # riso del catalogo con porzioni per tipo di giornata
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="catalog"]')
            pg.fill('#alim-q', 'riso bianco crudo'); pg.locator('#alim-q').dispatch_event('input')
            pg.click('#alim-list [data-act="food-info"]:has-text("Riso bianco, crudo")'); pg.click('[data-act="info-edit"]')
            expect(pg.locator('#f-name')).to_be_visible()
            pg.evaluate("document.querySelector('details:has(#f-dp-pesi)').open = true")
            pg.fill('#f-dp-pesi', '120'); pg.fill('#f-dp-cardio', '100'); pg.fill('#f-dp-riposo', '90'); pg.click('[data-act="save-food"]')
            f = [x for x in dump(pg)['foods'] if x['id'] == 'ciqual:9100'][0]
            assert f['dayPortions'] == {'pesi': 120, 'cardio': 100, 'riposo': 90} and not f.get('customized'), f
            pg.click('.tabs [data-view="oggi"]'); pg.click('[data-act="set-type"][data-type="cardio"]')
            pg.click('.meal[data-slot="3"] .add'); pg.fill('#pick-q', 'riso bianco')
            pg.click('[data-act="pick-food"]:has-text("Riso bianco, crudo")')
            expect(pg.locator('#g-in')).to_have_value('100'); expect(pg.locator('[data-testid="why"]')).to_contain_text('porzione Cardio')
            pg.fill('#g-in', '110'); pg.click('[data-act="save-grams"]')
            f = [x for x in dump(pg)['foods'] if x['id'] == 'ciqual:9100'][0]
            assert f['dayPortions']['cardio'] == 100  # la modifica manuale non cambia le impostazioni
        s29()

        @step('30. Ricerca e filtri: plurali/accenti, categoria, solo di stagione (mese corrente), nessun doppione catalogo/personali')
        def s30():
            pg.click('.meal[data-slot="5"] .add')
            for q, want in (('mele', 'Mela'), ('uova', 'Uovo'), ('olio evo', 'Olio extravergine'), ('pomodori', 'Pomodoro'), ('nocciole piemonte', 'Nocciole')):
                pg.fill('#pick-q', q)
                expect(pg.locator('#pick-results [data-act="pick-food"]').first).to_contain_text(want)
            pg.fill('#pick-q', '')
            pg.click('#pick-cats [data-act="pick-cat"][data-c="frutta"]'); pg.click('#pick-cats [data-act="pick-season"]')
            exp = pg.evaluate("(() => { const m = new Date().getMonth() + 1; return self.OSF_CATALOG.foods.filter(f => f.c === 'frutta' && Array.isArray(f.s) && f.s.includes(m)).map(f => f.id); })()")
            got = pg.eval_on_selector_all('#pick-results [data-act="pick-food"]', 'els => els.map(e => e.dataset.id)')
            assert sorted(got) == sorted(exp) and 'ciqual:13005' not in got, (got, exp)
            shot(pg, '18-catalogo-stagione')
            pg.fill('#pick-q', 'banana')
            ids = pg.eval_on_selector_all('#pick-results [data-act="pick-food"]', 'els => els.map(e => e.dataset.id)')
            assert ids.count('ciqual:13005') <= 1
            pg.click('[data-act="close-sheet"] >> nth=1')
        s30()

        @step('31. Piatto con ingredienti del catalogo (riso, pollo, peperoni, olio): totali calcolati dagli ingredienti')
        def s31():
            pg.click('.tabs [data-view="alimenti"]'); pg.click('[data-act="alim-tab"][data-tab="combos"]'); pg.click('[data-act="dish-form"]')
            pg.fill('#d-name', 'Riso, pollo e peperoni')
            plan = [('riso bianco crudo', 'Riso bianco, crudo', 120, 'ciqual:9100'), ('petto pollo crudo', 'Petto di pollo, senza pelle, crudo', 150, 'ciqual:36017'),
                    ('peperone crudo', 'Peperone (verde, giallo o rosso), crudo', 200, 'ciqual:20041'), ('olio evo', 'Olio extravergine di oliva', 10, 'ciqual:17270')]
            for i, (q, name, g, cid) in enumerate(plan):
                pg.click('[data-act="dish-add"]'); pg.fill('#dish-q', q); pg.locator('#dish-q').dispatch_event('input')
                pg.click(f'#dish-foods [data-act="dish-add-food"][data-id="{cid}"]')
                pg.fill(f'#dish input[data-i="{i}"]', str(g)); pg.locator(f'#dish input[data-i="{i}"]').dispatch_event('input')
            kc = pg.evaluate("(ids) => ids.reduce((s, [id, g]) => s + Math.round(self.OSF_CATALOG.foods.find(f => f.id === id).v.kcal * g / 100), 0)", [[c, g] for _, _, g, c in plan])
            expect(pg.locator('[data-testid="dish-total"]')).to_contain_text(f'{kc} kcal')
            pg.click('[data-act="save-dish"]')
            pg.click('.tabs [data-view="oggi"]'); pg.click('.meal[data-slot="5"] .add'); pg.click('[data-act="pick-combo"]:has-text("Riso, pollo e peperoni")')
            # giornata Cardio: il riso usa la sua porzione Cardio (100 g) invece dei 120 g della ricetta base
            expect(pg.locator('[data-act="set-type"][data-type="cardio"]')).to_have_attribute('aria-pressed', 'true')
            expect(pg.locator('#cu input[data-i="0"]')).to_have_value('100')
            kc_cardio = kc - round(351 * 120 / 100) + round(351 * 100 / 100)
            pg.click('[data-act="save-combo-use"]')
            expect(pg.locator('.meal[data-slot="5"] .grp-h')).to_contain_text(f'{kc_cardio}')
        s31()

        @step('32. Nutrienti del giorno: macro e micro separati, totali solo dalle voci con il dato (mai zero inventati)')
        def s32():
            # una voce senza micronutrienti (alimento inserito a mano)
            add_food(pg, 'Snack manuale', 400, 10, 50, 15)
            pg.click('.tabs [data-view="oggi"]'); add_entry(pg, 4, 'Snack manuale', 50)
            entries = [e for e in dump(pg)['entries'] if e['date'] == pg.evaluate(today_js)]
            exp_k = sum(e['per100'].get('k', 0) * e['grams'] / 100 for e in entries if isinstance(e['per100'].get('k'), (int, float)))
            missing = sum(1 for e in entries if 'k' not in e['per100'])
            pg.click('[data-act="day-nutr"]')
            txt = pg.locator('[data-testid="day-panel"] tr[data-k="k"] td').inner_text()
            assert abs(num_it(txt) - exp_k) < 1 and f'({missing} ' in txt, (txt, exp_k, missing)
            expect(pg.locator('[data-testid="day-panel"] h3')).to_have_text('Macronutrienti')
            expect(pg.locator('[data-testid="day-panel"] summary')).to_have_text(['Minerali', 'Vitamine'])
            shot(pg, '19-nutrienti-giorno')
            pg.click('[data-act="close-sheet"] >> nth=1')
        s32()

        @step('33. Aggiornamento del catalogo: stessi id, valori aggiornati, nessun doppione, diario e alimenti personalizzati intatti')
        def s33():
            nonlocal ctx, pg
            before = dump(pg)
            n_entries = len(before['entries'])
            pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('osfit-diario'); q.onsuccess = () => { const d = q.result; const t = d.transaction(['foods', 'meta'], 'readwrite');
              const s = t.objectStore('foods');
              s.get('ciqual:13005').onsuccess = e => { const f = e.target.result; f.kcal = 1; f.nutr.kcal = 1; f.catalogVersion = 'vecchia'; s.put(f); };
              s.get('ciqual:9100').onsuccess = e => { const f = e.target.result; f.kcal = 2; f.customized = true; f.catalogVersion = 'vecchia'; s.put(f); };
              t.objectStore('meta').put({ key: 'catalogVersion', value: 'vecchia' });
              t.oncomplete = () => { d.close(); r(); }; }; })""")
            pg.reload(); pg.wait_for_selector('body[data-ready="1"]')
            after = dump(pg)
            fb = {f['id']: f for f in after['foods']}
            assert fb['ciqual:13005']['kcal'] == 87.6 and fb['ciqual:13005']['nutr']['kcal'] == 87.6 and any(u['l'] == '1 banana media' for u in fb['ciqual:13005']['units']), fb['ciqual:13005']
            assert fb['ciqual:9100']['kcal'] == 2, 'alimento personalizzato sovrascritto'
            assert len(after['foods']) == len(before['foods']) and len(after['entries']) == n_entries
            assert [e for e in after['entries'] if e['id'] == before['entries'][0]['id']][0] == before['entries'][0]
        s33()

        @step('34. Telefono e desktop: nessuno scorrimento orizzontale, schede leggibili')
        def s34():
            for w, h, name in ((360, 740, '20-telefono-piccolo'), (1280, 800, '21-desktop')):
                pg.set_viewport_size({'width': w, 'height': h})
                for view in ('oggi', 'alimenti', 'settimana'):
                    pg.click(f'.tabs [data-view="{view}"]')
                    if view == 'alimenti': pg.click('[data-act="alim-tab"][data-tab="catalog"]')
                    over = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                    assert over <= 0, (w, view, over)
                pg.click('.tabs [data-view="oggi"]'); pg.click('.meal[data-slot="1"] .add'); pg.fill('#pick-q', 'mela')
                pg.click('[data-testid="pick-catalog"] [data-act="pick-food"] >> nth=0')
                over = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                assert over <= 0, (w, 'foglio quantità', over)
                shot(pg, name)
                pg.click('[data-act="close-sheet"] >> nth=1')
            pg.set_viewport_size({'width': 390, 'height': 844})
            ctx.close()
        s34()

        # ---- 1.4.0: nuova grafica e interazioni ----
        @step('35. Dashboard: anello e barre coerenti con i totali, pulsante Aggiungi, selettore +/-, conferma e voce evidenziata')
        def s35():
            nonlocal ctx, pg
            ctx, pg = launch()
            pg.click('.tabs [data-view="oggi"]')
            expect(pg.locator('#fab')).to_be_visible()
            pg.wait_for_timeout(900)  # fine dell'animazione dell'anello e del conteggio
            ring = pg.evaluate("""(() => { const c = document.querySelector('.ring .bar'); const C = 326.73;
                return { off: parseFloat(getComputedStyle(c).strokeDashoffset), kcal: document.querySelector('.ring .kcal b').textContent }; })()""")
            tot = pg.evaluate("""(async () => { const t = sum(await entriesOn(state.day)); const i = await dayInfo(state.day); const gs = await getMeta('goals');
                const g = i.type && gs && gs[i.type]; return { k: t.kcal, g: g && g.kcal > 0 ? g.kcal : 0 }; })()""")
            assert ring['kcal'].replace('.', '') == str(round(tot['k'])), (ring, tot)
            if tot['g']:
                exp = 326.73 * (1 - min(tot['k'] / tot['g'], 1))
                assert abs(ring['off'] - exp) < 1.5, (ring, exp)
            for v in ('alimenti', 'settimana'):
                pg.click(f'.tabs [data-view="{v}"]'); expect(pg.locator('#fab')).to_be_hidden()
            pg.click('.tabs [data-view="oggi"]')
            slot = pg.evaluate('defaultSlot()')
            pg.click('#fab')
            expect(pg.locator('#sheet-title')).to_have_text('Aggiungi a ' + pg.evaluate(f'SLOTS[{slot - 1}]'))
            pg.fill('#pick-q', 'mela')
            pg.click('[data-testid="pick-catalog"] [data-act="pick-food"] >> nth=0')
            pg.click('[data-act="pick-unit"][data-u="g"]')
            pg.fill('#g-in', '100')
            pg.click('[data-act="qty-step"][data-d="1"]'); expect(pg.locator('#g-in')).to_have_value('110')
            pg.click('[data-act="qty-step"][data-d="-1"]'); pg.click('[data-act="qty-step"][data-d="-1"]'); expect(pg.locator('#g-in')).to_have_value('90')
            pg.fill('#g-in', '0'); pg.click('[data-act="save-grams"]')
            expect(pg.locator('#toast')).to_have_class(re.compile(r'\berr\b')); expect(pg.locator('#toast')).to_have_attribute('role', 'alert')
            expect(pg.locator('#sheet')).to_be_visible()  # errore recuperabile: il foglio resta aperto
            pg.fill('#g-in', '90'); pg.click('[data-act="save-grams"]')
            expect(pg.locator('#sheet')).to_be_hidden()
            expect(pg.locator('#toast')).not_to_have_class(re.compile(r'\berr\b'))
            expect(pg.locator(f'.meal[data-slot="{slot}"] .rows li.new')).to_have_count(1)
            assert pg.locator('.sheet-ghost').count() <= 1
            pg.wait_for_timeout(300); assert pg.locator('.sheet-ghost').count() == 0
            shot(pg, '22-dashboard')

        @step('36. Progressi: grafico 7/30/90 giorni, calorie/proteine/peso, barra selezionata e apertura del giorno')
        def s36():
            pg.click('.tabs [data-view="settimana"]')
            expect(pg.locator('#chart-card .b')).to_have_count(7)
            for n in (30, 90, 7):
                pg.click(f'[data-act="chart-days"][data-n="{n}"]')
                expect(pg.locator('#chart-card .b')).to_have_count(n)
                expect(pg.locator(f'[data-act="chart-days"][data-n="{n}"]')).to_have_attribute('aria-selected', 'true')
            t = pg.evaluate(today_js)
            bar = pg.locator(f'#chart-card .b[data-date="{t}"]')
            bar.click()
            expect(bar).to_have_class(re.compile(r'\bsel\b'))
            expect(pg.locator('#chart-tip')).to_contain_text('kcal')
            pg.click('[data-act="chart-metric"][data-m="prot"]')
            expect(pg.locator('.chart-sum')).to_contain_text('g')
            pg.click('[data-act="chart-metric"][data-m="weight"]')
            expect(pg.locator('#chart-card .wline, #chart-card .nodata, #chart-card .b')).not_to_have_count(0)
            pg.click('[data-act="chart-metric"][data-m="kcal"]')
            other = pg.locator('#chart-card .b >> nth=0'); od = other.get_attribute('data-date')
            other.focus(); pg.keyboard.press('Enter')  # anche da tastiera
            expect(pg.locator(f'#chart-card .b[data-date="{od}"]')).to_have_class(re.compile(r'\bsel\b'))
            expect(pg.locator(f'#chart-tip [data-act="open-day"][data-date="{od}"]')).to_be_visible()
            shot(pg, '23-progressi')
            pg.click('#chart-tip [data-act="open-day"]')
            expect(pg.locator('#view-oggi')).to_be_visible()
            assert pg.evaluate('state.day') == od
            expect(pg.locator('#fab')).to_be_visible()
            pg.click('[data-act="day-today"]')

        @step('37. Tema chiaro/scuro: scelta salvata, ripristinata alla riapertura, "Automatico" segue il telefono')
        def s37():
            nonlocal ctx, pg
            pg.click('.tabs [data-view="settimana"]')
            light_bg = pg.evaluate('getComputedStyle(document.body).backgroundColor')
            pg.click('[data-act="theme"][data-t="dark"]')
            expect(pg.locator('html')).to_have_attribute('data-theme', 'dark')
            dark_bg = pg.evaluate('getComputedStyle(document.body).backgroundColor')
            assert dark_bg != light_bg, (light_bg, dark_bg)
            ctx.close(); ctx, pg = launch()
            expect(pg.locator('html')).to_have_attribute('data-theme', 'dark')
            shot(pg, '24-oggi-scuro')
            pg.click('.tabs [data-view="settimana"]'); pg.click('[data-act="theme"][data-t="auto"]')
            assert pg.evaluate('document.documentElement.dataset.theme') is None
            ctx.close()

        @step('38. Movimento ridotto: nessuna animazione, foglio chiuso subito, valori finali corretti')
        def s38():
            nonlocal ctx, pg
            ctx = p.chromium.launch_persistent_context(
                str(profile), headless=True, executable_path=args.chrome, reduced_motion='reduce',
                viewport={'width': 390, 'height': 844}, locale='it-IT')
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.goto(URL); pg.wait_for_selector('body[data-ready="1"]', timeout=15000)
            CUR['pg'] = pg
            kc = pg.evaluate("document.querySelector('.ring .kcal b').textContent")  # subito il valore finale
            tot = pg.evaluate("(async () => Math.round(sum(await entriesOn(state.day)).kcal))()")
            assert kc.replace('.', '') == str(tot), (kc, tot)
            anim = pg.evaluate("getComputedStyle(document.querySelector('#view-oggi')).animationName")
            dur = pg.evaluate("getComputedStyle(document.querySelector('.ring .bar')).transitionDuration")
            assert anim == 'none' or float(dur.rstrip('s').split(',')[0]) < 0.02, (anim, dur)
            pg.click('#fab'); expect(pg.locator('#sheet')).to_be_visible()
            pg.click('[data-act="close-sheet"] >> nth=1')
            assert pg.evaluate("document.getElementById('sheet').hidden") is True
            assert pg.locator('.sheet-ghost').count() == 0
            ctx.close()

        s35(); s36(); s37(); s38()

    httpd.shutdown()
    shutil.rmtree(work, ignore_errors=True)
    lines = ['# Report test OS_FIT Diario', '', f'Data: {time.strftime("%Y-%m-%d %H:%M")}', 'Motore: Chromium (Chrome headless), profilo persistente, viewport 390×844', '',
             '| Prova | Esito | Note |', '|---|---|---|']
    lines += [f'| {n} | {"OK" if ok else "FALLITA"} | {note} |' for n, ok, note in results]
    (out / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'\n{sum(ok for _, ok, _ in results)}/{len(results)} prove superate. Report: {out / "report.md"}')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback; traceback.print_exc()
        sys.exit(1)
