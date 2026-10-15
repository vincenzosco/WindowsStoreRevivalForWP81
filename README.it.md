# WP Store Lab

Laboratorio di intercettazione per il traffico dello **Store di Windows Phone 8.1**.
Fa tre cose e nient'altro:

1. **DNS** — risponde normalmente per tutto, tranne che per i nomi che gli dici tu,
   che risolve verso questo PC.
2. **Proxy** — tunnel trasparente di default; decifra TLS **solo** per gli host che
   gli dici tu. Il resto del traffico del telefono esce identico a prima.
3. **Patch** — per le richieste intercettate applica regole: passthrough, mock,
   rewrite, redirect, block. Tutto viene registrato su disco.

Zero dipendenze Node: gira sui moduli builtin più il binario `openssl` già presente
sul sistema.

---

## Stato attuale (verificato)

| Componente | Stato |
|---|---|
| Server DNS (hijack + forwarding intatto) | ✅ verificato |
| Proxy CONNECT, tunnel trasparente per host non elencati | ✅ verificato |
| MITM TLS selettivo con CA locale + leaf on-demand | ✅ verificato |
| Regole mock / rewrite / redirect / block / passthrough | ✅ verificato |
| Cattura su disco (index JSONL + body) | ✅ verificato |
| Dashboard live + hot reload | ✅ verificato |
| Blob di registro per la CA root | ✅ **byte-identico** a quello che produce Windows |
| Client Zinc (Live Store API) | ✅ 5/5 contro il servizio live, incluso il rifiuto `AC5` |
| Handler Store (`src/store/`) + bridge catalogo | ✅ verificato |
| Self-test end-to-end (meccanismi, su 127.0.0.1) | ✅ **24/24** |
| Prova di schieramento sui nomi host reali dello Store | ✅ **19/19** |
| Cattura reale dallo Store del Lumia 625 | ⏳ da fare (serve puntare il telefono) |
| Mappatura del protocollo Store vero | ⏳ da fare (serve la cattura + API key) |

`npm test` → `node tools/selftest.mjs`.

---

## Quick start

```bash
npm start          # oppure doppio clic su start.cmd
```

Se una porta è occupata il server **non parte** e ti dice chi la tiene e come
liberarla. Su questo PC capita già: vedi "Porta 53" più sotto.

Apri la dashboard: <http://127.0.0.1:8899/__lab/>

---

## Setup del Nokia Lumia 625

### 1. Porta 53 (già gestita)

Il telefono deve usare questo PC come DNS, e il DNS è per forza sulla **53**.
Su Windows quel wildcard è spesso già preso dal servizio *Internet Connection
Sharing* (`svchost` su `0.0.0.0:53`).

Il lab **non richiede di fermare quel servizio**: prova prima il bind
sull'indirizzo LAN e solo dopo sul wildcard, quindi parte comunque e lo dice nel
log:

```
DNS listening on 192.168.0.220:53 (udp)
  (skipped 0.0.0.0:53 - already in use)
```

Vedi `dns.bind` in `config.json` per forzare un indirizzo specifico.
Se davvero vuoi liberare il wildcard: `sc stop SharedAccess` (o disattiva
"Hotspot mobile"); è reversibile con `sc start SharedAccess`.

### 2. Come far usare il lab al telefono

**Se il telefono non ti lascia toccare il DNS, non è un problema: cambia il DNS sul
router.** Metti il DNS di `192.168.0.1` a `192.168.0.220` (o l'opzione DHCP che lo
annuncia) e *tutti* i dispositivi della rete — telefono compreso — useranno il lab,
senza configurare nulla sul telefono. Il lab inoltra normalmente ogni nome tranne i
pochi dello Store, quindi il resto della rete non se ne accorge.

Con questa strada **non serve nemmeno impostare il proxy**: il telefono risolve un
nome dirottato verso questo PC e si connette direttamente alla **443** (e alla **80**, vedi
sotto), dove il lab
ha un listener TLS dedicato (`proxy.tlsEnabled`). Verificato: `npm run rehearse`
prova anche questo percorso.

