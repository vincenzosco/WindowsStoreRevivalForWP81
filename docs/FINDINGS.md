# Findings

What we know about this phone, the Store and the lab — each entry with the method that showed
it and, just as important, the line that says what it does **not** show. Rules for adding one
are in [`README.md`](README.md).

Device under measurement: Nokia Lumia 625 (RM-941), Windows Phone 8.1 Update 2, `os=8.10.14219.0`,
`hw=402699266`, `dm=RM-941_eu_france_308`, `cc=IT`, on the LAN as `192.168.0.136`; the lab runs on
the PC at `192.168.0.220`. Where the clock matters: the device's `EdmCache` timestamps are
**local** (UTC+2 here), the lab's capture index is **UTC**, and today the same event appears as
`17:56:07` local and `15:56:07Z`.

## Numbers worth having in one place

| What | Value | How it was read |
| --- | --- | --- |
| Lab root CA | `WP Store Lab Root CA`, SHA-1 `2DE30E6BB059296AB07F5754511D97E16ED81D8D` | `npm run doctor` |
| Phone hive that carries it | `Windows\System32\config\SOFTWARE` on the mounted mass-storage volume | `npm run make-rootreg -- --phone` |
| Certificates in `Root\Certificates` | 10 before the install, 11 after | hive read on this PC, 2026-10-15 |
| Hive written to the device | byte-identical, SHA-256 `51DB8FD46E1683585A1D5600B1EEC902283A423ED938242A9DFFF71A9A23B6D6` | `certutil -hashfile` on both copies |
| Page the device cached | 29893 bytes, SHA-256 `3226D56F7930A6312F6FE008DB205EF528151DC3EA9FBECDE435915DC2A12923` | elevated readout on the phone, 2026-10-15 — re-take with `tools/phone-readout.ps1` |
| Page built today from the fixture | 29893 bytes, identical except `<a:updated>` | `npm run store:page`, `.selftest/cmp.fresh.txt` |
| Checks in the suite | 99, all passing | `npm run selftest`, 2026-10-15 |
| Page grammar the parser walks | 27 paths declared, 22 required, all 22 carried by the page — in both document shapes | `npm run selftest` |
| Difference between the page we serve and the page `store:page` builds | 116 bytes, the six `Flight`/`SEG0`-`SEG5` parameters the phone sends and the tool's reconstruction omits | replay of the phone's own query, 2026-10-15 |
| Machine-verified vocabulary | every page type, template type, path and offset still present on the phone | `npm run read-vocabulary` (needs the phone mounted) |

## F-001 The backend is gone, so the page has to be produced here

- **Date** 2026-10-15 · **Area** lab
- **Question** Can the phone's Store request simply be forwarded to the real service?
- **Method** Resolve the Store hosts from the PC through a public resolver, so the lab's own DNS
  cannot answer instead, and read what the CDN edge replies.
- **Evidence** `marketplaceedgeservice.windowsphone.com`, `catalog.zune.net` and
  `wscont*.apps.microsoft.com` are NXDOMAIN; `cdn.marketplaceedgeservice.windowsphone.com` still
  resolves to Akamai and answers `503 Service Unavailable - DNS failure`. Reproduced in `README.md`
  under *Status*, and re-checked by `npm run rehearse`.
- **Conclusion** The front door is up and the origin is gone. Forwarding cannot help; the page is
  built in `src/store/` and served.
- **Does not establish** Whether a *different* Microsoft host still serves any part of the old
  protocol. Nothing found so far does, and nothing here has been tested against a live Store.

## F-002 The page the client wants is identified by a number, not a name

- **Date** 2026-10-15 · **Area** page grammar
- **Question** Which template does a WP8.1 Store page select, and how does it say so?
- **Method** Read the parsing client and the UI asset DLL out of the mounted phone, locate each
  name and hold the byte offset it came from; then assert those offsets again from the device.
- **Evidence** `src/store/vocabulary.mjs` carries the offsets; the UI assets style
  `Store_Hub_TemplateType003/004/015/017`, `Store_Chart_TemplateType010` and
  `Store_DynamicHubStyle_*` (offsets 57209, 57252, 57288). `npm run read-vocabulary` re-derives all
  19 of them from the phone and fails on drift.
