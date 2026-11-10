# OS_FIT Diario 1.3.0 — Catalogo alimentare e registrazione più rapida

## A. Analisi iniziale (versione 1.2.0)

**Già presente**
- Diario con 5 pasti, tipo di giornata (Pesi/Cardio/Riposo) con programma settimanale, obiettivi, peso.
- Alimenti personali con valori per 100 g o 100 ml, porzione abituale, porzioni per tipo di giornata, preferiti, codice a barre.
- Piatti composti con varianti per tipo di giornata e peso del piatto cotto; giornate tipo; copia da altri giorni.
- Scanner integrato, ricerca Open Food Facts, CSV per OS_FIT, backup e ripristino, funzionamento offline.

**Mancante**
- Catalogo predefinito: ogni alimento andava inserito a mano o scansionato.
- Micronutrienti, zuccheri, saturi, fibre, sale e sodio.
- Unità domestiche: esistevano solo g/ml.
- Stagionalità, filtri per categoria, sezione "recenti".

**Problemi individuati**
- La ricerca mostrava solo gli alimenti personali.
- Non c'era modo di distinguere un dato assente da uno zero.
- I liquidi non potevano essere convertiti tra ml e g.

## B. Miglioramenti selezionati

| Funzione | Motivazione pratica | Priorità | Impatto sull'interfaccia |
|---|---|---|---|
| Catalogo di 390 alimenti (Ciqual 2025) | Registrare senza inserire valori a mano | Alta | Nuova scheda "Catalogo" in Alimenti; risultati del catalogo nella ricerca del "+" |
| Scheda nutrizionale completa con "dato non disponibile" | Dati attendibili e confrontabili | Alta | Scheda alimento con macro, minerali e vitamine separati |
| Unità per alimento e conversioni esplicite | Registrare "1 cucchiaio d'olio" o "1 vasetto" senza pesare | Alta | Pulsanti unità nel foglio quantità, calcolo immediato |
| Ricerca unica (recenti, piatti, tuoi alimenti, catalogo) | Meno passaggi | Alta | Stesso campo di ricerca, sezioni ordinate |
| Conservazione dei dati esistenti | Nessuna perdita | Alta | Nessuno: identificativi stabili, il diario passato non cambia |
| Recenti e preferiti | Il cibo di tutti i giorni a un tocco | Media | Sezione "Recenti" in cima |
| Filtri per categoria e stagionalità | Trovare e scegliere prodotti locali | Media | Pulsanti scorrevoli sotto la ricerca |
| Porzioni per tipo di giornata anche sul catalogo | Riso 120/100/90 g senza ricrearlo | Media | Come prima, in "Porzioni e dati" |
| Nutrienti del giorno | Vedere fibre, sale, vitamine e minerali | Media | Link sotto i totali di Oggi |

**Flusso di registrazione:** Oggi → **+** → scrivi o scegli dai Recenti → unità e quantità (calorie e macro si aggiornano subito) → **Salva**. Sono 3–4 tocchi e non servono conferme aggiuntive.

## C. Implementazione

**Modifiche eseguite**
- `catalog.js` è generato da `tools/build_catalog.py` a partire dal file Ciqual 2025 originale. Ogni alimento ha:
  - id stabile `ciqual:<codice>`;
  - nome italiano;
  - categoria;
  - 27 nutrienti;
  - porzioni LARN;
  - stagionalità;
  - nota sul prodotto tipico.
- Il catalogo resta in sola lettura. Un alimento entra nel database personale solo quando lo usi, lo segni come preferito o lo modifichi.
- Quando cambia la versione del catalogo, gli alimenti già usati si aggiornano senza doppioni. Restano invariati:
  - gli alimenti modificati da te;
  - le unità personali;
  - il diario passato.
