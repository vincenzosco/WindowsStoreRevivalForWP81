<p align="center">
  <img src="docs/store-logo.jpg" width="160" alt="Il logo dello Store: una borsa bianca con la bandiera di Windows, su fondo blu">
</p>

<h1 align="center">WP Store Lab</h1>

<p align="center">
  <strong>Lo Store di Windows Phone 8.1, intercettato e ricostruito su un PC.</strong><br>
  Il lab si prende i nomi host dello Store in DNS, decifra solo quel traffico e costruisce qui la
  home page, perché il backend Microsoft non risponde più dal 16/12/2019.
</p>

<p align="center">
  <a href="#avvio-rapido">Avvio rapido</a> ·
  <a href="#preparare-il-telefono">Preparare il telefono</a> ·
  <a href="#servire-lo-store">Servire lo Store</a> ·
  <a href="#problemi">Problemi</a> ·
  <a href="#comandi">Comandi</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-measured%20on%20Windows-0078D6" alt="Misurato su Windows">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node 20 o successivo">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Nessuna dipendenza">
</p>

Un laboratorio, non un prodotto. Gira su un PC accanto al telefono: DNS sulla 53, proxy sulla 8899,
HTTP semplice sulla 80, TLS sulla 443. Quello che il telefono manda a un host che il lab non
possiede passa intatto, quindi il resto della rete continua a funzionare. Nessun account, nessun
server, nessun cloud: i moduli builtin di Node e l'`openssl` già sul sistema sono l'unica
dipendenza.

Fa tre cose, e nient'altro:

1. **DNS**: risponde normalmente a tutto, tranne ai nomi che gli indichi tu, che risolve verso
   questo PC.
2. **Proxy**: tunnel trasparente per default. Decifra TLS **solo** per gli host che gli indichi. Il
   resto del traffico del telefono esce com'era.
3. **Patch**: sulle richieste intercettate applica regole (passthrough, mock, rewrite, redirect,
   block). Ogni cosa finisce su disco.

## Stato attuale

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
| Self-test end-to-end (meccanismi, su 127.0.0.1) | ✅ **190/190** |
| Prova di schieramento sui nomi host reali dello Store | ✅ **44/44** |
| Vocabolario dello Store letto dal telefono, e riverificabile | ✅ **19/19** (`npm run read-vocabulary`) |
| Cattura reale dallo Store del Lumia (RM-941) | ✅ la pagina viene chiesta, ed è etichettata (`storePages`, `type=003`) |
| Il telefono **rende** la pagina | ⏳ disegna la testata (è il `<a:title>` del nostro feed, ora `Windows Store`) ma non i pane sotto: F-065 → F-068 |
| Mappatura del protocollo Store vero | ⏳ in corso (la pagina generata è la variabile in prova) |

`npm run selftest` → `node tools/selftest.mjs`, e non serve il telefono.

## Avvio rapido

```bash
npm start          # oppure doppio clic su start.cmd
```

