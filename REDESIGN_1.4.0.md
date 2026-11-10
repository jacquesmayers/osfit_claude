# OS_FIT Diario 1.4.0 — Nuova grafica e UX/UI

## 1. Analisi della versione 1.3.0

**Struttura:** tre schermate (Oggi, Alimenti, Settimana), fogli dal basso per le operazioni, nessuna libreria esterna.

**Problemi individuati**
- **Oggi.** I totali erano una riga di testo con una sola barra. Calorie e macro non si leggevano a colpo d'occhio e non c'era un riferimento visivo all'obiettivo.
- **Pasti.** Tutti uguali, senza icone né sintesi dei macro.
- **Aggiunta.** Serviva scorrere fino al pasto giusto per toccare "+".
- **Quantità.** Si cambiava solo da tastiera.
- **Settimana.** Solo una tabella: nessun grafico e nessun confronto oltre i 7 giorni.
- **Grafica.** Icone testuali (▥, ★, ⌕) con stili diversi. Colori non legati al significato. Nessuna animazione né scheletro di caricamento: la schermata appariva vuota per un istante.
- **Messaggi.** Errori e conferme avevano lo stesso aspetto.
- **Tema.** Solo automatico, nessuna scelta manuale.

**Riutilizzato:** tutta la logica (database, calcoli, catalogo, scanner, CSV, backup), le azioni `data-act`, i fogli, i selettori usati dai test.

## 2. Direzione grafica

- **Base.** Superfici chiare e calde (scure nel tema scuro). Card con raggio 18–24 px e ombre leggere. Verde OS_FIT come colore d'azione.
- **Colori funzionali**, uguali ovunque: anello, barre, punti dei pasti, grafico e legenda.

  | Elemento | Colore |
  |---|---|
  | Calorie | Arancio `#f0603c` |
  | Proteine | Blu `#3b6ef5` |
  | Carboidrati | Ambra `#e9a21b` |
  | Grassi | Viola `#9a5cf0` |

  Pesi, Cardio e Riposo hanno ciascuno un punto colorato.
- **Tipografia.** Font di sistema (SF/Roboto), quindi nessun download. Numeri tabulari per evitare salti durante le animazioni. Gerarchia con peso 800 per i valori principali.
- **Icone.** 29 icone SVG a tratto unico (24×24, spessore 1,8) incluse in `index.html`.
- **Token CSS.** Colori, raggi, ombre e tempi sono variabili in `:root`. Il tema scuro e la scelta manuale (`html[data-theme]`) ridefiniscono solo i token.

## 3. Interventi realizzati

| Area | Prima | Dopo |
|---|---|---|
| Oggi – totali | Riga di testo + barra | Anello kcal, 3 barre macro, "Mancano/Oltre", link nutrienti; "Imposta un obiettivo" se manca |
| Oggi – pasti | Lista semplice | Icona del pasto, kcal e punti macro, "Nessun alimento" se vuoto |
| Aggiunta | Solo "+" sul pasto | Anche pulsante fisso "Aggiungi" (pasto dell'ora) |
| Quantità | Solo tastiera | − / + (5–10 g o mezza unità), anteprima con lampo |
| Settimana → Progressi | Tabella | Grafico 7/30/90 giorni, kcal/proteine/peso, obiettivo, selezione barra + "Apri"; tabella invariata sotto |
| Navigazione | Barra con testo | Icone con "pillola" attiva; su desktop barra flottante e fogli centrati |
| Tema | Automatico | Automatico / Chiaro / Scuro, ricordato |
| Messaggi | Uguali | Conferma con spunta; errore rosso con icona e `role="alert"`, foglio aperto per correggere |
| Caricamento | Schermata vuota | Scheletro animato |

**Animazioni** (120–420 ms, curva unica): entrata delle schermate; apertura e chiusura dei fogli; anello e barre che crescono dal valore precedente; numeri che scorrono; voce appena aggiunta evidenziata; barre del grafico che salgono; linea del peso disegnata; pressione dei pulsanti. Con *Riduci movimento* tutte le animazioni e transizioni sono azzerate e i valori compaiono subito definitivi.

**Accessibilità:** aree di tocco ≥ 44 px (stepper 56 px); `aria-current` sulla scheda attiva; barre del grafico raggiungibili da tastiera (Tab + Invio); `aria-live` sul dettaglio del grafico; `progressbar` sulle barre macro; contrasto ≥ 4,5:1 calcolato (formula WCAG) per testi secondari e numeri arancio in entrambi i temi (es. grigio 4,7:1 sullo sfondo chiaro, 5,5:1 su quello scuro).

**Prestazioni:** nessuna libreria nuova. Si animano solo `transform`, `opacity`, `stroke-dashoffset` e `width`. Il grafico è un SVG generato da circa 60 righe di codice.

**Funzioni aggiunte (solo visualizzazione di dati già esistenti, segnalate):**
- selettore 7/30/90 giorni e metrica del grafico;
- scelta manuale del tema;
- pulsante "Aggiungi" con pasto in base all'ora;
- link "Imposta un obiettivo" su Oggi quando non ci sono obiettivi.

Nessun dato nuovo viene salvato, tranne la preferenza del tema (nel browser, non nel backup).

## 4. Verifiche

- **38 prove automatiche** in Chrome headless, tutte superate: le 34 precedenti invariate più 4 nuove.
  - Dashboard:
    - anello coerente con kcal/obiettivo;
    - pulsante visibile solo in Oggi e collegato al pasto dell'ora;
    - − / +;
    - errore recuperabile;
    - conferma;
    - voce evidenziata.
  - Grafico:
    - 7/30/90 barre;
    - metriche;
    - selezione con tocco e tastiera;
    - "Apri" porta al giorno.
  - Tema salvato e ripristinato alla riapertura.
  - Movimento ridotto: nessuna animazione, foglio chiuso subito, valori finali.
- **Larghezze:** 360, 390 e 1280 px senza scorrimento orizzontale.
- **Aggiornamento reale 1.3.0 → 1.4.0:** avviso "Aggiorna", dati identici, riapertura offline.
- **Correzione emersa dai test.** In 1.4 il foglio restava nel DOM durante l'animazione di chiusura, e un tocco rapido poteva finire nel foglio che si stava chiudendo. Ora l'animazione usa una copia "fantasma" senza comandi e il foglio vero sparisce subito. Corretto anche il messaggio "Alimento aggiornato" dopo una modifica.

## 5. Limiti e da verificare

- Provato in Chrome (motore Chromium). **Safari/iPhone** va provato sul telefono: sfocature, animazioni SVG e vibrazione (che iOS non supporta: semplicemente non vibra).
- Il grafico di 90 giorni mostra barre molto sottili sui telefoni piccoli: il dettaglio si legge toccando la barra.
- Il tema scelto a mano vale per quel browser e non entra nel backup.
- Non implementato perché fuori dal perimetro del redesign:
  - menu contestuale a pressione lunga (oggi il tocco su una voce apre già modifica/elimina);
  - scorrimento laterale per eliminare.