- Formula di calcolo: valore consumato = valore per 100 × quantità in grammi / 100, per qualsiasi unità convertita in grammi.
- Sui totali: "tracce" e "< x" restano tali; un dato assente non viene sommato e la voce viene contata come "senza dato".
- Il database (versione 2) e il formato di backup (2) sono invariati: i nuovi campi sono facoltativi e i backup precedenti restano ripristinabili.
- Open Food Facts ora fornisce anche zuccheri, saturi, fibre, sale e sodio. Nel modulo manuale ci sono gli stessi campi, facoltativi.
- CSV: nuove colonne in fondo, le colonne esistenti non cambiano posizione.

**Struttura del catalogo:** 16 categorie.

| Categoria | Alimenti |
|---|---|
| Frutta fresca | 43 |
| Frutta secca e semi | 19 |
| Verdure e ortaggi | 72 |
| Legumi | 20 |
| Cereali, pasta, riso | 52 |
| Pane e forno | 17 |
| Carne | 33 |
| Salumi | 12 |
| Pesce | 31 |
| Uova | 7 |
| Latte e yogurt | 17 |
| Formaggi | 20 |
| Oli e grassi | 6 |
| Condimenti | 13 |
| Dolci e colazione | 18 |
| Bevande | 10 |

**Fonti utilizzate**
- **Ciqual 2025 (ANSES).** Licenza: *Licence Ouverte / Open Licence* (riuso consentito citando la fonte). File del 03/11/2025, impronta SHA-256 registrata in `catalog.js`.
- **LARN 2024 (SINU), "Standard quantitativi delle porzioni".** Da qui vengono le porzioni e la densità dell'olio EVO (1 cucchiaio = 10 ml = 9 g). Il cucchiaino è 5 ml, misura standard.
- **Calendario di stagionalità ASL VCO (Piemonte), campagna MIPAAF "Sai quel che mangi".**
- **CREA:** non raggiungibile dall'ambiente di sviluppo, quindi non è stato possibile verificarne dati né condizioni di riuso. Il formato del catalogo è pronto per importarlo in seguito.

**Dipendenze e limiti**
- Nessuna dipendenza nuova.
- Il catalogo pesa circa 190 KB ed è disponibile offline.
- I nomi italiani sono traduzioni dei nomi Ciqual; il nome originale e il codice compaiono nella scheda.
- I prodotti tipici senza scheda propria (Toma, Castelmagno, Bra, Raschera, salsiccia di Bra, Fassona) **non sono stati inseriti**: per non inventare valori, usa la scansione o la ricerca online.
- Le note "tipico" indicano solo che si usano i valori del prodotto generico.
- **Liquidi:** Ciqual riporta i valori per 100 g. Il ml è disponibile solo se la densità è nota (olio EVO) oppure se la imposti tu, per esempio per il latte.
- **Taglie dei pezzi:** piccola, media e grande non hanno una fonte. C'è la porzione LARN "1 frutto medio = 150 g" e puoi salvare le tue unità ("1 banana media = 130 g").
- Le vitamine B9 sono espresse in equivalenti di folati quando disponibili, altrimenti come folati totali (stesso valore per gli alimenti non fortificati). La vitamina K comprende solo la K1.

## D. Verifica

**Integrità dei dati:** `tools/verify_catalog.py` ha confrontato **10.530 valori** con il file Ciqual originale.
- 0 differenze;
- 806 "dato non disponibile" rispettati, mai trasformati in zero;
- identificativi unici.

**34 prove automatiche** (Chrome headless, profilo persistente, tutte superate). Le 26 precedenti più 8 nuove:
- banana 120 g: calorie, macro e micro uguali a valore per 100 × 1,2, con i dati sotto soglia mostrati come "<";
- olio EVO: cucchiaio 9 g / 81 kcal, cucchiaino 4,5 g, passaggio a ml;
- latte: il bicchiere è bloccato senza densità e diventa 129 g / 61 kcal con densità 1,03;
- unità personalizzata e ultima porzione ricordata;
- porzioni Pesi/Cardio/Riposo sul riso del catalogo; una modifica manuale non altera le impostazioni;
- ricerca con plurali e accenti; filtro "di stagione" uguale al calendario del mese corrente; nessun doppione;
- piatto "Riso, pollo e peperoni" con ingredienti del catalogo e variante Cardio applicata;
- pannello dei nutrienti del giorno: totali solo dalle voci con il dato e conteggio delle voci senza dato;
- aggiornamento del catalogo: stessi id e valori aggiornati; restano intatti alimenti personalizzati, unità personali e diario;
- telefono 360 px e desktop 1280 px senza scorrimento orizzontale.