Se una porta è occupata il server **non parte**. Ti dice chi la tiene e come liberarla. Su questo
PC succede già: vedi [Porta 53](#porta-53).

Apri la dashboard: <http://127.0.0.1:8899/__lab/>

Un comando solo, quando qualcosa non torna:

```bash
npm run doctor     # lab attivo, CA, porte, traffico del device, prossimo passo
```

> Dopo **qualsiasi modifica sotto `src/`** ferma e riavvia il lab con `tools\restart-lab.cmd`.
> `POST /__lab/reload` rilegge solo `config.json`, quindi una modifica al codice resta invisibile
> finché il processo non viene sostituito. Vedi
> [Il lab sta girando con il codice vecchio](#il-lab-sta-girando-con-il-codice-vecchio).

## Preparare il telefono

Servono tre cose, in questo ordine: il telefono deve risolvere i nomi verso questo PC, questo PC
deve ascoltare sulle porte giuste, e il telefono deve fidarsi della CA del lab.

### Porta 53

Il telefono deve usare questo PC come DNS, e il DNS sta per forza sulla **53**. Su Windows quel
wildcard è spesso già occupato da *Internet Connection Sharing* (`svchost` su `0.0.0.0:53`).

Non serve fermare quel servizio. Il lab prova prima il bind sull'indirizzo LAN e solo dopo sul
wildcard, quindi parte comunque, e lo scrive nel log:

```
DNS listening on 192.168.0.220:53 (udp)
  (skipped 0.0.0.0:53 - already in use)
```

Vedi `dns.bind` in `config.json` per forzare un indirizzo specifico. Se davvero vuoi liberare il
wildcard: `sc stop SharedAccess` (o disattiva "Hotspot mobile"); è reversibile con `sc start
SharedAccess`.

### Come far usare il lab al telefono

**Se il telefono non ti fa toccare il DNS, cambia il DNS sul router.** Metti il DNS di
`192.168.0.1` a `192.168.0.220` (o l'opzione DHCP che lo annuncia) e tutti i dispositivi della rete,
telefono compreso, passano dal lab senza configurare niente sul telefono. Il lab inoltra ogni nome
tranne i pochi dello Store, quindi il resto della rete non se ne accorge.

Con questa strada non serve nemmeno il proxy. Il telefono risolve un nome dirottato verso questo PC
e si connette diretto alla **443** (e alla **80**, vedi sotto), dove il lab ha un listener TLS
dedicato (`proxy.tlsEnabled`). `npm run rehearse` prova anche questo percorso.

Se invece puoi configurare il telefono, su WP8.1: **Impostazioni → Wi-Fi → tieni premuto sulla rete
→ modifica → IP statico** (il campo DNS compare solo dopo aver attivato l'IP statico).

| Campo | Valore |
|---|---|
| Indirizzo IP | un indirizzo libero, es. `192.168.0.250` |
| Subnet mask | `255.255.255.0` |
| Gateway | il tuo router (`192.168.0.1`) |
| **DNS** | `192.168.0.220` ← questo PC |
| **Proxy** | `192.168.0.220:8899` |

Il gateway e il DNS restano quelli del router per tutto il resto: il PC inoltra normalmente ogni
nome che non è in lista di hijack.

> [!WARNING]
> Non impostare il *PC* come proprio DNS, o il proxy inoltrerebbe verso sé stesso. Il caso è
> riconoscibile, ed è
> [descritto sotto](#quando-il-lab-sembra-occupato-ma-sta-solo-parlando-con-sé-stesso).

### Certificato root sul telefono

Lo Store parla in HTTPS, quindi serve che il telefono si fidi della CA del lab. La CA viene creata
al primo avvio in `ca/`.

```bash
npm run make-rootreg     # genera ca/install-root-ca.reg
npm run verify-rootreg   # dimostra che il blob coincide con quello di Windows
```

Il file `.reg` contiene:

```
HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates\<SHA1>
  "Blob" = <certificato>
```

Thumbprint SHA-1 della CA corrente:

```
2DE30E6BB059296AB07F5754511D97E16ED81D8D
```

La conferma sul device arriva da sé: finché la CA non viene letta, `npm run watch` mostra gli
handshake **rifiutati** (`tls`); dopo il riavvio le stesse connessioni diventano richieste
intercettate in `captures/`.

Il blob è stato ricostruito e **verificato**: `npm run verify-rootreg` importa la CA in uno store
usa-e-getta con `certutil`, rilegge il blob che scrive Windows e lo confronta col nostro. Se non
fossero identici fallirebbe.

Due strade per metterlo sul telefono, e solo una è misurata end to end:

- **Modalità memoria di massa**: il filesystem del telefono è montato come drive e l'hive viene
  modificato qui. Non serve sbloccare il telefono, e non serve nemmeno avviarlo. È la strada
  misurata: [`README.md`, sezione "Mass storage mode"](README.md#mass-storage-mode).
- **Console del telefono**: `ca/install-root-ca.reg` importato da CMD Injector. Il `.reg` è scritto
  per quella console, ma nessuna misura dice che ci arrivi: vedi
  [Il lato telefono](#il-lato-telefono).
- **WPinternals** (*Full Filesystem Access*): è la strada che questo documento indicava prima, per
  montare il registro e importare il `.reg`. Nessuna misura qui la conferma, e il `.reg` generato è
  nella forma che si aspetta la console del telefono, non necessariamente quella di un import sul
  PC: sulla strada misurata l'entry si scrive con `reg add`.

## Catturare

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

`npm run watch` filtra gli indirizzi di questo PC e distingue **tre** situazioni, perché "non vedo
nulla" da solo non basta:

| Quello che vedi | Cosa significa davvero |
| --- | --- |
| righe `dns` con `[HIJACK]` | il telefono usa il DNS del lab: è puntato qui |
| righe `http` | il telefono è intercettato: le richieste finiscono in `captures/` |
| righe `connect` | il telefono usa il **proxy esplicito**: `CONNECT <host>:<port> -> mitm\|tunnel` |
| righe `tcp` | il telefono ha aperto il TCP sulla **443** (sarà intercettato o rifiutato) |
| righe `tls` | ha raggiunto il lab ma l'handshake è stato **rifiutato**: manca la CA root sul telefono |
| niente | il telefono punta ancora al router, oppure risolve il nome ma non si connette |

Il caso `tls` è quello che prima non si vedeva. Un telefono senza CA root si connette senza
problemi, viene rifiutato all'handshake e **non produce nessuna cattura**, quindi `watch` sembrava
fermo mentre il telefono stava parlando con il lab.

Le righe `connect` sono l'unica prova che ottieni **prima** di installare la CA. Un host fuori da
`mitm.hosts` viene tunellato byte per byte e non decifrato, ma il nome e la porta restano nel log.
È la mappa degli endpoint che il dispositivo contatta, e serve proprio quando la CA non c'è ancora.

### Quando il telefono risolve il nome ma non compare da nessuna parte

Un dispositivo può risolvere un nome dirottato e comunque non apparire mai nel proxy, perché si
connette a una porta che **nessuno ascolta**: Windows risponde con un RST, il client riprova, e
l'unica traccia resta un'altra query DNS. In quel caso il lab sembra inerte mentre il dispositivo
sta provando.

```bash
npm run canary                        # 8080, 8000, 8443, 9443
npm run canary -- --ports 443,8081 --seconds 600
```

La 80 non è fra i default perché la serve il lab (`proxy.httpPort`): qui si tengono d'appoggio le
porte che il lab **non** serve.

Le connessioni da questo PC sono etichettate `self` e non contate come dispositivo. È utile anche
l'opposto: se il canary resta muto mentre il telefono è attivo, la porta è esclusa e l'ipotesi passa
a un **IP di CDN in cache o cablato**, che il dirottamento DNS da solo non intercetta.

> Attenzione al controllo: se il telefono è in standby non emette traffico di fondo. Un canary muto
> su una finestra senza query del telefono non è una prova - verifica prima che il device abbia
> parlato (`npm run watch`).

### Quando il lab sembra occupato ma sta solo parlando con sé stesso

Se anche il **PC** ha il lab fra i suoi server DNS (`192.168.0.220` su una scheda), un nome
dirottato si risolve - *su questo PC* - nell'indirizzo del lab: il rilancio verso l'upstream
richiama il lab, ogni hop aspetta quello sotto, e nessuno risponde mai. Il registro si riempie di
richieste che portano gli header del telefono ma arrivano dall'indirizzo del **PC**: è la traccia più
ingannevole di tutte, perché il telefono non c'entra e i contatori salgono come se fosse lui.

Riconoscerlo:

```bash
node -e "require('dns').lookup('cdn.marketplaceedgeservice.windowsphone.com',(e,a)=>console.log(a))"
# 192.168.0.220  ->  è il lab, non un CDN: questo PC si sta rimbalzando la richiesta
```

La richiesta viene ora **rifiutata subito** (`error: upstream_loop`, contatore `upstreamLoops`)
invece di restare appesa per tutto l'upstream timeout. Il rimedio è togliere il lab dai DNS del PC -
il telefono continua a usarlo - oppure rispondere a quel nome con una regola `mock`.

### Prova di schieramento: `npm run rehearse`

Ripete per ogni nome hijackato esattamente quello che farà il telefono: risolve contro il DNS del
lab, apre il TCP, fa il CONNECT, negozia TLS con quel nome come SNI fidandosi **solo** della CA del
lab, e legge la risposta.

La richiesta di pagina dello Store viene ripetuta **due volte**: come sopra, e di nuovo in HTTP
semplice sulla porta 80 con l'header `user-agent: ZDM/4.0; Windows Mobile 8.1` e nessun `Accept`,
che è il modo in cui la cattura mostra che il telefono la fa davvero. Ripeterla solo in TLS
lascerebbe non provato proprio il listener su cui il dispositivo parla.

Sulla pagina servita controlla anche le tre cose che rendono una pagina inutilizzabile pur essendo
ben formata: che il tipo di pagina sia uno che il client nomina, che il tipo di template sia uno che
il telefono stila, e che il blocco panes ci sia.

Un `502` sulla richiesta è un **pass**: significa che il backend Microsoft non risponde più - ed è
precisamente l'elenco degli endpoint da emulare. Deve invece riuscire l'intercettazione: hijack DNS,
raggiungibilità, validità del certificato, cattura.

Sui nomi reali configurati il risultato è che i backend **non risolvono nemmeno più**: `getaddrinfo
ENOTFOUND wscont1.apps.microsoft.com`. Non sono solo spenti, sono stati rimossi dal DNS.

La controprova che il resto del traffico è intatto: un host non hijackato mantiene il **suo
certificato autentico** (`en.wikipedia`, issuer pubblico), perché il tunnel è byte-per-byte e non
viene decifrato.

### Cosa dice `npm run analyze`

Produce `captures/<session>/report.md` con:

- **chi ha chiesto**: una riga per indirizzo client, con l'indirizzo di questo PC marcato.
  `client.address` è l'unico campo che separa il dispositivo da questo PC: **lo user-agent no**,
  perché `npm run rehearse` rimanda la richiesta con l'agent del telefono (`ZDM/4.0; Windows Mobile
  8.1`);
- **quale dispositivo**: le stesse righe raggruppate per `x-wp-device-id`, che è ciò che unisce due
  indirizzi dello stesso telefono e separa due telefoni diversi. Il log DNS non ha identità, quindi
  ogni nome è riportato per indirizzo e mai aggregato;
- ogni endpoint distinto (`metodo host path`, con id normalizzati), stato, content-type, decisione
  presa e **quali client** l'hanno raggiunto;
- **gli host che il telefono ha risolto ma che non sono ancora hijackati** → è la lista da copiare
  in `config.json`;
- **gli endpoint che falliscono** → è la lista di quello che va emulato.

### Iterazione

Le regole si aggiornano **senza riavviare**. Modifica `config.json`, poi lancia `POST
/__lab/reload`. La connessione del telefono non cade. Il codice no: quello vuole
`tools\restart-lab.cmd`.

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

- `dns.hijack.names` viene **sempre** unito a `proxy.mitm.hosts`: un nome dirottato ma non
  intercettato sarebbe un buco nero silenzioso.
- `proxy.mitm.mode: "all"` decifra ogni CONNECT - utile per una cattura ampia, rischioso come stato
  normale.
- `upstream.insecure: true` disattiva la verifica TLS verso il backend reale.
- Ogni valore sperimentale ha il suo `_comment_` accanto, con la data in cui è stato armato, cosa
  misura e come si disarma. È il motivo per cui il file è più lungo di così.

## Regole

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

Operazioni di rewrite: `json.set` (path `a.b[0].c`), `json.delete`, `regex.sub`. Se il body è
compresso viene decompresso prima e rispedito in chiaro.

## Dashboard e API admin

| Endpoint | Cosa fa |
|---|---|
| `GET /__lab/` | dashboard live, si aggiorna ogni 3 s, con reload e filtro |
| `GET /__lab/status` | stato completo: config attiva, statistiche, CA |
| `GET /__lab/images` | conteggio delle immagini servite dal CDN (per `imagetype`, guids distinti, ultima richiesta): è un conteggio di risposte, non di cosa ha disegnato il telefono, e non dipende dalla cattura |
| `GET /__lab/ca.crt` | scarica la CA in PEM |
| `GET /__lab/captures?limit=N` | ultime N richieste intercettate |
| `POST /__lab/reload` | rilegge `config.json` senza riavviare |

Risponde solo su indirizzi locali.

## Handler dello Store (`src/store/`)

Questo è il punto di estensione per cui esiste tutto il lab. Il proxy consulta il router **prima**
delle regole di config: un handler implementa il protocollo in codice, e quello che non matcha
ricade sul passthrough.

```js
{
  name: 'nome-handler',
  match: (ctx) => boolean,               // riceve il contesto della richiesta intercettata
  handle: async (ctx, deps) => ({ status, headers, body }) | null  // null = "non è mio, prova il prossimo"
}
```

Se un handler lancia un'eccezione, il router lo registra e **ricade sul passthrough**: un bug in un
handler non rompe il telefono.

| Handler | Cosa fa | Attivo di default? |
|---|---|---|
| `store-health` | Risponde su `<host intercettato>/__store/health` con un JSON che prova che la richiesta è arrivata al lab e la risposta è tornata indietro, senza toccare alcun backend | sì |
| `store-protocol` | Risponde agli endpoint che il telefono chiama **davvero** per aprire lo Store (`/v9/catalog/storePages`, `/v8/catalog/hubs`, `/v[89]/catalog/apps`, `/v8/catalog/updates` e - dal 2026-10-17 - `/v8/Configuration/Stores/...`), nel formato XML che sa leggere | no, va abilitato |
| `store-images` | Risponde al CDN delle immagini (`cdn.marketplaceimages.../v8/images/<guid>`) con un PNG segnaposto **con un segno visibile** (cornice e croce diagonale): un campo piatto non distingue «il client ha disegnato i nostri byte» da «ha disegnato il proprio sfondo vuoto», ed è la prima versione di questo handler a dirlo; prima erano 502 iniettati dal lab, 420 in due minuti e mezzo su una sola ricerca (F-031) | no, va abilitato |
| `store-provisioning` | Risponde alla richiesta di certificato del dispositivo (`POST /dcs/certificaterequest` e `/certificaterequest`): `application/pkcs10`, i tre header `X-Windows-Phone-*`, body **base64** dentro e catena PKCS#7 **base64** fuori come `application/c-x509-ca-cert`, firmata dalla CA del lab. Il contratto è la lettura WP7 di un altro progetto di reverse engineering (ReLiveWP), **non** una misura di questo telefono: ogni risposta porta `x-lab-invented: 1` e ogni rifiuto il proprio motivo in `x-lab-refused` (F-034). Firma solo con profilo fisso - `CA:FALSE`, `clientAuth`, nessun SAN copiato dalla richiesta | no, va abilitato |
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

Ogni risposta porta l'header `x-lab-source` con la sorgente che ha risposto. Con `source: "zinc"` e
nessuna API key la risposta è `502` con `error: NO_API_KEY` - è il percorso di errore verificato nel
self-test.

> Gli handler leggono l'oggetto `config` condiviso, quindi modificare `livestore.bridge` e fare
> `POST /__lab/reload` ha effetto immediato. Il self-test lo verifica cambiando sorgente a metà
> corsa.

## Servire lo Store

Il bridge risponde nel formato del catalogo **Live Store**; `store-protocol` risponde nel formato
dello **Store Microsoft**, ed è quello che serve al telefono per aprire lo Store. La differenza non
è stilistica: sono due grammatiche diverse per due client diversi.

Quello che il telefono chiede aprendo lo Store, parola per parola dalla cattura del Lumia:

```
GET  http://marketplaceedgeservice.windowsphone.com/v8/Configuration/Stores/OEMStores/NOKIA
         ?mpcVersion=8.10&os=8.10.14219.0&...          (e una chiamata equivalente su /MOStores/)
GET  http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages
         ?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT&hw=402699266&dm=RM-941_eu_france_308&...
POST http://marketplaceedgeservice.windowsphone.com/v8/catalog/updates?os=8.10.14219.0&...
```

Tutte e tre sono servite da `src/store/protocol.mjs`. La pagina è costruita nell'XML che il telefono
legge; il controllo aggiornamenti riporta ogni SKU come invariato, perché qui non viene servito
nessun pacchetto; le due chiamate di configurazione - che arrivano **prima**, e che il lab
rispondeva `502 upstream_loop` perché nessuna rotta le intercettava - ricevono un documento
`ConfigurationFile` nella grammatica del client stesso (`Domains`/`Domain`/`setting`), letta da un
FFU e scritta con le impostazioni che la tabella degli endpoint del client sostituisce. Di
quell'endpoint non esiste nessuna cattura, né nell'archivio né sul telefono: sono i *valori* a
essere una risposta e non una ricostruzione, e il documento lo dichiara nei propri header
(`x-lab-invented: 1`). Cosa resta aperto, e i due esperimenti che lo nominano, sono in
[`docs/FINDINGS.md`](docs/FINDINGS.md) sotto E-008, E-009 e F-024.

### Perché va servita e non inoltrata

L'abbiamo misurato, non dato per buono. Interrogando gli host veri da questo PC con un resolver
pubblico, così il dirottamento del lab non può rispondere al posto loro:

| Nome | Esito |
|---|---|
| `marketplaceedgeservice.windowsphone.com` | NXDOMAIN |
| `catalog.zune.net` | NXDOMAIN |
| `wscont1.apps.microsoft.com` | NXDOMAIN |
| `cdn.marketplaceedgeservice.windowsphone.com` | risolve (CNAME → `…edgesuite.net` → Akamai), ma l'edge risponde `503 Service Unavailable - DNS failure` |

Cioè: la porta d'ingresso del CDN è ancora in piedi, la sua origine non esiste più. Il `502` con
cui finiva ogni richiesta dello Store non era quindi risolvibile inoltrandola meglio: la pagina va
**prodotta** qui.

### Da dove viene il formato

Non è inventato. `src/store/catalog-feed.mjs` lo costruisce da risposte reali del servizio
conservate dalla Wayback Machine - tre generazioni della stessa grammatica - e ogni elemento in quel
file cita la cattura da cui proviene:

| Cattura archiviata | Cosa stabilisce |
|---|---|
| `/v3.2/en-US/clientTypes/WinMobile 7.1/hubTypes/marketplace/hub` | la home del marketplace: `<templateName>MarketplaceHub</templateName>`, una voce con `<editorialItems>` e `<features>` |
| `/v8/catalog/hubs?…&hub=games` | una pagina hub di WP8: `<templateName>GamesHub</templateName>`, `<editorialItems>` e le `<applications>` a cui puntano |
| `/v8/catalog/apps?…`, `/v9/catalog/apps?…` | una lista di applicazioni WP8/WP8.1: un `<a:entry>` per app |

Sono tutte feed Atom nel namespace `http://schemas.zune.net/catalog/apps/2008/02`, con un blocco
`<templates>` che nomina il modello UI con cui la pagina viene resa. È questo che rende possibile la
cosa: `storePages?typeId=DynamicHub.Main` è la stessa forma una generazione dopo.

Gli archivi descrivono la grammatica **v3.2 e v8**. La pagina che questo telefono chiede è
`/v9/catalog/storePages`, e per quella grammatica la fonte non è un archivio: è il dispositivo
stesso.

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

> Il `config.json` del repo adesso porta `"hubTemplate": "DynamicChart"`, armato come spike. La
> pagina porta più di un nome candidato per la testata - questo nome di template, il `<a:title>` del
> feed, il `typeId` richiesto - e cambiare solo questo valore li separa: se la testata legge
> "Dynamic Chart" l'etichetta viene dal template, se legge ancora "Dynamic Hub" non è il template a
> essere disegnato. `DynamicHub` è il valore base, e ripristinarlo è quella riga più
> `POST /__lab/reload`.

`catalogFile` viene riletto quando cambia: iterare su quello che il telefono mostra non richiede un
riavvio.

I cataloghi che il progetto porta sono due, entrambi dati inventati, con ogni editore che dice
`Lab Fixture`, così nessun listino può passare per reale:

- `src/store/fixtures/demo-catalog.json` - diciassette app su tutte e otto le categorie dichiarate,
  ed è il default: una pagina con una voce per sezione non si distingue da una pagina che non
  disegna niente;
- `src/store/fixtures/sample-catalog.json` - il fixture da tre voci che i test tengono come base di
  regressione. Passare a quello è quella riga lì.

Entrambi sono il *ripiego*. Lo Store che questo telefono apre è quello di sistema, quindi il
catalogo che deve mostrare è quello del Live Store, non uno store finto di app inventate: è questo
che decide `livestore.protocol.source`.

```jsonc
"livestore": {
  "protocol": {
    "source": "zinc",                 // "zinc" = catalogo reale, "file" = catalogFile
    "zinc": { "terms": ["store", "windows", "phone", "live"], "perCategory": 25 }
  }
}
```

La chiave sta fuori da `config.json`: quel file è tracciato da git, quindi una chiave scritta lì
finisce nella storia del repository alla prima commit. Si legge da due posti, in quest'ordine:
`ZINC_API_KEY` dall'ambiente, e un file `.zinc-key` (ignorato da git) accanto a `config.json` con la
chiave sulla prima riga. Il file serve quando il lab viene riavviato da `tools\restart-lab.cmd`:
quel rilancio è elevato e parte da una finestra senza il tuo ambiente, quindi una variabile
esportata non arriva al processo con cui parla il telefono. `livestore.apiKey` funziona ancora come
ultima scelta, ed è quella da evitare.

Zinc non ha un endpoint che elenchi tutte le app - nomina le sue categorie e rifiuta una query più
corta di cinque caratteri - quindi il catalogo viene **assemblato**: a ogni categoria si chiedono
pochi termini generici e le risposte si uniscono per id (`src/store/catalog-source.mjs`). Contro il
servizio reale sono sedici categorie e 203 app in circa quattro secondi, fatti una volta all'avvio
così la prima richiesta di pagina del telefono non li aspetta. Un guasto del Live Store non lascia
mai lo Store muto: viene servito il file di catalogo e `x-lab-source` sulla risposta dice quale dei
due ha risposto e perché - `src/store/fixtures/demo-catalog.json (zinc: no api key)` - così un
capture si legge sempre come il braccio da cui viene.

`npm run store:page` costruisce la pagina offline e stampa cosa c'è dentro, sezione per sezione, con
prezzo e valutazione di ogni app. È la risposta a «cosa riceverebbe il dispositivo», e si legge anche
a lab spento e mentre il telefono non mostra altro che un codice di assert.

`npm run page:diff` chiede la domanda più difficile: non *cosa* c'è nella pagina, ma se la pagina
porta i costrutti che il parser del client nomina. Prende il documento dal router vero, lo percorre
e riporta ogni path del parser (`ZMarketplace.dll`) come scritto esattamente, portato sotto un
prefisso di namespace che la stringa del parser non ha, oppure assente - poi fa lo stesso per la
mappa dei campi del primo pane e per la risposta archiviata del vero servizio. `assente` è l'unico
stato che sulle prove è un difetto, e oggi non ce ne sono: tutti i 22 path richiesti sono portati, 12
dei quali sotto il prefisso atom che usava anche il vero servizio (F-032).

Un'installazione è un'altra conversazione, e non è mai stata catturata: il pulsante non si raggiunge
finché la pagina non si disegna, e i passaggi di licenza, pacchetto e installazione non sono
misurati. `npm run trace:install` serve alla prima domanda - cosa chiede il tentativo. Stampa gli
scambi del dispositivo in ordine, ogni nome risolto e, separatamente, i nomi risolti che **il lab
non ha mai risposto**: quelli sono andati sulla rete vera, ed è lì che comparirebbe un host di
licenza o di account (non sono hijackati di proposito). Leggi quella lista prima di decidere cosa
intercettare: un host che il lab risponde senza conoscerne la grammatica è un guasto nuovo, non una
correzione.

La prossima variabile singola è già scritta ed è spenta: `livestore.protocol.paneBackgroundImage`
mette `<BackgroundImage><id>urn:uuid:…</id></BackgroundImage>` in ogni pane - l'unico path della
mappa del pane che un tile disegnerebbe, e il CDN delle immagini risponde a qualunque guid gli si
passi. Accenderla sono due passi (`true` in `config.json`, poi `POST /__lab/reload`) e cambia una
cosa sola: il pane. L'header `x-lab-pane-background: guid|none` sulla risposta della pagina dice a
quale braccio appartiene una consegna.

### Il vocabolario, letto dal telefono

Una pagina può essere perfettamente ben formata e nominare comunque un layout che il dispositivo non
ha mai sentito. Quel rifiuto è indistinguibile da una pagina sbagliata, ed è esattamente quello che
hanno incontrato i primi tentativi. Quindi i nomi con cui la pagina è costruita sono stati presi dal
telefono invece che indovinati:

```
npm run read-vocabulary        # rilegge il dispositivo montato, e fallisce su ogni deriva
```

Rispondono due binari del telefono, e devono essere d'accordo - uno analizza una pagina dello Store,
l'altro la disegna:

| Binario | Cosa stabilisce |
|---|---|
| `H:\Windows\System32\ZMarketplace.dll` | i percorsi strutturali che cammina (`/Panes/Pane`, `/Templates/Template`, `/feed/entry`, `/feed/link`), la chiave del tipo di template `TEMPLATETYPE`, i tipi di pagina che chiede (`DynamicHub`, `DynamicChart`, `Collection`), i tipi di link di contenuto (`Application`, `ApplicationCollection`) |
| `H:\Windows\System32\ZuneAssets480x800.dll` | quali tipi di template sono **stilabili su questo schermo 480×800**: `Store_Hub_TemplateType003`, `004`, `015`, `017` e `Store_Chart_TemplateType010`. E `Store_DynamicHubStyle_*`, lo stile con cui è disegnata la pagina stessa |

Tre scoperte hanno cambiato la pagina, e una è una correzione, non una rifinitura:

- **Il tipo di template è un numero.** La pagina chiedeva un layout di nome `DynamicHub` dove il
  telefono stila `Store_Hub_TemplateType003`. `003` è la lista ordinata semplice, che è quello che
  una sezione generata è; `017` è il layout ricco, con pannello del prezzo, motivo del suggerimento
  e un pulsante per elemento, e chiederebbe al telefono di stilare elementi che la pagina non porta.
- **La pagina non aveva panes.** Il parser conta i panes *prima* dei template (`Found %d Store
  Panes`), e ogni pagina che questo lab aveva servito portava un blocco template e **nessun**
  `<Panes>`: un template senza niente da rendere.
- **`GamesHub` è il nome sbagliato, e non è mai stato quello giusto.** Compare in
  `ZMarketplace.dll` dentro una serie di chiavi di **impostazioni** persistite
  (`MarketplaceSettings`, `AutoUpdateOn`, `TileCount`, …), e i suoi unici proprietari veri sul
  telefono sono `GamesShared.dll`, `ZMF_Client.dll` e `ZMF_Service.dll` - l'app hub dei Giochi Xbox.
  La pagina archiviata che lo porta è la pagina `hub=games` di un'altra generazione. Servirla a una
  richiesta `storePages?typeId=DynamicHub.Main` non è mai stato un esperimento a una variabile sola.

Una domanda che il telefono non può sciogliere sta in un posto solo invece che sparsa nei
costruttori: se la chiave del tipo viaggi come attributo di `<Template>` o come elemento figlio. Il
parser tiene `TEMPLATETYPE` come nome di proprietà, non come markup. `templateTypeForm` la
restringe a `attribute`, `element` o `both`; il default è `both`, così qualunque delle due letture
trova il valore.

### Le maniglie che il dispositivo può restituire

Ogni voce è servita sotto un GUID derivato dal suo id di catalogo (UUID v5 su un namespace fisso del
lab): la stessa voce ha lo stesso GUID a ogni esecuzione, ed è questo che permette di ricondurre la
richiesta successiva del dispositivo alla voce giusta **senza conservare stato**. Una richiesta per
un GUID che il lab non ha mai coniato viene rifiutata con `404 app_not_found`, non inoltrata.

### La controprova, e perché non è una variabile sola

La prima volta che lo Store del Lumia è stato aperto contro questo lab, ha chiesto la home page, ha
ricevuto un `200` con la pagina generata, e ha risposto con l'errore `0x88675309`: un assert interno
di Windows Phone (`E_JENNY_JENNY_WHO_CAN_I_TURN_TO`, "questo non dovrebbe mai accadere") invece di
una diagnosi. Dopo di che non ha chiesto **più nulla**, quindi la pagina è stata rifiutata mentre
veniva letta.

```jsonc
"livestore": { "protocol": { "serve": "archive" } }   // default: "generated"
```

Con `serve: "archive"` gli endpoint di pagina rispondono con
`src/store/fixtures/archive/real-hub-page-20130813.xml`: una risposta del servizio reale, scaricata
byte per byte dall'archivio.

Quell'esperimento è stato costruito come sostituzione a una variabile e **non lo è**, e la lettura
del vocabolario l'ha reso evidente dopo. La risposta archiviata è la pagina `hub=games` di un'altra
generazione: sostituirla cambia tre cose insieme - il tipo di pagina (l'hub dei giochi, non l'hub
dello Store che questa richiesta nomina), la grammatica (`<templateName>` dentro un blocco
`<templates>`, dove il client v9 cammina `/Templates/Template` e legge `TEMPLATETYPE`) e il
proprietario del template (`GamesHub` appartiene all'app hub dei Giochi, non allo Store). Un rifiuto
non incrimina nessuna delle tre separatamente.

La risposta dice tutto questo nei suoi header invece di lasciarlo in un commento, perché una cattura
non conserva i commenti:

```
x-lab-protocol:        storePages:archive
x-lab-archive-template: GamesHub
x-lab-archive-page:     games-PK-WindowsPhone80-ALL-ALL
x-lab-archive-warning:  archived response of a different page and grammar generation:
                        not a one-variable substitution for the requested page
```

`npm run rehearse` fallisce se una pagina archiviata viene servita senza quegli header, e stampa
l'equivoco invece di darlo per assodato.

### Cosa è provato e cosa no

Provato su questa macchina (`npm run selftest`, 190 controlli, e `npm run rehearse`: 44 con i nove
nomi dello Store, più quattro per ogni nome aggiunto alla lista di dirottamento - 68 con i quindici
di oggi): il feed è ben formato; una voce di catalogo ostile (un `&` grezzo, un `<`, virgolette, un
carattere di controllo) non può romperlo; ogni voce di catalogo arriva sulla pagina; lo store finto
che gira davvero è verificato non avere due voci che producono lo stesso GUID, nessuna voce in una
categoria che nessuno ha dichiarato, nessuna categoria dichiarata e vuota, e tutte le sue app sulla
pagina esattamente una volta - una volta come il link che la indica e una volta come il record che
la descrive; un GUID torna alla sua voce e uno sconosciuto viene rifiutato; gli endpoint rispondono
attraverso il proxy **vero** sul path e sulla query esatti che usa il telefono, **sul trasporto che
il telefono usa** (HTTP semplice sulla porta 80, `ZDM/4.0; Windows Mobile 8.1`, nessun header
`Accept`), e la cattura del lab li registra; l'handler è spento finché non lo si abilita, e in quel
caso ricade sul passthrough.

Provato sul vocabolario (`npm run read-vocabulary`, 19 controlli): ogni tipo di pagina, tipo di
template, percorso strutturale e tipo di link che il modulo dichiara è ancora presente nel telefono,
all'offset che il modulo cita. Una deriva fa fallire il comando.

Provato sulla pagina: nomina un tipo di template che il telefono stila, il suo nome di template
appartiene al client dello Store e non a un'altra app, e porta **ogni** percorso strutturale che il
parser cammina, panes inclusi. Tutte e tre sono verificate contro `src/store/vocabulary.mjs`, non
contro una copia dell'opinione di chi legge.

**Non provato: che il telefono renda la pagina.** La chiede - ripetutamente, da ultimo `200
storePages type=003`, formato `storePage`, 29835 byte di un catalogo da diciassette app - e poi non
chiede nient'altro. Nessuna immagine, nessun dettaglio, nessuna seconda richiesta di alcun tipo,
mentre il log dice che il lab non ha trattenuto niente (`storeRouterStats.failed: 0`, nessuna
connessione lasciata a metà dal dispositivo e nessun nome che non abbia risolto). Portare il
catalogo da tre app a diciassette ha quadruplicato la risposta senza cambiare altro: è questo che
rende la variabile rimasta la **forma** del documento, non il suo contenuto.

Che cosa il parser del telefono dice che la pagina deve essere, e che cosa la pagina è: è lì che sono
finiti gli ultimi tentativi, ognuno un errore di **forma** che un documento ben formato non può
rivelare. Una riga di questa tabella è stata sbagliata per cinque sere, e il dispositivo l'ha
sciolta: il parser nomina `/StorePage`, ma una pagina con quella radice non ha mai disegnato, e lo
stesso documento con radice `<a:feed>` disegna (**F-065**). I path del parser descrivono cosa sa
leggere di un documento che ha **accettato**. Non dicono quale radice accetta.

| Il parser nomina | La pagina era | Adesso |
|---|---|---|
| `/StorePage` come radice, `/Panes/Pane`, `/Templates/Template` | una radice `<a:feed>`, poi `<StorePage>` per cinque sere | **`<a:feed>` alla radice** - la forma dell'archivio e l'unica che il telefono disegna. `<Panes>` e `<Templates>` viaggiano dentro |
| `TEMPLATETYPE`, e da nessuna parte `templateName` / `mimeType` / `application/uix` | `<templateName>` e `<mimeType>application/uix</mimeType>`, copiati dall'archivio v8 | il tipo numerico, in entrambe le grafie che il parser potrebbe aspettarsi |
| un `TemplateType003` numerico negli asset UI | un template di **nome** `DynamicHub` | `003`, tenuto contro l'insieme che questo telefono stila |
| `Found %d Store Panes` prima di contare i template | nessun `<Panes>` | un pane per sezione |

L'altra metà era il controllo aggiornamenti nella stessa sequenza: `POST /v8/catalog/updates`
rispondeva `502` a ogni tentativo, e la cattura mostra il telefono che lo ritenta quattro volte di
fila mentre lo Store parte. Ora risponde `200`, dichiarando invariato ogni SKU che il dispositivo
nomina - l'unica risposta che non può essere sbagliata per un lab che non serve nessun pacchetto.

Resta non ricavabile dal telefono la forma interna di `<Pane>` e degli altri figli di `<StorePage>`.
Il parser conserva i percorsi attraverso un contesto scorrevole (`XmlPathContext::CommonPush` e
`Pop`), quindi dice quali elementi cerca ma non come si annidano. La risposta archiviata è l'unico
secondo testimone, e una parte la decide: nella pagina vera la `<a:entry>` della sezione porta
`<editorialItems>` e `<applications>` **dentro di sé**, e il GUID di collezione del pane *è* l'id di
quella entry. Ogni pagina che questo lab ha servito chiedeva al client di accettare un riferimento a
contenuto che gli era già stato mandato.

`pageFormat` ha quindi tre valori, e il terzo si aggiunge al secondo invece di sostituirlo:

| valore | il documento |
|---|---|
| `atom` | **il default, e quello che funziona**: la radice `<a:feed>` della pagina archiviata, con `<Panes>` e `<Templates>` dentro |
| `storePage` | radice `<StorePage>`: panes con un titolo e un riferimento alla loro sezione, gli item nel feed sotto. **Esperimento** da F-065 - è stata la radice di ogni consegna che non disegnava niente |
| `panes` | lo stesso documento, ma ogni pane porta anche i suoi `<editorialItems>` e `<applications>` |

Ciò che si verifica su `panes` è che **aggiunga**: stessa radice, stesso blocco template, stesso
feed, stessi handle, ogni app nominata esattamente due volte dentro il suo pane e due volte nel
feed, e ogni voce di catalogo che arriva ancora sulla pagina. Una differenza sul dispositivo è
quindi attribuibile a dove stanno gli item, e a nient'altro.

### Il flusso dell'account, reso visibile

Una richiesta verso un host che il lab non possiede non viene catturata: va in tunnel, o semplicemente
esce. Quello che il telefono fa lì resta invisibile. L'unica traccia è il log DNS, ed è così che sei
nomi sono finiti in `dns.hijack.names` e in `proxy.mitm.hosts` come diagnostica, non come nomi dello
Store.

Cosa dice il log, e cosa l'intercettazione ha poi smentito. Dopo la terza richiesta di pagina con
`pageFormat: panes` il telefono ha chiesto lo stack account di Live - `login.live.com`,
`clientconfig.passport.net`, `go.microsoft.com`, `ocsp.digicert.com` - non avendone chiesto
**nessuno** nelle 173 risoluzioni precedenti. Sembrava il client che passa dalla pagina all'accesso.
L'apertura successiva, alle 15:48, con quei nomi già intercettati - quindi un tentativo **sarebbe**
stato catturato - non ne ha chiesto nessuno e non ha catturato niente: quel gruppo non era l'accesso
dell'hub, e una lettura come sincronizzazione periodica dell'account regge. Quella stessa apertura ha
però chiesto, nello stesso secondo della pagina e subito dopo, `az717532.vo.msecnd.net` e poi
`account.nokia.com`, con `ssl-api.bing.com` un minuto prima: un sottodominio di CDN Azure, un
servizio account Nokia e un host dell'API Bing, nessuno dei quali questo lab possiede.

La lista porta quindi due gruppi, e il secondo è ciò che il telefono ha chiesto per ultimo: lo stack
Live, tenuto perché una occorrenza è pur sempre una occorrenza, e `account.nokia.com` /
`az717532.vo.msecnd.net` / `ssl-api.bing.com`. Il costo è scritto dove è configurato e ripetuto qui:
il traffico verso un nome in elenco **termina su questo lab e non può riuscire**, che è un modo di
fallire **nuovo**, in aggiunta a quello in indagine, e la CA deve essere attendibile sul dispositivo
per lo stesso motivo. Togliere le righe rimette ogni nome sul percorso vero. `npm run rehearse`
misura quattro cose per ogni nome in elenco - che risolva verso il lab, che raggiunga il proxy, che
il certificato sia emesso per quel nome, e che la richiesta venga intercettata e catturata - quindi
44 con i nove nomi dello Store, 68 con i quindici di oggi.

Il verdetto si legge solo sul dispositivo, e solo chi lo tiene in mano può leggerlo. `0x88675309` è
un assert catch-all: `E_JENNY_JENNY_WHO_CAN_I_TURN_TO` scrive 867-5309, il numero di telefono della
canzone da cui prende il nome, quindi non nomina nessun guasto in particolare. Se il messaggio sullo
schermo **cambia**, è l'unica cosa che dice se la forma del documento è quella giusta.

Per leggere il verdetto si va sul dispositivo: apri lo Store con il lab acceso e guarda cosa chiede
dopo - `npm run watch` mostra il traffico del device, e `captures/session-*/index.jsonl` conserva sia
la richiesta sia la pagina che gli è stata servita.

C'è una cosa che **non** fa, e vale la pena dirla: uno Store che si apre non è uno Store che
installa. Il lab serve le superfici di navigazione, cioè home page, pagine hub, liste di applicazioni
e il dettaglio di un GUID coniato da lui. Immagini, licenze e download non sono serviti, quindi
un'app toccata sul dispositivo arriva alla pagina di dettaglio e si ferma lì.

## Immagini dello Store

Il segnaposto è un PNG 48x48 che porta un **segno**: cornice chiara e croce diagonale sul campo
scuro. Un quadrato colorato non distingue un client che ha disegnato il nostro bitmap da uno che ha
disegnato il proprio sfondo vuoto - e la prima versione dell'handler `store-images` era piatta. Se
sul telefono compare il segno, il bitmap è disegnato; se compare solo il colore, non lo è (F-031).

`GET /__lab/images` conta cosa ha servito il lab, per `imagetype`, con i guid distinti e l'ultima
richiesta: è un conteggio di risposte, non di cosa ha disegnato il telefono.

Con `livestore.images.icons: true` l'handler serve l'icona dell'app quando la voce di catalogo dice
dove sta l'immagine: il Live Store lo fa (`app.icon` è `https://cdn.store.live.net.co/icons/...`),
il lab la scarica e la consegna dall'host che il telefono già conosce - il dispositivo non viene mai
mandato da un terzo. Una voce senza immagine, o un'icona che non si scarica, riceve il segnaposto
segnato, e la risposta dice quale delle due con `x-lab-image: live-store|placeholder`.

## Il lato telefono

La CA root deve essere attendibile sul dispositivo prima che qualunque nome TLS dirottato possa
essere intercettato. Fino a quel momento il telefono si connette e viene rifiutato all'handshake,
che non produce nessuna cattura.

La strada misurata è la **modalità memoria di massa**: filesystem montato come drive, hive modificato
qui, niente codice in esecuzione sul telefono. Sta in
[`README.md`, sezione "Mass storage mode"](README.md#mass-storage-mode), con i comandi, il ritorno
indietro e gli hash dei due backup.

Un'app nostra è stata provata prima, e rimossa. Il motivo vale la pena di tenerlo: su questa build
il runtime rifiuta le chiamate native dal codice dell'app (`NotSupportedException: DllImport cannot
be used on user-defined methods`), quindi un'app non può né scrivere né leggere lo store dei
certificati. Quello che poteva ancora fare senza privilegi era scrivere il file di import sul
telefono e verificare il lab **usando** la CA, con un handshake completato verso un nome dirottato.
Ma quella verifica costa un cavo e un avvio, e la modifica dell'hive è una strada più corta allo
stesso certificato.

`CMD Injector` (`fadilfadz01/CMD.Injector_WP8`) è il runner on-phone per i passaggi privilegiati: un
prompt dei comandi interattivo, che richiede WP8.1 con bootloader e interop unlock. Si apre, si
preme *Inject*, si riavvia, e si digitano comandi in una console sul telefono.

**Non** legge comandi da una cartella. Una versione precedente di questo file sosteneva che fosse
"guidato da file di comando messi in una cartella CMD Injector sul telefono": il sorgente upstream
non ha nessun meccanismo del genere, e quella frase era sbagliata.

Due cose da sapere prima di appoggiarsi a quella strada. Nessuno qui ha misurato se la console
raggiunge il `.reg` che questo repo genera, né se `reg.exe` esista su WP8.1. E l'issue tracker
upstream nomina questo modello: il Lumia 625 su WP8.1 Update 2 (GDR2) è fra i casi in cui installare
CMD Injector ha lasciato ogni app utente incapace di aprirsi. Gli unici recuperi riportati sono la
modifica del registro in memoria di massa o un hard reset. È riportato upstream, non misurato qui,
ma fa parte della decisione.

## Live Store (Zinc API)

Il catalogo di destinazione è quello di **Live Store** (`onelive.me`), che espone una API pubblica
detta **Zinc**:

```
Base URL : https://zinc.onelive.me/v1
Auth     : header X-OneLive-Key
```

Endpoint utili: `/apps/search`, `/apps/categories`, `/app/{id}`, `/app/{id}/updateCheck`, e gli
analoghi per i giochi.

**Serve una API key**: si crea dal One Live Developer Centre registrando un'app nel realm "Live
Store". Verificato: senza `X-OneLive-Key` la API risponde `400
{"success":false,"message":"...missing the X-OneLive-Key..."}` - anche sui feed RSS, che la
documentazione dichiara aperti.

Metti la chiave in `ZINC_API_KEY` o in `.zinc-key` (vedi sopra), e il client è pronto a essere usato
dagli handler.

## Perché il meta-store non basta

Lo Store di WP8.1 parla un protocollo proprietario: SOAP/XML verso i front-end
`wscont*.apps.microsoft.com`, catalogo Zune, licensing. Il backend Microsoft è **spento dal
16/12/2019**, quindi non c'è un'API viva che restituisca quel catalogo.

"Far credere allo Store che non sia mai chiuso" vuol dire riscrivere quel protocollo mappandolo sul
catalogo Zinc. Quel layer esiste, ed è `src/store/`: serve le superfici di navigazione con la
grammatica del client. Quello che manca non è più il catalogo, è l'installazione: licenza, pacchetto
e download non sono mai stati catturati, perché il pulsante non si raggiunge finché la pagina non si
disegna.

## Struttura

```
src/
  main.mjs            avvio, banner, hot reload
  config.mjs          caricamento config, default, glob matching, IP LAN, chiave Zinc
  preflight.mjs       controllo porte con nome del processo che le occupa
  pki.mjs             CA + leaf on-demand via openssl, cache su disco
  dns-server.mjs      DNS UDP: forwarding puro + hijack
  proxy.mjs           CONNECT/tunnel, MITM selettivo, regole, admin
  capture.mjs         index.jsonl + body su disco
  rules.mjs           matching regole e applicazione delle rewrite
  zinc.mjs            client della Live Store API, cache e mappatura errori
  paths.mjs           path canonici (Windows: Documenti vs Documents)
  log.mjs             logger con scope, una riga per evento
  store/
    router.mjs        dispatch degli handler, con fallback sul passthrough
    handlers.mjs      store-health + store-images + store-provisioning + store-live-client
                      + catalog-bridge
    protocol.mjs      gli endpoint v9 dello Store: pagina, liste, aggiornamenti, configurazione
    catalog-feed.mjs  i costruttori del documento (feed, panes, template, offerte)
    catalog-source.mjs il catalogo assemblato dalle categorie Zinc, con il ripiego sul file
    vocabulary.mjs    i nomi letti dal telefono, ciascuno con l'offset da cui viene
    page-frame.mjs    percorre la pagina e riporta ogni path del parser: esatto, altro prefisso,
                      assente
    images.mjs        il CDN delle immagini, con il PNG segnaposto segnato e le icone vere
    provisioning.mjs  la richiesta di certificato del dispositivo, firmata dalla CA del lab
    live-client.mjs   l'API JSON del client Live Store, forma e campi da F-029
    fixtures/         cataloghi di esempio, la pagina archiviata, il controllo rotto
tools/
  selftest.mjs         190 verifiche end-to-end, incluse watch e canary
  watch.mjs            mostra solo il traffico che arriva dal dispositivo,
                       compresi i TCP accettati e gli handshake rifiutati
  canary.mjs           ascolta sulle porte che il lab NON serve e segnala se il
                       dispositivo prova lì (escludi `proxy.httpPort`, che il lab usa)
  doctor.mjs           stato completo in un comando: config, porte, CA, traffico del
                       dispositivo e prossimo passo (`npm run doctor`)
  analyze-captures.mjs report del protocollo: chi ha chiesto, quale dispositivo,
                       endpoint e suggerimenti di config (`--all-sessions` per il censimento)
  rehearse.mjs         la catena intera sui nomi veri, senza il telefono
  store-page.mjs       la pagina costruita offline, stampata sezione per sezione
  page-diff.mjs        i path del parser contro la pagina servita
  install-trace.mjs    cosa chiede un tentativo di installazione, compresi i nomi non risposti
  read-vocabulary.mjs  il vocabolario riletto dal dispositivo, con deriva che fa fallire
  make-rootreg.mjs     blob di registro per la CA (con --verify)
  dnsprobe.mjs         query DNS grezza su porta arbitraria
  restart-lab.cmd      riavvio elevato, per porta, con report in logs/lab-restart.txt
ca/                    generato: CA, leaf, .reg
captures/              generato: sessioni, body, log DNS
```

## Problemi

<details>
<summary><strong>Il telefono risolve il nome e il lab non vede arrivare niente</strong></summary>
<br>

Quasi sempre è l'indirizzo scritto nel DNS del telefono: dopo un nuovo lease, o dopo che questo PC
è passato a un'altra rete, il telefono chiama un indirizzo su cui non risponde nessuno. `npm run
doctor` stampa l'indirizzo che il lab annuncia adesso; metti quello, o fissa `network.advertiseIp`.

Se l'indirizzo è giusto, guarda la porta: lo Store chiede molto di questo traffico in HTTP semplice
sulla 80, e un listener solo sulla 443 trasforma ogni richiesta in un RST silenzioso. Il lab sembra
inerte mentre il telefono riprova, e l'unica traccia è un'altra query DNS. `npm run canary` è il
modo per escludere una porta che il lab non serve.
</details>

<details>
<summary><strong>Handshake rifiutato, e in <code>captures/</code> non arriva nulla</strong></summary>
<br>

La CA non è attendibile sul dispositivo. Un telefono senza CA si connette, viene rifiutato
all'handshake e non produce nessuna cattura: è la riga `tls` di `npm run watch`. Metti l'entry in
[modalità memoria di massa](README.md#mass-storage-mode), espelli il volume, riavvia il telefono, e
riprova. Il registro che contiene l'entry non è una prova: lo è un handshake completato verso un
nome dirottato.
</details>

<details>
<summary><strong>Il log si riempie di <code>upstream_loop</code>, con l'indirizzo di questo PC</strong></summary>
<br>

Questo PC ha il lab fra i suoi server DNS. Un nome dirottato si risolve, qui, nell'indirizzo del
lab: il rilancio richiama il lab, ogni hop aspetta quello sotto, e nessuno risponde. La richiesta
viene rifiutata subito invece di restare appesa tutto il timeout. Togli il lab dai DNS di questo
PC, o rispondi a quel nome con una regola `mock`. Il telefono continua a usarlo.
</details>

<a id="il-lab-sta-girando-con-il-codice-vecchio"></a>

<details>
<summary><strong>Ho cambiato il codice e sul telefono non cambia niente</strong></summary>
<br>

`POST /__lab/reload` rilegge `config.json` e nient'altro. Una modifica sotto `src/` arriva al
dispositivo solo quando il processo viene sostituito, e il processo tiene le porte 80, 443, 8899 e
53, quindi fermarlo richiede un prompt elevato. Usa `tools\restart-lab.cmd`: alza lui l'UAC, ferma
chi tiene quelle porte, riparte staccato, aspetta `/__lab/status` e scrive l'esito in
`logs/lab-restart.txt`. La suite prova il sorgente, mai il processo che gira.
</details>

<details>
<summary><strong>Lo Store si apre, la testata si disegna, e sotto è vuoto</strong></summary>
<br>

È il punto in cui sta questo lab, non una configurazione sbagliata: il client accetta il documento e
disegna il `<a:title>` del feed, e i pane restano bianchi. `docs/FINDINGS.md` sotto F-065 - F-068 è
il registro di cosa è stato escluso. L'unica lettura che fa avanzare è cosa chiede il telefono dopo,
e solo chi guarda lo schermo può dire se la testata è cambiata.
</details>

<details>
<summary><strong>Lo Store mostra <code>0x88675309</code></strong></summary>
<br>

È un assert catch-all, `E_JENNY_JENNY_WHO_CAN_I_TURN_TO`, non una diagnosi: dice che la pagina è
stata rifiutata mentre veniva letta. La parte utile è cosa fa il telefono dopo - una richiesta per un
altro nome dice che il documento è stato almeno letto fin lì, il silenzio dice che non lo è stato.

Il numero scrive 867-5309: è uno scherzo dentro Windows Phone, non un codice da cercare.
</details>

<details>
<summary><strong>Lo slot dell'icona è pieno ma non compare nessun logo</strong></summary>
<br>

Cerca il segno. Il segnaposto è una cornice chiara con una croce diagonale sul campo scuro, e
l'header `x-lab-image` dice se hai ricevuto `placeholder` o l'icona del catalogo. Un colore piatto
senza segno è lo sfondo vuoto del client, non il nostro bitmap.
</details>

<details>
<summary><strong><code>reg import</code> dice «Operazione completata» e non scrive niente</strong></summary>
<br>

Misurato qui, quattro volte, su un `.reg` banale come su quello generato: exit 0, chiave assente
dopo. Sul PC il valore va messo con `reg add`, e il `reg query` che segue non è opzionale. I `.reg`
che questo repo genera servono alla console del telefono, non al PC. Vedi
[`README.md`](README.md#mass-storage-mode).
</details>

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia il lab. |
| `npm run dns` / `npm run proxy` | Solo DNS, o solo proxy. |
| `npm run doctor` | Stato completo in un comando, compreso quello che manca. |
| `npm run watch` | Traffico del solo dispositivo, dal vivo. |
| `npm run selftest` | Self-test end-to-end del lab. |
| `npm run rehearse` | Ripete la catena del telefono sui nomi veri, pagina sulla 80 compresa. |
| `npm run read-vocabulary` | Rilegge il vocabolario dal telefono montato e fallisce su ogni deriva. `:verbose` mostra la stringa da cui vengono i tipi di pagina. |
| `npm run store:page` | Costruisce la pagina offline e la stampa, sezione per sezione, con prezzo e valutazione. |
| `npm run page:diff` | Riporta ogni path del parser come portato, con altro prefisso, o assente. |
| `npm run trace:install` | Stampa gli scambi di un tentativo di installazione, compresi i nomi che il lab non ha risposto. |
| `npm run analyze` | Report dell'ultima sessione: chi ha chiesto, quale dispositivo, endpoint e client. |
| `npm run analyze -- --all-sessions` | Lo stesso censimento su tutte le sessioni: quanti dispositivi ci sono in `captures/`. |
| `npm run canary` | Ascolta sulle porte che il lab non serve, per scoprire un tentativo sulla porta sbagliata. |
| `npm run dnsprobe` | Query DNS grezza verso un server e una porta arbitrari. |
| `npm run make-rootreg` | Genera `ca/install-root-ca.reg` per il registro del telefono. |
| `npm run make-rootreg -- --phone` | Genera `ca/install-root-ca.phone.hex` e la riga `reg add` per la memoria di massa. |
| `npm run verify-rootreg` | Dimostra che il blob generato è byte-identico a quello che scrive Windows. |
| `npm run start:wp80` | Variante TLS 1.0, per dispositivi WP8.0. |
| `tools\restart-lab.cmd` | Riavvia il lab in esecuzione (UAC): ferma per porta, riparte staccato, aspetta `/__lab/status`, riporta in `logs/lab-restart.txt`. Serve dopo **ogni** modifica sotto `src/`. |

## Limiti noti

- **Lo Store 8.1 usa anche HTTP sulla 80 - ed è la spiegazione del sintomo più insidioso del
  progetto.** Osservato il 14/10/2026: il Lumia chiedeva `cdn.marketplaceedgeservice.windowsphone.com`
  ogni ~35 s, riceveva il dirottamento verso il lab, e **non apriva mai il TCP sulla 443** (nessun
  accept nel listener diretto, con la regola firewall per `node.exe` program-scoped e senza limiti di
  porta: un SYN sarebbe arrivato). La causa è che le ricerche, il catalogo e le immagini dello Store
  8.1 sono serviti in **HTTP sulla porta 80**: la guida alle regole firewall di Ivanti per l'accesso
  allo store di Windows 8.1 elenca `http://marketplaceedgeservice.windowsphone.com` e
  `http://cdn.marketplaceimages.windowsphone.com` su «HTTPS 443, HTTP 80». Un dirottamento DNS che
  ascolta **solo** sulla 443 ottiene quindi il fallimento più ingannevole possibile: il dispositivo
  risolve verso il lab, apre la 80, riceve un RST perché nessuno ascolta, riprova - e l'unica traccia
  resta un'altra query DNS. Da qui il listener `proxy.httpPort` (default 80): ora quelle richieste
  vengono accettate, instradate su regole/handler/capture e servite o diagnosticate con un 502
  leggibile invece di sparire.
- Se dopo questo resta un nome risolto ma nessuna connessione, l'ipotesi residua è un **IP di CDN in
  cache o cablato**: il dirottamento DNS non lo intercetta, e per distinguerlo serve una cattura a
  livello di pacchetti (`pktmon` richiede privilegi elevati).
- **Certificate pinning**: se lo Store app fa pinning, il MITM fallisce. Si vede come errore TLS nei
  log; in quel caso si lavora in `mode: "all"` per confermarlo e si valuta un approccio diverso.
- **WP8.0** userebbe TLS 1.0, che Node disabilita di default: `npm run start:wp80` (richiede
  `--tls-min-v1.0`).
- **DNS su TCP** non è implementato: irrilevante per risposte A/AAAA piccole.
- Le catture contengono **token del tuo account**: `captures/` è in `.gitignore`, non pubblicarlo.
- `172.26.160.1` è un adattatore virtuale: `network.advertiseIp` va forzato se l'auto-rilevamento
  sceglie la scheda sbagliata.
- Il lab parte su qualunque sistema con Node (`start.sh` esiste per questo), ma tutto quello che è
  misurato qui è Windows: montaggio degli hive, riavvio elevato e percorso in memoria di massa sono
  strumenti Windows.

## Nota su reverse-skill

`https://github.com/zhaoxuya520/reverse-skill` è clonato in `.reverse-skill/`. Non è uno strumento
che esegue il lavoro: è un **router di metodologie** (45 moduli skill, regole di routing, gate di
autorizzazione in `RULES.md`). È stato usato come riferimento di workflow, in particolare
`skills/protocol-reverse/` per la fase di analisi del protocollo e `skills/ops/` per la catena
evidenza → conclusione. Nessuno script del repository è stato eseguito.
