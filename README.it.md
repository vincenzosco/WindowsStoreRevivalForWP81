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
| Self-test end-to-end (meccanismi, su 127.0.0.1) | ✅ **97/97** |
| Prova di schieramento sui nomi host reali dello Store | ✅ **44/44** |
| Vocabolario dello Store letto dal telefono, e riverificabile | ✅ **19/19** (`npm run read-vocabulary`) |
| Cattura reale dallo Store del Lumia (RM-941) | ✅ la pagina viene chiesta, ed è etichettata (`storePages`, `type=003`) |
| Il telefono **rende** la pagina | ❌ chiede la pagina e poi non chiede più nulla: nessuna immagine, nessun dettaglio |
| Mappatura del protocollo Store vero | ⏳ in corso (la pagina generata è la variabile in prova) |

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

# 2b. e rileggi dal telefono il vocabolario con cui la pagina dello Store va costruita
npm run read-vocabulary    # fallisce se il modulo e il dispositivo non sono più d'accordo

# 3. in un altro terminale, guarda se il telefono è davvero puntato qui
npm run watch          # mostra solo il traffico che NON viene da questo PC

# 3. sul telefono: apri lo Store, naviga, cerca qualcosa
#    ogni richiesta finisce in captures/session-*/index.jsonl

# 4. leggi cosa è passato
npm run analyze
#    oppure, su tutte le sessioni: chi ha chiesto e quale dispositivo
npm run analyze -- --all-sessions

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

### Quando il lab sembra occupato ma sta solo parlando con sé stesso

Se anche il **PC** ha il lab fra i suoi server DNS (`192.168.0.220` su una scheda),
un nome dirottato si risolve — *su questo PC* — nell'indirizzo del lab: il rilancio
verso l'upstream richiama il lab, ogni hop aspetta quello sotto, e nessuno risponde
mai. Il registro si riempie di richieste che portano gli header del telefono ma
arrivano dall'indirizzo del **PC**: è la traccia più ingannevole di tutte, perché
il telefono non c'entra e i contatori salgono come se fosse lui.

Riconoscerlo:

```bash
node -e "require('dns').lookup('cdn.marketplaceedgeservice.windowsphone.com',(e,a)=>console.log(a))"
# 192.168.0.220  ->  è il lab, non un CDN: questo PC si sta rimbalzando la richiesta
```

La richiesta viene ora **rifiutata subito** (`error: upstream_loop`, contatore
`upstreamLoops`) invece di restare appesa per tutto l'upstream timeout. Il rimedio
è togliere il lab dai DNS del PC — il telefono continua a usarlo — oppure rispondere
a quel nome con una regola `mock`.

### Prova di schieramento — `npm run rehearse`

Ripete per ogni nome hijackato esattamente quello che farà il telefono: risolve
contro il DNS del lab, apre il TCP, fa il CONNECT, negozia TLS con quel nome come
SNI fidandosi **solo** della CA del lab, e legge la risposta.