**Aggiornamento reale da 1.2.0 a 1.3.0** con dati: avviso "Aggiorna", dati identici, riapertura offline funzionante.

**Problemi aperti**
- Safari/iPhone, la fotocamera reale e le risposte reali di Open Food Facts vanno provati sul telefono.
- I nomi italiani del catalogo sono traduzioni mie: segnalami le correzioni.

**Non implementato (priorità bassa, solo proposte):** vedi sezione E.

## E. Confronto con le app concorrenti e proposte

**Funzionalità verificate sulle pagine ufficiali**

| App | Funzione | Cosa ho verificato |
|---|---|---|
| **MyFitnessPal** | Ricerca e voci recenti | Il tasto "Log" su un pasto apre la ricerca con le voci recenti e frequenti. |
| | Riuso dei pasti | "Saved Meals" per i pasti abituali. Uno scorrimento sotto il pasto riporta le voci dell'ultima volta. |
| | Copia | Si copia un pasto verso un altro pasto o giorno; non i singoli elementi né il giorno intero. |
| | Quick Add | Inserimento rapido delle calorie; per i macro serve l'abbonamento Premium. |
| **Cronometer** | Diario | Pulsante "Add Food" nel diario. |
| | Alimenti e ricette personali | Alimenti personali e ricette per i piatti frequenti. |
| | Obiettivi | Obiettivi anche per i micronutrienti. |
| | Andamento | Scheda "Trends" con grafici. |
| **YAZIO** | Registrazione | Ricerca nel database e scanner di codici a barre, con calcolo di calorie e nutrienti. |
| | Analisi | Ricette e analisi nel tempo. |

Le pagine consultate non descrivono in dettaglio porzioni, preferiti o grafici; questi aspetti restano non verificati.

**Adattamento in OS_FIT**
- Recenti in cima e un'unica ricerca: ispirati a MyFitnessPal, già implementati.
- Dati assenti mai contati come zero e micro separati: nello spirito di Cronometer, già implementati.

**Proposte (massimo 5, non implementate)**

| # | Proposta | Esempio d'uso | Perché è utile | Complessità |
|---|---|---|---|---|
| 1 | Obiettivi per alcuni micronutrienti (fibre, sale, potassio, calcio, ferro), simili a Cronometer | Giorno Riposo: fibre ≥ 30 g, sale ≤ 5 g, con barra nel pannello del giorno | Rende utili i micro senza appesantire Oggi | Bassa |
| 2 | Quick add di calorie e macro senza alimento (MyFitnessPal lo offre; i macro solo con Premium) | Pasto fuori casa: "650 kcal, P 30, C 70, G 25" | Registrazione in 10 secondi quando non sai gli ingredienti | Bassa |
| 3 | Grafico settimanale semplice (kcal e proteine per giorno rispetto all'obiettivo) | Scheda Settimana | Controllo visivo prima del check-in | Media |
| 4 | Ricerca "frequenti per questo pasto": a Colazione propone ciò che mangi di solito a colazione | "+" su Colazione mostra prima yogurt e avena | Un tocco in meno ogni giorno | Media |
| 5 | Importazione di altri alimenti dal catalogo completo Ciqual (3.484 alimenti) o da CREA, se le licenze lo consentono | "Aggiungi dal catalogo esteso" | Copertura più ampia senza inventare valori | Media (Ciqual) / da verificare (CREA) |