- **Conclusion** A hub page is rendered with `003` - a number. A name (`DynamicHub`, or the
  archived page's `GamesHub`) is a token this client cannot style, and the page must also carry a
  `<Panes>` block it had been missing entirely.
- **Does not establish** Whether `003` is the *right* layout for what our page contains; it is the
  layout that describes plain ordered lists of applications, which is what a generated page has.

## F-003 The client's own cache is readable, and it holds the page we served

- **Date** 2026-10-15 · **Area** device evidence
- **Question** Can we see, from the device itself, that the page arrived — instead of inferring it
  from the PC side?
- **Method** Phone in mass storage mode; elevated readout of the whole device tree, with the
  relevant files copied out: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/phone-readout.ps1`.
  Report and copies land under `.selftest/`, which **`npm run selftest` wipes on every run**: the
  **elevated** readouts taken earlier on 2026-10-15 are gone for that reason (the `EdmCache` copy
  directory is there and empty), while the unelevated report of 18:49 and the crash-report copy
  survived, having been written after the last suite run. Which of the two halves survives is a
  matter of timing, not of design, so this finding stands on the command and not on the file
  (see the rule in `README.md`).
- **Evidence** `Data\SharedData\EdmCache\Short\0` holds four entries keyed by the exact request:
  15:31:19, 16:14:09 and 16:25:22 are **14 bytes** and read `{"probe":true}` (SHA-256
  `C775500EA34EDED73C2A3C3BEDE193F0D839E6C14B36F21B6CC31472E0720A91`) - the body of an earlier
  probe listener, not of the Store. 17:56:07 is **29893 bytes**, begins
  `<?xml version="1.0" encoding="utf-8"?><StorePage>`, and carries nine `<a:updated>` values, all
  `2026-10-15T15:56:07.000000Z`.
- **Conclusion** The client fetched the lab's page and stored it, byte for byte. Comparing the copy
  against the page built here today (`.selftest/compare-cached.mjs`) leaves **one** difference in
  the whole document: that timestamp. The cache is a faithful record of what the client was served,
  which is what makes the identical copy evidence.
- **Does not establish** That the page was **parsed or rendered**. A stored response is not a
  parsed one, and the reader is denied the place where that answer would be written (F-004).

## F-004 The Store client's private state is out of reach, even elevated

- **Date** 2026-10-15 · **Area** device evidence
- **Question** Can we read the Store app's own database or logs to see what it did with the page?
- **Method** Elevated readout as above, including `icacls` on each level of the tree.
- **Evidence** `Data\Users\DefApps` is owned by `NT AUTHORITY\SYSTEM` and grants
  `BUILTIN\Administrators:(OI)(CI)(F)` - a normal read of the file listing works. One level down,
  `Data\Users\DefApps\APPDATA` is owned by `S-1-5-21-2702878673-795188819-444038987-2781` and
  answers `Accesso negato` **to an elevated prompt**, so inheritance was cut deliberately and
  `Data\...\APPDATA\Local\Packages` cannot be listed (`Accesso negato`) either.
- **Conclusion** The app's own state is not readable by taking the drive; it would need an
  ownership change (**a write** to the phone's filesystem, and not one this project has done).
- **Does not establish** That the state would be informative if read. It is simply not available
  this way, and that is why the readable signals - `EdmCache`, `Public\Documents`, the exported
  logs - are the ones this register uses.

## F-005 The client fetches the page and never asks for anything else

- **Date** 2026-10-15 · **Area** Store client behaviour
- **Question** What does the phone do with the page? The whole open question of this project.
- **Method** Phone in normal mode with the lab running; the lab's capture index and the live view
  `npm run watch` record every request the device makes and the lab's answer.
- **Evidence** In the 2026-10-15 evening session the device made **13** requests, all of them the
  same one: `GET http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages?typeId=DynamicHub.Main&…`
  on **plain HTTP port 80**, user agent `ZDM/4.0; Windows Mobile 8.1`, with
  `x-wp-client-config-version: 81001`. Each was answered `200`, `application/atom+xml`, with the
  lab's page (`x-lab-protocol: storePages`, `x-lab-sections: 8`; 29893 bytes, or 55234 for the
  longer earlier build). Between 18:30:34 and 18:33:23 local it asked three times in under three
  minutes and then stopped. **No follow-up request of any kind** - no image from
  `marketplaceimages`, no detail page, no `POST /v8/catalog/updates`.
- **Conclusion** Delivery works and the page is not being turned into content: the client re-fetches
  on a one-to-two-minute cycle instead of rendering and moving on. What the user sees on screen is
  that cycle - a Store that keeps loading.
- **Does not establish** *Why*. An unparsed page and a parsed-but-empty page look the same from
  here, and the reader is denied the client's own state (F-004). The candidate variables are
  recorded as open experiments below, one at a time.

## F-006 `ssl-api.bing.com` is dead, and the 502 is not the lab's doing

- **Date** 2026-10-15 · **Area** suspected cause, ruled out
- **Question** The client asked for a client-configuration file and received `502`. Is the lab's
  diagnostic hijack the cause?
- **Method** Read the exchanges from the capture, then make the same request from the PC, which is
  not pointed at the lab's DNS.
- **Evidence** The client asked three times (16:08:31, 16:20:47, 16:21:05) for
  `https://ssl-api.bing.com/winphone/clientconfig/rwsettingbluegdr1qfex.xml` and the lab's relay
  answered `502`. From the PC, the same URL gives `curl` code **000** - no connection at all, to
  `150.171.73.13`. `ssl-api.bing.com` does resolve; it does not answer.
- **Conclusion** The host is gone, not the hijack. Removing `ssl-api.bing.com` from the hijack list
  would change nothing for the device, which is why it was not tried.
- **Does not establish** That the file is irrelevant to rendering. It is unavailable from the real
  network too, so the client has to cope without it either way - but a client that gives up on its
  own config before drawing a page is a plausible mechanism, just not one this rules in or out.

## F-007 The device's own error log is not Store evidence

- **Date** 2026-10-15 · **Area** suspected evidence, ruled out
- **Question** `Data\Users\Public\Documents\Non-Production Errors.txt` is rewritten at every
  shutdown - does its content say anything about the Store?
- **Method** Read the file in full, elevated, at 18:12 on 2026-10-15 (924 bytes, written 18:08:18).
- **Evidence** All of it is the production self-test header plus five lines: twice
  `TEST FAIL: BCD: Found banned Element BCDE_LIBRARY_TYPE_DISABLE_INTEGRITY_CHECKS`,
  `TEST FAIL: UMCIAuditMode is Enabled`, `TEST FAIL: UEFIVariable: SecureBoot is not enabled`,
  `TEST FAIL: Secure Boot is not provisioned for Bitlocker, the binding state is 0x00000000`.
- **Conclusion** That is the device's unlock state - integrity checks off, UMCI audit on, Secure
  Boot off - written by the factory self-test, and it says nothing about the Store. The file's
  stamp is a boot/shutdown event, not a Store event. **That reading was confirmed the same
  evening**: the same bytes came back with the stamp `18:20:36`, eight minutes later and with
  nothing in between but the phone being halted for mass storage mode - same content, new stamp,
  no Store traffic involved.
- **Does not establish** Anything about failures elsewhere; a crash of an **application** lands in
  a different place, `Data\Users\Public\Documents\Debug\<app> … .error.txt`, which is where a Store
  assert would be found (open experiment E-002).

## F-008 The EDM "keeper" is not Store evidence either

- **Date** 2026-10-15 · **Area** suspected evidence, ruled out
- **Question** `Data\SharedData\EdmCache\Keepers\CDCOutput00000002.xml` is written 17:51:23, five
  minutes before the page is fetched. Is it a trace of the client's work?
- **Method** Extract both keepers and hash them; read the content.
- **Evidence** Both are 374 bytes and **byte-identical**: SHA-256
  `5D2FD67878685B09465E479AB19438EE85132E587250F76E0D145346AD2685F2`, dated 2016-12-25 21:45:35 and
  2026-10-15 17:51:23. The content is `Cellular`/EDM modem XML (IMEI, capability bytes).
- **Conclusion** The same keeper, re-written. Its proximity to the page fetch is coincidence; it
  happens on an EDM evaluation, not on a Store request.
- **Does not establish** What triggers the rewrite, which nothing here needed to know.

## F-009 An app cannot patch this phone, which is why the app is gone

- **Date** 2026-10-15 · **Area** route decisions
- **Question** Can an interop app install the CA on this build, doing away with the cable?
- **Method** An on-device patcher was built and deployed to the Lumia over USB, and its reports
  were pulled back with ISETool; it ran its probe on launch.
- **Evidence** Every native call refused, each line carrying the runtime's words:
  `NotSupportedException: DllImport cannot be used on user-defined methods`. Registry read, registry
  write and the certificate-store API all report `False`.
- **Conclusion** The app could never write the certificate store, and could not read it either.
  What was left - writing the import file onto the phone for the phone's own console - costs a cable
  and a boot and lands on the same certificate the hive edit puts in place. The app
  (`StorePatcher/`, `tools/app.mjs`) was removed from the repository on 2026-10-15.
- **Does not establish** That no mechanism exists. A native component or a full-trust deployment
  would, and both are still blocked: the WP8.1 ARM compiler is not installed on this machine.

## F-010 The route that works: edit the phone's hive in mass storage mode

- **Date** 2026-10-15 · **Area** route
- **Question** How does the lab root CA get onto the device, verifiably?
- **Method** Phone in mass storage mode, mounted as a drive; copy its `SOFTWARE` hive, load it here,
  add the serialized entry, read it back, put the copy back, compare hashes; then reboot the phone.
- **Evidence** The device enumerates as a 7.28 GB `Qualcomm MMC Storage USB Device`; the user volume
  is NTFS, 1.75 GB, and carried `Data`, `Windows`, `DPP`, `EFIESP`, `MMOS`, `USERS`, `PROGRAMS`.
  The hive that ended up on the device was byte-identical to the copy whose entry had been read
  back (`51DB8FD4…`, above); reading it off the phone a second time found the certificate and no
  other difference. Rollback copies: `ca/phone-backups/SOFTWARE.original.hive`
  (`042679E7…`) and `SOFTWARE.before-ca.hive` (`510BBE09…`).
- **Conclusion** This is the measured route, and it needs no app, no unlock and no boot on the
  phone. Full procedure and its two traps (`reg import` silently writing nothing; `reg unload`
  answering `Accesso negato` while a handle is open) are in `README.md`, *Mass storage mode*.
- **Does not establish** The drive letter, which is a property of this PC's session and not of the
  device: it was `G:` in the first session and `H:` on 2026-10-15 evening. Readouts discover the
  volume by looking for `\Data\SharedData\EdmCache` rather than assuming a letter.

## F-011 The most deceptive failure was a port, not a certificate

- **Date** 2026-10-14/15 · **Area** lab
- **Question** The device resolved a hijacked name and then nothing happened. Why?
- **Method** Watch for the connection the device was supposed to open, with the firewall rule for
  `node.exe` in place and no port restriction.
- **Evidence** The device asked for `cdn.marketplaceedgeservice.windowsphone.com` roughly every 35
  seconds, received the hijack, and **never opened TCP 443** - no accept in the direct listener, so
  a SYN would have been seen. The 8.1 Store's lookups, search and images are served over **plain
  HTTP on port 80**, per Microsoft partners' own firewall guidance for Windows 8.1 store access
  (`http://marketplaceedgeservice.windowsphone.com`,
  `http://cdn.marketplaceimages.windowsphone.com`, "HTTPS 443, HTTP 80").
- **Conclusion** A DNS hijack that listens only on 443 gets the most misleading failure available:
  the device resolves to the lab, opens port 80, gets a RST because nothing is listening, retries -
  and the only trace is another DNS query. Hence the `proxy.httpPort` listener (default 80), which
  now accepts those requests, routes them through rules, handlers and capture, and answers with a
  readable 502 instead of silence.
- **Does not establish** That the device never uses TLS for the Store. It does - the capture has
  `https://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages` answered `200` through
  the MITM - so both listeners earn their place.

## F-012 The capture mixes this PC's replays with the device, so traffic has to be sorted before it is read

- **Date** 2026-10-15 · **Area** lab evidence
- **Question** The session report attributes 113 exchanges to the device, including `POST /v8/catalog/updates`,
  six `wscont*` hosts and requests to `marketplaceimages`. F-005 says the device asked for the page and
  nothing else. Which is right?
- **Method** Read `captures/session-2026-10-15_15-36-48/index.jsonl` per exchange rather than in
  aggregate, and separate by `client.address` and `request.headers['user-agent']`. This PC replays the
  device's requests through the lab with `user-agent: wp8-store-lab-rehearsal` and arrives from the lab's
  own address, `192.168.0.220`, which is exactly why the aggregate cannot tell them apart.
- **Evidence** Of 113 exchanges, **75** carry `wp8-store-lab-rehearsal` from `192.168.0.220` — this PC.
  Of the 24 that came from elsewhere, three distinct requests exist in the whole session, over four
  hours: 12× `GET http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages?typeId=DynamicHub.Main
  &…&Flight=&SEG0=&SEG1=&SEG2=&SEG3=&SEG4=&SEG5=&optedOut=true` (all `200`, one single parameter shape,
  from `192.168.0.136`), 8× `HEAD http://account.nokia.com/` (`502`, agent `MSIE 10.0 … Windows Phone OS 8.0`,
  pairs 10 s apart and hourly at `:57:06`), and 4× `GET https://ssl-api.bing.com/winphone/clientconfig/…`
  (`502`, agent `Windows Phone Search`). Every `POST /v8/catalog/updates` in the session is ours.
- **Conclusion** F-005 holds and is stronger than it was: the device asked for **one** thing, over plain
  HTTP, and nothing else — no updates check, no image, no detail page — which is a narrower behaviour than
  the aggregate suggested, not a wider one. The requests that looked like follow-up activity are the
  lab's own rehearsal loop.
- **Does not establish** That the two `502`s (`account.nokia.com`, `ssl-api.bing.com`) are harmless: they
  are the device's own account and client-config traffic, they fail against the real network too (F-006),
  and they are logged by a different agent than the Store client's. Nothing here shows the Store reads them.
- **Method note** The separation was done with a throwaway script under `.selftest/`, which the suite has
  since deleted (`MAINTENANCE.md`, footgun 1). The two markers above are what make it repeatable in a few
  lines; the counts are recorded here so the number does not depend on the script surviving.

## F-013 The page carries the parser's whole grammar — and one of our tools inspects a slightly different page

- **Date** 2026-10-15 · **Area** page grammar
- **Question** The client fetches the page and loops. Is the page missing something the client's parser
  walks? The six paths this project had been checking are the six somebody picked out by hand, and the
  client's own list is longer.
- **Method** Read the parser's string run out of the phone's `ZMarketplace.dll` (`@28776`-`@33224`, the
  same extraction `npm run read-vocabulary` performs) and walk every path of the page grammar against the
  document the lab serves — and against the archived response of the real service, as the second witness.
  The walk is now a check in `npm run selftest`, so the question does not have to be answered by hand again.
- **Evidence** The grammar is 27 paths, 22 of them required: `/StorePage`, `/Panes/Pane`
  (`@28776`, beside the parser's own `Found %d Store Panes`), `/Templates/Template` (`@28824`, `Found %d
  Store Templates`), `/feed`, `/entry`, `/feed/entry`, `/feed/link`, `/feed/entry/id`, `/feed/impressionId`,
  `/feed/entry/editorialItems/editorialItem`, `/feed/entry/applications/application` and its `/id`,
  `/offers/offer` and the offer's `/displayPrice`, `/price`, `/licenseRight`, plus seven field names the
  parser reads relative to a node it selects first. **The served page carries all 22**, in both document
  shapes (`storePage` and `panes`), asserted as 22/22 by `npm run selftest`; the same walk over the atom
  shape reports 12 missing, which is what makes the check worth something. The five not carried —
  `/feed/isActionable` and the entry-level `/feed/entry/offers/offer…` spelling — are **also absent from
  the archived response**, so each is marked optional with that reason in `src/store/vocabulary.mjs` rather
  than invented into the page. The paths in the same string run that are *not* page paths (credit-card,
  payment-instrument, IAP-detail and application-detail responses; the chart/collection `StoreObject`
  model) are recorded there too, with the reason, so the next reader does not have to re-derive them.
- **Conclusion** There is no missing structural element to fix: the document carries everything the parser
  names, and the field names it does not carry are spelled in a case the real page does not use (the
  archive writes `averageUserRating`, the strings say `/AverageUserRating`), so the archived page settles
  the spelling and the strings do not. **A suspect is removed rather than added** — the loop in F-005 is
  not explained by a hole in the document, which is why E-001 tests the arrangement of what is there.
- **Does not establish** That the client *parses* what it is sent. Carrying a path is not walking it: the
  parser may require an order, a type or a value this comparison knows nothing about, and the device's
  verdict is still the only witness to that (F-003, F-005).
- **Tool defect found on the way** `npm run store:page` and `npm run rehearse` build their document from a
  **reconstructed** query that omits the six `Flight`/`SEG0`-`SEG5` parameters the phone actually sends
  (F-012) — 116 bytes of difference, and every one of them inside the echoed self link. The live handler is
  not affected: it echoes the request it received (`src/store/protocol.mjs`, the `selfHref: requestPath`
  line), which the replay above confirms. So what the *device* is served is right; what our *inspection
  tools* show is a page built from a nearly identical request.

## Open experiments

Each one changes **a single variable**, and each names the value it replaced so it can be put back.

### E-001 `pageFormat`: `storePage` → `panes`

- **Why** This is the difference between the generated page and the archived response of the older
  generation: in `panes`, each pane also carries its own `editorialItems` and `applications`
  inline, so the client is never asked to resolve a reference to content it has already been sent.
- **State ARMED** Changed in `config.json` (`livestore.protocol.pageFormat`), lab hot-reloaded, and
  the answer verified **from the PC**: `x-lab-page-format: panes`, 55234 bytes, 8 sections, and 17 of
  the document's 34 items now sit inside `<Panes>`. The next Store open on the phone gets this page,
  so the experiment runs itself: what it asks for *afterwards* is the result.
- **Re-verified against the running lab on 2026-10-15 18:23 UTC**, by replaying the phone's *exact*
  request (all 17 parameters, `Flight` and `SEG0`-`SEG5` included) from the PC over plain HTTP: `200`,
  `application/atom+xml; charset=utf-8`, `content-length: 55234`, `x-lab-page-type: DynamicHub`,
  `x-lab-template-type: 003`, `x-lab-template-types-known: 000,003,004,015,017`, root `<StorePage>`, and
  the page echoes the query it was asked for (F-013). What this does **not** establish: that the
  device received anything at all — it is the lab's own answer read from the PC, and the request on
  the wire is still the experiment.
- **Waiting for** The phone's verdict. A page it accepts should produce follow-up traffic (images, a
  detail page); a repeat of F-005's one-request cycle means no - and then the candidate moves to
  `templateTypeForm` (`attribute` vs `element`), which is the other open question about the same
  document.
- **Undo** Set `livestore.protocol.pageFormat` back to `storePage` and `POST /__lab/reload`.

### E-002 Look for the client's own crash report

- **Why** It is the only route to the client's *reason*: `Data\Users\Public\Documents\Debug\`
  already holds one such file for another app, while the Store's private state is denied even to
  Administrators (F-004).
- **Result, first half - read, and negative.** That directory is readable **without** elevation, and
  it holds exactly one file: `Jellyfin - 53bed9b8-6040-4fa9-8d92-c13b6192ae80 with exception
  C000027B on 10-11-2026 09.33.error.txt` (356 bytes, UTF-16LE, 2026-10-11 09:33:54). Its text is
  the dump wrapper, not the fault: *"We're sorry, but we
  encountered an error while generating '<name>.dmp'"* and `HRESULT: 0x9007012b` - so the crash
  detail is in a `.dmp` that is not on this volume. Nothing for the Store client is there, three
  days of Store fetches and a crash-to-disk requirement later.
- **Does not establish** That the client did not fault: it may simply not write a report here (one
  app does, and it wrote one only for a dump-generation failure). `Data\Users\Public\Documents\LiveStore`,
  created 2026-10-11, is an empty directory - checked, also without elevation.
- **Still open** The elevated half: the full `EdmCache` listing, the ACL probe and the sweep of
  `Data` for anything written after the last fetch (18:33:23 local). Deferred rather than
  approximated - those trees need `tools/phone-readout.ps1` at an elevated prompt, and it needs the
  phone in mass storage. The first half above needs neither, and is repeatable from any file
  browser: `H:\Data\Users\Public\Documents\Debug`.
