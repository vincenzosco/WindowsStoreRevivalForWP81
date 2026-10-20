# Windows Store Revival for WP8.1

A lab that gives a Windows Phone 8.1 Lumia a working Store experience again, after
Microsoft shut the original backend down on 2019-12-16.

It hijacks the Store host names by DNS and intercepts only that traffic, so the real Store
protocol can be captured and mapped onto a catalog produced here. The phone side is reached
with mass storage mode - its registry hive is edited on this PC - which is the route measured
end to end.

An on-device patcher app used to be part of this repo (`StorePatcher/`, generated and driven
by `tools/app.mjs`). It was removed, and the measurement that removed it is in
[The phone side](#the-phone-side): on this build the runtime refuses native calls from app
code, so the app could never install the CA itself.

## Status

The lab runs and captures, and the phone's Store home page is now **served** here instead of
relayed. The backend is dead, and that was measured rather than assumed: asking the real
hosts from this PC through a public resolver (so the lab's own DNS cannot answer instead),
`marketplaceedgeservice.windowsphone.com`, `catalog.zune.net` and `wscont*.apps.microsoft.com`
are NXDOMAIN, while `cdn.marketplaceedgeservice.windowsphone.com` still resolves to Akamai and
its edge answers `503 Service Unavailable - DNS failure` — the front door is up, the origin is
gone. Forwarding the Store's request anywhere therefore cannot help; the page has to be
produced here. See [Serving the Store](#serving-the-store).

The template the page names is no longer a guess. It was read out of the phone itself —
the client that parses a store page and the UI assets that draw it — and is recorded name by
name, with the byte offset each came from, in [`src/store/vocabulary.mjs`](src/store/vocabulary.mjs).
That reading changed the page: a store page selects its template by a **number** the phone
styles (`003`), not by a name, and it carries a `<Panes>` block the generated page had been
missing altogether. See [The vocabulary, read from the phone](#the-vocabulary-read-from-the-phone).

What is still open is the phone's verdict. It now fetches the corrected page and still asks
for nothing afterwards — no image, no detail page — which is what a page that parses into an
empty model looks like. That fetch is measured on the device and not inferred from this side:
with the phone in mass storage mode its own response cache is readable, and
`Data\SharedData\EdmCache\Short\0` holds the `storePages` answer keyed by the exact request —
29893 bytes of `<?xml version="1.0"?><StorePage>...`, byte-identical to what
`tools/store-page.mjs` builds today apart from the `<a:updated>` timestamp it carries. The
three earlier entries for the same request are 14 bytes each and read `{"probe":true}`, the
body of an earlier probe listener, so the cache records whatever the client was served; that
is what makes the identical one evidence. What it does not prove is that the page was
*rendered* — a stored response is not a parsed one — and the app's own state would settle it:
that storage (`Data\Users\DefApps\APPDATA`) denies an elevated read, so it was opened the only
way it can be, by taking ownership of it, copying it and putting the ACL back. It holds no Store
state at all — the two package folders whose names promise some are empty — and it does hold a
**second, working client's** cache and its JSON API, `store-api.live.net.co`. See F-029. The
next single variable is named at the end of that section.

The phone side is not an app any more, and that is a measurement rather than a preference. An
on-device patcher was built, deployed to a Lumia 625 over USB and run; its first real run
answered the question the design left open with a no: on this build the runtime refuses native
calls from app code (`NotSupportedException: DllImport cannot be used on user-defined
methods`), so **an app cannot write the certificate store, and cannot read it either** - that
check reported the refusal instead of a result. What was left to it was the half needing no
privilege: writing the import file onto the phone and printing the one line that imports it
from the phone's own console. The route that is measured end to end needs no app at all: the
phone's hive is edited on this PC with the filesystem mounted as a drive, and the CA was
installed and verified that way on 2026-10-15 - see
[Mass storage mode](#mass-storage-mode). The app has since been removed from this repo; the
measurement above is why.

Design, decisions and the full measurement are in
[`docs/superpowers/specs/2026-10-15-wp81-store-revival-design.md`](docs/superpowers/specs/2026-10-15-wp81-store-revival-design.md).

## Serving the Store

These are the requests this phone makes on the way to the Store home page, verbatim from the
capture of the Lumia:

```
GET  http://marketplaceedgeservice.windowsphone.com/v8/Configuration/Stores/OEMStores/NOKIA
         ?mpcVersion=8.10&os=8.10.14219.0&...             (and an equivalent /MOStores/ call)
GET  http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages
         ?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT&hw=402699266&dm=RM-941_eu_france_308&...
POST http://marketplaceedgeservice.windowsphone.com/v8/catalog/updates
         ?os=8.10.14219.0&cc=IT&lang=it-IT&hw=...        (a BatchGetProductUpdatesRequest body)
```

All three are answered by `src/store/protocol.mjs`. The page is built in the Zune catalog XML
the phone reads; the update check reports every SKU it was asked about as unchanged, because
nothing here serves a package; and the two configuration calls - which come *first*, and which
the lab used to answer `502 upstream_loop` because no route matched them - get a
`ConfigurationFile` document in the client's own grammar (`Domains`/`Domain`/`setting`), read
out of an FFU and written with the settings the client's endpoint table substitutes. No
capture of that endpoint exists, in the archive or on the phone, so the *values* are a reply
and not a reconstruction, and the response says so (`x-lab-invented: 1`). What is open, and
the two experiments that name it, is in [`docs/FINDINGS.md`](docs/FINDINGS.md) under E-008,
E-009 and F-024.

The Store's image CDN is answered too, since 2026-10-17: `cdn.marketplaceimages.windowsphone.com`
has been hijacked all along, so every icon the handset asked for was answered with the lab's own
`502` - 420 of them during one search. The `store-images` handler now returns a generated 48x48
placeholder PNG instead, and nothing else: the page document is untouched, so an image-caused
change can never be mistaken for a page-caused one. The placeholder carries a **mark** - a light
frame and a diagonal cross on the dark field - on purpose: a flat coloured square cannot tell a
client that painted this lab's bitmap from one that painted its own empty-image background, and
the first version of this handler was flat. If the mark appears on the handset the bitmap is
drawn; if only the colour does, it is not. `GET /__lab/images` counts what the lab served - per
`imagetype`, distinct guids, the last request - so "the 502s became 200s" is answerable without
reading a capture. It is a count of responses and says nothing about what the handset drew.
See F-031.

The device-identity path is answered too, since 2026-10-20, and this is the one handler whose
protocol is **not** from a capture: `devicecertificateservice.windowsphone.com` has been treated
as Store traffic by the capture analysis for as long as that tool has had a host list, and no
handler had ever matched it - so every such request was a `502` this lab injected, on the one
host a device uses to prove it is a device. The `store-provisioning` handler answers
`POST /dcs/certificaterequest` with a PKCS#7 chain signed by the lab CA, in the shape another
project reversing the same era of handsets implements: `application/pkcs10`, three
`X-Windows-Phone-*` headers, base64 in and base64 out as `application/c-x509-ca-cert`. That is
Windows Phone **7**'s contract, not a measurement of this 8.1 handset, so every answer carries
`x-lab-invented: 1`, every refusal names itself in `x-lab-refused`, and the handler is **off by
default**. Signing uses a fixed client profile (`CA:FALSE`, `clientAuth`, no SAN, no
`-copy_extensions`): a CSR that asks for `CA:TRUE` or for `login.live.com` gets neither, because
this CA is a root the phone trusts. See F-034, and [`docs/DOMAINS.md`](docs/DOMAINS.md) for which
host is which service and how certain each row is.

The handset carries a **second** store client, and it works: a community app whose own cache
holds the JSON answers of `store-api.live.net.co` (`/apps`, `/games`, `/apps/search?q=`,
`/app/{id}`, `/me`, and a sign-in at `id.live.net.co`). That protocol is now served from the
same catalog by the `store-live-client` handler - key names and value types read off the
client's own cache, values from the fixture, every response carrying `x-lab-invented: 1` - off
by default, and arming it takes three edits rather than one so that the working client cannot
lose its catalog to a single flipped value. See F-029 and F-030.

### Where the format comes from

The XML is not guessed. `src/store/catalog-feed.mjs` builds it from responses of the real
service kept by the Wayback Machine — three generations of one grammar — and every element in
that file names the capture it came from:

| Archived capture | What it establishes |
| --- | --- |
| `/v3.2/en-US/clientTypes/WinMobile 7.1/hubTypes/marketplace/hub` | the marketplace home page: `<templateName>MarketplaceHub</templateName>`, one entry carrying `<editorialItems>` and `<features>` |
| `/v8/catalog/hubs?…&hub=games` | a WP8 hub page: `<templateName>GamesHub</templateName>`, `<editorialItems>` and the `<applications>` they point at |
| `/v8/catalog/apps?…`, `/v9/catalog/apps?…` | a WP8/WP8.1 application list: one `<a:entry>` per app |

All three are an Atom feed in `http://schemas.zune.net/catalog/apps/2008/02` with a
`<templates>` block naming the UI template that renders the page. That is what makes this
possible: `storePages?typeId=DynamicHub.Main` is the same shape one generation later.

The archives describe the **v3.2 and v8** grammars. The page this phone actually asks for is
`/v9/catalog/storePages`, and for that grammar the source is not an archive but the device.

```jsonc
"livestore": {
  "protocol": {
    "enabled": true,                                        // off by default: serving the
    "catalogFile": "src/store/fixtures/demo-catalog.json",   // device's own store page is a
    "hubTemplate": "DynamicHub",                             // decision, not a default
    "templateType": "003",
    "templateTypeForm": "both",
    "pageSize": 25
  }
}
```

`catalogFile` is re-read when it changes, so iterating on what the device shows needs no
restart. Two catalogs ship and both are invented data, every publisher reading `Lab Fixture`,
so no listing can be mistaken for a real one:

- `src/store/fixtures/demo-catalog.json` — seventeen apps across all eight declared
  categories, which is the default because a page with one entry per section cannot be told
  apart from a page that renders nothing;
- `src/store/fixtures/sample-catalog.json` — the three-entry fixture the tests keep as a
  baseline. Switching to it is that one line.

`npm run store:page` renders the page offline and prints what is on it, section by section,
with each app's price and rating. That is the answer to "what would the device be given", and
it is readable while the lab is stopped and while the phone shows nothing but an assert code.

`npm run page:diff` asks the harder question: not *what* is in the page but whether the page
carries the constructs the client's own parser names. It fetches the document through the real
router, walks it, and reports each of the parser's paths (`ZMarketplace.dll`) as spelled
exactly, carried under a namespace prefix the parser's string does not have, or missing - then
does the same for the first pane's own field map and for the archived real response. `missing`
is the only state that is a defect on the evidence, and today there are none: all 22 required
paths are carried, 12 of them under the atom prefix the real service also used (F-032).

An install is a different conversation, and it has never been captured: the button cannot be
reached while the page does not render, and the entitlement, package and install steps are
unmeasured. `npm run trace:install` is the tool for the first question - what the attempt asks
for. It prints the device's exchanges in order, every name it resolved, and, separately, the
names it resolved that **the lab never answered**: those went to the real network, and they are
where a licensing or account host would appear (they are deliberately not hijacked). Read that
list before deciding what to intercept next; a host the lab answers without having its grammar
is a new failure, not a fix.

The next single variable is already built and off: `livestore.protocol.paneBackgroundImage`
writes `<BackgroundImage><id>urn:uuid:…</id></BackgroundImage>` into every pane - the one path
of the pane's own field map a hub tile would draw with, and the image endpoint answers whatever
guid it is handed. Arming it needs two steps (`true` in `config.json`, then
`POST /__lab/reload`) and changes one thing: the pane. `x-lab-pane-background: guid|none` on the
page response says which arm a delivery belongs to.

### The vocabulary, read from the phone

A page can be perfectly well formed and still name a layout the device has never heard of.
That rejection looks exactly like a bad page, and it is what the first attempts ran into. So
the names the page is built from were taken from the phone instead of guessed:

```
npm run read-vocabulary        # re-derive it from the mounted device, fail on any drift
```

Two binaries on the device answer, and they have to agree — one parses a store page, the other
draws it:

| Binary | What it settles |
| --- | --- |
| `H:\Windows\System32\ZMarketplace.dll` | the structural paths it walks (`/Panes/Pane`, `/Templates/Template`, `/feed/entry`, `/feed/link`), the template type key `TEMPLATETYPE`, the page types it asks for (`DynamicHub`, `DynamicChart`, `Collection`), the content link types (`Application`, `ApplicationCollection`) |
| `H:\Windows\System32\ZuneAssets480x800.dll` | which template types are *styleable on this 480×800 screen*: `Store_Hub_TemplateType003`, `004`, `015`, `017` and `Store_Chart_TemplateType010`. Also `Store_DynamicHubStyle_*`, the style the page's own chrome is drawn with |

Three findings changed the page, and one of them was a correction rather than a refinement:

- **The template type is a number.** The page was asking for a layout named `DynamicHub`
  where the phone styles `Store_Hub_TemplateType003`. `003` is the plain ordered list, which
  is what a generated section is; `017` is the rich layout with a price panel, a "suggested
  because" reason and a per-item button, and would ask the phone to style elements the page
  does not carry.
- **The page had no panes.** The parser counts panes *before* it counts templates
  (`Found %d Store Panes`), and every page this lab had served carried a template block and no
  `<Panes>` at all — a template with nothing to render.
- **`GamesHub` is the wrong name, and it was never the right one.** It appears in
  `ZMarketplace.dll` inside a run of persisted **settings** keys (`MarketplaceSettings`,
  `AutoUpdateOn`, `TileCount`, …), and its only real owners on the phone are `GamesShared.dll`,
  `ZMF_Client.dll` and `ZMF_Service.dll` — the Xbox Games hub app. The archived page that
  carries it is the `hub=games` page of a different generation. Serving that to a
  `storePages?typeId=DynamicHub.Main` request was never a one-variable experiment.

One question the phone cannot settle is kept in one place instead of being spread through the
builders: whether the type key travels as an attribute of `<Template>` or as a child element.
The parser holds `TEMPLATETYPE` as a property name, not as markup. `templateTypeForm` narrows
it to `attribute`, `element` or `both`; `both` is the default so either reading of the page
finds the value.

### Handles the device can come back with

Every entry is served under a GUID derived from its catalog id (UUID v5 over a fixed lab
namespace), so the same entry has the same GUID on every run — that is what lets the device's
follow-up request be mapped back to an entry with no state kept. A request for a GUID the lab
never minted is refused with `404 app_not_found` rather than relayed.

### The counter-proof, and why it is not one variable

The first time the Lumia's Store was opened against this lab it fetched the home page, was
handed a `200` carrying the generated page, and answered with error `0x88675309` — an internal
Windows Phone assert (`E_JENNY_JENNY_WHO_CAN_I_TURN_TO`, "this should never happen") rather
than a diagnosis. It made no request afterwards, so the page was rejected while being read.

```jsonc
"livestore": { "protocol": { "serve": "archive" } }   // default: "generated"
```

With `serve: "archive"` the page endpoints answer with
`src/store/fixtures/archive/real-hub-page-20130813.xml`: a response of the real service,
downloaded byte for byte from the archive.

That experiment was built as a one-variable substitution and **is not one**, which the
vocabulary reading made plain afterwards. The archived response is the `hub=games` page of a
different generation, so substituting it changes three things at once: the page type (the
games hub, not the store hub this request names), the grammar (`<templateName>` in a
`<templates>` block, where the v9 client walks `/Templates/Template` and reads
`TEMPLATETYPE`), and the template's owner (`GamesHub` belongs to the Games hub app, not to the
Store). A rejection of it indicts none of those separately.

The response says all of this in its headers rather than leaving it in a comment, so a later
reading of the capture finds it — a capture does not keep comments:

```
x-lab-protocol:        storePages:archive
x-lab-archive-template: GamesHub
x-lab-archive-page:     games-PK-WindowsPhone80-ALL-ALL
x-lab-archive-warning:  archived response of a different page and grammar generation:
                        not a one-variable substitution for the requested page
```

`npm run rehearse` fails if an archived page is served without those headers, and prints the
confound instead of assuming it away.

### What is proven here, and what is not

Proven on this machine (`npm run selftest`, 95 checks, and `npm run rehearse`: 44 with the nine
store names, plus four per host for every name added to the hijack list — 68 with today's
fifteen): the feed is
well formed; a hostile catalog entry (raw `&`, `<`, quotes, a control character) cannot break
it; every catalog entry reaches the page; the fake store that actually runs is checked to have
no two entries hashing to the same GUID, no entry in a category nobody declared, no declared
category left empty, and every one of its apps on the page exactly once — once as the link that
points at it and once as the record that describes it; a GUID round-trips to its entry and an unknown one is
refused; the endpoints answer through the real proxy on the exact path and query the phone
uses, **on the transport the phone uses** (plain HTTP on port 80, `ZDM/4.0; Windows Mobile
8.1`, no `Accept` header), and the lab's own capture records them; the handler is off unless
enabled and falls through to passthrough when it is.

Proven about the vocabulary (`npm run read-vocabulary`, 19 checks): every page type, template
type, structural path and content link type the module declares is still present in the phone
at the byte offset the module cites. A drift fails the command.

Proven about the page: it names a template type the phone styles, its template name belongs to
the Store client rather than another app, and it carries every structural path the parser
walks, panes included. All three are asserted against `src/store/vocabulary.mjs`, not against a
copy of the reader's opinion.

**Not proven: that the phone renders the page.** It fetches it — repeatedly, most recently
`200 storePages type=003`, format `storePage`, 29835 bytes of a seventeen-app catalog — and
then asks for nothing else. No image, no detail page, not a second request of any kind, while
the log says the lab held nothing back (`storeRouterStats.failed: 0`, no half-open connection
from the device and no name it failed to resolve). Growing the catalog from three apps to
seventeen changed the answer fourfold in size and changed nothing else — which is what makes
the remaining variable the *shape* of the document rather than its contents.

What the phone's own parser says the page must be, and what the page now is, since that is
where the last three attempts went wrong — each of them a *shape* mistake that a well-formed
document cannot reveal:

| The parser names | The page used to be | Now |
| --- | --- | --- |
| `/StorePage` as a root, `/Panes/Pane`, `/Templates/Template` | an Atom `<a:feed>` root — the v8 `catalog/hubs` shape | `<StorePage>` carrying `<Panes>`, `<Templates>` and the feed |
| `TEMPLATETYPE`, and no `templateName` / `mimeType` / `application/uix` anywhere | `<templateName>` and `<mimeType>application/uix</mimeType>`, copied from the v8 archive | the numeric type, in both spellings the parser could expect |
| a numeric `TemplateType003` in the UI assets | a template *named* `DynamicHub` | `003`, held against the set this phone styles |
| `Found %d Store Panes` before it counts templates | no `<Panes>` at all | one pane per section |

The update check in the same flow was the other half: `POST /v8/catalog/updates` answered `502`
on every attempt, and the capture shows the phone retrying it four times in a row while the
Store starts. It now answers `200`, reporting every SKU the device names as unchanged — the
only answer that cannot be wrong for a lab that serves no package.

Still not derivable from the phone: the inner shape of `<Pane>` and of the other children of
`<StorePage>`. The parser stores paths through a rolling context (`XmlPathContext::CommonPush`
and `Pop`), so it says which elements it looks for but not how they nest. The archived response
is the only second witness, and it settles one part of that: in the real page the section's
`<a:entry>` carries its `<editorialItems>` and `<applications>` **inline**, and the pane's
collection GUID *is* that entry's id. Every page this lab served asked the client to accept a
reference to content it had already been sent.

So `pageFormat` has three values, and the third adds to the second instead of replacing it:

| value | the document |
| --- | --- |
| `storePage` | a `<StorePage>` root: panes carrying a title and a reference to their section, the items in the feed underneath |
| `panes` | that same document, except each pane additionally carries its own `<editorialItems>` and `<applications>` |
| `atom` | the older `<a:feed>` root, kept because every earlier page was it |

What is asserted about `panes` is that it *adds*: same root, same template block, same feed,
same handles, each app named exactly twice inside its own pane and twice in the feed, and every
catalog entry still reaching the page. A difference on the device is therefore attributable to
where the items are, and to nothing else.

### The account flow, made visible

A request to a host this lab does not own is never captured — it is tunnelled, or on this network
simply goes out — so whatever the phone does there is invisible. The DNS log is the only trace,
and it is what put six names in `dns.hijack.names` and `proxy.mitm.hosts`, as a diagnostic and
not as part of the store names.

What the log shows, and what the interception then disproved. After the third page fetch under
`pageFormat: panes` the phone asked for the Live account stack — `login.live.com`,
`clientconfig.passport.net`, `go.microsoft.com`, `ocsp.digicert.com` — having asked for none of
them in the 173 lookups before it. That read as the client moving from the page to the sign-in.
The next open, at 15:48 with those names already intercepted so that an attempt *would* have
been captured, asked none of them and captured nothing: the cluster was not the hub's sign-in,
and a plausible account-sync reading of it stands. What that open did ask, in the same second as
the page and just after, was `az717532.vo.msecnd.net` and then `account.nokia.com`, with
`ssl-api.bing.com` a minute earlier — an Azure CDN subdomain, a Nokia account service and a Bing
API host, none of which the lab owns.

So the list carries two groups, and the second one is what the phone actually asked for last:
the Live stack, kept because one occurrence is still one occurrence, and
`account.nokia.com` / `az717532.vo.msecnd.net` / `ssl-api.bing.com`. The cost is stated where it
is configured and repeated here: traffic to any listed name **terminates at this lab and cannot
succeed**, which is a *new* failure mode on top of the one being investigated, and the CA has to
be trusted on the device for the same reason. Remove the lines to put each name back on the real
path. `npm run rehearse` measures four things for every name in the list — that it resolves to
the lab, reaches the proxy, that the certificate is issued for that name, and that the request is
intercepted and captured — so 44 with the nine store names, 68 with today's fifteen.

The verdict is only readable on the device, and only the person holding it can read it:
`0x88675309` is a catch-all assert (`E_JENNY_JENNY_WHO_CAN_I_TURN_TO` spells 867-5309, the
phone number in the song it is named after), so it names no specific failure. Whether the
message on the screen *changed* is the one thing that says whether the document shape is now
right.

The way to read the verdict is on the device: open the Store with the lab running and see what
it asks for next — `npm run watch` shows the device's traffic, and
`captures/session-*/index.jsonl` keeps both the request and the page served to it.

What this does not do, said plainly because a Store that opens is not a Store that installs:
it serves the browse surfaces — the home page, the hub pages, the application lists, and the
detail of a GUID it minted itself. Images, licenses and downloads are not served, so an
application tapped on the device reaches a detail page and no further.

## Quick start (lab)

```bash
npm start                # DNS on :53, TLS on :443, plain HTTP on :80, proxy on :8899
npm run doctor           # one command: config, ports, CA, device traffic, next step
npm run watch            # only the traffic that comes from the device, not this PC
```

Then point the phone's Wi-Fi DNS at this PC and reboot it. Requests to the hijacked
names are captured under `captures/session-*/index.jsonl`.

The address you point it at is not typed in anywhere: `network.advertiseIp` is `"auto"`, so
the LAN IPv4 of this PC is detected at startup, printed in the banner, and handed out as the
answer for the hijacked names. Nothing is baked into a build, so no artifact can go stale - but
the phone keeps whatever address was typed into its Wi-Fi DNS, so after a new lease or a move
to another network it dials an address nothing answers on, which fails in a way that reads
like a certificate problem. Put the new address in, or pin it with `network.advertiseIp`.

```bash
npm run selftest         # end-to-end checks, no device needed
npm run rehearse         # replays the whole chain against the real host names
npm run read-vocabulary  # re-reads the Store's templates out of the mounted phone
npm run analyze          # report from the last capture session
npm run analyze -- --all-sessions   # census: who asked, and which device
```

## Repository map

```
src/                     lab: DNS, selective TLS MITM, rules, capture, store handlers
tools/                   lab tooling: selftest, watch, doctor, canary, analyze, root CA
config.json              everything the lab does is driven by this file
docs/                    what we know and how to keep it: FINDINGS.md, MAINTENANCE.md, specs
ca/                      generated: CA, leaves, install-root-ca.reg   (gitignored)
captures/                generated: sessions, bodies, DNS query log  (gitignored)
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the lab. |
| `npm run doctor` | Full state in one command, including what is missing. |
| `npm run watch` | Live view of device-only traffic. |
| `npm run selftest` | End-to-end self-test of the lab. |
| `npm run rehearse` | Replay the phone's chain against the real names, including the page request over port 80. |
| `npm run read-vocabulary` | Re-derive the Store vocabulary from the mounted phone and fail on drift. Add `:verbose` to see the string run the page types live in. |
| `npm run analyze` | Report of the last capture session: who asked (per client address, this PC marked) and which device (per `x-wp-device-id`), then the endpoints with the clients that reached them. |
| `npm run analyze -- --all-sessions` | The same census over every session at once. The one reading that says how many devices are in `captures/` - and it matters, because the user agent this PC replays with is the phone's own. |
| `npm run canary` | Listen on ports the lab does *not* serve, to catch a wrong-port attempt. |
| `npm run dnsprobe` | Raw DNS query against an arbitrary server/port. |
| `npm run make-rootreg` | Generate `ca/install-root-ca.reg` for the phone registry. |
| `npm run make-rootreg -- --phone` | Generate `ca/install-root-ca.phone.hex` and the `reg add` line for mass storage mode. |
| `npm run verify-rootreg` | Prove the generated blob is byte-identical to what Windows writes. |
| `npm run start:wp80` | TLS 1.0 variant, for Windows Phone 8.0 devices. |

## Mass storage mode

The route that is measured end to end, and the one to reach for. The phone's filesystem is
mounted as a drive on this PC, its registry hive is edited here, and the entry is verified in
the bytes that end up on the device. Nothing runs on the phone: it does not need to be
unlocked, and it does not need to be booted - a halted OS is in fact the requirement.

The device this was measured on: a Lumia 625 on WP8.1 Update 2, mounted over USB as a 7.8 GB
"Qualcomm MMC Storage" disk, `G:` on this PC. The hive is
`G:\Windows\System32\config\SOFTWARE`, and the CA goes into
`Microsoft\SystemCertificates\Root\Certificates` - 10 entries before, 11 after.

```bash
node tools/make-rootreg.mjs --phone
```

That writes `ca/install-root-ca.phone.hex` (the `Blob` value, 894 bytes, as hex) and prints the
`reg add` line below with the hex already in it - currently for the CA with thumbprint
`2DE30E6BB059296AB07F5754511D97E16ED81D8D`.

1. **Use an elevated prompt.** `reg load` needs `SeRestorePrivilege`, and the phone's
   `Windows\System32\config` is ACLed `O:SYG:SYD:(A;ID;FA;;;SY)(A;ID;FA;;;BA)` - SYSTEM and
   Administrators only. A normal prompt answers `Il privilegio richiesto non appartiene al
   client`, which reads like a broken command instead of a missing prompt.
2. **Edit a copy, never the phone's file.**

   ```bat
   copy "G:\Windows\System32\config\SOFTWARE" "%TEMP%\SOFTWARE.work"
   reg load   "HKLM\PhoneSoftware" "%TEMP%\SOFTWARE.work"
   reg add    "HKLM\PhoneSoftware\Microsoft\SystemCertificates\Root\Certificates\<thumbprint>" /v Blob /t REG_BINARY /d <hex> /f
   reg query  "HKLM\PhoneSoftware\Microsoft\SystemCertificates\Root\Certificates\<thumbprint>" /v Blob
   reg unload "HKLM\PhoneSoftware"
   ```

   The `reg query` is not optional: it is the only thing that says the value the phone will
   read is the value that was written. Two traps sit in this step, both measured here.
   **`reg import` reports `Operazione completata` and exit 0 while writing nothing at all** -
   four times, on a trivial .reg as well as on the generated one, with the key absent
   afterwards. The `.reg` files this repo generates are therefore for the *phone's own*
   console; on the PC the value goes in with `reg add`. And **`reg unload` can answer
   `Accesso negato`** while a handle to the loaded key is still open - PowerShell's registry
   provider keeps `Get-Item` results alive - so retry, and never assume a hive was unloaded: a
   mounted hive keeps its file locked and writes it back on the next unload.
3. **Put the hive back.** Stage it, compare the hashes, then rename over the phone's file:

   ```bat
   certutil -hashfile "%TEMP%\SOFTWARE.work" SHA256
   copy "%TEMP%\SOFTWARE.work" "G:\Windows\System32\config\SOFTWARE.new"
   certutil -hashfile "G:\Windows\System32\config\SOFTWARE.new" SHA256
   move /y "G:\Windows\System32\config\SOFTWARE.new" "G:\Windows\System32\config\SOFTWARE"
   ```

   If the hashes differ, stop - the phone still has its own file. Verified on 2026-10-15: the
   hive that ended up on the device was byte-identical
   (`51DB8FD46E1683585A1D5600B1EEC902283A423ED938242A9DFFF71A9A23B6D6`) to the copy whose entry
   had been read back and compared against the hex, and reading it off the phone a second time
   found the certificate and no other difference.
4. **Eject the volume, then reboot the phone.** The certificate store is read at boot, so until
   then nothing on the device sees the entry.
5. **The check that means something** is not the registry: it is a completed TLS handshake to a
   name the lab hijacks, which `npm run watch` shows from this PC. A refused handshake is the CA
   still not trusted, and it is named as that cause instead of being left to guesswork.

### What the phone stores, and why the desktop's blob is not it

Every entry in every store on this device is a serialized store element:

```
DWORD 0x19 (25)    version - in each entry opened on the device, one per store
DWORD 1
DWORD 16           length of the element id that follows
BYTE  id[16]
properties, each:  DWORD id, DWORD 1, DWORD length, BYTE data[]
```

The desktop's own entries - what `npm run verify-rootreg` proves against `certutil` - use the
same grammar with version `3`, a 20-byte id and one property. This PC's crypt32 deserializes
both: handed to `CertAddSerializedElementToStore`, each shape returned the byte-identical
certificate. That is a fact about *this* crypt32 and not the question the phone asks, so what
is written to the phone is the shape the phone itself writes, the only one it is known to read.

`--phone` writes two properties, both measured on the device instead of assumed: `3`, the
SHA-1 of the certificate, which in every existing entry equals the key name, and `32`, the
certificate itself. The device's entries also carry a subject-name hash, a key identifier, a
friendly name and an EKU, and they are deliberately not written: the same property id was
found holding 16 bytes in `ROOT` and 20 in `AuthRoot`, and its recipe was not pinned down. An
absent property crypt32 computes on demand; a wrong value it does not.

### Undo

`ca/phone-backups/` keeps the phone's `SOFTWARE` hive as it was found and as it was before the
CA went in:

| File | What it is | SHA-256 |
| --- | --- | --- |
| `SOFTWARE.original.hive` | the file as found, before anything mounted it | `042679E73D5B5FB8EB2DEA29ACE7108F7C0855720C2938AC5A88183A356BF093` |
| `SOFTWARE.before-ca.hive` | after the mounts, before the CA | `510BBE095E4F1BE474B8556162651C3DDCD48EEB64F1EFFBE7F22F3342C547C9` |

Copy either over `G:\Windows\System32\config\SOFTWARE` with the phone in mass storage mode and
reboot. Both are kept on purpose: mounting a hive rewrites its bytes even when nothing inside
it changed, because `reg unload` flushes it, so only the first file is the device's original.

## The phone side

The root CA has to be trusted on the device before any hijacked TLS name can be
intercepted; until then the phone connects and is refused during the handshake, which
produces no capture at all. There is one route on this repo, and it is measured end to end:

**Mass storage mode** — the phone's filesystem is mounted as a drive on this PC and its
registry hive is edited here: [Mass storage mode](#mass-storage-mode). Nothing runs on the
phone, and it does not even need to be booted. `npm run make-rootreg` (without `--phone`)
also generates `ca/install-root-ca.reg` in the desktop's blob layout, which is what the
phone's own console imports; the hive edit uses `--phone`.

An app of our own was tried first and removed. It is worth keeping the reason: on this build
the runtime refuses native calls from app code, so an app can neither write nor read the
device certificate store. What it could still do without any privilege was write the import
file onto the phone and check the lab by *using* the CA - a completed TLS handshake to a
hijacked name - but that check costs a cable and a boot, and the hive edit is a shorter path
to the same certificate.

`CMD Injector` (`fadilfadz01/CMD.Injector_WP8`) is the on-phone runner for privileged steps:
an interactive command prompt, requiring WP8.1 with bootloader and interop unlock. You open
it, press *Inject*, reboot, and type commands into a console on the phone itself.

It does **not** read commands from a folder. An earlier version of this file claimed it was
"driven by command files placed in a CMD Injector folder on the phone"; the upstream source
has no such mechanism, and that claim was wrong.

Two things to know before relying on it. Nothing here has measured whether the console can
reach the `.reg` this repo generates on the phone, or whether `reg.exe` exists on WP8.1 at
all. And upstream's
own issue tracker names this model: Lumia 625 on WP8.1 Update 2 (GDR2) is among the cases
where installing CMD Injector left every user app unable to open, recoverable only by editing
the registry in mass storage mode or by a hard reset. That is reported upstream, not measured
here, but it belongs in the decision.

## Known limits

- The Store lookups, search and images are served over **HTTP on port 80**, not only TLS;
  the lab listens on both.
- **Certificate pinning** in the Store app would defeat interception; it would show up as
  a TLS error in the logs.
- A **PC that is also pointed at the lab's DNS** resolves a hijacked name to the lab
  itself, so relaying it upstream would call back into the lab, once per hop. That is
  refused immediately as `upstream_loop` (counter `upstreamLoops`) instead of timing
  out; the fix is to put the PC back on the router's DNS, since only the device is
  meant to use the lab.
- Captures can contain **account tokens**: `captures/` is gitignored, do not publish it.
- The full, detailed operator documentation is the Italian lab document:
  [`README.it.md`](README.it.md).