La richiesta di pagina dello Store viene ripetuta **due volte**: come sopra, e di
nuovo in HTTP semplice sulla porta 80 con l'header `user-agent: ZDM/4.0; Windows
Mobile 8.1` e nessun `Accept`, che è il modo in cui la cattura mostra che il
telefono la fa davvero. Ripeterla solo in TLS lascerebbe non provato proprio il
listener su cui il dispositivo parla.

Sulla pagina servita controlla anche le tre cose che rendono una pagina
inutilizzabile pur essendo ben formata: che il tipo di pagina sia uno che il
client nomina, che il tipo di template sia uno che il telefono stila, e che il
blocco panes ci sia.

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

- **chi ha chiesto**: una riga per indirizzo client, con l'indirizzo di questo PC
  marcato. `client.address` è l'unico campo che separa il dispositivo da questo
  PC: **lo user-agent no**, perché `npm run rehearse` rimanda la richiesta con
  l'agent del telefono (`ZDM/4.0; Windows Mobile 8.1`);
- **quale dispositivo**: le stesse righe raggruppate per `x-wp-device-id`, che è
  ciò che unisce due indirizzi dello stesso telefono e separa due telefoni
  diversi. Il log DNS non ha identità, quindi ogni nome è riportato per
  indirizzo e mai aggregato;
- ogni endpoint distinto (`metodo host path`, con id normalizzati),
  stato, content-type, decisione presa e **quali client** l'hanno raggiunto;
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
| `store-protocol` | Risponde agli endpoint che il telefono chiama **davvero** per aprire lo Store (`/v9/catalog/storePages`, `/v8/catalog/hubs`, `/v[89]/catalog/apps`, `/v8/catalog/updates` e - dal 2026-10-17 - `/v8/Configuration/Stores/...`), nel formato XML che sa leggere | no, va abilitato |
| `store-images` | Risponde al CDN delle immagini (`cdn.marketplaceimages.../v8/images/<guid>`) con un PNG segnaposto: prima erano 502 iniettati dal lab, 420 in due minuti e mezzo su una sola ricerca (F-031) | no, va abilitato |
| `store-live-client` | L'API JSON del **secondo** client presente sul telefono (l'app Live Store, non lo Store di sistema): `/apps`, `/games`, `/apps/search`, `/app/{id}`, `/me` - forma letta dalla sua cache (F-029, F-030) | no, va abilitato |
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

### Il protocollo vero dello Store (`store-protocol`)

Il bridge risponde nel formato del catalogo **Live Store**; `store-protocol` risponde
nel formato dello **Store Microsoft**, ed è quello che serve al telefono per aprire lo
Store. La differenza non è stilistica: sono due grammatiche diverse per due client
diversi.

Quello che il telefono chiede aprendo lo Store, parola per parola dalla cattura del
Lumia:

```
GET  http://marketplaceedgeservice.windowsphone.com/v8/Configuration/Stores/OEMStores/NOKIA
         ?mpcVersion=8.10&os=8.10.14219.0&...          (e una chiamata equivalente su /MOStores/)
GET  http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages
         ?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT&hw=402699266&dm=RM-941_eu_france_308&...
POST http://marketplaceedgeservice.windowsphone.com/v8/catalog/updates?os=8.10.14219.0&...
```

Tutte e tre sono servite da `src/store/protocol.mjs`. La pagina è costruita nell'XML che
il telefono legge; il controllo aggiornamenti riporta ogni SKU come invariato, perché qui
non viene servito nessun pacchetto; le due chiamate di configurazione - che arrivano
**prima**, e che il lab rispondeva `502 upstream_loop` perché nessuna rotta le
intercettava - ricevono un documento `ConfigurationFile` nella grammatica del client
stesso (`Domains`/`Domain`/`setting`), letta da un FFU e scritta con le impostazioni che
la tabella degli endpoint del client sostituisce. Di quell'endpoint non esiste nessuna
cattura, né nell'archivio né sul telefono: sono i *valori* a essere una risposta e non una
ricostruzione, e il documento lo dichiara nei propri header (`x-lab-invented: 1`). Cosa
resta aperto, e i due esperimenti che lo nominano, sono in
[`docs/FINDINGS.md`](docs/FINDINGS.md) sotto E-008, E-009 e F-024.

#### Perché va servita e non inoltrata

Misurato, non assunto. Interrogando gli host veri da questo PC con un resolver
pubblico (così il dirottamento del lab non può rispondere al posto loro):

| Nome | Esito |
|---|---|
| `marketplaceedgeservice.windowsphone.com` | NXDOMAIN |
| `catalog.zune.net` | NXDOMAIN |
| `wscont1.apps.microsoft.com` | NXDOMAIN |
| `cdn.marketplaceedgeservice.windowsphone.com` | risolve (CNAME → `…edgesuite.net` → Akamai), ma l'edge risponde `503 Service Unavailable - DNS failure` |

Cioè: la porta d'ingresso del CDN è ancora in piedi, la sua origine non esiste più. Il
`502` con cui finiva ogni richiesta dello Store non era quindi risolvibile inoltrandola
meglio: la pagina va **prodotta** qui.

#### Da dove viene il formato

Non è inventato. `src/store/catalog-feed.mjs` lo costruisce da risposte reali del
servizio conservate dalla Wayback Machine — tre generazioni della stessa grammatica — e
ogni elemento in quel file cita la cattura da cui proviene:

| Cattura archiviata | Cosa stabilisce |
|---|---|
| `/v3.2/en-US/clientTypes/WinMobile 7.1/hubTypes/marketplace/hub` | la home del marketplace: `<templateName>MarketplaceHub</templateName>`, una voce con `<editorialItems>` e `<features>` |
| `/v8/catalog/hubs?…&hub=games` | una pagina hub di WP8: `<templateName>GamesHub</templateName>`, `<editorialItems>` e le `<applications>` a cui puntano |
| `/v8/catalog/apps?…`, `/v9/catalog/apps?…` | una lista di applicazioni WP8/WP8.1: un `<a:entry>` per app |

Sono tutte feed Atom nel namespace `http://schemas.zune.net/catalog/apps/2008/02`, con un
blocco `<templates>` che nomina il modello UI con cui la pagina viene resa. È questo che
rende possibile la cosa: `storePages?typeId=DynamicHub.Main` è la stessa forma una
generazione dopo.

