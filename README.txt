OS_FIT DIARIO - versione 1.4.0
==============================

Web app personale per registrare i pasti e preparare i dati del check-in
settimanale di OS_FIT. Si installa sulla schermata Home del telefono, funziona
offline e i dati restano solo sul telefono.

Indirizzo dell'app:
https://jacquesmayers.github.io/osfit-diario/


1. CONTENUTO DELLA CARTELLA
---------------------------
index.html             struttura della pagina
app.js                 logica dell'app (schermate, dati, CSV, backup, ricerca)
catalog.js             catalogo di 390 alimenti (valori Ciqual 2025)
tools/                 script per rigenerare e verificare il catalogo
scanner.js             lettore dei codici a barre (EAN-13, UPC-A, EAN-8)
style.css              grafica e animazioni (tema automatico, chiaro o scuro)
sw.js                  permette l'apertura offline
manifest.webmanifest   permette l'installazione sulla schermata Home
icons/                 icone dell'app
tests/                 test automatici (non servono per usare l'app)
README.md              documentazione tecnica completa
REDESIGN_1.4.0.md      note sulla nuova grafica (1.4.0)
README.txt             questo file


2. PUBBLICARE L'APP SU GITHUB (dal PC)
--------------------------------------
1) Accedi a github.com.
2) Apri il repository "osfit-diario". Se lo hai cancellato, ricrealo con
   LO STESSO NOME: New repository -> nome "osfit-diario" -> Public -> Create.
3) Clicca "Add file" -> "Upload files".
4) Apri questa cartella sul PC, premi Ctrl+A per selezionare tutto e
   trascina tutto nella pagina di GitHub. Poi clicca "Commit changes".
5) Controlla: nella pagina del repository deve comparire subito index.html,
   NON dentro un'altra cartella.
6) Vai in Settings -> Pages:
   Source = "Deploy from a branch", Branch = "main", cartella "/ (root)",
   poi Save.
7) Aspetta 1-2 minuti. Il link compare in Settings -> Pages
   ("Your site is live at ...").


3. INSTALLARE SUL TELEFONO
--------------------------
iPhone:  apri il link in SAFARI -> tocca Condividi (quadrato con freccia)
         -> "Aggiungi alla schermata Home" -> Aggiungi.
Android: apri il link in CHROME -> menu (tre puntini) -> "Installa app"
         (oppure "Aggiungi a schermata Home").

Apri sempre l'app dall'icona sulla schermata Home. La prima volta aprila
con la connessione attiva: dopo funziona anche in modalita' aereo.


4. USO QUOTIDIANO
-----------------
OGGI
- In alto: anello delle calorie e barre di proteine, carboidrati, grassi
  rispetto all'obiettivo del tipo di giornata.
- Scegli il tipo di giornata: Pesi, Cardio o Riposo.
- Il pulsante verde "Aggiungi" in basso apre la ricerca sul pasto
  dell'ora. Con - e + cambi la quantita' senza tastiera.
- Tocca "+" su un pasto, scrivi il nome (cerca nei tuoi alimenti, nei
  piatti e nel catalogo) oppure scegli dai Recenti. Scegli l'unita'
  (g, porzione, cucchiaio, bicchiere, unita' tue), la quantita' e Salva.
- "Fibre, sale, vitamine e minerali" sotto i totali mostra
  tutti i nutrienti del giorno. "Dato non disponibile" non vale zero.
- Tocca una voce per modificarla o eliminarla.
- "Ripeti da ieri", "Copia da un altro giorno", "Salva come piatto",
  "Salva come giornata tipo", "Applica giornata tipo".
- "Aggiungi peso corporeo" per annotare il peso del giorno.

ALIMENTI
- Catalogo: 390 alimenti gia' pronti, divisi per categoria, con filtro
  "Di stagione". Tocca un alimento per vedere la scheda completa
  (macronutrienti, minerali, vitamine, fonte) e aggiungerlo al diario.
- I miei: valori per 100 g o 100 ml, porzioni per Pesi/Cardio/Riposo,
  codice a barre, preferiti.
- Piatti: ingredienti con quantita', varianti per tipo di giornata,
  peso del piatto cotto (facoltativo).
- Giornate: le giornate tipo salvate.

PROGRESSI (prima si chiamava Settimana)
- Grafico di 7, 30 o 90 giorni: calorie, proteine o peso. Tocca una
  barra per vedere il giorno e aprirlo.
- Riepilogo dal lunedi' alla domenica; i giorni senza dati sono segnati
  come "nessuna registrazione".
- Esportazione CSV per OS_FIT ("CSV giorni" e "CSV voci").
- Obiettivi e programma settimanale.
- Backup, ripristino e guida rapida.
- Tema: Automatico, Chiaro o Scuro.


5. CODICI A BARRE E PRODOTTI
----------------------------
- Dal "+" di un pasto tocca "Scansiona" e inquadra il codice:
  orizzontale, dentro il riquadro, a 10-20 cm, con buona luce.
- Se il video non legge: "Fai una foto al codice", oppure digita le cifre.
- "Cerca online" trova i prodotti per nome (anche senza codice).
- I dati arrivano da Open Food Facts: controllali sempre con l'etichetta.
  I valori mancanti restano vuoti e vanno inseriti a mano.
- Un prodotto gia' salvato viene riconosciuto subito, anche offline,
  senza creare doppioni.
- Se qualcosa non va, apri "Lo scanner non funziona?" nella schermata
  di scansione: mostra lo stato della fotocamera e permette di provare
  la connessione a Open Food Facts.

Permesso fotocamera:
iPhone:  Impostazioni -> Safari -> Fotocamera -> Consenti.
Android: tieni premuta l'icona dell'app -> Info app -> Autorizzazioni.


6. BACKUP (IMPORTANTE)
----------------------
- Progressi -> "Scarica backup" almeno una volta a settimana e sempre
  prima di un aggiornamento. Conserva il file in un posto sicuro
  (File/iCloud, Google Drive, email a te stesso).
- Se elimini l'icona dell'app dal telefono o cancelli i dati del sito,
  il diario si recupera SOLO dal backup.
- Per ripristinare: Progressi -> "Ripristina..." (oppure, alla prima
  apertura, "Ripristina un backup") -> scegli il file
  osfit-diario-backup_....json.


7. AGGIORNARE L'APP
-------------------
1) Sul telefono: Progressi -> "Scarica backup".
2) Sul PC: carica su GitHub i file nuovi (Add file -> Upload files ->
   Commit changes). I file con lo stesso nome vengono sostituiti.
3) Sul telefono: apri l'app online e tocca "Aggiorna" quando compare
   "Nuova versione disponibile". I dati restano.


8. SE HO CANCELLATO L'APP
-------------------------
- Cancellato il repository su GitHub: ricrealo con lo stesso nome
  "osfit-diario" e ricarica i file (punto 2). I dati sul telefono
  sono ancora li'.
- Cancellata l'icona dal telefono: reinstalla l'app (punto 3) e usa
  "Ripristina un backup". Senza backup si riparte da zero.


9. COSTI E LIMITI
-----------------
- Nessun costo: GitHub Pages e Open Food Facts sono gratuiti.
- Nessun account, nessuna sincronizzazione tra dispositivi: per cambiare
  telefono usa backup e ripristino.
- La ricerca prodotti richiede connessione; tutto il resto funziona offline.