Se invece puoi configurare il telefono, su WP8.1: **Impostazioni → Wi-Fi → tieni
premuto sulla rete → modifica → IP statico** (il campo DNS compare solo dopo aver
attivato l'IP statico).

| Campo | Valore |
|---|---|
| Indirizzo IP | un indirizzo libero, es. `192.168.0.250` |
| Subnet mask | `255.255.255.0` |
| Gateway | il tuo router (`192.168.0.1`) |
| **DNS** | `192.168.0.220` ← questo PC |
| **Proxy** | `192.168.0.220:8899` |

Il gateway e il DNS restano quelli del router per tutto il resto: il PC inoltra
normalmente ogni nome che non è in lista di hijack.

> ⚠️ Non impostare il *PC* come proprio DNS, o il proxy inoltrerebbe verso sé stesso.

### 3. Certificato root sul telefono

Lo Store parla in HTTPS, quindi serve che il telefono si fidi della CA del lab.
La CA viene creata al primo avvio in `ca/`.

```bash
npm run make-rootreg     # genera ca/install-root-ca.reg
npm run verify-rootreg   # dimostra che il blob coincide con quello di Windows
```

Il file `.reg` contiene:

```
HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates\<SHA1>
  "Blob" = <certificato>
```

Installazione, con il device già interop-unlocked:

1. Apri **WPinternals** e monta il registro del telefono (Full Filesystem Access).
2. Importa `ca/install-root-ca.reg`.
3. Riavvia il telefono.

Thumbprint SHA-1 della CA corrente:

```
2DE30E6BB059296AB07F5754511D97E16ED81D8D
```

La conferma sul device arriva da sé: finché la CA non viene letta, `npm run watch`
mostra gli handshake **rifiutati** (`tls`); dopo il riavvio le stesse connessioni
diventano richieste intercettate in `captures/`.

> Il formato del blob è stato ricostruito e **verificato**: `npm run verify-rootreg`
> importa la CA in uno store usa-e-getta con `certutil`, rilegge il blob che scrive
> Windows e lo confronta col nostro. Se non fossero identici fallirebbe.
> Il punto da confermare sul device è solo *dove* importare il `.reg`; la chiave
> suggerita è quella che Windows usa per lo store delle root.

---

## Workflow di cattura

```bash
# 1. avvia il lab
npm start

# 2. prova la catena completa sui nomi host reali, senza il telefono
npm run rehearse

# 3. in un altro terminale, guarda se il telefono è davvero puntato qui
npm run watch          # mostra solo il traffico che NON viene da questo PC

# 3. sul telefono: apri lo Store, naviga, cerca qualcosa
#    ogni richiesta finisce in captures/session-*/index.jsonl

# 4. leggi cosa è passato
npm run analyze

# 5. aggiungi host alla lista di hijack in config.json, poi ricarica a caldo
curl -X POST http://127.0.0.1:8899/__lab/reload

# 6. quando qualcosa non torna, un solo comando dice cosa manca
npm run doctor         # lab attivo, CA, porte, traffico del device, prossimo passo
```

`npm run watch` filtra gli indirizzi di questo PC e distingue **tre** situazioni,
perché "non vedo nulla" da solo non basta:

| Quello che vedi | Cosa significa davvero |
| --- | --- |
| righe `dns` con `[HIJACK]` | il telefono usa il DNS del lab: è puntato qui |
| righe `http` | il telefono è intercettato: le richieste finiscono in `captures/` |
| righe `connect` | il telefono usa il **proxy esplicito**: `CONNECT <host>:<port> -> mitm\|tunnel` |
| righe `tcp` | il telefono ha aperto il TCP sulla **443** (sarà intercettato o rifiutato) |
| righe `tls` | ha raggiunto il lab ma l'handshake è stato **rifiutato**: manca la CA root sul telefono |
| niente | il telefono punta ancora al router, oppure risolve il nome ma non si connette |

Il caso `tls` è quello che prima restava invisibile: un telefono senza CA root si
connette benissimo, viene rifiutato durante l'handshake e **non produce nessuna
cattura**, quindi `watch` sembrava inerte mentre il device stava parlando con il lab.

Le righe `connect` sono l'unica prova che si ottiene **prima** di installare la CA:
un host non in `mitm.hosts` viene tunellato byte-per-byte e non viene mai decifrato,
ma il nome e la porta richiesti restano nel log. È la mappa degli endpoint che il
dispositivo contatta — utile proprio quando la CA non c'è ancora.

### Quando il telefono risolve il nome ma non compare da nessuna parte

Un dispositivo può risolvere un nome dirottato e comunque non apparire mai nel
proxy, perché si connette a una porta che **nessuno ascolta**: Windows risponde con
un RST, il client riprova, e l'unica traccia resta un'altra query DNS. In quel caso
il lab sembra inerte mentre il dispositivo sta provando.

```bash
npm run canary                        # 8080, 8000, 8443, 9443
npm run canary -- --ports 443,8081 --seconds 600
```

La 80 non è fra i default perché la serve il lab (`proxy.httpPort`): qui si tengono
d'appoggio le porte che il lab **non** serve.

Le connessioni da questo PC sono etichettate `self` e non contate come dispositivo.
È utile anche l'opposto: se il canary resta muto mentre il telefono è attivo, la
porta è esclusa e l'ipotesi passa a un **IP di CDN in cache o cablato**, che il
dirottamento DNS da solo non intercetta.

> Attenzione al controllo: se il telefono è in standby non emette traffico di fondo.
> Un canary muto su una finestra senza query del telefono non è una prova — verifica
> prima che il device abbia parlato (`npm run watch`).

### Prova di schieramento — `npm run rehearse`

Ripete per ogni nome hijackato esattamente quello che farà il telefono: risolve
contro il DNS del lab, apre il TCP, fa il CONNECT, negozia TLS con quel nome come
SNI fidandosi **solo** della CA del lab, e legge la risposta.

Un `502` sulla richiesta è un **pass**: significa che il backend Microsoft non
risponde più — ed è precisamente l'elenco degli endpoint da emulare. Deve invece
riuscire l'intercettazione: hijack DNS, raggiungibilità, validità del certificato,
cattura.

Sui nomi reali configurati il risultato è che i backend **non risolvono nemmeno
più**: `getaddrinfo ENOTFOUND wscont1.apps.microsoft.com`. Non sono solo spenti,
sono stati rimossi dal DNS.

La controprova che il resto del traffico è intatto: un host non hijackato
mantiene il **suo certificato autentico** (`en.wikipedia`, issuer pubblico),
perché il tunnel è byte-per-byte e non viene decifrato.

`npm run analyze` produce `captures/<session>/report.md` con:

- ogni endpoint distinto (`metodo host path`, con id normalizzati),
  stato, content-type, decisione presa;
- **gli host che il telefono ha risolto ma che non sono ancora hijackati**
  → è la lista da copiare in `config.json`;
- **gli endpoint che falliscono** → è la lista di quello che va emulato.

### Iterazione

Le regole si aggiornano **senza riavviare**: modifica `config.json`, poi
`POST /__lab/reload`. La connessione del telefono non cade.

---

## Configurazione (`config.json`)

```jsonc
{
  "network": { "advertiseIp": "auto" },          // IP LAN del PC; "auto" lo rileva
  "dns": {
    "port": 53,
    "upstream": ["1.1.1.1", "8.8.8.8"],
    "hijack": { "ip": "auto", "names": ["*.apps.microsoft.com"] }
  },
  "proxy": {
    "port": 8899,
    "mitm": { "mode": "listed", "hosts": ["*.apps.microsoft.com"] }
  },
  "upstream": { "insecure": false, "timeoutMs": 20000 },
  "livestore": { "baseUrl": "https://zinc.onelive.me/v1", "apiKey": "" },
  "rules": []
}
```

- `dns.hijack.names` viene **sempre** unito a `proxy.mitm.hosts`: un nome
  dirottato ma non intercettato sarebbe un buco nero silenzioso.
- `proxy.mitm.mode: "all"` decifra ogni CONNECT — utile per una cattura ampia,
  rischioso come stato normale.
- `upstream.insecure: true` disattiva la verifica TLS verso il backend reale.

---

## Scrivere una regola

```jsonc
{
  "name": "catalogo da Zinc",
  "match": { "host": "wscont1.apps.microsoft.com", "path": "^/winstore/", "methods": ["GET"] },
  "action": "mock",
  "status": 200,
  "headers": { "content-type": "application/json" },
  "file": "fixtures/catalog.json"
}
```

| `action` | effetto |
|---|---|
| `passthrough` | inoltra al backend reale |
| `mock` | risponde dal file/body della regola, backend non toccato |
| `rewrite` | inoltra, poi applica `rewrites` alla risposta |
| `redirect` | risponde con il contenuto di un'altra URL |
| `block` | 403 |

Operazioni di rewrite: `json.set` (path `a.b[0].c`), `json.delete`, `regex.sub`.
Se il body è compresso viene decompresso prima e rispedito in chiaro.

---

## Dashboard e API admin

| Endpoint | Cosa fa |
|---|---|
| `GET /__lab/` | dashboard live, si aggiorna ogni 3 s, con reload e filtro |
| `GET /__lab/status` | stato completo: config attiva, statistiche, CA |
| `GET /__lab/ca.crt` | scarica la CA in PEM |
| `GET /__lab/captures?limit=N` | ultime N richieste intercettate |
| `POST /__lab/reload` | rilegge `config.json` senza riavviare |

Risponde solo su indirizzi locali.

---

## Handler dello Store (`src/store/`)

Questo è il punto di estensione che tutto il lab esiste per alimentare. Il proxy
consulta il router **prima** delle regole di config: un handler implementa il
protocollo in codice, tutto ciò che non matcha ricade sul passthrough normale.

```js
{
  name: 'nome-handler',
  match: (ctx) => boolean,               // riceve il contesto della richiesta intercettata
  handle: async (ctx, deps) => ({ status, headers, body }) | null  // null = "non è mio, prova il prossimo"
}
```

Se un handler lancia un'eccezione, il router lo registra e **ricade sul
passthrough**: un bug in un handler non rompe il telefono.

### Handler presenti

| Handler | Cosa fa | Attivo di default? |
|---|---|---|
| `store-health` | Risponde su `<host intercettato>/__store/health` con un JSON che prova che la richiesta è arrivata al lab e la risposta è tornata indietro, senza toccare alcun backend | sì |
| `catalog-bridge` | Serve il catalogo Live Store sotto un prefisso di path sugli host intercettati | no, va abilitato |

### Abilitare il bridge

```jsonc
"livestore": {
  "baseUrl": "https://zinc.onelive.me/v1",
  "apiKey": "",
  "bridge": {
    "enabled": true,
    "pathPrefix": "/livestore/",
    "source": "fixture"        // "fixture" = offline, "zinc" = catalogo reale
  }
}
```

Poi, dallo Store intercettato:

```
GET https://<host intercettato>/livestore/                 -> categorie + app
GET https://<host intercettato>/livestore/?categories=1    -> solo categorie
GET https://<host intercettato>/livestore/?q=sample        -> ricerca
GET https://<host intercettato>/livestore/?app=1           -> singola app
```

Ogni risposta porta l'header `x-lab-source` con la sorgente che ha risposto.
Con `source: "zinc"` e nessuna API key la risposta è `502` con `error: NO_API_KEY`
— è il percorso di errore verificato nel self-test.

> Gli handler leggono l'oggetto `config` condiviso, quindi modificare
> `livestore.bridge` e fare `POST /__lab/reload` ha effetto immediato.
> Il self-test lo verifica cambiando sorgente a metà corsa.

### Mappare il protocollo vero

Il bridge risponde nel formato del **catalogo Live Store**, non in quello dello
Store Microsoft: quello si può scrivere solo dopo aver visto la cattura. La
sequenza è: cattura → `npm run analyze` → aggiungi un handler che produce la forma
che lo Store si aspetta, prendendo i dati da `zinc`.

---

## Live Store (Zinc API)

Il catalogo di destinazione è quello di **Live Store** (`onelive.me`), che espone una
API pubblica detta **Zinc**:

```
Base URL : https://zinc.onelive.me/v1
Auth     : header X-OneLive-Key
```

Endpoint utili: `/apps/search`, `/apps/categories`, `/app/{id}`,
`/app/{id}/updateCheck`, e gli analoghi per i giochi.

**Serve una API key**: si crea dal One Live Developer Centre registrando un'app nel
realm "Live Store". Verificato: senza `X-OneLive-Key` la API risponde
`400 {"success":false,"message":"...missing the X-OneLive-Key..."}` — anche sui feed
RSS, che la documentazione dichiara aperti.

Metti la chiave in `config.json` → `livestore.apiKey` e il client è pronto a essere
usato dai futuri handler.

---

## Perché "meta" dello Store non basta

Lo Store di WP8.1 parla un protocollo proprietario (SOAP/XML verso i front-end
`wscont*.apps.microsoft.com`, catalogo Zune, licensing). Il backend Microsoft è
**spento dal 16/12/2019**: non esiste una API viva che restituisca quel catalogo.

Quindi "far credere allo Store che non sia mai chiuso" significa *riscrivere quel
protocollo* mappandolo sul catalogo Zinc. Servono, in quest'ordine:

1. il traffico vero (che è esattamente ciò che questo lab produce);
2. l'API key di Zinc;
3. il layer di traduzione nella cartella `src/store/` (da scrivere dopo la cattura).

Finché quel layer non esiste, le richieste allo Store reale **falliscono con 502**:
è il comportamento corretto e atteso, e il 502 con il suo `detail` è precisamente
l'informazione che indica cosa va emulato.

---

## Struttura

```
src/
  main.mjs        avvio, banner, hot reload
  config.mjs      caricamento config, default, glob matching, IP LAN
  preflight.mjs   controllo porte con nome del processo che le occupa
  pki.mjs         CA + leaf on-demand via openssl, cache su disco
  dns-server.mjs  DNS UDP: forwarding puro + hijack
  proxy.mjs       CONNECT/tunnel, MITM selettivo, regole, admin
  capture.mjs     index.jsonl + body su disco
  rules.mjs       matching regole e applicazione delle rewrite
  zinc.mjs        client della Live Store API, cache e mappatura errori
  paths.mjs       path canonici (Windows: Documenti vs Documents)
  store/
    router.mjs    dispatch degli handler, con fallback sul passthrough
    handlers.mjs  store-health + catalog-bridge
    fixtures/     catalogo di esempio per lavorare offline
tools/
  selftest.mjs         35 verifiche end-to-end, incluse watch e canary
  watch.mjs            mostra solo il traffico che arriva dal dispositivo,
                       compresi i TCP accettati e gli handshake rifiutati
  canary.mjs           ascolta sulle porte che il lab NON serve e segnala se il
                       dispositivo prova lì (escludi `proxy.httpPort`, che il lab usa)
  doctor.mjs           stato completo in un comando: config, porte, CA, traffico del
                       dispositivo e prossimo passo (`npm run doctor`)
  analyze-captures.mjs report del protocollo + suggerimenti di config
  make-rootreg.mjs     blob di registro per la CA (con --verify)
  dnsprobe.mjs         query DNS grezza su porta arbitraria
ca/                    generato: CA, leaf, .reg
captures/              generato: sessioni, body, log DNS
```

---

## Limiti noti

- **Lo Store 8.1 usa anche HTTP sulla 80 — ed è la spiegazione del sintomo più
  insidioso del progetto.** Osservato il 14/10/2026: il Lumia chiedeva
  `cdn.marketplaceedgeservice.windowsphone.com` ogni ~35 s, riceveva il dirottamento
  verso il lab, e **non apriva mai il TCP sulla 443** (nessun accept nel listener
  diretto, con la regola firewall per `node.exe` program-scoped e senza limiti di
  porta: un SYN sarebbe arrivato). La causa è che le ricerche, il catalogo e le
  immagini dello Store 8.1 sono serviti in **HTTP sulla porta 80**: la guida alle
  regole firewall di Ivanti per l'accesso allo store di Windows 8.1 elenca
  `http://marketplaceedgeservice.windowsphone.com` e
  `http://cdn.marketplaceimages.windowsphone.com` su «HTTPS 443, HTTP 80».
  Un dirottamento DNS che ascolta **solo** sulla 443 ottiene quindi il fallimento
  più ingannevole possibile: il dispositivo risolve verso il lab, apre la 80,
  riceve un RST perché nessuno ascolta, riprova — e l'unica traccia resta un'altra
  query DNS. Il lab sembra inerte mentre il dispositivo continua a provare.
  Da qui il listener `proxy.httpPort` (default 80): ora quelle richieste vengono
  accettate, instradate su regole/handler/capture e servite o diagnosticate con un
  502 leggibile invece di sparire.
- Se dopo questo resta un nome risolto ma nessuna connessione, l'ipotesi residua è
  un **IP di CDN in cache o cablato**: il dirottamento DNS non lo intercetta, e per
  distinguerlo serve una cattura a livello di pacchetti (`pktmon` richiede
  privilegi elevati).
- **Certificate pinning**: se lo Store app fa pinning, il MITM fallisce. Si vede
  come errore TLS nei log; in quel caso si lavora in `mode: "all"` per confermarlo
  e si valuta un approccio diverso.
- **WP8.0** userebbe TLS 1.0, che Node disabilita di default:
  `npm run start:wp80` (richiede `--tls-min-v1.0`).
- **DNS su TCP** non è implementato: irrilevante per risposte A/AAAA piccole.
- Le catture contengono **token del tuo account**: `captures/` è in `.gitignore`,
  non pubblicarlo.
- `172.26.160.1` è un adattatore virtuale: `network.advertiseIp` va forzato se
  l'auto-rilevamento sceglie la scheda sbagliata.

---

## Nota su reverse-skill

`https://github.com/zhaoxuya520/reverse-skill` è clonato in `.reverse-skill/`.
Non è uno strumento che esegue il lavoro: è un **router di metodologie** (45 moduli
skill, regole di routing, gate di autorizzazione in `RULES.md`). È stato usato come
riferimento di workflow, in particolare `skills/protocol-reverse/` per la fase di
analisi del protocollo e `skills/ops/` per la catena evidenza → conclusione.
Nessuno script del repository è stato eseguito.