Gli archivi descrivono la grammatica **v3.2 e v8**. La pagina che questo telefono chiede
è `/v9/catalog/storePages`, e per quella grammatica la fonte non è un archivio: è il
dispositivo stesso.

```jsonc
"livestore": {
  "protocol": {
    "enabled": true,                                        // spento di default: servire la
    "catalogFile": "src/store/fixtures/demo-catalog.json",   // pagina dello Store è una
    "hubTemplate": "DynamicHub",                             // decisione, non un default
    "templateType": "003",
    "templateTypeForm": "both",
    "pageSize": 25
  }
}
```

`catalogFile` viene riletto quando cambia: iterare su quello che il telefono mostra non
richiede un riavvio. I cataloghi che il progetto porta sono due, entrambi dati inventati, con
ogni editore che dice `Lab Fixture`, così nessun listino può passare per reale:

- `src/store/fixtures/demo-catalog.json` — diciassette app su tutte e otto le categorie
  dichiarate, ed è il default: una pagina con una voce per sezione non si distingue da una
  pagina che non disegna niente;
- `src/store/fixtures/sample-catalog.json` — il fixture da tre voci che i test tengono come
  base di regressione. Passare a quello è quella riga lì.

`npm run store:page` costruisce la pagina offline e stampa cosa c'è dentro, sezione per
sezione, con prezzo e valutazione di ogni app. È la risposta a «cosa riceverebbe il
dispositivo», e si legge anche a lab spento e mentre il telefono non mostra altro che un
codice di assert.

#### Il vocabolario, letto dal telefono

Una pagina può essere perfettamente ben formata e nominare comunque un layout che il
dispositivo non ha mai sentito. Quel rifiuto è indistinguibile da una pagina sbagliata, ed è
esattamente quello che hanno incontrato i primi tentativi. Quindi i nomi con cui la pagina è
costruita sono stati presi dal telefono invece che indovinati:

```
npm run read-vocabulary        # rilegge il dispositivo montato, e fallisce su ogni deriva
```

Rispondono due binari del telefono, e devono essere d'accordo — uno analizza una pagina
dello Store, l'altro la disegna:

| Binario | Cosa stabilisce |
|---|---|
| `H:\Windows\System32\ZMarketplace.dll` | i percorsi strutturali che cammina (`/Panes/Pane`, `/Templates/Template`, `/feed/entry`, `/feed/link`), la chiave del tipo di template `TEMPLATETYPE`, i tipi di pagina che chiede (`DynamicHub`, `DynamicChart`, `Collection`), i tipi di link di contenuto (`Application`, `ApplicationCollection`) |
| `H:\Windows\System32\ZuneAssets480x800.dll` | quali tipi di template sono **stilabili su questo schermo 480×800**: `Store_Hub_TemplateType003`, `004`, `015`, `017` e `Store_Chart_TemplateType010`. E `Store_DynamicHubStyle_*`, lo stile con cui è disegnata la pagina stessa |

Tre scoperte hanno cambiato la pagina, e una è una correzione, non una rifinitura:

- **Il tipo di template è un numero.** La pagina chiedeva un layout di nome `DynamicHub`
dove il telefono stila `Store_Hub_TemplateType003`. `003` è la lista ordinata semplice,
che è quello che una sezione generata è; `017` è il layout ricco, con pannello del prezzo,
motivo del suggerimento e un pulsante per elemento, e chiederebbe al telefono di stilare
elementi che la pagina non porta.
- **La pagina non aveva panes.** Il parser conta i panes *prima* dei template
(`Found %d Store Panes`), e ogni pagina che questo lab aveva servito portava un blocco
template e **nessun** `<Panes>`: un template senza niente da rendere.
- **`GamesHub` è il nome sbagliato, e non è mai stato quello giusto.** Compare in
`ZMarketplace.dll` dentro una serie di chiavi di **impostazioni** persistite
(`MarketplaceSettings`, `AutoUpdateOn`, `TileCount`, …), e i suoi unici proprietari veri sul
telefono sono `GamesShared.dll`, `ZMF_Client.dll` e `ZMF_Service.dll` — l'app hub dei Giochi
Xbox. La pagina archiviata che lo porta è la pagina `hub=games` di un'altra generazione.
Servirla a una richiesta `storePages?typeId=DynamicHub.Main` non è mai stato un esperimento
a una variabile sola.

