# OS_FIT Diario

Web app personale per registrare i pasti e preparare i dati del check-in settimanale di OS_FIT.
Si installa sulla schermata Home, funziona offline e tiene i dati solo sul telefono.

- **Nessun build, nessun server, nessuna dipendenza esterna.** Sono file statici: si pubblicano su qualsiasi hosting HTTPS.
- **Versione:** 1.4.0 (nuova grafica) — novità in fondo.
- L'unico servizio esterno è **Open Food Facts**, usato solo per cercare i prodotti online. Tutto il resto funziona offline.

## Contenuto

| File | A cosa serve |
|---|---|
| `index.html` | Struttura della pagina |
| `app.js` | Tutta la logica: schermate, database locale, CSV, backup, ricerca prodotti |
| `catalog.js` | Catalogo predefinito: 390 alimenti Ciqual 2025 con nomi italiani, porzioni LARN e stagionalità (generato, non modificare a mano) |
| `tools/` | Script che genera e verifica il catalogo dalla tabella Ciqual originale; elenco degli alimenti scelti |
| `ANALISI_1.3.0.md` | Analisi, confronto con YAZIO/MyFitnessPal/Cronometer, fonti, verifiche e proposte |
| `REDESIGN_1.4.0.md` | Nuova grafica e interazioni: direzione visiva, componenti, verifiche e limiti |
| `scanner.js` | Lettore di codici a barre EAN-13 / UPC-A / EAN-8 integrato (JavaScript puro, offline) |
| `style.css` | Grafica: colori, caratteri, componenti e animazioni (tema chiaro/scuro, movimento ridotto) |
| `sw.js` | Service worker: salva l'app in cache per l'apertura offline |
| `manifest.webmanifest`, `icons/` | Installazione sulla schermata Home |
| `tests/test_offline.py` | Test automatici (non servono per far funzionare l'app) |

## Funzioni

**Oggi**
- Cinque pasti: Colazione, Spuntino, Pranzo, Merenda, Cena. Tocca **+**, scegli un alimento o un piatto, correggi la quantità, **Salva**.
- **Tipo di giornata** (Pesi · Cardio · Riposo) in alto. Le quantità proposte seguono le porzioni configurate per quel tipo.
- **Obiettivi**: barra di avanzamento e "Mancano: … kcal · P … g" quando il tipo di giornata ha obiettivi impostati.
- **Peso corporeo** del giorno (facoltativo).
- Tocca una voce per cambiare quantità o pasto, oppure eliminarla. Tocca l'intestazione di un piatto per eliminarlo intero.
- **Salva come piatto**, **Ripeti da ieri**, **Copia da un altro giorno** (giornata intera o singolo pasto).
- **Salva come giornata tipo** e **Applica giornata tipo**.
- Ogni aggiunta o eliminazione mostra **Annulla** per qualche secondo.

**Alimenti**
- **Alimenti**: valori per 100 g o 100 ml, marca, crudo/cotto, porzione abituale, porzioni per Pesi/Cardio/Riposo, codice a barre, preferiti. Il pulsante ▥ scansiona un codice.
- **Piatti**: ingredienti scelti tra i tuoi alimenti, totali calcolati dagli ingredienti, quantità diverse per Pesi/Cardio/Riposo nello stesso piatto, peso del piatto cotto (facoltativo).
- **Giornate**: le giornate tipo salvate.

**Settimana**
- Riepilogo lunedì–domenica con il tipo di ogni giorno. I giorni senza voci sono segnati come *nessuna registrazione* e non contano nella media. Peso medio.
- Esportazione CSV, obiettivi e programma settimanale, backup e ripristino, stato della memoria.

Le voci del diario salvano i valori nutrizionali al momento della registrazione: modificare o eliminare un alimento non cambia il passato.

## Ho cancellato l'app: come rimediare

- **Se hai cancellato il repository su GitHub:** ricrealo con **lo stesso nome** (`osfit-diario`) e ricarica i file. Il telefono ritrova i suoi dati, perché restano legati all'indirizzo e non a GitHub.
- **Se hai eliminato l'icona dal telefono, o cancellato i dati del sito:**
  1. Reinstalla l'app dall'indirizzo.
  2. Alla prima apertura compare **Benvenuto** con **Ripristina un backup**: scegli l'ultimo file `osfit-diario-backup_….json`.
  3. Se un backup non c'è, i dati di quel telefono non sono recuperabili: si riparte da zero.
- **Per il futuro:** Settimana → **Scarica backup** almeno una volta a settimana. L'app te lo ricorda dopo 7 giorni.

## Pubblicazione gratuita su GitHub Pages

1. Crea un account su github.com, se non lo hai.
2. Crea un repository nuovo, per esempio `osfit-diario`. Con il piano gratuito deve essere **pubblico**: il codice è visibile, i tuoi dati no, perché non stanno nel repository.
3. Carica tutti i file di questa cartella nella radice del repository: **Add file → Upload files**, trascinando anche le cartelle `icons` e `tests`. Nella pagina del repository `index.html` deve comparire subito, non dentro un'altra cartella.
4. Vai in **Settings → Pages**. In *Build and deployment* scegli **Deploy from a branch**, branch `main`, cartella `/ (root)`, poi **Save**.
5. Dopo uno o due minuti l'app è su `https://<tuo-utente>.github.io/osfit-diario/`. Il link si ritrova in **Settings → Pages** (*Your site is live at…*).

**Attenzione:** i dati sono legati all'indirizzo. Se in futuro cambi indirizzo o hosting, sul nuovo indirizzo l'app parte vuota: fai un backup dal vecchio e ripristinalo sul nuovo.

Funziona allo stesso modo su qualunque hosting statico con HTTPS (Cloudflare Pages, Netlify, un tuo server).

## Prova sul telefono (prova decisiva)

**Installazione**
- **iPhone**: apri l'indirizzo in **Safari** → Condividi → **Aggiungi alla schermata Home**.
- **Android**: apri l'indirizzo in **Chrome** → menu ⋮ → **Installa app** (oppure *Aggiungi a schermata Home*).

**Ciclo offline**
1. Apri l'app dall'icona (non dal browser) mentre sei online. Aspetta qualche secondo.
2. Attiva la **modalità aereo**.
3. Chiudi l'app dal multitasking (scorri via la scheda).
4. Riapri dall'icona → deve comparire la schermata Oggi.
5. Crea un alimento e registra un pasto.
6. Chiudi di nuovo dal multitasking e riapri → il pasto deve esserci.
7. (Consigliato) Riavvia il telefono, sempre in modalità aereo, e riapri.

**Esportazione e ripristino**
1. Settimana → **CSV giorni** e **CSV voci** → salva i file e aprili (controlla accenti e numeri).
2. **Scarica backup** → salvalo in File / Download.
3. **Cancella tutti i dati…** → scrivi CANCELLA → il diario è vuoto.
4. **Ripristina…** → scegli il backup → **Sostituisci tutto** → i dati tornano identici.
5. Su iPhone: elimina l'icona dalla Home, reinstalla l'app e ripeti il ripristino.

In Settimana trovi anche **Modalità** (app installata o browser), **Memoria persistente** e **Rete**: annotali nell'esito della prova.

Su iPhone il pulsante di esportazione apre il foglio di condivisione: scegli **Salva su File**.

## Cosa succede ai dati

| Situazione | Effetto |
|---|---|
| Aggiorno l'app | I dati restano. L'aggiornamento sostituisce solo i file dell'app in cache. |
| Cambio telefono | Nulla passa da solo: backup sul vecchio, ripristino sul nuovo. |
| Cancello i dati del sito o del browser | Tutto perso, salvo backup. |
| Elimino l'icona dalla Home (iPhone) | Probabile perdita dei dati: va verificato, quindi fai prima un backup. |
| Cambio indirizzo o hosting | L'app riparte vuota sul nuovo indirizzo: usa backup e ripristino. |

L'app avvisa in Oggi se non fai un backup da più di 7 giorni.

## Pubblicare un aggiornamento

1. Modifica i file.
2. Cambia la versione in **due punti, con lo stesso valore**: `APP_VERSION` in `app.js` e `VERSION` in `sw.js` (per esempio `1.0.1`).
3. Carica i file su GitHub.
4. Sul telefono, apri l'app online. Compare **Nuova versione disponibile → Aggiorna**.

Se cambi la struttura del database, aumenta `DB_VERSION` e aggiungi un blocco di migrazione in `openDB()`. Non cancellare mai gli archivi esistenti.

## Formati dei file

**CSV** (UTF-8, separatore virgola, decimali con il punto, una riga di intestazione). Rispetto alla 1.0.0 le colonne nuove sono **solo in fondo**:

- `osfit-giorni_<lunedì>_<domenica>.csv` — sempre 7 righe:
  `data,stato,voci,kcal,proteine_g,carboidrati_g,grassi_g,tipo_giornata,peso_kg`
  - `stato` vale `registrato` oppure `vuoto`; per i giorni vuoti i valori nutrizionali sono lasciati vuoti, non a 0.
  - `tipo_giornata` vale `pesi`, `cardio`, `riposo` o vuoto.
- `osfit-voci_<lunedì>_<domenica>.csv` — una riga per voce:
  `data,pasto_n,pasto,alimento,grammi,kcal,proteine_g,carboidrati_g,grassi_g,unita,piatto`
  - `grammi` contiene la quantità nell'unità indicata da `unita` (`g` o `ml`).
  - `piatto` riporta il nome del piatto se la voce ne fa parte.

Se OS_FIT richiede un altro formato (colonne, separatore `;`, decimali con la virgola), basta modificare `exportCSV()` in `app.js`.

**Backup** `osfit-diario-backup_<data>.json` (formato 2; il ripristino accetta anche i backup della 1.0.0, formato 1):

```json
{
  "app": "OS_FIT Diario",
  "format": 1,
  "dbVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "...",
  "counts": {},
  "foods": [],
  "combos": [],
  "entries": [],
  "days": [],
  "templates": [],
  "settings": { "goals": {}, "plan": {} }
}
```

- `foods`: `{id, name, brand, unit "g"|"ml", state "crudo"|"cotto"|"", kcal, prot, carb, fat, portion, dayPortions:{pesi,cardio,riposo}, barcode, source, fav, lastGrams, lastUsed}` (valori per 100 g o 100 ml)
- `combos` (piatti): `{id, name, items:[{foodId, name, per100, unit, grams, dayGrams:{pesi,cardio,riposo}}], cookedWeight}`
- `entries`: `{id, date "AAAA-MM-GG", slot 1–5, foodId, name, grams, unit, per100, kcal, prot, carb, fat, dishId, dishName, groupId, createdAt}`
- `days`: `{date, type, weight}` — `type` vuoto = nessun tipo scelto a mano; assente = segue il programma
- `templates` (giornate tipo): `{id, name, type, entries:[…]}`
- `settings.goals`: `{pesi:{kcal,prot,carb,fat}, …}` · `settings.plan`: `{1..7: tipo}` (1 = lunedì)

Il ripristino verifica il file prima di scrivere ed è tutto-o-niente.
- **Sostituisci** cancella i dati attuali e li rimpiazza con il backup.
- **Unisci** aggiunge e aggiorna per `id`, senza cancellare nulla.

## Test automatici

```bash
pip install playwright
python3 tests/test_offline.py --chrome /percorso/di/chrome   # oppure: playwright install chromium
```

Le 21 prove coprono:
- installazione del service worker;
- modalità aereo, chiusura completa e riapertura;
- registrazione, modifica e cancellazione offline;
- pasti preferiti e riepilogo settimanale;
- CSV, backup, cancellazione totale e ripristino identico;
- aggiornamento a una nuova versione senza perdita di dati;
- piatti, varianti per tipo di giornata, peso cotto, obiettivi, programma, giornate tipo, copia, peso;
- codici a barre con risposte di Open Food Facts **simulate** (completa, incompleta, non trovata), offline e anti-duplicati;
- migrazione da un database della 1.0.0 e ripristino di un backup della 1.0.0.

Il report viene scritto in `tests/output/report.md`.

**Limite:** i test usano il motore di Chrome. Il comportamento di Safari/iOS va verificato sul telefono con la checklist sopra. Fotocamera e chiamate reali a Open Food Facts non sono testabili qui.

## Continuare il progetto altrove

Il codice è JavaScript, HTML e CSS standard, senza framework: si può modificare a mano o con qualsiasi assistente AI.
Per dare il contesto a un altro modello, passagli questo README e `app.js`: le sezioni del file seguono le schermate (OGGI, ALIMENTI, SETTIMANA, CSV/backup).

## Novità della 1.1.0

- **Aggiornamento senza perdita di dati.** Il database passa dalla versione 1 alla 2 aggiungendo solo archivi e campi nuovi. Verificato con un'installazione 1.0.0 con dati reali, aggiornata alla 1.1.0.
- **Codici a barre.**
  - Si avvia dal **+** di un pasto (**Scansiona codice**) o da Alimenti (▥).
  - Si può anche **digitare il codice**.
  - Se l'alimento con quel codice è già salvato, viene usato subito, anche offline, senza duplicati.
  - Altrimenti l'app cerca su Open Food Facts e precompila il modulo. I valori mancanti restano **vuoti e segnalati**, e il salvataggio richiede di compilarli. Le kcal calcolate dai kJ sono segnalate come tali.
  - Se il prodotto non viene trovato, o sei offline, si compila a mano con il codice già associato.
- **Lettore dei codici.**
  - **Android/Chrome:** usa il lettore integrato del browser.
  - **iPhone:** carica al primo uso una libreria open source (licenza MIT) da jsDelivr; serve la connessione la prima volta.
  - **Fotocamera:** il permesso viene chiesto al primo uso; se lo neghi, puoi sempre digitare il codice.
- **Piatti.** Creazione da zero, aggiunta e rimozione di ingredienti, totali calcolati solo dagli ingredienti.
  - Varianti **Base/Pesi/Cardio/Riposo** nello stesso piatto.
  - **Crudo/cotto:** gli alimenti crudi e cotti sono distinti, con un'etichetta. Il **peso del piatto cotto**, se lo inserisci, permette di registrare una porzione in grammi calcolata dagli ingredienti.
- **Porzioni per tipo di giornata.** Su alimenti e piatti. La quantità modificata al momento vale solo per quella voce e non cambia le impostazioni.
- **I 5 suggerimenti:**
  - obiettivi per tipo di giornata;
  - programma settimanale dei tipi;
  - giornate tipo;
  - copia da un giorno qualsiasi;
  - peso corporeo (anche nel CSV).

## Novità della 1.2.0

**Scanner riscritto, nessuna dipendenza.** La 1.1.0 su iPhone dipendeva da una libreria scaricata da internet al primo uso. Ora il lettore è nel file `scanner.js`.
- Funziona offline e su tutti i browser.
- Dove il browser ha un lettore integrato (Android/Chrome), l'app li usa entrambi.
- Ogni codice va confermato due volte e deve superare la cifra di controllo.
- Nei test su oltre 1.000 immagini generate (sfocate, piccole, inclinate, capovolte, rumorose, con luce non uniforme) **non ha mai restituito un codice sbagliato**.
- Con sfocatura estrema non legge: in quel caso allontana un po' il telefono, oppure usa la foto.

**Fai una foto al codice.** Usa la fotocamera del telefono con la sua messa a fuoco; utile se il video non legge.

**Torcia** (dove il telefono la rende disponibile) e **messa a fuoco continua**.

**Lo scanner non funziona?** Mostra cosa succede:
- stato della fotocamera e del permesso;
- risoluzione;
- lettori in uso;
- fotogrammi analizzati;
- una prova di collegamento a Open Food Facts.

**Cerca online.** Ricerca dei prodotti per nome su Open Food Facts, dal **+** di un pasto (🔎) o da Alimenti. Il risultato scelto precompila l'alimento, con il codice a barre. Se il prodotto è già tra i tuoi alimenti, l'app usa quello.

**Se Open Food Facts non risponde** (rete bloccata o offline): il modulo resta compilabile a mano con il codice già associato, e c'è il link alla scheda del prodotto sul sito.

**Benvenuto con ripristino del backup** alla prima apertura, e **invito a installare l'app** con i passi giusti per iPhone o Android.

**Guida rapida** in Settimana: installazione, backup, aggiornamenti, scanner, ricerca, giornate pesi/cardio/riposo.

**Test:** 26 prove automatiche. Le nuove includono:
- fotocamera simulata con un video, senza lettore del browser, come su iPhone;
- foto;
- ricerca per nome;
- Open Food Facts bloccato;
- reinstallazione con ripristino.

Le 26 prove si aggiungono all'aggiornamento reale verificato a mano: dalla 1.0.0 alla 1.1.0 e dalla 1.1.0 alla 1.2.0, con i dati intatti.

**Da verificare sul telefono:** la fotocamera reale, il permesso nell'app installata su iPhone e la risposta reale di Open Food Facts. Nei test le sue risposte sono simulate.

## Novità della 1.3.0 — catalogo alimentare

- **Catalogo predefinito di 390 alimenti** in 16 categorie, scelti per il Nord Italia, con note sui prodotti tipici piemontesi che usano i valori del prodotto generico (Nocciola Piemonte IGP, Castagna e Fagiolo Cuneo IGP, Peperone di Carmagnola, Gorgonzola, Grana Padano…).
- **Valori nutrizionali da Ciqual 2025 (ANSES)**, Licence Ouverte, per 100 g di parte edibile: energia, proteine, carboidrati, zuccheri, grassi, saturi, fibre, sale e sodio (separati), potassio, calcio, magnesio, ferro, zinco, fosforo, vitamine A, C, D, E, K1 e gruppo B (B1, B2, B3, B5, B6, folati, B12). I dati assenti nella fonte sono mostrati come *dato non disponibile* e non vengono mai contati come zero; *tracce* e *< x* restano tali.
- **Unità per alimento**: g, porzioni standard LARN 2024 (es. 1 frutto medio = 150 g, 1 uovo = 50 g, 1 vasetto = 125 g, 1 cucchiaio di olio EVO = 10 ml = 9 g), ml solo se la densità è nota, unità personalizzate (“1 banana media = 130 g”). L'ultima porzione usata viene ricordata.
- **Stagionalità** (calendario ASL VCO Piemonte / MIPAAF) per frutta e verdura: filtro “di stagione”, etichette *di stagione / fuori stagione / importato*. Non impedisce di registrare nulla.
- **Ricerca unica** su recenti, piatti, tuoi alimenti e catalogo, con filtri per categoria; plurali e accenti ignorati (“mele” trova “Mela”).
- **Scheda alimento** con macro e micronutrienti separati, fonte e codice Ciqual; **Nutrienti del giorno** con i totali e il numero di voci senza dato.
- **Identificativi stabili** (`ciqual:<codice>`): un alimento del catalogo entra nel tuo database solo quando lo usi; aggiornando il catalogo i valori si aggiornano senza doppioni (tranne gli alimenti che hai modificato), e il diario passato non cambia.
- CSV: nuove colonne in fondo (zuccheri, saturi, fibre, sale, quantità domestica); le colonne precedenti non cambiano posizione.

### Rigenerare o verificare il catalogo

```bash
python3 tools/build_catalog.py CIQUAL2025_ENG_2025_11_03.csv CIQUAL2025_FR_2025_11_03.csv
python3 tools/verify_catalog.py CIQUAL2025_ENG_2025_11_03.csv   # confronta ogni valore con la fonte
```

Per aggiungere alimenti: una riga in `tools/catalog_selection.txt` (codice Ciqual, nome italiano, categoria, stagione, porzione, nota), poi rigenera. I file Ciqual si scaricano da ciqual.anses.fr.

### Fonti

- Ciqual 2025, Table de composition nutritionnelle des aliments, ANSES — Licence Ouverte / Open Licence (Etalab), file del 03/11/2025.
- LARN 2024 (SINU), Standard quantitativi delle porzioni.
- Calendario stagionalità di frutta e verdura, ASL VCO (Piemonte), campagna MIPAAF “Sai quel che mangi”.
- Le tabelle CREA non erano raggiungibili dall'ambiente di sviluppo: il formato del catalogo permette di importarle in futuro con lo stesso script, se le condizioni di riuso lo consentono.

## Novità della 1.4.0 — nuova grafica e interazioni

Solo interfaccia: database (versione 2), backup (formato 2), CSV e calcoli non cambiano. Dettagli in `REDESIGN_1.4.0.md`.

- **Oggi come dashboard**: anello delle calorie rispetto all'obiettivo, barre di proteine, carboidrati e grassi, "Mancano/Oltre", link ai nutrienti del giorno. Ogni pasto mostra icona, calorie e macro in sintesi.
- **Pulsante "Aggiungi"** sempre visibile in Oggi: apre la ricerca sul pasto dell'ora (colazione fino alle 10, spuntino fino alle 12, pranzo fino alle 15, merenda fino alle 18, poi cena).
- **Quantità con − / +** (5 o 10 g, mezza unità) e anteprima che si aggiorna con un breve lampo.
- **Progressi** (ex Settimana): grafico interattivo di 7, 30 o 90 giorni per calorie, proteine o peso, con obiettivo del tipo di giornata. Tocca una barra per vedere il giorno e aprirlo. Sotto restano tabella settimanale, CSV, obiettivi e backup.
- **Tema** Automatico / Chiaro / Scuro (in fondo a Progressi), ricordato sul telefono.
- **Colori funzionali** costanti: calorie arancio, proteine blu, carboidrati ambra, grassi viola; pesi/cardio/riposo con il proprio punto colorato.
- **Animazioni brevi**: cambio schermata, apertura e chiusura dei fogli, anello e barre, numeri che scorrono, voce appena aggiunta evidenziata, caricamento a scheletro. Con "Riduci movimento" attivo nel telefono sono tutte disattivate.
- **Messaggi**: conferme con spunta; gli errori sono rossi, con icona, e il foglio resta aperto per correggere.
- Icone SVG coerenti incluse nella pagina (nessun file o libreria aggiuntiva).

**Test:** 38 prove automatiche (le 34 precedenti più 4 nuove: dashboard e selettore, grafico, tema, movimento ridotto) e aggiornamento reale 1.3.0 → 1.4.0 con dati identici e riapertura offline.