Una domanda che il telefono non può sciogliere sta in un posto solo invece che sparsa nei
costruttori: se la chiave del tipo viaggi come attributo di `<Template>` o come elemento
figlio. Il parser tiene `TEMPLATETYPE` come nome di proprietà, non come markup.
`templateTypeForm` la restringe a `attribute`, `element` o `both`; il default è `both`,
così qualunque delle due letture trova il valore.

#### Le maniglie che il dispositivo può restituire

Ogni voce è servita sotto un GUID derivato dal suo id di catalogo (UUID v5 su un namespace
fisso del lab): la stessa voce ha lo stesso GUID a ogni esecuzione, ed è questo che permette
di ricondurre la richiesta successiva del dispositivo alla voce giusta **senza conservare
stato**. Una richiesta per un GUID che il lab non ha mai coniato viene rifiutata con
`404 app_not_found`, non inoltrata.

#### La controprova, e perché non è una variabile sola

La prima volta che lo Store del Lumia è stato aperto contro questo lab, ha chiesto la home
page, ha ricevuto un `200` con la pagina generata, e ha risposto con l'errore `0x88675309`:
un assert interno di Windows Phone (`E_JENNY_JENNY_WHO_CAN_I_TURN_TO`, "questo non dovrebbe
mai accadere") invece di una diagnosi. Dopo di che non ha chiesto **più nulla**, quindi la
pagina è stata rifiutata mentre veniva letta.

```jsonc
"livestore": { "protocol": { "serve": "archive" } }   // default: "generated"
```

Con `serve: "archive"` gli endpoint di pagina rispondono con
`src/store/fixtures/archive/real-hub-page-20130813.xml`: una risposta del servizio reale,
scaricata byte per byte dall'archivio.

Quell'esperimento è stato costruito come sostituzione a una variabile e **non lo è**, e la
lettura del vocabolario l'ha reso evidente dopo. La risposta archiviata è la pagina
`hub=games` di un'altra generazione: sostituirla cambia tre cose insieme — il tipo di pagina
(l'hub dei giochi, non l'hub dello Store che questa richiesta nomina), la grammatica
(`<templateName>` dentro un blocco `<templates>`, dove il client v9 cammina
`/Templates/Template` e legge `TEMPLATETYPE`) e il proprietario del template (`GamesHub`
appartiene all'app hub dei Giochi, non allo Store). Un rifiuto non incrimina nessuna delle
tre separatamente.

La risposta dice tutto questo nei suoi header invece di lasciarlo in un commento, perché una
cattura non conserva i commenti:

```
x-lab-protocol:        storePages:archive
x-lab-archive-template: GamesHub
x-lab-archive-page:     games-PK-WindowsPhone80-ALL-ALL
x-lab-archive-warning:  archived response of a different page and grammar generation:
                        not a one-variable substitution for the requested page
```

`npm run rehearse` fallisce se una pagina archiviata viene servita senza quegli header, e
stampa l'equivoco invece di darlo per assodato.

#### Cosa è provato e cosa no

Provato su questa macchina (`npm run selftest`, 109 controlli, e `npm run rehearse`: 44 con i nove
nomi dello Store, più quattro per ogni nome aggiunto alla lista di dirottamento — 68 con i
quindici di oggi): il
feed è ben formato; una voce di catalogo ostile (un `&` grezzo, un `<`, virgolette, un
carattere di controllo) non può romperlo; ogni voce di catalogo arriva sulla pagina; lo store
finto che gira davvero è verificato non avere due voci che producono lo stesso GUID, nessuna
voce in una categoria che nessuno ha dichiarato, nessuna categoria dichiarata e vuota, e tutte
le sue app sulla pagina esattamente una volta — una volta come il link che la indica e una
volta come il record che la descrive; un GUID
torna alla sua voce e uno sconosciuto viene rifiutato; gli endpoint rispondono attraverso il
proxy **vero** sul path e sulla query esatti che usa il telefono, **sul trasporto che il
telefono usa** (HTTP semplice sulla porta 80, `ZDM/4.0; Windows Mobile 8.1`, nessun header
`Accept`), e la cattura del lab li registra; l'handler è spento finché non lo si abilita, e
in quel caso ricade sul passthrough.

Provato sul vocabolario (`npm run read-vocabulary`, 19 controlli): ogni tipo di pagina, tipo
di template, percorso strutturale e tipo di link che il modulo dichiara è ancora presente nel
telefono, all'offset che il modulo cita. Una deriva fa fallire il comando.

Provato sulla pagina: nomina un tipo di template che il telefono stila, il suo nome di
template appartiene al client dello Store e non a un'altra app, e porta **ogni** percorso
strutturale che il parser cammina, panes inclusi. Tutte e tre sono verificate contro
`src/store/vocabulary.mjs`, non contro una copia dell'opinione di chi legge.

**Non provato: che il telefono renda la pagina.** La chiede — ripetutamente, da ultimo
`200 storePages type=003`, formato `storePage`, 29835 byte di un catalogo da diciassette app —
e poi non chiede nient'altro. Nessuna immagine, nessun dettaglio, nessuna seconda richiesta di
alcun tipo, mentre il log dice che il lab non ha trattenuto niente (`storeRouterStats.failed:
0`, nessuna connessione lasciata a metà dal dispositivo e nessun nome che non abbia risolto).
Portare il catalogo da tre app a diciassette ha quadruplicato la risposta senza cambiare altro:
è questo che rende la variabile rimasta la **forma** del documento, non il suo contenuto.

Che cosa il parser del telefono dice che la pagina deve essere, e che cosa la pagina è
adesso: è lì che sono finiti gli ultimi tentativi, ognuno un errore di **forma** che un
documento ben formato non può rivelare.

| Il parser nomina | La pagina era | Adesso |
|---|---|---|
| `/StorePage` come radice, `/Panes/Pane`, `/Templates/Template` | una radice `<a:feed>` — la forma del v8 `catalog/hubs` | `<StorePage>` con dentro `<Panes>`, `<Templates>` e il feed |
| `TEMPLATETYPE`, e da nessuna parte `templateName` / `mimeType` / `application/uix` | `<templateName>` e `<mimeType>application/uix</mimeType>`, copiati dall'archivio v8 | il tipo numerico, in entrambe le grafie che il parser potrebbe aspettarsi |
| un `TemplateType003` numerico negli asset UI | un template di **nome** `DynamicHub` | `003`, tenuto contro l'insieme che questo telefono stila |
| `Found %d Store Panes` prima di contare i template | nessun `<Panes>` | un pane per sezione |

L'altra metà era il controllo aggiornamenti nella stessa sequenza: `POST /v8/catalog/updates`
rispondeva `502` a ogni tentativo, e la cattura mostra il telefono che lo ritenta quattro
volte di fila mentre lo Store parte. Ora risponde `200`, dichiarando invariato ogni SKU che
il dispositivo nomina — l'unica risposta che non può essere sbagliata per un lab che non
serve nessun pacchetto.

Resta non ricavabile dal telefono la forma interna di `<Pane>` e degli altri figli di
`<StorePage>`. Il parser conserva i percorsi attraverso un contesto scorrevole
(`XmlPathContext::CommonPush` e `Pop`), quindi dice quali elementi cerca ma non come si
annidano. La risposta archiviata è l'unico secondo testimone, e una parte la decide: nella
pagina vera la `<a:entry>` della sezione porta `<editorialItems>` e `<applications>` **dentro
di sé**, e il GUID di collezione del pane *è* l'id di quella entry. Ogni pagina che questo lab
ha servito chiedeva al client di accettare un riferimento a contenuto che gli era già stato
mandato.

`pageFormat` ha quindi tre valori, e il terzo si aggiunge al secondo invece di sostituirlo:

| valore | il documento |
|---|---|
| `storePage` | radice `<StorePage>`: panes con un titolo e un riferimento alla loro sezione, gli item nel feed sotto |
| `panes` | lo stesso documento, ma ogni pane porta anche i suoi `<editorialItems>` e `<applications>` |
| `atom` | la vecchia radice `<a:feed>`, tenuta perché ogni pagina precedente era quella |

Ciò che si verifica su `panes` è che **aggiunga**: stessa radice, stesso blocco template, stesso
feed, stessi handle, ogni app nominata esattamente due volte dentro il suo pane e due volte nel
feed, e ogni voce di catalogo che arriva ancora sulla pagina. Una differenza sul dispositivo è
quindi attribuibile a dove stanno gli item, e a nient'altro.

#### Il flusso dell'account, reso visibile

Una richiesta verso un host che questo lab non possiede non viene catturata: viene messa in
tunnel, o su questa rete semplicemente esce. Perciò quello che il telefono fa lì è invisibile. Il
log DNS è l'unica traccia, ed è quello che ha messo sei nomi in `dns.hijack.names` e in
`proxy.mitm.hosts`, come diagnostica e non come nomi dello Store.

Cosa dice il log, e cosa l'intercettazione ha poi smentito. Dopo la terza richiesta di pagina con
`pageFormat: panes` il telefono ha chiesto lo stack account di Live — `login.live.com`,
`clientconfig.passport.net`, `go.microsoft.com`, `ocsp.digicert.com` — non avendone chiesto
**nessuno** nelle 173 risoluzioni precedenti. Sembrava il client che passa dalla pagina
all'accesso. L'apertura successiva, alle 15:48, con quei nomi già intercettati — quindi un
tentativo **sarebbe** stato catturato — non ne ha chiesto nessuno e non ha catturato niente: quel
gruppo non era l'accesso dell'hub, e una lettura come sincronizzazione periodica dell'account
regge. Quella stessa apertura ha però chiesto, nello stesso secondo della pagina e subito dopo,
`az717532.vo.msecnd.net` e poi `account.nokia.com`, con `ssl-api.bing.com` un minuto prima: un
sottodominio di CDN Azure, un servizio account Nokia e un host dell'API Bing, nessuno dei quali
questo lab possiede.

La lista porta quindi due gruppi, e il secondo è ciò che il telefono ha chiesto per ultimo: lo
stack Live, tenuto perché una occorrenza è pur sempre una occorrenza, e `account.nokia.com` /
`az717532.vo.msecnd.net` / `ssl-api.bing.com`. Il costo è scritto dove è configurato e ripetuto
qui: il traffico verso un nome in elenco **termina su questo lab e non può riuscire**, che è un
modo di fallire **nuovo**, in aggiunta a quello in indagine, e la CA deve essere attendibile sul
dispositivo per lo stesso motivo. Togliere le righe rimette ogni nome sul percorso vero.
`npm run rehearse` misura quattro cose per ogni nome in elenco — che risolva verso il lab, che
raggiunga il proxy, che il certificato sia emesso per quel nome, e che la richiesta venga
intercettata e catturata — quindi 44 con i nove nomi dello Store, 68 con i quindici di oggi.

Il verdetto si legge solo sul dispositivo, e solo chi lo tiene in mano può leggerlo:
`0x88675309` è un assert catch-all (`E_JENNY_JENNY_WHO_CAN_I_TURN_TO` scrive 867-5309, il
numero di telefono della canzone da cui prende il nome), quindi non nomina nessun guasto
specifico. Se il messaggio sullo schermo è **cambiato** è l'unica cosa che dice se la forma
del documento ora è giusta.

Per leggere il verdetto si va sul dispositivo: apri lo Store con il lab acceso e guarda cosa
chiede dopo — `npm run watch` mostra il traffico del device, e
`captures/session-*/index.jsonl` conserva sia la richiesta sia la pagina che gli è stata
servita.

Quello che **non** fa, detto chiaramente perché uno Store che si apre non è uno Store che
installa: serve le superfici di navigazione — home page, pagine hub, liste di applicazioni
e il dettaglio di un GUID che ha coniato lui. Immagini, licenze e download non sono serviti,
quindi un'applicazione toccata sul dispositivo arriva a una pagina di dettaglio e non oltre.

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
    handlers.mjs  store-health + store-images + store-live-client + catalog-bridge
    images.mjs    il CDN delle immagini, con un PNG segnaposto
    live-client.mjs  l'API JSON del client Live Store, forma e campi da F-029
    fixtures/     catalogo di esempio per lavorare offline
tools/
  selftest.mjs         95 verifiche end-to-end, incluse watch e canary
  watch.mjs            mostra solo il traffico che arriva dal dispositivo,
                       compresi i TCP accettati e gli handshake rifiutati
  canary.mjs           ascolta sulle porte che il lab NON serve e segnala se il
                       dispositivo prova lì (escludi `proxy.httpPort`, che il lab usa)
  doctor.mjs           stato completo in un comando: config, porte, CA, traffico del
                       dispositivo e prossimo passo (`npm run doctor`)
  analyze-captures.mjs report del protocollo: chi ha chiesto, quale dispositivo,
                       endpoint e suggerimenti di config (`--all-sessions` per il censimento)
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
