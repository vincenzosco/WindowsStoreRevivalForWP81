# Findings

What we know about this phone, the Store and the lab — each entry with the method that showed
it and, just as important, the line that says what it does **not** show. Rules for adding one
are in [`README.md`](README.md).

Device under measurement: Nokia Lumia 625 (RM-941), Windows Phone 8.1 Update 2, `os=8.10.14219.0`,
`hw=402699266`, `dm=RM-941_eu_france_308`, `cc=IT`, `x-wp-device-id`
`40752FEDCD7E0095C8BFAFB9D58575C236517C15679D2C37046971F4FD5A1872`; the lab runs on the PC at
`192.168.0.220`. **Identify it by that id, not by an address**: the router has moved it from
`192.168.0.136` to `192.168.0.137`, and two addresses on this LAN carry the same Nokia/Windows
Phone name fingerprint without being this handset (F-023). Where the clock matters: the device's
`EdmCache` timestamps are **local** (UTC+2 here), the lab's capture index is **UTC**, and today the
same event appears as `17:56:07` local and `15:56:07Z`.

## Numbers worth having in one place

| What | Value | How it was read |
| --- | --- | --- |
| Lab root CA | `WP Store Lab Root CA`, SHA-1 `2DE30E6BB059296AB07F5754511D97E16ED81D8D` | `npm run doctor` |
| Phone hive that carries it | `Windows\System32\config\SOFTWARE` on the mounted mass-storage volume | `npm run make-rootreg -- --phone` |
| Certificates in `Root\Certificates` | 10 before the install, 11 after | hive read on this PC, 2026-10-15 |
| Hive written to the device | byte-identical, SHA-256 `51DB8FD46E1683585A1D5600B1EEC902283A423ED938242A9DFFF71A9A23B6D6` | `certutil -hashfile` on both copies |
| `storePage` the device cached | 29893 bytes, SHA-256 `3226D56F7930A6312F6FE008DB205EF528151DC3EA9FBECDE435915DC2A12923` | elevated readout on the phone, 2026-10-15 — re-take with `tools/phone-readout.ps1` |
| `panes` page the device cached | 55234 bytes, SHA-256 `38E904A1F685AE9F9E1B71DF3B809A951D798BD5461E604FDCBBBD1355ED4FBE` | same command, elevated, 21:05 — and it is **byte-identical** to the response the lab served (below) |
| Page cached on 2026-10-17, the first one fetched **with** a page cookie | 58 555 bytes, name `Short\9\7f3c9a52b1e84d0f9a6c2e58d4b1073c$48b1e555.zmz`, written 14:06:48 local = `12:06:48Z`, two seconds after the delivery | elevated readout 2026-10-17 14:44; the name filter in that tool did not match it until the same day (F-026) |
| A stored `LKGOEMStoreConfigOverride` / `LKGMOStoreConfigOverride` on the phone | **none** — 0 hits in `SOFTWARE`, in `SYSTEM` and in every readable user hive, byte scan and mounted-hive query | mass storage 2026-10-17 14:41, F-026 |
| The page cookie, round trip | reply header `x-wp-storepage-cookie` → `HKLM\...\Microsoft\Zune\Settings\WPSStorePageCookie` → the client's next request carries it, same 32 hex | capture `12:06:46.867Z` + hive read 2026-10-17 |
| The control's answer | **error `0xc00cee23` on the handset**, one open, where the built page had drawn silence | request `13:02:01.328Z` from `.137`, `200`, 872 bytes, `x-lab-control: malformed`; F-027 |
| The same document through `msxml6` on this PC | `0xC00CE55F` (missing `>` in the end tag) — same facility `0xC00C` as the handset's code | `loadXML('<StorePage><Panes><Pane><index>1</index')`, 2026-10-17 |
| Three verdicts for one URL, one set of request headers | built page → **accepted, silent**; control (truncated) → **`0xc00cee23`**; archived real v8 page → **`88675309`** | requests at `12:06:46`, `13:02:01` and `13:15:05Z`, F-027 and E-010 |
| The served response that file matches | `bodies/0117-res.bin`, 55234 bytes, SHA-256 `38E904A1F685AE9F9E1B71DF3B809A951D798BD5461E604FDCBBBD1355ED4FBE` — the delivery at `2026-10-15T18:47:27.289Z` | `captures/session-2026-10-15_15-36-48/index.jsonl` + `bodies/`, `sha256sum` |
| What the device wrote about the Store in the whole session | **one** file — the cached page above. 84 files under `Data` since 17:00, 18 past the hive/telemetry/ETW filter, 1 of them Store-related | elevated readout, 2026-10-15 21:05 |
| Page built today from the fixture | 29893 bytes, identical except `<a:updated>` | `npm run store:page`, `.selftest/cmp.fresh.txt` |
| Checks in the suite | 169, all passing | `npm run selftest`, 2026-10-20 (155 before F-037 to F-041 added six; four with F-044, two with F-046, one with F-048, one with F-049) |
| Exchanges in `captures/` | 487 480 over 28 sessions, of which **109 are a device's** - 99.98 % of the index is this PC | `npm run analyze -- --all-sessions`, 2026-10-16 |
| DNS records in the same capture | 19 615 from 21 addresses, and only **8 639** are this PC's - a `.151` that asks for `a.root-servers.net` 6 437 times, not the phone | same command |
| Devices the requests identify in that capture | **two** handsets: `x-wp-device-id 40752FED…5A1872` (the one above) and `3499541B…EEA32B`, `os=8.10.14226.0`, `dm=RM-941_eu_hungary_356`; the two overlap for 2 h 38 m on 2026-10-15 | same command |
| What the measured handset asked for in the whole capture | **96** exchanges at `.136` and `.137`: 67× the page, 7× the `catalog.zune.net` root, 4× `OEMStores/NOKIA` + 4× `MOStores/`, 1× `POST /v8/catalog/updates`, 4× `HEAD account.nokia.com`, 9× `ssl-api.bing.com` - the second handset's 13 exchanges are not in that list | same command |
| Page grammar the parser walks | 27 paths declared, 22 required, **all 22 carried, 0 missing**: 10 spelled exactly, 12 under the atom prefix the real service also used | `npm run page:diff`, `npm run selftest` |
| Difference between the page we serve and the page `store:page` builds | 116 bytes, the six `Flight`/`SEG0`-`SEG5` parameters the phone sends and the tool's reconstruction omits | replay of the phone's own query, 2026-10-15 |
| Machine-verified vocabulary | **69 checks against the device itself** - every page type, template type, the parser's whole path run and every byte offset, all present where the module cites them | `npm run read-vocabulary -- --device H:`, 2026-10-15, exit 0 |
| Does the check detect drift? | Yes: against a copy of `ZMarketplace.dll` shifted by one byte, 64 of 69 fail and the message names where the string actually is (`cites @28776 ... the path itself is at @28775`) | `--device` on a tree holding the shifted copy, 2026-10-15, exit 1 |

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
  (see the rule in `README.md`). The 21:05 report below was copied out of `.selftest/` **before**
  the next suite run and compared by hash (`%TEMP%\wp-massstorage\readouts-2026-10-15\elevated-2105.txt`)
  — `%TEMP%` is no more durable than `.selftest/`, which is the point of keeping the command.
- **Evidence** `Data\SharedData\EdmCache\Short\0` holds four entries keyed by the exact request:
  15:31:19, 16:14:09 and 16:25:22 are **14 bytes** and read `{"probe":true}` (SHA-256
  `C775500EA34EDED73C2A3C3BEDE193F0D839E6C14B36F21B6CC31472E0720A91`) - the body of an earlier
  probe listener, not of the Store. 17:56:07 is **29893 bytes**, begins
  `<?xml version="1.0" encoding="utf-8"?><StorePage>`, and carries nine `<a:updated>` values, all
  `2026-10-15T15:56:07.000000Z`.
- **Re-measured 2026-10-15 21:05, against the served response rather than against a rebuilt page,
  and it is now exact.** Same command, elevated, with `panes` armed (E-001). The same cache slot
  holds the same request key and a **55234-byte** entry, `…$50f7756$5D37.zmz`, written **20:47:27
  local**: `<?xml version="1.0" encoding="utf-8"?><StorePage><Panes><Pane><index>1</index><title>social</title>…`,
  34 `editorialItem` (17 of them inside `<Panes>`), `StorePage` at offset 39, `<a:entry` at 27495, and
  nine `<a:updated>` values **all** `2026-10-15T18:47:27.000000Z`. Hashing it gives `38E904A1…`;
  hashing `bodies/0117-res.bin` — the body this lab served at `2026-10-15T18:47:27.289Z`, which is the
  only delivery in the capture in that second — gives `38E904A1…`, 55234 bytes, `application/atom+xml`,
  no `content-encoding`. **The device's cache file is the served response, byte for byte**, and the
  stamp inside the document is the delivery instant to the millisecond. The three 14-byte
  `{"probe":true}` entries and their single shared hash are still there beside it.
- **Conclusion** The client fetched the lab's page and stored it, byte for byte. The earlier reading
  compared the copy against the page built here today (`.selftest/compare-cached.mjs`) and left **one**
  difference in the whole document - that timestamp; the re-measurement removes even the need for that
  comparison, because the copy matches the *served bytes* by hash. Whatever else is in doubt, delivery
  and persistence are not: the document the lab emits is the document the device keeps.
- **Does not establish** That the page was **parsed or rendered**. A stored response is not a
  parsed one, and the reader is denied the place where that answer would be written (F-004). Nor does
  it show the cache was *read* after being written: a file written and never used looks the same here,
  and F-015 is the search for anything the client wrote after using it.

## F-004 The Store client's private state is out of reach, even elevated

- **Date** 2026-10-15 · **Area** device evidence
- **Question** Can we read the Store app's own database or logs to see what it did with the page?
- **Method** Elevated readout as above, including `icacls` on each level of the tree.
- **Evidence** `Data\Users\DefApps` is owned by `NT AUTHORITY\SYSTEM` and grants
  `BUILTIN\Administrators:(OI)(CI)(F)` - a normal read of the file listing works. One level down,
  `Data\Users\DefApps\APPDATA` is owned by `S-1-5-21-2702878673-795188819-444038987-2781` and
  answers `Accesso negato` **to an elevated prompt**, so inheritance was cut deliberately and
  `Data\...\APPDATA\Local\Packages` cannot be listed (`Accesso negato`) either.
- **Re-confirmed 2026-10-15 21:05**, in full and with the owners: `Data\Users\DefApps` is owned by
  `NT AUTHORITY\SYSTEM` and grants `…SYSTEM:(OI)(CI)(F)`, `BUILTIN\Administrators:(OI)(CI)(F)`,
  `S-1-5-21-2702878673-795188819-444038987-2781:(OI)(CI)(F)` and
  `ALL APPLICATION PACKAGES:(RA)`. `Data\Users\DefApps\APPDATA` is owned by
  `S-1-5-21-2702878673-795188819-444038987-2781` and refuses the elevated prompt. So the app's SID
  has the access, `Administrators` have none, and inheritance was cut on purpose.
- **The same probe explains the asymmetry that cost the earlier searches their answer** (F-015,
  E-002): `Data\SharedData` is owned by `NT SERVICE\TrustedInstaller` and grants
  `BUILTIN\Administrators:(F)` — no `Users` entry at all. A normal prompt is denied and an elevated one
  reads the tree, which is exactly why the unelevated sweep reported *nothing touched* while the
  elevated one found the cached page (F-003). Elevation is not a nicety here; it decides which
  questions can be answered.
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
  lines; the counts are recorded here so the number does not depend on the script surviving. **The agent is
  not one of those markers and never was** (F-023): this entry used `client.address` first and the agent
  second, which is why its conclusion still holds, but a reader who kept only the agent would call 308 354 of
  this PC's exchanges the phone's. The command is now `npm run analyze`, and it prints the separation the
  session once needed a script for.

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

## F-014 The `panes` variant changes nothing on the device

- **Date** 2026-10-15 · **Area** Store client behaviour
- **Question** E-001's question: is the reason the client does not render that each pane points at
  content the client is expected to resolve, rather than carrying it inline as the archived response did?
- **Method** `livestore.protocol.pageFormat` set to `panes` in `config.json`, lab hot-reloaded, and the
  device's own requests read per exchange — by `client.address` and `user-agent`, which is what makes them
  the device's (F-012). The verdict is what the device asks for *after* each delivery.
- **Evidence** The device was served the `panes` document **six times over three hours**, each time
  `200`, `x-lab-page-format: panes`, 55234 bytes: 17:37:19, 17:37:30 and 17:37:43 local, then 18:37:57 and
  18:38:50, then 20:40:51. Between and after all six it asked for nothing else — no image from
  `marketplaceimages`, no detail page, no `POST /v8/catalog/updates` — and its next Store request, minutes
  or an hour later, was the same page again. In the same session it also met the `storePage` shape seven
  times (29893 bytes, 17:48-18:33): same behaviour, same silence. The two shapes are the only difference
  between those deliveries, and the device's answer was identical.
- **Conclusion** The hypothesis is removed: the client is not waiting for the items to be carried inline,
  and the arrangement of what the page contains is not what stops it. The variable list for the document
  narrows to the one thing the vocabulary itself flags as undecided — `templateTypeForm` — and to causes
  outside the document entirely (E-003).
- **Does not establish** That the `panes` shape is *wrong*; it was never shown to be right either. Nothing
  here shows the client parses the page at all, and the two shapes failing the same way is as consistent
  with a failure before the parse as with one inside it.

## F-015 The only thing the device wrote about the Store was the page itself

- **Date** 2026-10-15 · **Area** device evidence (the device-side bound on F-005)
- **Question** The client re-fetches the page and never settles (F-005). Whatever it is doing with each
  delivery, does it *write* anything down — a state file, an index, a log, a crash report?
- **Method** Phone in mass storage, elevated, sweep of the whole `Data` tree modified after a threshold set
  before the session: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/phone-readout.ps1
  -Since "2026-10-15 17:00" -Keepers`, with registry hives, telemetry and ETW blobs filtered out and files
  above 4 MB skipped.
- **Evidence** **84** files under `Data` were touched after 17:00; **18** survive the filter, and exactly
  **one** of them is Store-related: the `EdmCache` entry written at `20:47:27` local (F-003). The other 17
  are a boot: `Sru` (`18:40:27`, `20:55:39`), `casvcdatabase` (`18:20:45`, `20:20:41`), the `Speech`
  grammars, `CAUpload\Contact\contacts.json` and the OEM logs at `20:20:23`-`20:22:25`,
  `Non-Production Errors.txt` at `20:20:30` (F-007), `FveEnableSvc.log` at `20:21:35` (*Failed to query
  secure boot status*, `0x80071149`) — and `Data\SharedData\Comms\Unistore\data\AggregateCache.uca`, the
  Store's own catalogue cache, **4 bytes written at `20:21:42`**, i.e. an empty cache created at boot and
  not touched again during any of the deliveries. One write is not boot noise:
  `Data\ProgramData\MICROSOFT\IdentityCRL\production\ppcrlconfig600.dll`, 27016 bytes, **`17:37:28`**.
  *Measured*: the file, its size and its time, which falls between two page fetches (`17:37:19`, `17:37:30`)
  and inside the window in which the client resolved `login.live.com`, `clientconfig.passport.net` and
  `go.microsoft.com` (E-003). *Inferred*: that this is the account stack refreshing its own configuration,
  which is what the path and the window suggest and what nothing here proves.
- **Conclusion** Across a whole session and six `panes` deliveries, the device's only Store-shaped write is
  the page it was served. No index, no state, no client log, no crash report (E-002), and
  `Documents\LiveStore` has held **no file** since it was created on 2026-10-11. So the loop in F-005 is not
  being driven by anything the client records: the page arrives, the client comes back for it, and in
  between it leaves nothing behind to read.
- **Does not establish** That it did not *use* the page — reading leaves no file, and F-004 still stands.
  The sweep is also bounded: files above 4 MB are skipped, only `Data` is walked, and the threshold is a
  clock, not a session. And the one place the client would most plausibly write state,
  `Data\Users\DefApps\APPDATA`, is outside the sweep because it is denied even elevated (F-004).

## F-016 The readout could have measured this PC and called it the phone

- **Date** 2026-10-15 · **Area** tooling (and a limit on the readings above)
- **Question** The phone's volume is *discovered*, never assumed (F-010). Can that discovery pick the wrong
  volume and still produce a complete, confident report?
- **Method** Run `tools/phone-readout.ps1` elevated and read its first section, which prints every volume
  with its markers and the choice it made.
- **Evidence** A run of the tool printed `C: NTFS 952.72 GB  punti 0  marker:
  \Windows\System32\config\SOFTWARE  <- questa macchina` and `H: NTFS 1.75 GB  punti 6`, and then
  `volume scelto : C:`. It matched **this PC's own Windows installation**, because the marker list accepted
  a path that is not phone-specific and the selector took the first volume with any hit — and the report
  that followed described this machine, with the phone's logs, cache and ACLs all reading *absent*. That
  report was overwritten by the corrected run and `.selftest/` is scratch (footgun 1), so what stays
  durable is the selector's output format and the fix: `tools/phone-readout.ps1` now weights its markers
  `3` for `\Data\SharedData\EdmCache`, `2` for `\Data\Users\Public`, `1` for `\Data\SharedData` and `0`
  for the `SOFTWARE` hive — listed so it prints, weightless so it can never decide — excludes
  `$env:SystemDrive` outright, takes the highest score, and prints each volume's score, the markers that
  produced it and a `<- questa macchina` label. Re-run 21:05:
  `H: … punti 6  marker: \Data\SharedData\EdmCache + \Data\Users\Public + \Data\SharedData + \Windows\…\SOFTWARE`,
  `C: … punti 0 … <- questa macchina`, `volume scelto : H:  (punti 6)`.
- **Conclusion** A heuristic device probe has to print *why* it chose what it chose, and the choice has to be
  falsifiable from the report alone — otherwise its worst failure is not an error but a confident report
  about the wrong machine, and the person reading it cannot tell the difference. `\Data\Users\Public` and
  `\Data\SharedData` carry weight because a Windows *installation* does not ship them, not because nothing
  else can have them; the hive is the one marker that only ever distinguishes an unlocked phone from a
  locked one.
- **Does not establish** That the readings taken before the fix are wrong. Where they are phone-only they
  cannot be about this PC: an ACL block for `Data\Users\DefApps` and an `EdmCache` entry whose body is the
  served `StorePage` (F-003) have no counterpart on this machine, so those readings stand — which is the
  check to run on any readout that is suspected, not the fix's date.

## F-017 What the binary settles about the page, and the one field every real offer sends

- **Date** 2026-10-15 · **Area** page grammar (the part F-013 left open)
- **Question** F-013 walked the paths the parser names and found the page carries all of them. Are there things
  the same binary settles that no path walk can see - an element nothing reads, a token that is not a path, a
  field the real service sends that the page does not?
- **Method** Read the *whole* run of path strings out of `H:\Windows\System32\ZMarketplace.dll` (all 264, not the
  page family alone), the two string runs in `ZuneAssets480x800.dll`, and the two `Lib` entries of 2026-10-07 that
  an elevated pass copied off the phone's `EdmCache` - entries written three days before this lab existed, so
  they cannot be ours (F-003, F-015).
- **Evidence**
  - **`templateName` and `mimeType` appear nowhere in the parser's string run.** The client does not read the
    template block's children at all: the archived page's `<templates><template><mimeType>application/uix</mimeType>
    <templateName>GamesHub</templateName></template></templates>` is v8 decoration for a parser that no longer
    exists, and `livestore.protocol.hubTemplate` writes an element nothing on this phone reads. It is inert, not
    wrong - which is a different thing to record.
  - **`TEMPLATETYPE` is not a document path.** Every path in that run carries a leading `/` (`/Panes/Pane`,
    `/Templates/Template`, `/feed/entry`); `TEMPLATETYPE` does not, and it sits with `rel`, `next` and `href` -
    the names `CAtomParser::ParseNodeAttributes` and `ConsumeAttributes` consume. So the token travels as an
    **attribute**, and `templateTypeForm: both` cannot be what stops the client: the child element it also writes
    has the path `/Templates/Template/TEMPLATETYPE`, a path this run does not name, and a walker that looks up
    paths it does not know ignores it. **E-003's first variable is answered without an experiment**, and `003`
    stays zero-padded because the UI names it `Store_Hub_TemplateType003ListItem_Padding` - a string lookup needs
    the padded form, an integer lookup accepts both.
  - **`/mediaInstanceId` is a path the parser reads, and every one of the 42 offers** in the archived response of
    the real service carries one (`<offer><offerId/><mediaInstanceId/><clientTypes/>...`). The lab's offers carry
    none: 34 of them. The same string region holds `PendingMediaLocationFetchV4::Begin` beside
    `wszLicenseType '%S' wszMediaInstanceId '%S'`, so a media instance id and a licence type are the pair the
    client hands the location fetch - and a location fetch is the only route it has from an item to its artwork.
  - **The two 2026-10-07 `Lib` entries are real artwork.** Both are JFIF/JPEG (102 560 and 78 613 bytes, `/Lib/8`
    and `/Lib/20`, 464x464 per the SOF0), downloaded from the real service's CDN at 14:28 and 14:33 that day. The
    store was serving this phone pictures three days before this lab, from a distribution path the page never
    reaches now: the device has never once asked for a `marketplaceimages` or `marketplacecontent` name (F-005).
- **Conclusion** The document cannot be made more complete by reading the binary: everything it names the page
  carries, and the one thing it does not name is decoration. What the binary *does* justify is narrower and it is
  not a missing path: the offer's `mediaInstanceId` is read by the client and absent from every offer the lab
  writes, and it is the field the client's own location fetch is built from. F-013 could not have found it,
  because F-013 compared the page against the paths a page *carries*, and this is a field the real service
  *sends*.
- **Does not establish** That the missing field is the cause. It is the one difference the binary justifies that
  is still open, not a demonstrated blocker, and the client asks for no location before it asks for nothing at
  all - so whatever stops it, stops it earlier than the artwork.

## F-018 The lab was answering 502 on the Store's own account path

- **Date** 2026-10-15 · **Area** harness (a failure the lab injects, not one it observes)
- **Question** Five names on the hijack and MITM lists are there as a *diagnostic* - to make traffic visible that
  would otherwise be a tunnel. Three of them are alive on the real network. What does the device get from them,
  and what does a lab that wants a page *rendered* owe the client on its own account path?
- **Method** Read the device's exchanges out of every capture session by streaming each `index.jsonl` (one session
  is over 512 MB, so a read is not possible) and keeping only `client.address = 192.168.0.136` (F-012), then
  remove the five names from both lists in `config.json`, reload, and read `/__lab/status` back.
- **Evidence** `account.nokia.com` answered the device **4 x 502** (UA `Mozilla/5.0 (compatible; MSI...`), the last
  at 19:22:09 UTC - **nine seconds** before a page fetch at 19:22:18; the DNS log shows 10 queries for that name
  *forwarded* and 2 *hijacked*, i.e. the name was added to the list part-way through the day, so the device met
  both behaviours for the same name. `login.live.com`, `clientconfig.passport.net` and `go.microsoft.com` are
  alive on the real network and were answered `502` by this lab; `ssl-api.bing.com` is in the same list and is the
  one name whose real answer is also a failure (F-006), so it stays. After the edit both lists hold **10** names,
  every one of them a name this lab serves or intends to serve, and `dns.logQueries: true` still records every
  query, hijacked or not - nothing that was being watched is now unseen.
- **Conclusion** A harness built to see the client's traffic had started to *cause* two of its failures, and the one
  it can least afford is on the account and configuration path: `ppcrlconfig600.dll` was rewritten at 17:37:28 on
  this device, in the window in which the client resolved exactly those names (F-015). The group was removed, not
  narrowed, because a name answered by neither a handler nor the real service is only ever a failure with the
  lab's name on it.
- **Does not establish** That the 502s are why the page does not render: the one-request loop is older than the
  list (F-005) and survived every configuration the list has had (F-014).

## F-019 The screen, read at last: the client builds no model at all

- **Date** 2026-10-15 22:05 local (21:22 UTC delivery) · **Area** Store client behaviour (the witness E-003 asked for)
- **Question** Every finding in this file records what the device *asks*. Nothing recorded what it *displays*, and for a
  client whose failure is silent that is the difference between "it built nothing" and "it built something it cannot
  draw".
- **Method** One Store open on the phone (Lumia 625) with the lab armed, and the screen read by the operator:
  *"vuoto, o rotella che gira"* - empty, or a spinner that keeps turning. Nothing else was touched.
- **Evidence** Taken together with F-005 (the client fetches the page and asks for nothing else - no image from
  `marketplaceimages`, no detail page, no update check) and F-003 (the page it was served is in its own cache), the
  reading says the client never arrives at a model: a hub that had been built would show section titles even with
  every image missing, and the device has never once asked for an image. The device has also never asked for a
  `marketplaceimages` name at all - 35 queries for the page host, none for an image host - so the artwork path is
  not a stall that was entered and abandoned; it was never entered.
- **Conclusion** The failure is before or at the parse, not in the drawing. That removes the whole family of
  "renders nothing because of how the items are arranged" from the list, which is what F-014 could only remove
  empirically, and it makes the document's *shape* (its root, its namespaces, its framing) more interesting than its
  contents. It also means a hypothesis can be tested by whether the client starts asking for images: that is the
  first self-observing sign of a built model, and it needs nobody at the phone.
- **Does not establish** Which of the pre-parse steps fails. The client downloads and caches the body, so transport,
  TLS and the request itself work; what happens between the completed download and the parser is not observable
  from the volume (E-002), which is why the next changes are structural and additive rather than a specific repair.

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
- **Result NEGATIVE, see F-014.** The device met this page six times and asked for nothing else - the same
  one-request cycle as `storePage`. The verdict was already in the capture before anyone went looking for it,
  which is its own lesson: the experiment runs itself on every Store open, so its result has to be read from
  the capture rather than waited for.
- **State** Still `panes`, because nothing needs unarming while the page is being read: the next Store open
  re-runs a run that is known negative. Retire the variable by setting it back, not by leaving it.
- **Undo** Set `livestore.protocol.pageFormat` back to `storePage` and `POST /__lab/reload`.

### E-003 The document is not the only suspect: what the screen says, and the 502s we inject

- **Why** F-014 leaves two families of cause. One is inside the document and is a single line
  (`templateTypeForm`: the page writes `TEMPLATETYPE` both as an attribute and as a child element, because
  the parser's strings cannot decide which it reads — a client strict about unexpected children would reject
  the form it does not expect). The other is outside it: the client resolves `login.live.com`,
  `go.microsoft.com` and `clientconfig.passport.net` **between** two page fetches (17:37:24-30 local), and
  the lab answers those three — plus `ssl-api.bing.com` and `az717532.vo.msecnd.net` at 17:48:30 — with
  `502`, because they sit in the hijack list as a *diagnostic*. That is a failure this lab injects into the
  Store's own account and configuration path, on hosts that are alive on the real network, and the config's
  own comment says so and says how to undo it.
- **The measurement that is missing, and costs one sentence** What the phone's **screen** shows after a page
  is delivered. Every finding here records what the device *asks*; nothing records what it *displays*, and
  the screen is the one witness that has never been read - for a client whose answer is an assert code, it
  is also the only place that code would appear. Worth taking before either variable: it costs one Store
  open, and it can turn two coin flips into a directed test.
- **Variables, one at a time**
  1. `livestore.protocol.templateTypeForm`: `both` → `attribute`. One line; undo is the value it replaced.
  2. Remove the five `502`-injecting names from `dns.hijack.names` **and** `proxy.mitm.hosts`
     (`login.live.com`, `clientconfig.passport.net`, `go.microsoft.com`, `account.nokia.com`,
     `az717532.vo.msecnd.net`) and `POST /__lab/reload`. `ssl-api.bing.com` is deliberately left
     in: it answers nothing on the real network either (F-006), so removing it would change
     nothing and would blur the variable with a name that does not belong to it. Undo: the names
     are in `config.json`'s `_comment_account`, in both lists, and in this entry.
- **Before either** Check that the device would have connected at all: it resolved those names and the
  capture holds **no** HTTP request from it to any of them, so a removed hijack may be a no-op exactly as
  F-006 found for `ssl-api.bing.com`. `directHandshakeErrors` in `GET /__lab/status` is where a connection
  that died before it became an exchange would show, and it must be read *before* the change to be worth
  anything after it.
- **Waiting for** One Store open, and the screen read aloud.
- **Undo** Both candidates are single values, named above; nothing else in `config.json` moves with them.

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
- **Second half, unelevated, re-taken 2026-10-15 20:59** - with the phone in mass storage again and the
  threshold set just before the last delivery (20:40:51), after six `panes` deliveries (F-014).
  `powershell -File tools/phone-readout.ps1 -Since "2026-10-15 20:35"`. What it found: `Documents\Debug`
  still holds **one** file, the same Jellyfin report from 10-11 - nothing for the Store; the sweep of
  `Data` reports **0 files touched** after the threshold; `Data\Users\Public\Documents\LiveStore` still has
  **0 entries** and has never held one since it was created on 10-11; and `Data\SharedData\EdmCache`
  answers **`Accesso negato`** even to a listing, which is why the run reports "0 voci storePages" - an
  absence of permission, not an absence of entries (F-003 read that tree in an elevated session).
- **Conclusion so far** The device left **no readable trace** of what it did with any of the six delivered
  pages, and the only place that could hold one is not readable from here. The error log that does change
  its stamp is the self-test log, rewritten by a boot (F-007): 18:08 -> 18:20 -> 20:20:30, same bytes.
- **The elevated half, taken 2026-10-15 21:05, and it closes the question.** Two UAC passes (one to
  discover that the first pass had read the wrong volume — F-016 — and one for the corrected run), each
  starting a process with `-Verb RunAs`, waiting for it and leaving **no scheduled task** behind. What the
  elevated pass found: `Data\Users\Public\Documents\Debug` holds the **same single** Jellyfin report from
  10-11 and nothing for the Store; `Documents\LiveStore` still holds **0 entries**; the sweep of `Data`
  finds **one** Store-related write in the whole session, the cached page itself (F-015); and
  `Data\SharedData\EdmCache` lists **8 files** once elevation is available, which is what makes F-003
  readable at all.
- **The unelevated "0 files touched" above was blindness, not absence.** That run reported `EdmCache:
  Accesso negato` in the same breath, with the threshold at 20:35 - and the entry the elevated pass found
  was written at 20:47:27, **inside that window**. A tree a normal prompt cannot enumerate cannot be swept
  by a normal prompt, so a `0` from an unelevated sweep of `Data` means *nothing is visible from here*.
  The lesson generalises past this tool: read the permission line of the report **before** the count line
  (F-004 for why `Data\SharedData` needs elevation and `DefApps\APPDATA` never gets it).
- **Closed.** There is no Store crash report to find, and no state file was written; the reason the client
  loops is not on this volume in readable form. The finding that replaces this experiment is F-015, and the
  question that remains is F-005's, which no further readout will answer: it needs the screen (E-003) or a
  document variable changed one at a time. The sweep and the ACL probe are repeatable at any time with the
  one command in the row above; the half that needs no elevation and no mass storage is still
  `H:\Data\Users\Public\Documents\Debug`.

### E-004 The screen, and the one field every real offer sends

- **Why** F-005 says the client fetches the page and asks for nothing else; E-002 closed every readable trace of
  its reason; F-013 and F-017 removed the document as a *structural* suspect. Two things are still unread: what
  the screen says after a delivery, and the `mediaInstanceId` field (F-017). The first is the only witness the
  project has never had, and it discriminates between the families of cause in one Store open.
- **State ARMED, second round (22:20 local)** The screen was read - **empty, or a spinner** (F-019) - so the
  first-round question is answered and the round that follows it is structural. Armed now, both additive and both
  fidelity rather than guesswork: (1) the page root declares `xmlns:a`, `xmlns:os` and the catalog default, which it
  did not before, leaving `StorePage`, `Panes` and `Template` in no namespace at all (`src/store/catalog-feed.mjs`,
  asserted by a new check); (2) the page answers with `X-WP-StorePage-Cookie`
  (`livestore.protocol.pageCookie`), the only header the client reads back from a response and one this lab has
  never sent. `pageFormat` is `panes`, `templateType` is `003`, `templateTypeForm` is `both` (F-017 settles that
  last one as a non-variable). A code change needs the lab **restarted**, not hot-reloaded - the reload path
  re-reads `config.json` and not the modules, which is why the first attempt at these two showed no change on the
  wire.
- **What to read** Two readings, one at the screen and one that needs nobody there. The screen: a blank hub again
  means both changes are wrong and the next candidates are the ones below. The capture: whether the device's next
  request carries `X-WP-StorePage-Cookie` back - that would prove the client read our header, stored it and echoed
  it, which is a fact about the flow that no amount of document reading could give. The third and best reading is
  a request for an image, which F-019 makes the first sign of a model that exists.
- **Next candidates, in the order they would be tried** (1) `<StoreObjects><StoreObject><Id/><DisplayPrice/>
  <Price/></StoreObject></StoreObjects>` inside the feed: `/feed/StoreObjects/StoreObject` is a path the parser
  names (`@30936`, in the same run as the page grammar) and `src/store/vocabulary.mjs` records it as *not a claim
  about the page* rather than as excluded - which is exactly the state a candidate should be in. (2) The response's
  `content-type`: `application/atom+xml` is this lab's own invention, never read off a real response, and the only
  XML type the client spells anywhere in its strings is `application/xml`. (3) The offer's `mediaInstanceId`
  (F-017), which F-019 has now made less likely to be the blocker and more likely to be the next one.
- **Result, first half - the header, and it is POSITIVE (2026-10-16 04:44:43)** The page root's namespaces changed
  nothing: the client's behaviour with them is the same as without them (E-005's result). The cookie did: **every**
  request the device made today carried `x-wp-storepage-cookie: 7f3c9a52b1e84d0f9a6c2e58d4b1073c` back, including the
  first one after a lab restart, so the value had been read, stored (`WPSStorePageCookie`) and re-sent - the client
  runs `WPSHeaderHandler` on what this lab sends. That is a fact about the flow no amount of document reading could
  give, and it is the first thing this project has observed the client *doing* with a response.
- **Second variable, deliberately not armed yet** Add `<mediaInstanceId>` to each `<offer>` (F-017). It is one field,
  the fixture has no media id to invent from, and arming it now would put two changes between the reading and its
  cause.
- **Undo** Put `login.live.com`, `clientconfig.passport.net`, `go.microsoft.com`, `account.nokia.com` and
  `az717532.vo.msecnd.net` back into both lists in `config.json` and `POST /__lab/reload`. Nothing else moved.

### E-005 A pane's data source: the field the client *downloads* its content from

- **Why** F-019 (the client builds no model) and F-005 (one request, then nothing) say the failure is at or
  before the parse and that the client never asks for anything else. The binary names one field every page this
  lab has served was missing: a pane is not a container that holds items, it is a **pointer**. `PANE_FIELDS`
  (`src/store/vocabulary.mjs`) holds `/DataSource/Type` (@14112) and `/DataSource/Url` (@14148) beside
  `/CollectionId`, `/MaxItems` and `/MinItems`; `ProcessEntryFromType`'s own literal pool holds
  `Create StoreObjects with FeedType = %S Url = %S`; and the download that follows has its own function names
  (`PendingListDownload::ParseFromStream`, `::OnDownloadAvailable`, `::OnRequestFailed`). The four feed types a
  source may name sit at @139376-@139576 as UTF-16 literals - `Applications`, `FeaturedApps`, `Collections`,
  `Categories` - each followed by the parser that type selects, and `Applications` is the one whose parser
  (`Marketplace_ParseAppsFeedIntoStoreObjects`) matches what `/v9/catalog/apps` already answers with.
- **The change** Each pane now writes `<Id>`, `<Title>`, `<CollectionId>`, `<DataSource><Type/><Url/></DataSource>`
  and `<MaxItems>/<MinItems>`, where the URL is absolute, on the host the device just reached this lab through and
  in the scheme it used, and carries that pane's own section (`/v9/catalog/apps?chunkSize=25&category=<section>`).
  The apps route gained the `category` filter, because eight panes asking for the whole catalog is eight panes
  showing the same thing. Off by default in code (`dataSource: false`), armed in `config.json`, and the suite's own
  config now arms it too, so the document under test is the document served.
- **What was verified from the PC, before the phone** The phone's exact page request (all 17 parameters) replayed
  over the lab's plain-HTTP listener on :80 with the phone's own `Host`: `200`, 58 327 bytes, `x-lab-sections: 8`,
  `x-lab-page-format: panes`, `x-lab-pane-sources: Applications`, root `<StorePage>` declaring `xmlns:a`, `xmlns:os`
  and the catalog default. **Eight** data sources in the page, each an absolute URL on
  `cdn.marketplaceedgeservice.windowsphone.com`, and **8/8 of those URLs answered `200`** with that pane's own
  section (2, 2, 3, 2, 2, 2, 2, 2 apps, each matching the section's items). `npm run selftest` **105/105** (three new
  checks: the pane names the source its content is downloaded from; the source URL answers with that pane's own
  section, read back out of the served page and fetched through the proxy as the device would; and every pane the
  *demo* page names answers with that section, driven through the router so the count of captured exchanges does not
  move). `npm run rehearse` 48/48 against the running lab.
- **State ARMED, 2026-10-16 04:44 UTC** The lab was **restarted** (`pid 8092`), not hot-reloaded: a code change
  needs the modules re-read, which is the footgun E-004 already recorded. This run also delivers the two changes
  E-004 armed at 22:20 local and never got in front of a phone - the page root's namespaces and the
  `X-WP-StorePage-Cookie` header - so a positive reading does not attribute to the data source alone; a negative one
  has three suspects and the next step is to deliver them one at a time.
- **Result NEGATIVE, 2026-10-16 04:44:43 - 04:48:46 UTC.** One Store open (held open by the operator, "sto
  caricando", for a quarter of an hour after the last fetch). The device - **`192.168.0.137`**, the same
  `x-wp-device-id` and `ZDM/4.0; Windows Mobile 8.1` UA as F-012's `192.168.0.136`, so an address the router
  reassigned, not a different phone - fetched the page **three times** (04:44:43, 04:47:51, 04:48:46), each answered
  `200`, `content-length: 58371`, `x-lab-pane-sources: Applications`, and then asked for **nothing**: no request for
  any of the eight URLs the page itself named, no image, no update check, no detail page. The one-request cycle of
  F-005 survived the field it was supposed to be explained by. Three readings are now settled as *neutral* on this
  client rather than untested: `pageFormat` (panes vs storePage, E-001), the page root's namespaces (E-004 round 2),
  and a pane that names a data source (this entry) all leave it in the same state - page in, nothing after.
- **The one thing that did move, and it is not the render** Every one of those three requests carries
  `x-wp-storepage-cookie: 7f3c9a52b1e84d0f9a6c2e58d4b1073c` - the value this lab minted - including the first one,
  which means the client had already read it from an earlier delivery, stored it (the binary's `WPSStorePageCookie`)
  and put it on its own requests (`::AddStorePageCookie`). E-004's header half is **positive**: the client's
  response-header handler runs on what this lab sends. Its body half is not: the same responses are handed to
  something that produces no model.
- **What to read next** Not another document variant: five have now been delivered and read. The next reading has to
  come from the phone itself, and the two that can settle the document's *shape* are (1) the parse-config tables in
  `ZMarketplace.dll` - whether `/DataSource/Url` belongs to a `<Pane>` at all, which needs the image, since only
  offsets are available offline - and (2) an elevated copy of `Data\SharedData\EdmCache` in full, in case a page of
  the real service survived there. One mass-storage session buys both.
- **Undo** `livestore.protocol.dataSource` back to `false` and `POST /__lab/reload`; the panes fields, the pane's
  `Id`/`Title`/`CollectionId` and the `category` filter are additive and inert with it off. `pageFormat` back to
  `storePage` (E-001's undo) and `pageCookie` back to `""` retire the rest of the run.
- **Does not establish** That the missing source is the only thing missing, nor that a real page declares an app
  list as `Applications`-typed: the path is read off the phone, the value is the first of the four the client knows
  how to parse, and a page whose panes point at a type the client cannot read would fail the same way a page with no
  panes does.

### E-006 The pane's own type: `inv`, the one token the page parser holds

- **Why** E-005 removed the data source as the explanation and left the pane's own property map as the only
  part of a pane this lab writes nothing for. That map, read as a pointer table out of the image rather than as a
  string region, is one object's field list at `@19700` in `ZMarketplace.dll`: `/Id`, `/Title`, `/Type`,
  `/SubType`, `/DataSource/Type`, `/DataSource/Url`, `/CollectionId`, `/MaxItems`, `/MinItems`,
  `/LiveTileUpdateInterval`, `/StoreObjectsForLiveTile` - eleven fields, contiguous, in one table. Two of them
  (`/Type`, `/SubType`) the lab has never sent. The same pass found where the table is used:
  `ProcessEntryFromType` (`@193452`, in the same pool as `LoadEntryPropertiesFromParseConfig`, `@193608`) logs
  `Found %d Store Panes`, reads `/Panes/Pane` and `/Panes`, logs `Found %d Store Templates`, reads
  `/Templates/Template`, `/Templates`, `/offers/offer`, `/tags/tag`, `/entry/deviceCapabilities`,
  `/entry/dependencyPackages/dependencyPackage` - **and holds the token `inv` twice**, once between
  `/Templates/Template` and `/Templates` and once at `@194004`. A token in a function's literal pool is a token
  that function *compares or builds with*, which is a different kind of evidence from sharing a string region, and
  `inv` also opens the object-code table at `@20112` (`inv, alb, tra, art, pod, gen, off, pce, ... app, fea,
  col, sto`). So a pane declares what it is, the client has a token for it, and this lab has never sent one.
- **The change, and it is one field** Every pane writes `<Type>inv</Type>` (`livestore.protocol.paneType`).
  Nothing else about the pane moves: the data source, the collection id, the items, the template block, the root
  and its namespaces are all exactly what E-005 delivered and read. `paneSubType` exists in code and stays
  empty, because no reading suggests a value and two invented fields would be two variables in one run.
- **Verified from the PC, before the phone** The phone's exact request, on port 80 with the phone's own `Host`:
  `200`, 58 455 bytes, `x-lab-pane-type: inv`, `x-lab-pane-sources: Applications`, `<Type>inv</Type>` in all eight
  panes, and 8/8 pane sources still answering with their own section. `npm run selftest` **107/107** - two new
  checks: a pane writes the type it is given and writes none when given none, and the served page carries it and
  reports it in its headers (the header is what makes the *served* document readable from the PC, which is where a
  value that reaches the builder and not the wire was caught once before). `npm run rehearse` re-run after the
  restart: 48/48.
- **State ARMED, 2026-10-16 05:25 UTC** Lab restarted (`pid 17812`), because this is a code change. The device's
  address is `192.168.0.137` now - the same `x-wp-device-id` and UA, so F-012's `192.168.0.136` is a lease the
  router reassigned, and any future read that filters on the address has to filter on the device id instead.
- **Result NEGATIVE, 2026-10-16 04:56:43 UTC.** One Store close and reopen. The device resolved the page host
  **once**, opened HTTP :80 **once**, fetched the page **once** - `200`, `content-length: 58499` (128 bytes more than
  E-005's 58 371, which is exactly the eight `<Type>inv</Type>` blocks), `x-lab-pane-type: inv` - and then asked for
  **nothing at all**: no pane source, no image, no update check, no account name resolved, no TLS connection. The
  typed page answers the pane property map's last unwritten field and the client is unmoved by it.
- **What that leaves, and it is a different kind of claim** Five documents have now been delivered and read: panes
  with and without inline items, with and without a data source, with and without the root's namespaces, with and
  without a cookie, with and without a pane type. **All five share one thing: their framing** - a response typed
  `application/atom+xml; charset=utf-8`, rooted at `<StorePage>` with `<Panes>`, `<Templates>` and a nested `<a:feed>`
  as its children, and every pane and entry shaped the way this lab writes them. Every experiment so far varied
  something *inside* that frame, and no experiment has varied the frame. That is now the honest reading of five
  identical non-reactions: the shared part is untested, and it is a bigger part than any single field.
- **What to read next** Two readings, and neither is another field inside the same frame. (1) The `atom` page format
  (`livestore.protocol.pageFormat: atom`), which is the *archived real service's* own shape - an `<a:feed>` root with
  the sections as its entries - and the one arrangement of the five that has never been served to this client
  (`E-001` served `panes`/`storePage`, both rooted at `<StorePage>`). (2) An elevated, wholesale copy of
  `Data\SharedData\EdmCache` off the phone: the two `Lib` entries written 2026-10-11 prove the client rendered
  *something* from the real service five days before this lab existed, and if the page it rendered then is still in
  that tree, it is the ground truth every generated page has been guessed at. `hunt/copy-edmcache.ps1` copies the
  tree read-only and was written for this and never run.
- **Undo** `livestore.protocol.paneType` back to `""` and `POST /__lab/reload` for a config-only revert; the code
  writes nothing for it when it is empty, so the page is byte-for-byte the E-005 page again.


## F-020 What the phone's own cache holds, read with the phone in mass storage

- **Date** 2026-10-16 07:05-07:20 local · **Area** device state (the witness E-002 could not reach)
- **Question** E-002 closed every readable trace of the client's reason unelevated, and the one tree that would
  hold a *real* page - `Data\SharedData\EdmCache` - answered `Accesso negato` to a listing. With the phone in
  mass storage and one elevated pass, what does that tree actually hold, and is there a page in it that the real
  service wrote?
- **Method** One elevated, read-only pass (`elevated-read-phone.ps1`, written for this run): the whole EdmCache
  tree listed and copied with SHA-256 per file, `Data\Users\Public` and `Windows\System32\config` copied, and a
  content search of the phone's `Data` tree for `<StorePage`, `<a:feed` and `<Panes`. **The content search is
  broken and its "0 file" is not evidence of anything**: it reports zero files while `Data\SharedData\EdmCache`
  holds a 58 499-byte body that begins `<?xml ...><StorePage` and is inside the tree it walked, so the enumeration
  or the per-file read failed silently under `-ErrorAction SilentlyContinue`. What stands in this finding is the
  *listing* below - names, dates, sizes, hashes - which is authoritative because every file in that tree was
  copied and hashed; the search is recorded here rather than removed so the next reader does not repeat it as
  though it had worked.
- **Evidence**
  - **EdmCache holds eight entries and every page in it is ours.** `Short\0\og_storePages_...` are the
    *request* keys (four of them, two at 14 bytes, from 2026-10-15 15:31-16:25, and one 55 373-byte body written
    21:46:14), and **today's delivery is there under a name that carries this lab's cookie**:
    `Short\9\7f3c9a52b1e84d0f9a6c2e58d4b1073c$48b1e555.zmz`, **58 499 bytes, written 2026-10-16 06:56:42
    local** - the page E-006 served, byte-for-byte (decoded: no compression, `<?xml ...><StorePage`). So the
    client's download path accepts our body and caches it, and the *cookie this lab mints becomes part of the
    cache key*. There is **no page from the real service anywhere in the tree** - the only pre-lab entries are
    the two `Lib` JPEGs of 2026-10-07 (102 560 and 78 613 bytes, hashes unchanged) and an unrelated
    `Keepers\CDCOutput0000000{1,2}.xml` holding cellular/IMEI inventory.
  - The cookie is in the phone's **registry**: the 32-hex value this lab minted is present once, UTF-16LE, in the
    copied `SOFTWARE` hive (`\Windows\System32\config\SOFTWARE`, 12 845 056 bytes, modified today 06:59).
    E-004's header half is now confirmed from the device's own storage, not only from its traffic.
  - `Data\Users\Public\Documents\Non-Production Errors.txt`, which changes its stamp on every boot (F-007),
    was rewritten **2026-10-15 22:40:32** and holds the production self-test log (banned BCD element, UMCIAuditMode
    enabled, SecureBoot not provisioned) - a boot, not the Store. It is not a Store report and E-002's conclusion
    stands.
- **Conclusion** The one artefact this project has been missing - a page of the real service - is **not on this
  phone**, and the readout that was going to be the next move is now closed as a source of it. What the readout
  did establish is that the client stores, keys and caches what this lab sends, and that its own registry holds
  the cookie: the client's *download and storage* path runs on our responses, while nothing after it does.
- **Does not establish** Anything about why the parse produces no model. It removes the EdmCache as a place to
  look and leaves the client's behaviour, the binary, and the delivered document as the only three witnesses.
- **Repeatable** One elevated pass with the phone in mass storage; read-only on the phone, output under
  `%TEMP%\wp-massstorage\phone-read\`.

### E-007 The pane says it is a `Collection`

- **Why** E-006's `inv` was a token in the page parser's literal pool twice, which said the function uses it but
  not what for; it was delivered and the client was unmoved. Reading the same pool in order
  (`@28716`-`@29600`) puts a better candidate two lines further on: the tokens the client compares a *page*
  against - `sDynamicHub` (@29010), `DynamicChart` (@29036), `Collection` (@29064) - sit immediately before
  `TEMPLATETYPE` and the property-loading strings (`Prop: %d, %s, path {%S}, value {%S}`, `found`, `missing`),
  i.e. in the code that reads a page's own vocabulary. And the phone's UI assets name the two kinds of item a hub
  draws: `Store_HubCollectionUI_ArtMargin`/`_TitleMargin` and `Store_HubFeaturedItemUI_Margin`, with
  `Store_ChartCollectionUI_*` for a chart page and the hub layouts `Store_Hub_TemplateType003List_Padding` (a
  list) and `Store_Hub_TemplateType017_*` (one item with a price panel). A generated pane *is* one section of
  apps, and both witnesses call that a **Collection**.
- **The change, one field, one value** `livestore.protocol.paneType`: `inv` -> `Collection`. Everything else is
  the page E-006 delivered: the same data source, collection id, items, template block, root and namespaces.
- **Verified from the PC** The lab hot-reloaded (config only, no restart): `x-lab-pane-type: Collection`,
  `<Type>Collection</Type>` in all eight panes, `x-lab-pane-sources: Applications`, 8/8 sources still answering.
  `npm run selftest` **107/107** with the suite's own config armed to the same value.
- **What to read** The same single reading: does the device, after the page, ask for a URL the page named? If it
  does, the pane's own type was the gate and every earlier negative was a pane the client could not materialise.
- **Result NEGATIVE, 2026-10-16 05:30:46 UTC.** The device (`192.168.0.137`) fetched the page **once** and was
  answered `200`, `content-length: 58555`, `x-lab-pane-type: Collection`, `x-lab-pane-sources: Applications` -
  i.e. eight panes each declaring a type the page parser holds *and* a source whose URL resolves here - and then
  asked for **nothing**: not one of the eight URLs the page itself named, no image, no update check, no detail
  page, no account name. Read out of the capture by filtering the two sessions of the day on the **device**
  rather than the address: seven requests from it in the whole day (five page fetches and two
  `ssl-api.bing.com`), and **zero** to `/v9/catalog/apps` from any of them. So the typed pane is as inert as
  every field before it, and the sixth document joins F-014, E-005 and E-006 in the same non-reaction.
- **What this makes true, and it is the same sentence E-006 wrote** Six documents, six fields, one outcome - and
  all six share their frame (root element, the panes block, the template block, the nested `<a:feed>`, and the
  shapes this lab writes for a pane and an entry). F-021 now supplies what that frame has been missing: the real
  service's own documents, as the archive still holds them, and they disagree with the frame in named places.
- **Undo** `livestore.protocol.paneType` back to `inv` for the previous value or to `""` for the pages before
  E-006, then `POST /__lab/reload` - no restart, because nothing but config moves.


## F-021 What the marketplace CDNs returned, as the Web Archive still holds it

- **Date** 2026-10-16 07:35-08:10 local · **Area** the real service (the ground truth E-006 named, looked for off
  the phone)
- **Question** E-006 and E-007 both end the same way: the archived response of the real service is what every
  generated page has been guessed at, and F-020 removed the phone as a source of one. So does an archive hold a
  page of the real service - and if not, what does it hold of the service this client was built against?
- **Method** The Wayback Machine's CDX index, queried per host (URL-prefix and domain match, one row per unique
  URL so a page hit ten thousand times is one line), then every capture with a real body fetched as **raw bytes**
  (`/web/{stamp}id_/...`, which is the archived response and not the archive's replay wrapper). Four hosts, in
  the order they matter to this client: `cdn.marketplaceedgeservice.windowsphone.com` (where the page comes
  from), `marketplaceedgeservice.windowsphone.com` (the same service without the CDN name),
  `catalog.zune.net` and `marketplaceimages.windowsphone.com` (where the artwork comes from).
- **Evidence, and the first line is the one that matters**
  - **No archived store page exists.** `.../v9/catalog/storePages` has **one** capture in the whole index:
    `20170610033935`, `400 text/xml`, 469 bytes - a request with a bare `?` and no parameters. There is no
    archived `200` of the store page on any host, under any parameter set. The ground truth E-006 asked the
    archive for is missing from the archive as well as from the phone (F-020), so it does not exist in either
    place and the project should stop expecting to find it.
  - **The neighbouring endpoints of that same CDN host *are* archived and do carry the real grammar**:
    `/v8/catalog/hubs?os=8.0.10328.0&cc=PK&...&hub=games&cf=99-1` (2013-08-13, `200`, `application/atom+xml`,
    5 033 bytes compressed) - which is already this project's fixture - and the WP7.5 and WP8.0 hub pages
    `/v3.2/en-US/clientTypes/WinMobile%207.1/hubTypes/marketplace/hub?` and `.../WinMobile8/...` (2013-02-15,
    `200`, 1 501 and 1 496 bytes). Everything else on the host is a `403` root, a `404` robots, a `503` favicon,
    or a bare `?` answered `400`.
  - **The apps feed is archived with real content, twice**, on the non-CDN name:
    `/v9/catalog/apps?os=8.10.14234.0&cc=US&lang=en-US&chunkSize=50&orderBy=GlobalRank&tag=phone.protocol.ms-band`
    (2016-05-06, `200`, 21 634 bytes raw, 14 entries) and
    `/v8/catalog/apps?os=8.0.10211.0&cc=US&lang=en-US&hw=520170499&dm=RM-820_nam_att_100&oemId=NOKIA&moId=att-us&chunkSize=50&orderBy=GlobalRank&tag=phone.protocol.xplatformcloudkit`
    (2013-12-16, `200`, 82 231 bytes raw, 50 entries). Both are now saved as fixtures -
    `src/store/fixtures/archive/real-apps-feed-20160506-v9.xml` and `real-apps-feed-20131216-v8.xml`, byte for
    byte - because they are the only two responses of the app-list shape this lab serves, and until now every
    field in that shape was inferred.
  - **The ~40 bare `?` rows in the index are not pages that failed to archive, they are requests that were never
    valid.** Every `/v8/catalog/apps/{id}?` and `/v9/catalog/apps/{id}?` capture from 2013 to 2017 is `400
    text/xml`, 488-493 bytes: the service rejected a request naming no device context. The storePages `400` is the
    same `400`.
- **What the archived app feeds carry that this lab never sends** (measured against `buildApplicationListFeed`,
  not eyeballed - the counts are of the two fixtures and of a generated `social` feed):

  | element | archived v9 2016 | archived v8 2013 | this lab |
  |---|---|---|---|
  | `<k>` per entry | **4,5,6…17** | **4,5,6…53** | **absent** |
  | `<pagingToken>` + `<a:link rel="next">` | no | yes (`50\|50`) | no |
  | `<mediaInstanceId>` in `<offer>` | no | 59 of them | no |
  | `<clientType>WindowsPhone80</clientType>` | no | 59 of them | no |
  | `<isUniversal>` | 14 of them | no | yes |
  | bare `<title>` on an *entry* | no | no | **yes, one per entry** |
  | `<a:title type="text">`, `<sortTitle>`, `<a:author>`, `rel="self"`, `tag:catalog.zune.net,{date}:/apps` | yes | yes | yes |

  `<k>` is the one that lands exactly where this lab writes nothing: the real entry ends
  `</publisher><impressionId>…</impressionId><k>4</k><isUniversal>false</isUniversal></a:entry>`, and the lab's
  entry is that same run with `<k>` missing. It is **not** a 1-based index: in both captures it starts at **4**
  and increments by one, to `17` across 14 entries and to `53` across 50. Why 4 is not settled by this, and it is
  recorded as a number rather than as an explanation.
- **The one structural disagreement the archive settles, and it is in the frame six documents shared**
  - The archived hub pages put the template block in **lower case**, as a **child of the feed root**, between
    `<impressionId>` and the first `<a:entry>`, and carry **no type token at all**:
    `<a:feed …><a:link rel="self" …/><a:updated>…</a:updated><a:title type="text">games-PK-WindowsPhone80</a:title><a:id>games-PK-WindowsPhone80-ALL-ALL</a:id><impressionId>…</impressionId><templates><template><mimeType>application/uix</mimeType><templateName>GamesHub</templateName></template></templates><a:entry>…`
    - 0 occurrences of `TEMPLATETYPE`, 0 of `<Panes>`, in the whole document.
  - This lab writes `<Templates><Template TEMPLATETYPE="003">…<TEMPLATETYPE>003</TEMPLATETYPE></Template></Templates>`
    (three `TEMPLATETYPE` tokens in `both` form) as a child of `<StorePage>`, **beside** `<Panes>` and the nested
    `<a:feed>` - and every one of the six delivered documents carried that panes block and that template block.
  - **Two limits on the reading, which is why it is recorded and not acted on.** The archived pages are the
    v8/v3.2 generation (WP8.0 and WP7.5), not the v9 `storePages` endpoint, so they are evidence about the family
    and not about this endpoint; and case is the one thing an XML parser does not forgive, so lower-case
    `<templates>` in the archive is a real difference from this lab's `<Templates>` without saying which of the
    two the *8.1* parser matches. What it does establish is that the template block's case, its parent and its
    type token have never been evidenced and have never been varied.
  - **The archived pages also root at `<a:feed>` directly**, with the sections as the feed's own `<a:entry>`
    children and no panes anywhere. That is E-006's untried `pageFormat: atom` - now confirmed from a real
    response rather than inferred - **except that this lab's `atom` is not that document**: built and measured, it
    roots at `<a:feed>` and still carries `<Panes>` with eight panes inside it (offset 493), so the one format the
    archive confirms has never actually been served in its archived shape.
- **What the CDNs returned for artwork, and a gap this lab has** The client's image requests are archived in two
  families, and the second is the one this lab's own page points at:
  - `marketplaceimages.windowsphone.com/v8/images/{id}?imageType=ws_icon_large|ws_icon_small|ws_screenshot_large|ws_screenshot_small&rotation=0`
    → `200 image/png`, at least **100 000** distinct URLs (the CDX query's own limit was hit), 2012-2018.
  - `catalog.zune.net/v3.2/{locale}/image/{imageId}?width=&height=&resize=true` → `200 image/png` (**22 129**
    distinct URLs), and `catalog.zune.net/v3.2/{locale}/apps/{appId}/primaryImage?width=&height=&resize=true` →
    `200 image/png`.
  - The `{imageId}` of the first of those two is exactly the `urn:uuid:` our page writes into `<image><id>` and
    `<backgroundImage><id>`, so the artwork URL a client would build from a generated page is
    `catalog.zune.net/v3.2/{lang}/image/{uuid}?width=W&height=H&resize=true`.
  - **Both hosts are in this lab's `dns.hijack.names` and `proxy.mitm.hosts`, and no handler matches a path on
    either**: a `grep` for `marketplaceimages` and `catalog.zune.net` over `src/`, `tools/` and `config.json`
    finds the two config lists (`config.json:24,28,53,57`), one comment in `src/proxy.mjs:258`, one in
    `src/store/protocol.mjs:11`, the rehearsal's own `--host` list, and the two `tag:catalog.zune.net,{date}:/apps`
    feed ids at `src/store/protocol.mjs:468,490` - and nothing that serves a byte. So a client that got as far as
    asking for artwork would have its request intercepted, matched by no handler and passed through to a host that
    is gone - the request is still in the capture, so F-019's "the first sign of a model is a request for an image"
    survives as an observation, but the lab cannot serve an image today even if it is asked for one.
- **What this changes** Two candidates that were guesses are now named against a real response: `<k>` on every
  entry of the app list, and the template block's case/parent/type-token in the page frame. Neither is armed,
  because F-021 is a reading and not a change, and because the honest ordering is one variable at a time - but
  the *frame* is now the only part of the document with a measured disagreement against the real service, which
  is what E-006 could only say as "the shared part is untested".
- **Does not establish** Anything about what the 8.1 client does with `<k>`, whether it pages, or whether it
  matches `<Templates>` or `<templates>`. It also does not establish that the archived hub pages are the shape the
  *storePages* endpoint answers with: they are the closest thing that exists, and no archived store page exists at
  all.
- **Repeatable** Per host, one CDX query; the captures are re-fetchable by URL. The two fixtures are the raw
  bytes and are read by nothing in the suite yet.
  ```
  https://web.archive.org/cdx/search/cdx?url=cdn.marketplaceedgeservice.windowsphone.com&matchType=domain&collapse=urlkey&limit=300&fl=timestamp,original,statuscode,mimetype,length
  https://web.archive.org/cdx/search/cdx?url=catalog.zune.net&matchType=domain&collapse=urlkey&filter=!original:.*primaryImage.*&limit=200&fl=timestamp,original,statuscode,mimetype,length
  https://web.archive.org/web/20160506031640id_/http://marketplaceedgeservice.windowsphone.com/v9/catalog/apps?os=8.10.14234.0&cc=US&lang=en-US&chunkSize=50&orderBy=GlobalRank&tag=phone.protocol.ms-band
  https://web.archive.org/web/20131216103112id_/http://marketplaceedgeservice.windowsphone.com/v8/catalog/apps?os=8.0.10211.0&cc=US&lang=en-US&hw=520170499&dm=RM-820_nam_att_100&oemId=NOKIA&moId=att-us&chunkSize=50&orderBy=GlobalRank&tag=phone%2Eprotocol%2Explatformcloudkit
  ```


## F-022 Reading the *older* capture is what shrank the change

- **Date** 2026-10-16 08:10-08:40 local · **Area** the real service, and the application list this lab serves
- **Question** F-021 ended with a table of "what the archived app feeds carry that this lab never sends",
  with a 2016 column and a 2013 column beside it. A table with two columns and one "this lab" column reads
  like a to-do list, and a to-do list assembled from two generations of one service is how a lab acquires
  fields the client's own generation never had. So the older capture was read as a document - not skimmed -
  to ask which of those rows are the *entry shape* and which are the *older service*.
- **Method** The whole of `real-apps-feed-20131216-v8.xml` (82 231 bytes, 50 entries) read three ways and
  compared against the same three readings of the v9 capture and of the archived hub page: the sequence of
  the root element's children, the first occurrence of every element name in the document, and the direct
  children of one `<a:entry>`.
- **Evidence**
  - **The two captures disagree with each other in exactly three places, and all three are the older one
    having *more***: `<mediaInstanceId>` inside every `<offer>` (59 of them), `<clientType>WindowsPhone80`
    beside `WindowsPhone81` (59), and feed-level `<a:link rel="next">` with `<pagingToken>50|50</pagingToken>`
    and `startIndex=50`. The v9 capture of the same endpoint carries **none** of them. So those three rows
    of F-021's table are properties of the 2013 *service*, not of the entry shape, and the answer to "should
    this lab write a `mediaInstanceId`?" is **no** - which is the opposite of what the table alone suggested,
    and it is F-017's open candidate settled by reading rather than by another delivery.
  - **They agree on `<k>`**: same position in both (immediately after `impressionId`, before `<isUniversal>`
    in v9 and as the entry's last child in v8), same arithmetic in both (**4** on the first entry, +1 each: to
    17 across 14 entries in 2016, to 53 across 50 in 2013). It is the one element that survives both
    generations, and the only one of F-021's rows that both archives ask for.
  - **They agree on the bare `<title>` too, and this is where a one-line edit would have been wrong**: neither
    feed entry has one, and the archived *page* does - its `<application>` blocks run
    `<application><id/><title/><sortTitle/>...`. The element the lab writes first in
    `applicationFields` is therefore correct for the page and extra for the list, which is why the switch had
    to be a parameter of that function and not a deletion from it.
  - **The entry shape, read back after the change** (`<a:entry>`'s direct children):
    - v9 2016: `a:updated a:title a:id isHardwareCompatible sortTitle releaseDate version averageUserRating userRatingCount image hasLiveTile categories tags offers publisher impressionId k isUniversal`
    - v8 2013: same list **without** `isUniversal`
    - this lab now: **identical to v9, element for element** - and identical to v8 except for `isUniversal`,
      which is the newer generation's own field and already written.
- **The change, and it is two values rather than a rewrite** `applicationEntryXml` gained `rank` (the `<k>`
  this entry carries; `null` writes none) and `entryTitle` (whether the bare `<title>` is written), and
  `buildApplicationListFeed` takes `entryRank` / `entryTitle` from config as `appListRank` / `appListEntryTitle`.
  Both **default in code to this lab's own earlier bytes**, and both are armed in `config.json` to the
  archived values (`4`, `false`) - an experiment that cannot be un-armed cannot be read. Only
  `applicationEntryXml` changed: `applicationXml`, which the page uses, keeps the title. Two new response
  headers (`x-lab-applist-rank`, `x-lab-applist-entry-title`) report the served shape, because the header is
  where a value that reached the builder and never reached the wire was caught once before.
- **Verified, and every number below is from the running lab**
  - The lab was **restarted** (`pid 26176`, 07:53 local) rather than hot-reloaded, because this is a code
    change - the footgun E-004 recorded.
  - `GET /v9/catalog/apps?chunkSize=25&category=social` with the phone's own `Host`: `200`,
    `x-lab-applist-rank: 4`, `x-lab-applist-entry-title: no`, two entries, `<k>4</k> <k>5</k>`, **0** bare
    entry titles - and the entry's child sequence read back out of the *response* is identical to the v9
    capture's, element for element.
  - The phone's exact page request, unchanged: `200`, `content-length: 58555` - the same 58 555 bytes E-007
    delivered - `x-lab-pane-type: Collection`, 8 panes, **34** `<application>` blocks each still carrying its
    bare `<title>`, and **0** `<k>` anywhere in the page.
  - `npm run selftest` **109/109**, `exit 0` (two new checks: the configured entry shape is the archived one
    and the default is this lab's own; and the *served* list carries it and says so in its headers).
- **What this changes** The application list now answers with the shape the archive evidences, and F-021's
  table has stopped being a list of things to add. What remains in disagreement with the real service is the
  **page's** frame - lower-case `<templates>` as a child of the feed, no `<Panes>`, no `TEMPLATETYPE` - which
  is E-006's closing observation and still unarmed.
- **Does not establish** What the client does with `<k>`, or whether it reads these entries at all: the
  device has never requested `/v9/catalog/apps` (E-007's result - seven requests in a whole day, five of them
  the page). This change is fidelity to the archive, not an experiment, and it cannot produce a reading until
  something makes the client ask for the feed.
- **Undo** `appListRank` back to `""` and `appListEntryTitle` back to `true`, then `POST /__lab/reload` - the
  page cannot move either way, because neither value is read on that path.

## F-023 The capture holds two handsets and this PC, and the requests are what says which is which

- **Date** 2026-10-16 11:00-11:20 local · **Area** lab evidence (who every finding in this file is about)
- **Question** Every entry here says *the device*, meaning one Nokia Lumia 625. The capture is 28 sessions and
  19 615 DNS records from 21 addresses. Which addresses are that device, is there only one device in the file,
  and was the rule this project reads captures by able to tell?
- **Method** `npm run analyze -- --all-sessions`, which now reports per client address and per device: the index by
  `client.address` (`x-wp-device-id` and the `os`/`hw`/`dm` tuple where a request carries one), the DNS logs per
  querying address, and this machine's own addresses marked from `os.networkInterfaces()` plus the configured
  `advertiseIp`. Ten checks in `npm run selftest` hold the attribution rules without a capture; the numbers below
  are the real one.
- **Evidence**
  - **The index is almost entirely this PC; the DNS log mostly is not.** 487 480 exchanges over 28 sessions, and
    all but **109** of them are this machine's - `192.168.0.220` 329 304 and `127.0.0.1` 158 067. The DNS log beside
    it is 19 615 records from 21 addresses, and only **8 639** are this PC's: the other 10 976 come from the household
    (`192.168.0.151` alone is 6 437 queries for `a.root-servers.net`), of which **555** come from the four addresses
    that carry the Nokia fingerprint (`.136` 296, `.53` 155, `.137` 57, `.54` 47). Combined, 496 010 of 507 095 records are this machine's - a number that hides
    which of the two files it came from, which is why the census reports them per address.
  - **The user agent cannot separate them, and the maintenance note said it could.** Of the 329 304 exchanges from
    this PC's own address, **308 354 carry `ZDM/4.0; Windows Mobile 8.1`** - the Store client's own agent, because
    `tools/rehearse.mjs` replays the device's requests with the device's own headers (lines 376, 418). The marker the
    register pointed at, `wp8-store-lab-rehearsal`, covers **338**, and `wp8-store-lab-replay` another 2. Sorting by
    agent therefore hands this machine's traffic to the phone for 308 354 exchanges, which is what F-012's method
    note could not have caught: it had one session and 113 exchanges.
  - **Two handsets, and the ids say so.** `192.168.0.136` (81 exchanges, 70 of them carrying a device id) and
    `192.168.0.137` (15, 5 of them) carry the **same** `x-wp-device-id` `40752FED…5A1872` - one handset, two leases,
    which E-005 and E-006 had already inferred from the agent. `192.168.0.53` (13) carries a **different** id,
    `3499541B…EEA32B`, with `os=8.10.14226.0` and
    `dm=RM-941_eu_hungary_356` against the measured phone's `8.10.14219.0` and `RM-941_eu_france_308`: a second
    Lumia 625, a newer build and another regional variant. **The two identities overlap in time** - 12:27 to 15:05
    on 2026-10-15 - so this is not one handset reflashed or one lease misspelled; two phones were talking to this lab
    at once.
  - **A fourth address that nothing identifies.** `192.168.0.54` resolved 47 names, 7 of them answered with the
    lab's own address, and **completed no request at all**. It carries the Nokia/Windows Phone fingerprint
    (`discoveryservice.windowsphone.com` 14×, `cdn.marketplaceedgeservice.windowsphone.com` 9×,
    `account.nokia.com` 4×, the NCIS probe 11×), so it is a Windows Phone-era device asking; whether it is a third
    handset or the second one on a second lease is **not in the capture**, because the DNS log carries no device id,
    no MAC and no agent, and it never made an HTTP request that would have carried one.
  - **The fingerprint is not an identity.** Four addresses (`.53`, `.54`, `.136`, `.137`) match the Nokia-era name
    set, and the other 17 that resolve through the lab match nothing: what they asked for is somebody else's - Apple
    devices, a Samsung Android phone, a television's HbbTV stack, an Alexa, VS Code, and four smart-home addresses
    (*inferred* from the resolved names, not verified against the machines). The lab's own probe traffic asks
    `wscont1.apps.microsoft.com` 56× and `catalog.zune.net` 62× from this PC, which is why the census reports those
    names **per address** and never pooled.
  - **What the measured handset actually asked for, whole capture: 96 exchanges.** 67× the `storePages` page, 7× the
    `catalog.zune.net` root, 4× `GET /v8/Configuration/Stores/OEMStores/NOKIA` + 4×
    `GET /v8/Configuration/Stores/MOStores/` (no device id, same `hw`/`dm` - system components of the same phone),
    1× `POST /v8/catalog/updates`, 4× `HEAD account.nokia.com`, 9× `ssl-api.bing.com`. Three of those endpoints are
    in no other entry in this register: both configuration calls and the `catalog.zune.net` root. The configuration
    calls are also the ones that would tell the client what `moId`/`oemId` mean, if they were answered.
  - **`POST /v8/catalog/updates` is the one that changes a reading.** 25 in the whole capture: **20 are this PC's**
    (19 from `.220`, 1 from loopback), 4 are the *other* handset's (all inside 150 ms at `15:05:27Z`), and **1 is
    the measured phone's** (`2026-10-15T14:14:03.468Z`, `.136`). F-012 was right about its own session - every one of
    that session's updates POSTs was ours - but read across the whole capture the measured phone asks for an update
    check **once**, while the aggregate shows five and cannot say that four of them are another phone's.
- **The change** `tools/analyze-captures.mjs` reports *who asked* and *which device* before it reports endpoints, marks
  this machine's addresses, and joins on `x-wp-device-id` (falling back to `hw`/`dm`, without which the configuration
  calls would be unattributed). `--all-sessions` censuses every session; the DNS log was switched to the streamed
  reader `src/capture.mjs` already had, because read whole it throws `ERR_STRING_TOO_LONG` and an empty report reads
  as an empty capture. A device with no id whose `hw`/`dm` matches an identified handset is reported as *same handset*,
  never merged. The register's own sorting rule was the other half of the bug: `MAINTENANCE.md` footgun 4 told the
  reader that `wp8-store-lab-rehearsal` means us.
- **What this changes** "The device" in this file means the `40752FED…5A1872` handset, and its address since
  2026-10-16 04:44 is `192.168.0.137`. Any count taken over the capture without this separation is a count of this
  PC doing what the phone does, and any count of "the phone" that filters on one address is a count of one lease.
  The second handset's traffic is *not* in any finding here, and it should stay out of them until something is known
  about it: it first appears in the capture on 10-15, it runs a newer build, and it asked for updates four times in
  150 ms - which is not what the measured phone does.
- **Verified** `npm run analyze -- --all-sessions` exit 0, `--json` exit 0 (its `devices`, `clients`,
  `deviceRequestsWithoutIdentity` fields carry the numbers above); `npm run selftest` **119/119**, exit 0, ten of the
  checks new and all ten on this attribution (one device id at two addresses is one device; two ids with the same
  `hw` stay two; a component with no id joins its handset; this PC's copy of a device request - same path, same
  agent, same device id - stays this PC's; the fingerprint is narrower than "looks like Store"; the DNS log is read
  per client and a torn line is dropped; and the capture the suite itself writes has no device row in it).
- **Does not establish** How many Windows Phones are on this LAN: `.54` is unresolved, and the DNS log can never
  resolve it. Nor that the *second* handset is idle - it asked for updates, which is not what the measured phone
  does, and nothing here says why. And nothing here says whether this PC's replays perturb what the phones do: they
  share the lab's DNS, so a replay that hijacks a name is a replay the phone's own lookups also see.
- **Does not establish, and it matters most** Whether the vocabulary still holds for the second handset. Its build is
  **8.10.14226.0**, and every offset in `src/store/vocabulary.mjs` was read off **8.10.14219.0**. `npm run
  read-vocabulary -- --device <letter>` has never been run against that phone, so the honest statement is that the
  project has one device's binary verified and a second device's version number. Running it is a mass-storage pass
  and it is the cheapest unknown left.
- **Undo** Nothing to undo in the lab: no config value moved. The report this tool wrote is
  `captures/census-report.md`, not in the repository, and the previous aggregate is still in it as the endpoints
  table - now with a `clients` column saying whose each row was.


## F-024 The FFU answers E-009's open question: the configuration document has the client's own grammar

- **Why** E-009 was armed on a document whose element names were this lab's from first byte to last, and its own register entry
  named the pass that could replace them: search the phone for `mpcVersion`, dump the component, read the grammar. The same pass
  exists **offline**, because a signed FFU is the whole filesystem of the build and can be byte-searched without halting the phone,
  without elevation and without `reg load` touching a hive. `npm run image:find -- --file <image>.ffu` (new, 2026-10-17) does that,
  in ASCII and UTF-16LE, with two controls (`StorePage`, `Store_Hub_TemplateType003`) that are strings already read off the phone, so
  a zero means the method failed rather than proving absence.
- **What it read** Against `~\Downloads\RM941_3058.50000.1445.1005_RETAIL_eu_italy_219_05_458378_prd_signed\...ffu` (1 611 661 312
  bytes), `mpcVersion` = 4 hits, `OEMStores` = 1, `MOStores` = 1, both controls found: the hits are one **endpoint table**, at
  offset `1177075854`, in the client's own file and with the `{Placeholder}` spellings intact. The two URLs the phone asks are two
  `<ep>` entries in it, and they say what the client does with the answer:
  `<ep id="OEMStoreFile" url="{WPAppsMarketplaceShopSecure}v8/Configuration/Stores/OEMStores/{DeviceRawOEMID}?mpcVersion={MarketplaceClientVersion}&amp;os=...&amp;hw={DeviceHardwareBitmask}&amp;dm={DeviceModelName}" />`,
  and the same for `MobileOperatorStoreFile` with `{LastFetchedMOID}`. So the `hw`/`dm`/`mpcVersion` the capture shows on those
  requests are not a quirk of this handset: the URL template puts them there, and `v8/Configuration` - a zero-hit string in
  `ZMarketplace.strings.txt` - is exactly the literal this table holds.
- **The frame, and it is not invented** The same file holds a `ConfigurationFile` document the client parses
  (`<ConfigurationFile version="81000" forceupdate="0"><Domains><Domain id="PROD"><setting id="...">value</setting>`), in five
  domains (`PROD`, `DF`, `INT`, `PartnerNet`, `CertNet`). **Every service base in it is a `<setting>`**, and those settings *are*
  the placeholders the endpoint table substitutes: `<setting id="WPAppsMarketplaceShopSecure" nexus="WPAppsMarketplaceShopSecure">
  https://marketplaceedgeservice.windowsphone.com/</setting>` (also `Shop` on `http://`, `ShopCdn` on
  `http://cdn.marketplaceedgeservice.windowsphone.com/`, `ImageService` on `http://cdn.marketplaceimages.windowsphone.com/`,
  `Accounts`/`Buy`/`Review`/`Telemetry` on the same edge host, `TunerService` on `https://marketplaceconfigservice.windowsphone.com/`,
  `MoServices` on `https://disco.moservices.microsoft.com/`). One document, one grammar, and the parameters the client builds its
  URLs from are settings in it.
- **The negative that turns an inference into the only candidate** The `PROD` domain of the device's own file supplies every
  `WPAppsMarketplace*` base and **not one store setting**: `OEMStoreID`, `MOStoreID`, `MOUniqueID`, `CatalogLocale` and
  `MarketplaceClientVersion` are all absent from it (checked in the extracted document, not assumed), while the same names appear in
  the endpoint table as `<EndpointParameter>` - the parameters `{OEMStoreID}`, `{MOStoreID}`, `{MOUniqueID}`, `{CatalogLocale}`
  expand. Settings the `PROD` file does not carry have to arrive from somewhere, and the two places the client asks at start-up are
  these two endpoints. That does not *prove* the pairing; it leaves no other candidate the client's own files name.
- **The change** `buildStoreConfiguration()` (`src/store/catalog-feed.mjs`) now writes that grammar instead of an invented
  `<StoreConfiguration>`: the eight `WPAppsMarketplace*` bases (with the `nexus=` attribute for bases and without it for store ids,
  both spellings copied from the file rather than unified), plus the store family the file lacks - `OEMStoreID` or `MOStoreID` and
  nothing else. Two omissions are deliberate: `WPAppsMarketplaceTunerService` is **not** written, because that host is not hijacked
  and pointing the client's next configuration fetch at the real server would be a failure this lab injects; and `cc`/`lang`/
  `mpcVersion` are not echoed back as settings, because the table declares them `EndpointParameter`s - values the client supplies per
  call - and answering a question that was not asked is how a plausible document becomes a wrong one. The CDNs are named rather than
  derived: a base built as `cdn.<advertiseIp>` is a hostname no resolver can answer, which is the classic way this reply looks right
  and silently disables images. `x-lab-invented: 1` stays, with a narrower meaning than it had this morning - the grammar is the
  device's, the values answered to it are this lab's - and `x-lab-configuration-evidence` now says exactly that.
- **Verified** The document rendered for `OEMStore/NOKIA` on `192.168.0.220` is well-formed, opens
  `<?xml version="1.0" encoding="utf-8"?><ConfigurationFile version="81000" forceupdate="0"><Domains><Domain id="PROD">` and closes
  symmetrically, and the live lab answers it on both listeners after a restart (pid 19124: `:80` `200`/1304 bytes,
  `MOStore/-` on `:443` `200`/1254 bytes). `npm run selftest` **130/130**, exit 0, with two checks new and two rewritten: the body
  matches the `ConfigurationFile` frame and contains no `<StoreConfiguration` (a body that drifted back to an invented root would
  otherwise still look like an answer), each store answers with its own id and only its own (`OEMStoreID` absent from the
  `MOStores/` reply and vice versa), the CDN and image bases are the hijacked *names* and never `cdn.127.0.0.1`, and the header
  declares its values inferred rather than its element names invented.
- **Does not establish** That the client accepts it: the frame and the setting names are read off the build, the pairing of that frame
  to these two endpoints is still one step of inference, and nothing here is a capture of the real service. Nor that this image is
  the handset's build - the FFU is `3058.50000.1445.1005` retail IT and the measured phone runs `8.10.14219.0`, so every offset in
  `src/store/vocabulary.mjs` still comes from the phone and only the *grammar* here comes from the image; a build difference in the
  configuration parser is not excluded. And nothing says the values themselves are what Nokia shipped: the bases are the `PROD`
  defaults, which is what a phone this lab intercepts needs, not what an operator store would carry.
- **Undo** Nothing to undo in `config.json`: the endpoint stays armed exactly as E-009 left it. The code change is one function; the
  previous invented builder is in this repository's history and the checks above are what would notice a partial revert.


## F-025 The phone took the page and stopped, and it never asked for the configuration

- **Why** "The Store spins forever" is the shape of a failure that looks the same from four different causes - no DNS, a dead
  host, a page that is refused, a page that is accepted and not rendered. The first three leave a mark in the capture and the fourth
  does not, so the question is settled by reading the session rather than by reasoning about it.
- **What the session holds** One session, `session-2026-10-17_12-01-38`, five exchanges, two of them the handset's: at
  `12:06:32.800Z` `GET https://ssl-api.bing.com/winphone/clientconfig/rwsettingbluegdr1qfex.xml` - passthrough, `502`, the
  documented dead host (F-006) - and at `12:06:46.867Z` `GET http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA&moId=`
  answered `200`, `application/atom+xml`, **58 555 bytes**, `decision=store:store-protocol`, in `35 ms`. After it: nothing. No image,
  no second page, no retry, no error. So DNS was the lab's, the host arrived, and the page was **accepted at the transport and HTTP
  layer** - the spinner is a parse or model failure, which is the branch F-019 named and this measurement now puts the failure on.
- **The detail that makes it a parser failure and not a rendering one** The body it received was complete (`content-length: 58555`,
  stored `58555` bytes, `truncated: false`) and every one of its eight panes carried a live source: `<DataSource><Type>Applications</Type>
  <Url>http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/apps?chunkSize=25&amp;category=social&amp;cc=IT&amp;lang=it-IT</Url>
  </DataSource><MaxItems>25</MaxItems>`. By the binary's own function names a pane that parses *is* a pending download
  (`PendingListDownload::ParseFromStream`, `ProcessEntryFromType` - "Create StoreObjects with FeedType = %S Url = %S "), and the URL is
  on the hostname this lab intercepts. Not one of those eight URLs was requested. A page whose panes never became downloads never
  became panes, so the failure is at or before the pane load and not in the UI asset or template the client would draw.
- **The second thing the same session says, and it is about F-024** The handset did **not** request `/v8/Configuration/Stores/...`
  at all, although that route is armed and had been for hours. Its configuration therefore came from the cached override, not from
  this lab: the client keeps the last good store configuration under `LKGOEMStoreConfigOverride` / `LKGMOStoreConfigOverride`, which
  the image's string pool confirms as value names beside `LKGTunerConfigOverride` and `LKGTunerConfigVersionOverride`, under a key
  built from the format string `Software\Microsoft\Zune%s\%s%s` (`ZMReg::CreateKey`, `ZMReg::TryGetDWORD`, offsets `159164596`
  and `165958968` of `RM941_3058.50000.1445.1005_...ffu`). **The consequence is the useful part**: no device measurement can say
  anything about the new document until that value is deleted, because a cached override means the request never happens. The
  reading is therefore two steps, in this order - clear the override, then reopen the Store - and a page fetch that is still
  preceded by no configuration request means the cache survived.
- **What the image does not contain, searched rather than assumed** In the same 1 611 661 312-byte image: `<StoreConfiguration` -
  **zero hits anywhere**, which retires the root this lab invented this morning and is the one thing that made replacing it safe;
  `<setting id="OEMStoreID">` and `<setting id="MOStoreID">` - **zero hits**, so no pre-baked store document ships with the build
  (the names occur only as `<EndpointParameter id="...">` in the endpoint table and as `MktConfigSetting_*` enum entries);
  `forceupdate` - two hits, one of which is the single `ConfigurationFile` the build carries (78 860 bytes, 185 settings, domains
  `PROD`/`DF`/`INT`/`PartnerNet`/`CertNet`, then `XuidMarketization`/`Xbox`/`Zest`/`WPSMarketization`/`WPS`/`WMIS`), and the other a
  WMI trace file. That document carries every `WPAppsMarketplace*` base and **no** store setting: `OEMStoreID`, `MOStoreID`,
  `MOUniqueID` are absent from `PROD` too, and `CatalogLocale` exists only as a per-market map (`<setting id="CatalogLocale"
  XuidMarket="it-CH">de-CH</setting>` under `XuidMarketization`), which is why the served document writes no locale.
- **Does not establish** Why the client renders nothing from a page it accepted. The page was not compared against the parser's
  expected tree in this pass, and nothing here tells a body that parses into an empty model from one that fails late. Nor that the
  cached override is the *old invented* document - it might be the stock one from a previous successful fetch - so the value to read
  before deleting is the cached string itself, and the mass-storage hive read is what would show it.
- **Retracted 2026-10-17 14:44, and the retraction is the useful part** The hive was read: **there is no cached override at all**
  (F-026). The reading above that "its configuration therefore came from the cached override" was inference from a missing request,
  and the cache it supposed was empty - it can only be written after a configuration answer arrives, and on 2026-10-17 at 12:06 the
  lab had never given one that reached the device. So the *consequence* this entry drew - "no device measurement can say anything
  until that value is deleted" - is void: there is nothing to delete, and the next Store open is already a clean measurement of the
  endpoint.


## F-026 The override was never there, and the page cookie is a closed loop

- **Date** 2026-10-17 · **Area** device, registry · **Method** the phone in mass storage (volume `H:`, chosen by the weighted
  markers in `tools/phone-readout.ps1`, 6 points), hives copied to this PC and read twice: mounted with `reg load` + `reg query /s`,
  and scanned as bytes for every name in both encodings, because a registry search that finds nothing must be able to say whether
  the name is absent or the query was wrong.
- **No `LKG*StoreConfigOverride` exists on this phone** `H:\Windows\System32\config\SOFTWARE` (12 845 056 bytes) mounted and
  dumped: `Software\Microsoft\Zune` holds **18 keys and 59 lines**, and no value name contains `LKG`, `ConfigOverride` or
  `StoreConfig` - in the dump or in a byte scan of the same file (0 hits, UTF-16LE and ASCII). `SYSTEM` (5 242 880 bytes) has the
  only `LKG`/`ConfigOverride` strings on the phone and both are audio: `DisableLKG` (dword `1`) and ten
  `...\HdAudModel_*\Driver\PinConfigOverrideVerbs` keys under the `hdaudss_coresystem.inf` driver package. `DefApps\NTUSER.DAT`
  (exported whole, 9 462 lines) has **0** hits, and its only `Zune` strings are `Microsoft.ZuneMusic_8wekyb3d8bbwe` package ids.
- **Why it is absent, and it is not a missing write** The image says the client stores the last good answer there (`ZMReg::CreateKey`
  over `Software\Microsoft\Zune%s\%s%s`, F-025). The answer it stores is the one it *received*; the lab served
  `v8/Configuration/Stores/` for the first time at `12:02:59Z` on 2026-10-17, and every one of those five exchanges is
  `192.168.0.220` - this PC's curls, not the handset. So the cache is empty because nothing ever filled it, and the handset's
  missing configuration request in the 12:06 session cannot be explained by a cached override.
- **The cookie is a measured round trip, not a hypothesis** `config.json` has carried
  `pageCookie: 7f3c9a52b1e84d0f9a6c2e58d4b1073c` since 2026-10-15 22:20 and the reply has echoed it; the handset's request at
  `12:06:46.867Z` carries `x-wp-storepage-cookie: 7f3c9a52b1e84d0f9a6c2e58d4b1073c`, and the hive holds
  `Microsoft\Zune\Settings\WPSStorePageCookie` = the same 32 hex. Header read, stored, echoed - the whole path F-025 quoted from
  the binary (`WPSHeaderHandler::GetStorePageCookie`, `::AddStorePageCookie`) is now observed end to end on the device.
- **The cache key is the cookie - and the cache does NOT mean accepted (corrected 2026-10-17 15:27, F-028)** The page the client kept at 12:06 was at
  `Data\SharedData\EdmCache\Short\9\7f3c9a52b1e84d0f9a6c2e58d4b1073c$48b1e555.zmz`, 58 555 bytes, written 14:06:48 local =
  `12:06:48Z`, two seconds after the delivery. Before the cookie the same request cached under `Short\0\og_storePages_...` (four
  such files, 10-15). So the entry is keyed by the cookie: the same URL fetched under a different cookie is a different entry,
  which is why a stale page cannot be re-used to answer a request that carries a new one - and it is the one mechanism that lets
  the lab make the client re-fetch without touching the device. **What this entry does not mean is that the client accepted the
  page**: the same key on 2026-10-17 holds the 872-byte truncated control (written 15:02:04 local, the open that drew `0xc00cee23`)
  and the 29 252-byte archived document (15:23:34 local, the open that drew `88675309`) - both cached, both rejected. See F-028.
- **`tools/phone-readout.ps1` was blind to exactly that file** Its copy loop selected entries by `Name -match 'storePages'`, so the
  newest cached page - the cookie-keyed one, whose name contains no `storePages` - was listed in the inventory and never opened.
  Fixed in the same pass: it now copies every entry under `EdmCache` except `Keepers\`, and says so in the section title. Parsed with
  the 5.1 parser (`Parser::ParseFile`), no errors; the run itself needs elevation and EdmCache is `Accesso negato` without it, so
  the changed selection is written but not yet exercised against the phone.
- **Nothing else moved, and the silence is informative** 10 files in `EdmCache` (unchanged count), `Public\Documents\Debug` holds one
  report and it is Jellyfin's from 10-11, `Public\Documents\LiveStore` is empty, and `Non-Production Errors.txt` is the production
  self-test log (BCD/IMGE integrity, UMCI audit, SecureBoot) touched 13:45 local - a boot, not a Store run. No Store crash drop was
  written for the 12:06 session, so the failure left no artifact on the device, which is consistent with F-025's "accepted and not
  rendered" and not with a crash.
- **What this changes** E-009 needs no preparation step: nothing has to be cleared, and the next Store open is a measurement of the
  endpoint as it stands. What the 12:06 session still needs is an explanation for the *absent* request, and the candidates are now
  narrower - a Store process that was already running with the configuration in memory, a fetch that belongs to first use after
  boot, or a copy held outside the registry. F-026 cannot separate them because the only one of those stores that could be read was
  the registry, and it is empty.
- **The hive was opened, not merely read, and the difference is on disk** `reg load` / `reg unload` rewrites the file it mounts: 12 845 056
  bytes before and after, SHA-256 `01BE292F…D41433D1` -> `778A8623…9673E376`, 109 bytes different, all of them in the base block and in
  1-15 byte groups at per-key offsets (sequence numbers, dirty flags, last-write stamps) - the `Zune` subtree still exports in full
  afterwards, so no record data moved. A copy taken before the first load is
  `%TEMP%\wp-massstorage\SOFTWARE.phone.backup`, and that is the only way back if a later session wants the pre-2026-10-17 image of the hive.
  Stated because "read the hive" in this repository has meant two different things, and only one of them is read-only.
- **Where the evidence is** `captures/phone-2026-10-17-mass-storage/` - the subtree dump and its `.reg`, the readout report, and an
  `INDEX.md` carrying the byte-scan table. `captures/` is git-ignored, which is why the numbers above are also here.
- **Does not establish** Whether a configuration copy lives in the Store app's isolated storage under `Data\Users\DefApps\APPDATA`:
  that tree answers `Accesso negato` even to an elevated prompt (F-004), and copying it out was attempted and refused in this pass,
  so the negative above is "not in any hive that can be read", never "not on the device". Nor what the `9` in the cache path means -
  it is the only bucket digit seen other than `0`. Nor that the client will not write an override after it accepts a configuration:
  that write is what a successful E-009 run should produce, and it would be visible in the same hive.


## F-027 The control drew an error and the page drew silence: the client parses

- **Date** 2026-10-17 · **Area** device, page grammar · **Method** E-008's control, one Store open, read against the two
  opens of the same URL earlier the same afternoon.
- **The three requests, and the only thing that differs is the body** `12:06:46.867Z` and `12:59:48.260Z`, both from
  `192.168.0.137`, `GET /v9/catalog/storePages?...optedOut=true` with `x-wp-storepage-cookie: 7f3c9a52...`, answered `200`
  with the built page, **58 555 bytes** - and no reaction from the device at all, no dialog, no second request, no crash
  drop. `13:02:01.328Z`, the same request, answered `200` with the control, **872 bytes**, `x-lab-protocol:
  storePages:control`, `x-lab-control: malformed`, body ending mid-element at `<index>1</index` - and the handset showed
  **`0xc00cee23`**. Same host, same query, same headers, same `content-type: application/atom+xml; charset=utf-8`, same
  `no-store`, same content-length discipline. A client that never reached a parser could not react to that difference. One
  caveat, recorded because it is the only other thing that moved: the 13:02 open carried **no** `ssl-api.bing.com` request
  before the page, where the 12:06 and 12:59 opens each began with one (`502`). That request is the client's own, not something
  the lab varied, and the error arrived after the 872-byte body - but it is the reason this entry says "the body is the only
  served difference" rather than "the only difference".
- **What the code is, and what is not claimed about it** `0xC00C…` is the facility this PC's own XML parser reports
  from: `Msxml2.DOMDocument.6.0` on the very string the control serves (`<StorePage><Panes><Pane><index>1</index`) returns
  `0xC00CE55F`, "missing `>` in the end tag", same high word. That is a family, not an identification - `certutil -error` on
  this machine names **neither** code, so the text Microsoft attached to `0xC00CEE23` is not in hand and this entry does not
  invent one. What is measured is narrower and enough: the device distinguishes an unparseable document from a parseable
  one, and the difference reaches its UI.
- **Why this is the result the last six page experiments were missing** E-001 to E-007 and the `atom` run all varied how
  *plausible* the document was, and every one of them produced the same silence - which is exactly what a client that never
  parses would also produce (F-014 said so and left it standing). A negative control separates the two: silence for a valid
  page and an error for an invalid one means the parser is running and the defect is *inside* the document. From here a
  further page edit is a test of the grammar, not of the transport.
- **Verified from the PC before the open, and the revert after it** Armed: `200`, `872`, control headers, unparseable tail.
  Reverted with `serve: "generated"` + `POST /__lab/reload`: `200`, `content-length: 58555`, `x-lab-protocol: storePages`,
  no `x-lab-control`. `config.json` parses. `npm run selftest` **130/130**, exit 0, both while the control was armed and
  after - the suite builds its own config, which is why arming an experiment does not move it.
- **Does not establish** *Where* the built page fails, or that it fails at all in this sense: an invalid document can be
  rejected by a validator that runs before any model is built, and the next question is which construct of ours that
  validator dislikes - `panes` vs `storePage`, the pane's `DataSource`, the template type. Nor that `0xc00cee23` is a
  parse error rather than the code this client shows for "the page I got was unacceptable" - only that this body, and not
  the other, produced it. Nor whether the control's 872 bytes were written to `EdmCache`: the phone was not read after this
  open.


## F-028 The response cache keeps bodies the client cannot use, and the Store keeps nothing else

- **Date** 2026-10-17 15:27 local · **Area** device, cache and shared data · **Method** mass storage, one elevated read: `EdmCache` copied
  whole, `Data\SharedData\Comms\Unistore` copied whole, `Documents\Debug` copied, and every file under `Data\SharedData`,
  `Data\SystemData` and `Data\Users\Public` modified since `12:30` listed. Script: `%TEMP%\wp-massstorage\read-unistore.ps1`,
  report `readout2-2026-10-17\unistore-readout.txt`.
- **The one result that changes something: caching is not acceptance** `Data\SharedData\EdmCache` holds **11** files, and the
  cookie-keyed bucket for this page carries two bodies written during today's rejected opens: `Short\9\7f3c9a52...$48b1e555.zmz`,
  **872 bytes, 15:02:04 local** - the truncated control, delivered at `13:02:01Z`, the open that showed `0xc00cee23` - and
  `Short\9\7f3c9a52...$48b1e555$0E8B.zmz`, **29 252 bytes, 15:23:34 local** - the derived archived document, the open that showed
  `88675309`. The client writes the delivery to its cache **before** it can use it, so a cache entry is evidence that a body arrived
  and nothing more. F-026 read the 12:06 entry as the client having accepted the page; that reading is withdrawn here, and with it the
  idea that the cache could ever have told us which documents the client *understood*. The 58 555-byte entry from 12:06 is gone from
  the same key: the newest body for that key replaces the previous one.
- **The surface that had never been opened, opened, and it is not the Store's** `Data\SharedData\Comms\Unistore` holds 488 entries -
  a 33 532-byte `AggregateCache.uca` (15:00:48 local) and 485 files of 60 bytes under `data\2\a`..`data\2\p`, all with the **same**
  SHA-256, all written in a 39-second burst at `14:00:10`-`14:00:49`. The 60 bytes are a BOM and the string `Importo da
  account1@google.com`: this is the phone's **account and settings import** store, not the app Store's cache, and its update burst
  belongs to the account/import path rather than to any page open. Nothing in it mentions the Store, the page, or a catalog. The
  lead F-021's note left ("the Unistore catalogue cache under `Data\SharedData\Comms\Unistore`") is therefore closed: the name is
  right, the thing is not a catalogue.
- **And nothing else moved for a page** The `modified since` sweep over `Data\SharedData` returns 519 files, and outside the
  Unistore burst they are the operator-settings refresh (`Data\SharedData\OEM\Public\ADC`, 13:09), the speech grammars (13:58) and
  `casvcdatabase\edbtmp.log` - none of them a Store artefact. `Documents\Debug` still holds exactly one report, Jellyfin's from
  10-11, so **none of the nine documents delivered today left a crash drop**. `Documents\LiveStore` is empty.
- **What this leaves** The client's own state is not readable where the Store would write it: it caches bodies it then rejects, it
  writes no report when it fails, and the one shared tree whose name promised a catalogue is the accounts store. The remaining
  surface is the Store app's isolated storage under `Data\Users\DefApps\APPDATA`, which denies an elevated read (F-004) and would
  need taking ownership - a write to the device, and a decision, not a mechanic.
- **Does not establish** That the client parses the cached body at all: a cache write and a parse are independent, and the 872-byte
  entry proves the write happens even for a body the client later reports as unparseable. Nor that any of the nine documents was
  *understood* - only that two of the rejected ones were stored, which is the opposite of the inference this entry withdrew.


## F-029 The isolated storage, opened: the Store keeps nothing there, and a second client does

- **Date** 2026-10-17 15:39-15:48 local · **Area** device, the surface F-004 left closed · **Method** ownership taken on
  `Data\Users\DefApps\APPDATA`, `robocopy /B` of the tree, ACL restored; then the whole of `Data\SharedData\EdmCache` copied
  through `\\?\`. Scripts `%TEMP%\wp-massstorage\take-ownership-defapps.ps1`, `read-defapps.ps1`, `restore-owner2.ps1`,
  `copy-long.ps1`; evidence and the two reports in `captures/phone-2026-10-17-mass-storage/defapps-readout/`.
- **What was done to the device, and undone** `takeown /r` exited **1** with two lines of output and not one `denied` among
  them - and the owner was this PC's account afterwards, which the restore step recorded as `owner prima`, so the code was not
  "the owner change was refused" - while `icacls /grant *S-1-5-32-544:(OI)(CI)F /T` succeeded, which is the whole mechanism: 1140 files, 138.4 MB copied with
  `robocopy /B`, then the Administrators ACE removed and the owner set back to `S-1-5-21-2702878673-795188819-444038987-2781`
  with `Set-Acl` (`icacls /setowner` answers **1332**, because it resolves a *name* and that SID has no account here; a
  `SecurityIdentifier` object needs no resolution). **No file on the phone was edited** - the copy is a read, the two `icacls`
  calls change an ACE and the ACL went back. Afterwards the path answers `Accesso negato` to an ordinary prompt again, which is
  the state F-004 recorded; that is the only check possible without owning the folder a second time.
- **The negative, and it is the answer to the question this surface was opened for** No Store state is in there. Of 173 package
  folders, **`STOREDATAMIGRATOR` and `HUBTILERESTOREHOST` are empty**, `Microsoft.ZuneMusic` carries only its 2016 EDB
  scaffolding, and nothing under `Local` names the Store, a catalogue or a page. The Store's page cache is where F-028 said it
  was, in `Data\SharedData\EdmCache` - so the surface that F-004 made unreadable was never where the client's verdict would be
  written. With it, the last item left open by the previous read closes honestly: **all 11 `EdmCache` entries are now copied**
  (`captures/.../edmcache-complete/`, with `MAP.tsv`), because through `\\?\` the longest path is **238 characters** and the
  "four not copied for MAX_PATH" was a reporting artefact of the enumerator. What overflows is the *destination* name: the file
  name of a `storePages` entry **is** the query string, so seven of the eleven names are cut to `<first 40>~<last 7>` and
  `MAP.tsv` keeps every original path.
- **The positive, and it was not the one being looked for: the handset already runs a store that works** Package
  `fa477102-7bbf-4e47-a48f-54b1d9c1cdde_jv9w7t471r6vp`, `AC\INetCache`, holds the answers a **second client** received between
  2026-10-06 and 2026-10-11: `/apps` (530 entries, 552 013 B), `/games` (371, 470 829 B), `/apps/search` and `/games/search`
  answers, nine `/app/{id}` and `/game/{id}` detail pages (`variants`, `updates`, `reviews`, `r2_url`) and `/me`. The WinINet
  index names the hosts: `store-api.live.net.co` (17 URLs: `/apps`, `/games`, `/apps/search?q=`, `/games/search?q=`, `/app/{id}`,
  `/game/{id}`), `cdn.store.live.net.co` (66 - icons and `.appx`/`.xap`/`.appxbundle` payloads), `id.live.net.co` (5, an OIDC
  authorize with `client_id=LSS` and an `ms-app://s-1-15-2-...` redirect), `legacy.livestore.cdns.onelive.me` (15). So this is the
  **Live Store client**, a community front-end with its own JSON API, and the day's nine documents went to `ZMarketplace`, a
  different program with a different protocol.
- **The API refuses an anonymous caller, measured rather than assumed** `GET https://store-api.live.net.co/apps` from this PC
  answers `403`, 469 bytes, `{"error":"Get the latest version at g.live.net.co/ls_ww/1 (Windows Phone 8.1) or
  g.live.net.co/ls_ww/2 (Windows 10). Error: VC1", ...}`. Keyless, therefore, but **version-gated**: the cached pages were
  fetched by a client that names a build. The payloads also carry the operator's notice that the API cannot be used without
  written permission, so the bodies stay in `%TEMP%` and only their shape is recorded - `defapps-readout/contract.txt` states
  routes, item fields and counts, and `me[1].json` (a name, an e-mail, a developer id) is not reproduced at all.
- **Why this matters to the page question** Not as an answer: as the end of one line of inquiry. The client the lab has been
  feeding is not the client that works on this handset, and the storage that was supposed to hold its state holds another
  product's cache. Nine documents have been delivered and none produced a model; the next surface is not DefApps, and the
  cheapest remaining lever is still the one E-010 named - whether *any* document makes `ZMarketplace` ask for something.
- **Does not establish** That the Store's model cannot be built - only that this storage does not hold it, so the reason is
  elsewhere (the client's code, the registry it does write, or a validation that runs in memory). Nor the LSS client's build or
  identity beyond the package SID in its own authorize URL, which was not resolved to a package family name: the app's binaries
  were not read, and that is the one thing in this entry that was seen from far away.


## F-030 The second client's protocol, served from this lab's catalog

- **Date** 2026-10-17 (built and measured the same evening) · **Area** the Live Store client's JSON API · **Method** the
  shapes read off that client's own cache in F-029, written into `src/store/live-client.mjs` and a `store-live-client`
  handler, then requested over the running lab with the client's own `Host`.
- **What is served, and where its authority comes from** `GET /apps`, `/games`, `/apps/search?q=`, `/games/search?q=`,
  `/app/{id}`, `/game/{id}`, `/me`. The list envelope is `{categories, apps|games, information}`; a list entry carries
  **exactly** the seventeen keys the cache holds, in its order; a detail document carries exactly the thirteen at its top
  level and the twenty-two inside `details`. Nothing was renamed, added or reordered, because an extra key in a served
  protocol is a claim about a client nobody measured. Values come from the fixture, so every response says
  `x-lab-invented: 1`.
- **Three decisions the shape forced, recorded because each is a choice** (1) **the ids are the entry's position**, 1-based
  as a string, and `/app/<that number>` resolves them: the real service numbers its apps and the fixture's ids are slugs
  whose own note says they are GUID seeds, so serving a slug would be a value *type* this client never saw. (2) **`icon` and
  `r2_url` are null**, never a URL: a URL here would send the handset to the operator's image or package CDN, which is one
  service this lab must not stand in for, and the fixture has no artwork or package anyway. (3) **`/me` answers `401
  auth_required`** rather than a fabricated account: the real field holds a signed-in identity, and an invented one is the
  only lie in this protocol a client could act on.
- **The guard, and why it is not decoration** The handler matches on host and refuses with `421` unless the host is one the
  lab was told to intercept (`isInterceptedHost`, the same guard the other Store handlers carry). The router is consulted for
  *every* request that reaches the lab, so without it a bare `Host:` header would be enough to have this lab answer for a
  name it was never asked to serve. Arming it for the handset therefore takes three touchpoints - the flag, the host in
  `proxy.mitm.hosts`, the host in `dns.hijack.names` - which is deliberate: the community client works today against the
  real service, and no single value should be able to take its catalog away.
- **Measured, on the PC, through the listener the device would use** Suite: **143/143, exit 0**, ten checks new (the
  disabled handler falls through; the unlisted host is `421`; the list envelope and its exact key set; the ids; the thirteen
  detail keys and a numeric-string `download_count`; an unknown id is `404`; search without a term is `400`, with one it
  filters, with a nonsense one it finds nothing; `/games` is an empty list that says why; `/me` is `401`; `POST` is `405`).
  Armed in `config.json` and after `POST /__lab/reload`: `GET /apps` with `Host: store-api.live.net.co` answers `200`,
  `content-type: application/json; charset=utf-8`, `x-lab-source: live-client`, `x-lab-invented: 1`, `x-lab-count: 17`;
  `/app/1` `200` with the thirteen keys; `/apps/search?q=Corte` `200` `x-lab-count: 2`; `/apps/search` `400`; `/games`
  `200` with `x-lab-note: the catalog this lab serves carries no games`; `/me` `401`; `/app/9999` `404`; `POST /apps` `405`.
  Disarmed again in the same minute: the same request is passed through to the real service (`301`, Cloudflare) with no lab
  header, and the phone's own page endpoint is untouched (`200`, 58 339 bytes, `x-lab-protocol: storePages`).
- **Why this is worth having even though it answers a different client** It is the first thing in this project that serves a
  protocol *some* client on this handset demonstrably parses and renders from - the same catalog the page endpoint has been
  failing to get a model out of. If the page question ever needs an oracle for "is this client-side or server-side", this
  endpoint is one: it delivers the same invented store to the client that works, and the difference between what that client
  draws and what `ZMarketplace` draws is the difference between the two protocols and not between the catalogues.
- **Does not establish** That the client parses any of it. The keys are the cache's; the *values* are the fixture's, and a
  client that wants artwork, a download URL or a variant may reject the document exactly where the fabricated parts are -
  which is the device test not yet made, and it needs the three touchpoints armed. Nor the meaning of the `VC1` refusal an
  anonymous `/apps` gets from the real service (F-029 measured only that it is refused), nor whether the client cares that
  `information` no longer carries the operator's notice.


## F-031 The Store renders this lab's app list, and 420 image requests were answered 502

- **Date** 2026-10-17 14:18-14:26 local · **Area** device, the first rendered content · **Method** one handset session,
  `captures/session-2026-10-17_14-17-31/index.jsonl`, 486 requests from `192.168.0.137`, read path by path; the fixture's own
  GUIDs recomputed with `uuidForApp` to see whether the ids the client asked back for were ours.
- **The result that matters: search works, and it is our catalog the client drew** `14:21:34.220Z`,
  `GET /v9/catalog/apps?...&chunkSize=50&q=f` answered **200**, `x-lab-protocol: appList`, `x-lab-apps: 17` - the demo
  fixture. The handset then asked for four apps **by the GUIDs this lab mints**: `0e26aad2-8c5d-5aa4-acdb-642442bbc3ca`
  (Corte dei Vicini) ×8, `ab53f005-1e0a-5115-bedf-61fa492ba94c` (Filodiretto) ×14, `db38e142-68ca-5e82-8c12-c9826e8a5958`
  (Onda Corta) ×10, `4f59491a-d2b4-5c28-bc80-6681aa8f165d` (Erbario Portatile) ×2, each answered `200` with `x-lab-protocol:
  appDetail`. A client that asked for the detail of an entry it had not resolved could not produce those four ids, so the
  list was **parsed, built and rendered** - the first content this lab has ever had drawn on the screen. The reading is the
  user's too: "se cerco `f`, compaiono molte app, con tutte le informazioni".
- **What that changes about the page** The entry grammar is not the problem. The same entries, in the same `catalog-feed.mjs`,
  render from `/v9/catalog/apps` and produce nothing from `/v9/catalog/storePages` - eight page fetches in this session, all
  `200`, all the same 58 555-byte document, none followed by a single pane source. So the defect is in the **page frame** (the
  `StorePage` wrapper, `Panes`, `Templates`, the pane's `DataSource`), not in the applications inside it, and the mutants of
  E-010 that renamed those constructs were probing the right place - they were just read as "not refused" rather than
  "not read".
- **Two injected failures, and one of them was 420 requests wide** Every image the client asked for - and it asked for
  **420** of them between `14:21:35.008Z` and `14:24:07.111Z`, two and a half minutes,
  `cdn.marketplaceimages.windowsphone.com/v8/images/<guid>?imagetype=icon_small`, **17 distinct guids**, up to 40 requests
  for one of them - was answered `502 upstream_loop`: the host is in `dns.hijack.names` and `proxy.mitm.hosts`, and no
  handler matched it. Those 17 guids are not new to this lab: they are the `<image><id>urn:uuid:…</id></image>` of the
  seventeen entries in the feed the client had just rendered, one for one and with nothing left over - so the images were
  requested *from the list the client had drawn*, which is the same fact as the resolved app ids above, seen from the
  other end. `GET /v8/catalog/queries?prefix=f` (the search box's suggestions) was answered `502` sixteen
  times, four retries per keystroke, and `/v8/catalog/appCategories/windowsphone.Social` eight times. **The image CDN is now
  answered** by a `store-images` handler: a generated 48x48 PNG, the same bytes for every guid and every `imagetype`, saying
  so (`x-lab-image: placeholder`, `x-lab-invented: 1`). Arming it removes the failure class; it does not attribute anything.
- **`0x80070057` seen on the handset, and it is not attributed here** At `14:25:47` and `14:26:05` the page was fetched again
  (`200`, 58 555 bytes, the same document) and the screen showed **E_INVALIDARG**. The capture holds only those two fetches -
  no request follows them - so the code is the client's own verdict on the page, the fourth distinct one on record
  (`0xc00cee23` for the unparseable control, `88675309` for the archived feed-where-page-expected, silence for eight built
  pages, now this). One hypothesis fits the timing and is **explicitly a hypothesis**: with the image host hijacked, the
  client was handed a 502 error document where a bitmap was expected, and decoding it throws `E_INVALIDARG`. The `images`
  flag is the test of that and nothing else, because it changes the images and leaves the page untouched.
- **Read on the handset, one Store open with the placeholder armed: the slot changed colour, and that is all it showed** The
  square where an app's logo is drawn - in the same list the client had rendered - went from **grey to the placeholder's own
  dark blue**, `#2E355C`. That was first written here as "the client decoded the bitmap", and the reading was **wrong**, so it
  is kept and corrected rather than deleted: a **flat field cannot distinguish** a client that painted this lab's bitmap from
  one that painted its own empty-image background, and both produce that same coloured square. The person looking at the
  handset answered the question the pixels could not - the colour changed and **no logo is drawn** - which is what the second
  reading of a flat field would look like. So all that session established on the screen is that *something* was painted in the
  slot where the `502` painted nothing; whether it was these bytes is now a test instead of an inference, because the
  placeholder carries a **frame and a diagonal cross** (`src/store/images.mjs`, `x-lab-image-shape: 48x48 field+frame+X`). If
  the mark appears, the bitmap is drawn; if only the colour does, it is not. What the same open did settle is the other half:
  the home page was **unchanged, still on the spinner**, so **the page's missing model does not depend on images.** The reading
  is the user's, from the screen; the capture holds the image requests and the page fetch, not the pixels.
- **Read in a second session, with the handler already armed** `captures/session-2026-10-17_14-27-40`, 56 requests: the image
  host asked 14 times and answered `200` every time (`icon_small` and `icon_large`, 13 distinct guids), where the earlier
  session has 420 of them all `502`. The failure class is gone from the capture; the screen is what decides whether the bytes
  are drawn.
- **Verified from the PC** `npm run selftest` **147/147**, exit 0, three checks on the images (off falls through; on answers
  an unlisted host `421` and a listed one `200 image/png` whose body has the PNG signature, `IHDR` and `IEND`, with
  `content-length` equal to the body; the same bytes for another guid and another `imagetype`; and the PNG **decodes to two
  colours with a mark at the centre**, so a flat field cannot pass as a marked placeholder again). Over the running lab, with the phone's own
  `Host`: `/v8/images/a07cf5c2-…?imagetype=icon_small` `200`, `content-type: image/png`, `content-length: 158`,
  `x-lab-source: store-images`; the page endpoint unchanged at `200`, 58 555 bytes, `x-lab-page-format: panes`.
- **Does not establish** Why the page frame yields no model - only that the entries do render, so the difference is in the
  frame and the next probe belongs there. Nor that `0x80070057` came from the images: this entry does not know which UI the
  code appeared on, and the capture cannot say. Nor that the two `502` endpoints are irrelevant: `/v8/catalog/queries` and
  `/v8/catalog/appCategories` still fall through, and no capture of either document exists, so answering them would mean
  inventing a grammar - which is why they are left alone.

## F-032 The page frame carries every path its parser names, so the missing model is not a missing path

- **Date** 2026-10-17 evening · **Area** the page document · **Method** `npm run page:diff` (new,
  `tools/page-diff.mjs`), which fetches the page **through the real router** - so it reads what the device would be
  sent under the current config - walks it, and reports every one of `PAGE_PARSE_PATHS` (the selectors read out of
  `ZMarketplace.dll`) as carried exactly, carried under a prefix only, or missing; then does the same for the first
  `<Pane>` against `PANE_FIELDS`, and for the archived response of the real service. The same reading is asserted
  in `npm run selftest`, so a builder change that drops a parser path fails the suite instead of a device run.
- **The result** 22 required parser paths, **0 missing**. 10 are spelled exactly as the parser spells them
  (`/StorePage`, `/Panes/Pane` ×8, `/Templates/Template`, and six the application records satisfy anywhere in the
  document). 12 are carried under the atom prefix - `/feed`, `/feed/entry`, `/feed/link`, `/feed/entry/id`,
  `/feed/impressionId`, `/feed/entry/editorialItems/editorialItem`, and the application/offer subtree. That is
  **how the real service spelled them too**: the archived v8 response is `a:feed`/`a:entry`/`a:link` throughout,
  so the prefix is a property of the protocol and not something this lab introduced, and which spelling the
  client's XML engine accepts is not decided here.
- **What that rules out** The hypothesis held since F-014 - that the page renders nothing because the client asks
  its parser for a construct the document omits - is **refuted for all 22 required paths**. Whatever fails is
  either a value, a spelling, or something below the paths the page parser walks.
- **The pane, one level down** Of the 12 paths in `PANE_FIELDS`, the served pane carries **8**: `/Id`, `/Title`,
  `/Type`, `/CollectionId`, `/DataSource/Type`, `/DataSource/Url`, `/MaxItems`, `/MinItems`. It does **not** carry
  `/SubType`, `/BackgroundImage/id`, `/LiveTileUpdateInterval`, `/StoreObjectsForLiveTile`. Nothing read says the
  pane parser *requires* any of them - and the archived page carries **no `<Panes>` at all**, its items hang
  directly off the root as `a:entry`, so the archive cannot settle it. That is a fact about the document, recorded
  as one: four fields absent, none of them yet shown to be wanted.
- **A session with the pane source armed, and not one icon follows** `captures/session-2026-10-17_14-50-41`, the open at
  `14:50:50` (`x-wp-device-id 40752FED…`, the measured handset): page `200`, four retries of `/v8/catalog/queries` `502`,
  then `GET /v9/catalog/apps` `200` - the URL the page's own pane named - then **six** fetches of one app detail
  (`0e26aad2…`, Corte dei Vicini), then the page again. **Zero requests to the image host.** In the same configuration the
  *search* result list drew 420 image requests (`F-031`), so the client reads the pane's feed, resolves an entry out of it
  and asks for its detail, while asking for no icon at all: the same entries carry icons when drawn from the search list and
  none when drawn from the pane source. That is "the page's items are not rendered" seen from the images side, and it is
  the second independent reading of it - the first being that no pane source was requested at all before the data source was
  armed (`F-019`).
- **The candidates left, ranked, with what each rests on**
  1. **A pane field that is wanted and absent** - `BackgroundImage/id` first, because a hub tile draws art and the
     pane map names it (@14024). Evidence that it is required: none. Evidence that it is used at all: the name is in the
     pane's own property map. **The probe is built and off**: `livestore.protocol.paneBackgroundImage` writes
     `<BackgroundImage><id>urn:uuid:…</id></BackgroundImage>` into every pane (guid derived from the section title, so it is
     stable and distinct per pane), the image endpoint answers whatever guid it is handed, and the page response carries
     `x-lab-pane-background: guid|none` so no capture can be read against the wrong arm. Arming it is `true` plus
     `POST /__lab/reload`, and it changes the pane and nothing else.
  2. **The pane's `Type` value.** `Collection` was chosen from the parser's literal pool (@29010-@29064) and the
     phone's own UI asset names; it is a token, not an observation. A wrong token that a client *compares* leaves
     the rest of the document unread, which is exactly the silence observed.
  3. **The arrangement.** Panes that *point* at content versus entries that *carry* it. Both arrangements have now
     been served (`storePage` and `panes`, F-014) and both drew nothing, so this is weakened - but the archive's
     arrangement is neither of them, so it is not closed either.
  4. **Something outside the document** - a header, the page cookie, the configuration on the critical path. Less
     likely since F-027 (the control drew an error, so the client parses) and F-026 (the cookie round-trips), and
     kept last because each of those is a single observation.
- **Does not establish** Which of the two spellings the client accepts. Whether the pane parser runs at all for
  this document, or requires any of the four absent fields. Nothing here is a claim that the page *should* render:
  it is a statement of what the document contains, checked against what the binary says the client looks for.

## F-033 An install attempt asks for nothing new: the account wall is not (yet) a network event

- **Date** 2026-10-17 14:59-15:02 local · **Area** the install path, measured for the first time · **Method**
  `npm run trace:install -- --device 192.168` on the running lab, print of every exchange from the handset and
  every DNS query it made (`dns.logQueries` records all of them, hijacked or not), then the same window read by
  timestamp from `captures/dns-queries-2026-10-17.jsonl`.
- **What the handset did** `session-2026-10-17_14-57-05`, 18 exchanges from `40752FED…` at `192.168.0.137`:
  page `200` at `14:59:55` (and again at `15:01:08`), four retries of `/v8/catalog/queries` `502`, `GET
  /v9/catalog/apps` `200` (the pane's source), then **six** fetches of one app detail (`0e26aad2…`) between
  `15:01:13` and `15:01:58` - and nothing else. **No licensing host, no account host, no package URL.**
- **The DNS side, which is the part that would have shown a wall the lab does not answer** In that whole window
  the handset resolved **five names**: `cdn.marketplaceedgeservice…` and `marketplaceedgeservice…` (twice each,
  hijacked) and `discoveryservice.windowsphone.com` once (forwarded). Nothing for `login.live.com`, nothing for a
  licence or purchase service, nothing for a download CDN. A request the lab cannot see cannot be the thing that
  blocked the install.
- **What that establishes, and what it does not** The "you must sign in to install" wall, in this configuration,
  **does not produce a request**: whatever the client consulted, it consulted locally, and the only network effect
  of the attempt was fetching the same detail document again. So interception cannot be the fix for this wall as
  it stands - the client never gets far enough to ask anybody. It does **not** establish that no such request
  exists in the protocol: six detail fetches and no install surface is exactly what "the detail page yields no
  model" would look like from the network, and the capture cannot see the screen. Whether a button was there, was
  pressed, or opened a sign-in dialog is the operator's half of this measurement, and it is missing.
- **The screen, as the operator read it - the half the capture cannot see** On the same run the install control answered
  **"devi avere un account Microsoft"** and then a technical error whose code begins **`800…`**, not recorded in full at the
  time. Two facts follow from that, and they are the reason this entry is worth keeping: the client **does** present an
  install surface and a gate (so the detail page was not simply blank), and the gate **fails before asking anybody** -
  which is the same statement as the empty network window, from the other side. Which family the code belongs to decides
  the next step and cannot be guessed: a transport code (`0x80072EFD`, `0x80072EE7`) would be a host the lab never saw, and
  the DNS log holds no such name; an account code (`0x80048820`) is the local gate, and the way through it is a real
  sign-in, not an interception.
- **The code that came, and what it points at** `0x80070057` - `E_INVALIDARG` - and then the sign-in message. That is the **same code**
  the home page produced at `14:25-14:26` when the image host was answering `502` (`F-031`), and the fifth distinct verdict this client
  has given on this lab's documents (`0xc00cee23`, `88675309`, silence, `0x80070057`, `0x80070057`). An invalid *argument* is what a
  client throws when it builds a request from a model that is missing a field it needs - not what a server error looks like - and the
  sign-in message came **after** it, which makes the account wall a consequence here rather than the cause.
- **The field that would be missing, and the probe that is now armed** The archived response of the real service puts
  `<mediaInstanceId>` immediately after `<offerId>` in **every** offer, and the client logs the pair it works with when it handles one:
  `wszLicenseType '%S' wszMediaInstanceId '%S'` (`F-017`). This lab has never written that element - when the v9 *application list*
  archive was read it carried none, and the entry shape was copied from it (`F-022`) - but a list and an install are not the same
  consumer, and an install built from an offer with a licence type and no media instance is exactly the shape that throws
  `E_INVALIDARG`. So `livestore.protocol.offerMediaInstance` is **armed** (`true`): every offer on every surface - list, detail, page -
  now carries `<mediaInstanceId>urn:uuid:…</mediaInstanceId>` with a guid derived from the app (`media:<app id>`), and
  `x-lab-offer-media-instance: guid` says so on the wire. 34 offers, 34 media instances on the served page; the detail response 1965 bytes,
  up from 1885. **This is a hypothesis with a test, not a finding.** The reading is the next tap: if `0x80070057` turns into a request,
  the field was the missing one and the capture will name the host the install asks for; if it stays, the field is not the cause and the
  next candidate is the offer's `paymentTypes`/`store` pair. The guid is minted here, so a licensing step downstream would reject it -
  the test is only whether the client gets past `E_INVALIDARG` to ask someone.
- **What to measure next, in order** 1) the screen: does the detail page draw, and what does the install control
  do - this decides whether the wall is the local account check or the missing model, and the two have opposite
  fixes. 2) If the client does show a sign-in path, `login.live.com` is **alive on the real network** and
  deliberately not hijacked (E-004) - signing in is the one part of this chain that may still work, and it would
  move the wall to the licensing call that follows it, which is the request worth having.
- **Does not establish** That the app cannot be installed without an account, that Microsoft's licensing service is
  reachable, or that a licence can be satisfied from this lab. Nothing in this entry is about signatures; it is
  about who the phone talked to, and the answer is: only this lab.


## F-034 The device certificate request has a written contract, and the lab can now answer it

- **Date** 2026-10-20 · **Area** the device-identity path, and the lab's own host list · **Method** read of the contract in
  [`ReLiveWP/ReLiveWP`](https://github.com/ReLiveWP/ReLiveWP) (`src/services/ReLiveWP.Services.Activation/Controllers/CertificateRequestController.cs`),
  then `src/pki.mjs` + `src/store/provisioning.mjs` written against it, `npm run selftest` **155/155** exit 0, and one armed round
  on the running lab measured on both listeners - `:80` with the phone's `Host`, and `:443` over TLS with SNI - then disarmed with
  `POST /__lab/reload`.
- **Why** `devicecertificateservice.windowsphone.com` has been in `tools/analyze-captures.mjs`'s Store-host list for as long as that
  tool has had one, and no handler has ever matched it: every such request was a `502` this lab injected, the same defect F-031 found
  on the image CDN, on the one host a device uses to prove it is a device. The install path is where that would matter - F-033 ends at a
  gate that fails before asking anybody - and no capture of the request, the answer or the host exists: not in the archive (F-021), not
  on the phone (F-020), not in the FFU (F-024), where the only related tokens are the host name and nothing about the protocol.
- **Where the contract comes from, named rather than implied** Another project reversing the same era of handsets implements the WP7
  endpoint, and its controller is specific enough to build from: `POST /dcs/certificaterequest` (plus `/certificaterequest`),
  `content-type: application/pkcs10`, headers `X-Windows-Phone-Activation-Protocol-Version` (`1.0`/`2.0`),
  `X-Windows-Phone-Activation-Code` and `X-Windows-Phone-Device-Info` (a `Name:value,Name:value` list whose `DeviceUniqueID` is
  mandatory), a **base64** PKCS#10 body, a **base64** PKCS#7 chain back with `application/c-x509-ca-cert`, `400` for a malformed
  request or a missing header and `409` for a code it will not honour. Their docs also say why the endpoint exists at all: the device
  "will refuse to connect to any Windows Live services without a valid certificate chain". That is a statement about WP7 and it is
  **not** a measurement of this 8.1 handset - no request from this phone has ever been captured, so the response says so on the wire.
- **The change** `src/store/provisioning.mjs` (new, `store-provisioning`), `Pki.signCsr()` in `src/pki.mjs`, the `pki` handed to the
  router through `deps`, `livestore.provisioning` in `src/config.mjs` and `config.json`, **off by default**. It answers the two routes,
  refuses with a named reason (`x-lab-refused: no_protocol_version | unsupported_protocol_version | no_activation_code |
  no_device_info | no_device_unique_id | activation_code_refused | malformed_certificate_request | pki_unavailable`), and returns
  `x-lab-invented: 1` on every answer. A body that is not base64 is refused by a round-trip comparison rather than by Node's tolerant
  decoder, because a text body would otherwise become mystery bytes and reach openssl as an error nobody can attribute.
- **The part that had to be decided rather than copied, and it is a security decision** `openssl x509 -req -copy_extensions copy`
  is the obvious way to sign whatever was asked for, and on a CA that is trusted by the phone for TLS interception it is a way to
  mint a certificate for `login.live.com` from a request anyone on the LAN can send. So the extensions are **fixed** in the signer -
  `basicConstraints=critical,CA:FALSE`, `keyUsage=digitalSignature,keyEncipherment`, `extendedKeyUsage=clientAuth`, no SAN - and the
  request's own are never copied. The selftest sends a CSR that asks for `CA:TRUE` **and** `subjectAltName=DNS:login.live.com` and fails
  if either appears in the issued certificate.
- **Verified, live, on both listeners** Armed (`enabled: true`, the host added to `proxy.mitm.hosts` and `dns.hijack.names`, then
  `POST /__lab/reload` - no restart, so the phone's connection was never dropped): `POST http://127.0.0.1:80/dcs/certificaterequest` with
  the phone's `Host` and the three headers answered **`200`**, `content-type: application/c-x509-ca-cert`, `content-length: 2268`,
  `x-lab-source: provisioning`, `x-lab-invented: 1`, `x-lab-cert-subject: CN=lab-device-live`, `x-lab-device-unique-id: 0f1e2d3c`; the
  body decodes to a **1701-byte PKCS#7 with two certificates**, `openssl verify -CAfile ca/ca.crt` says **OK**, and the leaf is
  `CA:FALSE` + `TLS Web Client Authentication` with **no copied SAN**. The same request over TLS on `:443` with SNI and the lab CA
  answers the identical 2268 bytes, so the route answers on the listener the phone actually reaches. Both exchanges are in
  `captures/session-2026-10-20_04-50-23/index.jsonl` with `decision: store:provisioning`. Disarmed and reloaded: the same request is
  `502 passthrough` again, and `storeHandlers` still lists the handler while `enabled: false` keeps it out of the way.
- **What the suite pins** Four checks: off falls through, and on it refuses an unlisted host (`421`), a missing protocol header, a body
  that is not a request and a refused activation code - with the reason named in a header, not only in a status; a valid request is a
  two-certificate chain that **verifies against the lab CA**; the issued certificate is a client certificate and not the one the
  request asked for; and the same request twice returns the same bytes (`x-lab-cert-cached: 1`) on both routes, because a client that
  retries should not collect a new serial per attempt.
- **What this does not establish, in the order it matters** That this handset asks for this path at all: the armed round was measured
  **from this PC**, with a request shaped by the WP7 contract, and no device request has been captured. That the 8.1 contract is the
  7 one - the headers, the base64 body and the `c-x509-ca-cert` answer are their reading of the older flow, and the phone's own request
  is the only thing that can confirm or refute it. That a chain from this CA would be accepted for anything: it is this lab's root, and
  a real service would reject it, so the reading is only ever "did the client ask, and did it accept a chain at all". And nothing here
  connects provisioning to the install wall of F-033 - that connection is the hypothesis the row exists to make testable, not a result.
- **Undo** `livestore.provisioning.enabled` back to `false` and `POST /__lab/reload`; that is the whole undo, and it is what the lab is
  on now. The host is out of both lists - arming it again is three edits, on purpose, so no single value can turn a diagnostic on.


## F-035 The marked placeholder is drawn, and the list stopped asking for art

- **Date** 2026-10-20 04:50-04:56 local (02:50-02:56Z) · **Area** the image CDN, and the application list · **Method** one Store
  open from the handset with the images handler armed, read three ways: the capture index of `session-2026-10-20_04-50-23`, the
  DNS log for the same day (`captures/dns-queries-2026-10-20.jsonl`, which records every query, hijacked or not), and the
  operator's reading of the screen. Then a byte comparison of the list body this open was served against the list body served on
  2026-10-17 (`captures/session-2026-10-17_14-17-31/bodies/0016-res.bin`), entry by entry.
- **Measured, and it answers F-031's open question** The app detail asked `cdn.marketplaceimages.../v8/images/ec1e8563-…?imagetype=icon_large`
  and got `200` - the first `200` an image host has ever received from this lab - and the operator saw **the light frame and the
  diagonal cross** inside the app's information page. A flat field cannot paint a mark, so this is not "the slot changed colour":
  the client **decoded our PNG and drew it**. F-031 wrote that a flat square could not distinguish "the client drew our bytes"
  from "the client drew its own empty-image background"; the marked placeholder was made to settle exactly that, and it has.
- **Measured, and it is the new problem** The same open rendered the **application list** (17 entries, each carrying
  `<image><id>urn:uuid:…</id></image>`) and asked for **no image at all**: zero image exchanges in the session, and exactly **one**
  DNS query for the image host in the whole day - `04:50:51.491Z`, the detail's. The tile slot in the list is the client's own empty
  background, because nothing was ever requested. This is not the capture missing traffic: a request that never happened leaves no
  exchange, but it would leave a DNS query, and there is none.
- **The comparison that makes it an anomaly rather than a quirk** On 2026-10-17 the **same list URL** (`/v9/catalog/apps?chunkSize=50&q=f`)
  was followed within one second by **240 icon requests** for `icon_small`, covering **all 17 guids** that today's list carries - the
  same 17 apps, the same guids (`56dff8d0-…` first in both). So the client does fetch list art from this feed, and today it did not.
- **What changed between the two bodies, read instead of guessed** First entry, byte for byte: identical except `<a:updated>`, the
  `impressionId` value, and **`<mediaInstanceId>urn:uuid:…</mediaInstanceId>` inside `<offers><offer>`** - the field armed on 10-17
  evening for the install hypothesis (F-033), which is the only structural difference between the list that produced 240 icon
  requests and the list that produced none. Its *spelling* is not the difference: both archives (the 2013 page and the v8 list) write
  exactly `urn:uuid:<uuid>`, and so do we.
- **Inferred, and it stays an inference** The extra element inside the offer is the prime suspect: a plausible mechanism is that the
  client builds the entry, keeps the fields it already read (the app is listed, with its name and publisher), and stops before the
  tile's art is bound. Nothing here observes that parse, so the mechanism is unproven. The one confound is named: the images handler
  went from `502` on 10-17 to `200` today, and a `502` cannot *suppress* a request - it caused 240 of them - so it cannot be the
  reason there were none. Two data points, one variable, one confound that points the other way.
- **The single variable now armed** `livestore.protocol.offerMediaInstance` is `false` again (`config.json`; the value it left, `true`,
  is in this entry's Undo and in the comment beside the flag). The reading is one Store open and the same search: if the list asks for `icon_small` again, the
  field was the regression and F-033's hypothesis is dead with a cost named; if it does not, the field is not the cause and the next
  candidate is the list's own art path, which has never been given a `200` to draw.
- **Does not establish** That the client would *draw* our bitmap in a list at all: `icon_small` has been requested **800** times across
  every session and answered `502` on every one of them - today it was requested none - so a list tile drawing this lab's picture is
  something no run has shown yet, whatever this arm answers.
  Nor that `mediaInstanceId` is the cause - that is what the armed arm is for. And nothing here touches the home page: `storePages`
  answered `200` again at `04:56:18` and still produced no model, which is the same silence F-027 left off at, on a different endpoint
  from the one this entry is about.
- **Undo** `offerMediaInstance` back to **`true`** - the value this entry moved it off - and `POST /__lab/reload`; that returns the
  lab to F-033's arm, whose install reading is still pending. Measured, not asserted: a reload is enough because the flag is read per
  request, so the "restart" the old comment asked for was wrong, and the config comment now says so.


## Open experiments, continued

### E-008 The page never made unparseable: the control every page experiment was missing

- **Why** Six documents have now been delivered and read (E-001, E-004, E-005, E-006, E-007 and the `atom`
  format), and every one of them varied how *plausible* the document was. Not one varied whether the document
  could be parsed at all, and F-014 wrote the consequence down without acting on it: "as consistent with a
  failure before the parse as with one inside it". That sentence is a fork, and the two branches cost very
  different amounts of work - one says to keep editing the page, the other says every further page edit is
  wasted - so it is worth one Store open to find out which side of it the client is on.
- **The change, and it is one variable** `livestore.protocol.serve: 'generated'` -> `'control-broken'`, which
  answers `storePages` and `hubs` with `src/store/fixtures/control/broken-page.xml` instead of the built page:
  a document that opens `<StorePage>`, `<Panes>`, `<Pane>` and never closes them, so no XML parser can produce
  a document from it. Everything else is held constant on purpose - same URL, same `content-type:
  application/atom+xml; charset=utf-8`, same `content-length` discipline, same `no-store` - because the only
  thing that has to differ for the reading to be attributable is the body's validity.
- **The fixture is guarded** The handler refuses with `502 control_unavailable` if the file ever ends with a
  closing bracket, and the selftest fails if the body is parseable. A repaired fixture would serve an ordinary
  page under a control's name, and the device's usual silence would then read as "it never parses" - the one
  way this experiment could produce a confident wrong answer.
- **Verified from the PC, before the phone** The phone's own request, on the lab's plain-HTTP listener with the
  phone's `Host`: `200`, `content-length: 872`, `x-lab-protocol: storePages:control`,
  `x-lab-control: malformed`, body ending mid-element at `<index`. Reverted with `serve: "generated"` and a
  `POST /__lab/reload`, which answers `200`, `content-length: 58386`, every header of the built page again.
  `npm run selftest` **125/125**, exit 0 at the time - two checks new here: the served control body is
  unparseable and labelled, and a repaired control file is refused rather than served. (The suite is at
  **128** since the sequence report added three, below.)
- **How the result is read** Against the *same* configuration endpoint state (E-009 is armed in the same run,
  so config is 200 in both halves): if the device behaves exactly as it does for a well-formed page - one
  fetch, cached body, the same silence, then the same re-fetch - the client never reaches a parser and the
  page's contents are not where the failure is. If it behaves *differently* - a dialog, no cache entry, a
  different retry pattern, a crash drop under `Documents\Debug` - the parser is running and rejecting the
  grammar, and grammar work resumes with a signal instead of a guess.
- **State ARMED, 2026-10-17 11:07 local** but **`serve` is back on `generated`**: this entry is armed one Store
  open *after* E-009 has been read, so the two do not move in the same run. Order matters: E-009 first (does a
  200 at the configuration endpoint change what the client does at all), then E-008 (does an unparseable page
  look different from a parseable one).
- **ANSWERED 2026-10-17 13:02Z, one open, and the answer is the second branch** Armed at 13:01:51 as verified
  (`200`, `content-length: 872`, `x-lab-protocol: storePages:control`, `x-lab-control: malformed`, body ending
  `<index>1</index`), the handset asked for the page at `13:02:01.328Z` - `200`, **872 bytes** - and showed
  **error `0xc00cee23`**. The two earlier opens of the *same* URL at `12:06:46` and `12:59:48` were served the
  built page (58 555 bytes) and produced no dialog at all. Nothing else moved between them: same host, same query,
  same UA, same `x-wp-storepage-cookie`, same `no-store`, same listener. So the client **does** read the body and
  can tell a document that cannot be parsed from one that can, which retires F-014's "before the parse" branch
  and means page work is not wasted. `serve` was returned to `generated` and reloaded the same minute (`200`,
  `content-length: 58555`), so the next open is a normal one. See F-027 for the code and its limits.
- **Undo** `livestore.protocol.serve` back to `"generated"` and `POST /__lab/reload`.
- **Does not establish** Anything about the device yet - this is a control, not a reading. And a *negative*
  reading here does not prove the client has no parser: a client may discard a malformed body before any parse
  attempt and still parse the next well-formed one, which is why the control is compared with a delivery in the
  same configuration state rather than with the historical record.

### E-009 The configuration endpoint: the one request on the client's critical path the lab drops

- **Why** Two requests come before the page, and neither has ever been answered: `GET
  /v8/Configuration/Stores/OEMStores/NOKIA` and `GET /v8/Configuration/Stores/MOStores/`. The host is hijacked,
  no route matched them, so the relay resolved the name back to this process and returned
  `502 upstream_loop`. On 2026-10-16 the device made **eight** of them in **735 ms** (four tries per store:
  06:20:23.966, .010, .039, .069 and 06:20:24.622, .647, .672, .701) and then **never asked for the page at
  all** in that session - so this is not a side request: it is a gate the client stops at, and it is the only
  request in its flow that the lab answers with a self-inflicted error.
- **What the client's own strings say it is for** In `ZMarketplace.dll`: `ServiceConfiguration::
  BuildParameterizedUrl` (`@42348`) and `::GetServiceUrl` (`@42392`) build service addresses,
  `ServiceConfiguration::ParametrizeUrl` (`@152676`) substitutes named parameters, and the pool beside them
  holds the spellings the client itself uses - `{locale}`, `{chunksize}`, `{appsearchchunksize}`, `{objectid}`
  and twenty more (`@42426`-`@43060`). The name `marketplaceedgeservice` does **not** occur in the string table,
  so the page host is configured rather than compiled in. The client caches the answer under
  `LKGOEMStoreConfigOverride` / `LKGMOStoreConfigOverride` (`@36932`, `@37024`), which is why one good answer
  would persist.
- **The change** A `configuration` route in `src/store/protocol.mjs`, off by default in code and armed in
  `config.json`, answering with `buildStoreConfiguration()`: the store family and id the path named, the
  `mpcVersion` the client asked with, the locale, and three service URLs written with the two parameter
  spellings the client's own table holds (`{locale}`, `{chunksize}`), pointing back at the host the request
  arrived through so any download the client then starts lands in the capture. **Superseded later the same day
  by F-024**: the frame below is no longer what the route serves - the document is a `ConfigurationFile` in the
  client's own grammar - so read the measurement that follows as the state E-009 was armed in, not as the
  current body.
- **What is measured and what is assumed, stated plainly** *Measured*: the requests, their timing, their
  failure, their `mpcVersion`, and every symbol and parameter spelling above. *Assumed*: **the document's
  element names are this lab's** - no capture of this endpoint exists in the archive (F-021 filtered the CDN
  index for `Configuration` and found none) nor on the phone (F-020), so this is a reply and not a
  reconstruction. The response says so in the capture, not only here: `x-lab-invented: 1`,
  `x-lab-configuration-evidence: shape unobserved: element names are this lab's`, `x-lab-source: built: no
  capture of this endpoint exists`.
- **Verified from the PC, before the phone, on both listeners** Over plain HTTP on :80 with the phone's `Host`
  and UA: `200`, `content-length: 775`, `x-lab-protocol: configuration`, `x-lab-configuration-store:
  OEMStore/NOKIA`; `/MOStores/` `200`, `MOStore/-`. Then over **TLS on :443 with the lab's own CA**, which is the
  path the device actually used for these calls (`lab.log` 2026-10-16 06:20: `device opened TCP :443`,
  `DIRECT marketplaceedgeservice...`): `200`, `content-length: 778`, same headers, and `/MOStores/` `200` -
  so the route answers on the listener the phone reaches it through, not only on the one that is easy to curl.
  `npm run selftest` **125/125**, exit 0 at the time - three checks new: the endpoint is routed rather than
  fallen through, each store answers as itself with the parameter spellings intact, and the answer declares
  itself invented. The suite is at **128** now, the three extra being `npm run sequence`'s.
- **What the string table does NOT contain, measured 2026-10-17** The plan was to replace the invented
  element names with the parser's own path table, the way `FEED_PATHS` was read for the page. That is not
  possible from this binary, and the negative is specific: over `ZMarketplace.strings.txt` (12 625 strings,
  309 of them path-shaped), `mpcVersion`, `OEMStores`, `MOStores`, `Stores/` and `v8/Configuration` each return
  **zero** hits, while the five `LKG*ConfigOverride` registry value names (`@36824`-`@37024`) are there. So the
  configuration URL is not a literal in this module either - it is built from a stored default
  (`ServiceConfiguration::BuildParameterizedUrl` over a URL template) or by another component - and this
  register must not read a document's element names off a table that does not exist. What the same dump does
  give is the shape of the *reason*: the parameter spellings (`{locale}`, `{chunksize}`, 30 of them,
  `@42426`-`@44008`) and the proof that a service address is assembled rather than compiled in.
- **The pass that can replace the invention, and it needs the phone** `tools/find-store-config.ps1` (added
  2026-10-17) searches the mounted volume by byte - ASCII and UTF-16LE - for those six tokens across
  `\Windows\System32`, `\Windows`, and with `-Deep` under `Data\Users\Public` and the Unistore cache, printing
  every hit with its byte offset and every unreadable file by name. A hit on `mpcVersion` names the component
  that builds the request, and that file can be dumped and read the way the page grammar was; no hit anywhere
  means the URL comes from a stored default, and the place to look is `Software\Microsoft\Zune` in the mounted
  hive and `Data\SharedData\Comms\Unistore`. **Verified against a fake volume** (two files, one UTF-16LE with
  `mpcVersion`, one ASCII with `/v8/Configuration`, plus a decoy with neither): 3 hits with correct byte
  offsets, no hit on the decoy, and the `-Deep` LKG string found only under `Data\Users\Public`. The trap it is
  written around is the one that made F-020's content search worthless: `Get-ChildItem -Include` without a
  wildcard in `-Path` returns **zero** files, and a scan that finds nothing reads as "no component has it".
  **Answered without the phone, 2026-10-17: see F-024.** A signed FFU is the same filesystem searched offline, and
  `npm run image:find` found the endpoint table in one pass - so the invented element names are gone and this
  bullet stands as the reason they existed.
- **What to read** The device's next request, per device id and never in aggregate: (1) fewer than four
  retries per store, or no configuration request at all after the first success - the client accepted *an*
  answer; (2) a page fetch that follows the configuration directly instead of after eight failures; (3) an
  image or a pane-source request, which by F-019 is the first self-observing sign of a model that exists. A
  fourth possibility is the honest one to write down as well: the client may reject the shape and behave
  exactly as before, in which case the endpoint stays armed and the next value tried is a *smaller* document,
  not a larger one.
- **State ARMED, 2026-10-17 11:07 local**, `configuration: { enabled: true }` in `config.json`; the lab was
  restarted for the code change. **Nothing has been measured on the device yet**: as of 11:16 UTC the session
  holds five exchanges and every one of them is this PC's (four curls, one of them carrying the phone's UA), and
  the day's DNS log holds 79 queries from `192.168.0.220` and none from the handset.
- **Undo** `livestore.protocol.configuration.enabled` back to `false` and `POST /__lab/reload` - the route
  stops matching and the request falls through to passthrough exactly as it did before, `502 upstream_loop`
  included.
- **Does not establish** That the client reads any of it. Nothing here is a capture of the real service, so a positive result would say "the client accepts a reply of this shape", never "this is the shape". The retry count is also not a clean binary: the client retried four times per store against a 502, and a 200 it dislikes may be retried too, which is why the reading is the whole sequence and not one request.

### E-010 The configuration is asked for once per boot, and this boot is older than the route

- **Why this, and not another page** F-027 closed the question the page experiments were circling: the client parses, so a document
  that draws silence now means "parsed into nothing" rather than "never read". Six documents have parsed into nothing, and every one
  of them named eight pane sources the client never asked for. The one input to that decision the lab has never supplied is the
  client's own service configuration - and the client did ask for it: **eight** requests on 2026-10-16 06:20 (four per store, 735 ms),
  then nothing, although the route has answered `200` since 12:02:59 on 2026-10-17. The reading that fits both facts is a client that
  resolves its service base **once, at boot**, and has not booted since the route started answering. A page whose panes carry absolute
  URLs would then still be inert, because the URL it would use is the one it builds from a configuration it believes it does not have.
- **The change: nothing in the lab** `configuration.enabled: true`, `serve: "generated"`, `pageFormat: "panes"`, `dataSource: true`,
  `paneType: "Collection"`, page verified from the PC at `content-length: 58555` with no control header. The one thing that moves is
  the device: **one reboot**, then one Store open.
- **Attribution already settled, so the reboot needs nothing behind it** At `13:11:29Z`, after the control was reverted, the handset
  fetched the page again: `200`, the built page, and **no dialog** - the same silence as 12:06 and 12:59. So `0xc00cee23` was the
  control's answer and not a state the phone fell into, which is what makes a plain reboot a clean next move rather than a repair.
- **How to read it, in order** (1) Does `/v8/Configuration/Stores/OEMStores/NOKIA` appear in the session at all? (2) If it does and it is
  answered `200`, does **anything** follow the page - one of the eight pane URLs, an image, a detail page? (3) If nothing follows a boot,
  the request is not per-boot and the next lever is the archived real document (`serve: "archive"`), which has never been in front of
  this handset.
- **Three outcomes, and each has its own next step** config asked + something follows -> the chain is through and the work becomes
  content. config asked + still nothing -> the gate was real and the *document* is wrong; the next variable is its frame, with the
  archive as the reference. config not asked after a boot -> the trigger is neither the route nor the boot, and the archived page
  becomes the cheapest way to find out whether *any* real document gets this client to ask for something.
- **Result of the boot, 2026-10-17 13:14:06Z: branch (3), the request is not per-boot** The handset was rebooted and the Store opened
  once. The session gained **one** exchange: the page fetch at `13:14:06`, `200`, and before it **no** `/v8/Configuration` request on
  either store - so a boot does not make the client ask, although the route has been answering `200` since `12:02:59`. Read with the
  caveat that a capture cannot prove a reboot happened, only that the address made one page request and nothing else; what it does
  prove is that this open, like the four before it, began at the page.
- **Step 3 armed the same minute: the archived real document** `serve: "archive"` + reload, verified from the PC before the open:
  `200`, `content-length: 29238`, `application/atom+xml; charset=utf-8`, `x-lab-archive-template: GamesHub`, and the warning header
  that says it is not a one-variable substitution. This is the only document in the project that came from the real service byte for
  byte, so it is the cheapest answer to the question the six generated pages cannot answer: does *any* real page get this client to ask
  for something?
- **Result of step 3, 2026-10-17 13:15:05Z: rejected, not ignored** The archived document went to the handset - `200`,
  `content-length: 29238`, `x-lab-archive-template: GamesHub` - and the screen showed **error `88675309`**, with **no** request after
  it. So the client did not ignore a foreign page: it **rejected** it. Compare the three outcomes now on record for this one URL and
  these same request headers: the built page -> accepted, cached, nothing on screen and nothing after it; the control -> `0xc00cee23`;
  the archived v8 page -> `88675309`. Three documents, three verdicts, so the client runs a page **validator** whose failures are
  visible, and the interesting one is the document that passes it and still yields no items - ours.
- **What that turns into, and it is the next experiment** A validator that answers differently is a probe: take the page the client
  *accepts* and rename one construct at a time (`Panes` -> `PanesX`, `Templates` -> `TemplatesX`, `DataSource` -> `DataSourceX`, ...).
  A construct the validator reads will flip the outcome from silence to an error; a construct it never looks at will stay silent. That
  maps which parts of the document are consumed at all, which is exactly the question six content experiments could not answer.
- **The probe, built 2026-10-17 15:19 local** `serve: "mutant"` + `mutant: "<name>"`, and `PAGE_MUTATIONS` in
  `src/store/protocol.mjs` holds seven names: `root-renamed`, `panes-renamed`, `pane-renamed`, `templates-renamed`,
  `template-renamed`, `datasource-renamed`, `entries-renamed`. Each renames an element and its closing tag, so the body stays
  well-formed - an unparseable mutant would reproduce the control's answer and say nothing about the validator. Two refusals are
  built in on purpose: an unknown name, and a name whose element the page does not carry, both answer **`502`** rather than serving
  the ordinary page under a mutant's name, because that silence would read as "the client ignores this construct" when nothing
  changed. The suite is at **133** (three checks: the mutant body is the accepted page with exactly one name changed and nothing
  else, an unknown name is refused, an absent element is refused); lab restarted as a *code* change, not a reload - pid 21400,
  `:80`/`:443` and UDP `:53` up. First name armed: **`root-renamed`**, which is the probe's own control - if renaming the root does
  not move the verdict, the three-verdict reading above has another cause and the rest of the ladder means nothing.
- **First name read, 2026-10-17 13:2xZ: `root-renamed` drew no code** One Store open against `<StorePageX ...>...</StorePageX>`
  (58 557 bytes, `x-lab-mutant: root-renamed`) and the screen stayed on the spinner. So the probe does **not** fire on the root and
  its own control is negative. The limit this exposes is the one to remember about the technique: it can only report a construct the
  client **rejects**, so silence means "not rejected", not "not read" - an ignored element and a tolerated one look the same from
  outside. The ladder is therefore worth running only on elements whose absence has a plausible way to be *refused*, and the block
  with one is the template: the archived response carries `<templateName>GamesHub</templateName>` and drew `88675309`, while the page
  that passes carries the numeric `TEMPLATETYPE` the phone's UI assets actually style. Second name armed, `template-renamed`
  (58 557 bytes, `<TemplateX TEMPLATETYPE="003">`, `x-lab-mutant: template-renamed`, XML still well-formed).
- **Second name read: also silent, and that changes the reading of `88675309`** Forty-five seconds on the spinner again, no code, on
  a page whose template block the client cannot resolve by name. So **the template block is not what the client refuses** in the
  archived response - it does not report an unstyleable template on *our* document at all. The likelier reading is now the other way
  round: the archived page is the one the client got **further** with, far enough to fail while drawing it, and `88675309` is a
  rendering-path code, not a validation one. If that is right, our page never reaches that path because it yields no page model - and
  the difference to chase is structural, not a name.
- **The single variable that tests that reading, armed 2026-10-17 15:2x local** The real 2013 document byte for byte, with **one**
  substitution: its `<templates><template>...GamesHub...</template></templates>` block replaced by the numeric form this phone's UI
  assets style, `<Templates><Template TEMPLATETYPE="003"><mimeType>application/uix</mimeType><TEMPLATETYPE>003</TEMPLATETYPE></Template></Templates>`
  - 29 238 -> 29 252 bytes, 14 more, everything else identical (checked as a byte comparison, not by eye). Saved as
  `src/store/fixtures/archive/real-hub-page-20130813-tpl003.xml`; the original is untouched and one config value away
  (`livestore.protocol.archiveFile`). Served and verified from the PC: `200`, `content-length: 29252`, body identical to the file,
  no `GamesHub` string left. Three outcomes: the code disappears and content appears (the template was the gate on a document that
  already built a model); the same `88675309` (the gate is the root or the entry shape, not the template); silence (the page is
  accepted and still empty, and the error had a third cause).
- **Result: the same `88675309`, so the template block is not the gate** One open on the derived document drew the identical code. That
  closes the template as the cause and leaves the rest of that document's frame - and it reads back onto the older atom runs: every
  page served as an `<a:feed>` root was said to have been "asserted on", and the code for it is this one. `88675309` is therefore best
  read as **a feed answered where a page was expected**, not as a verdict on the content inside it. `serve` is back on `generated`
  (`200`, `content-length: 58555`, `x-lab-protocol: storePages`, no mutant and no archive header); `archiveFile` still points at the
  derived fixture, which is one value away from the original and is kept because it is a document whose *only* difference from the real
  response is a block now proven irrelevant.
- **What is left after this, stated plainly** Nine documents have now been delivered to this handset: six generated variants, the
  control, the archived response, and the archived response with a styleable template. Every one of them either produced an error that
  we can name (unparseable, or a feed where a page was expected) or was accepted and produced no model. Nothing in the document has
  moved the second group, so the next reading has to come from the device's own state rather than from another body: the Store's shared
  data is the only surface left that has never been opened (`Data\SharedData\Comms\Unistore\data` and its `AggregateCache.uca`, both
  touched during today's opens, plus `EdmCache` after these specific documents).
- **Does not establish** That the configuration is the gate: a page can parse into an empty model for reasons that have nothing to do
  with service URLs, and this entry does not exclude that. It also does not say the configuration document is the right shape - F-024's
  frame is still an inference - so an outcome of "config asked, page still empty" would leave it unclear which of the two is at fault.
  Nothing here identifies `88675309` either: it is not in the `0xC00C...` family of the control's code and this entry does not claim a
  meaning for it beyond "the archived document's verdict".

## F-036 No pane source has ever been requested, and the field that decides it is the pane's type

- **Date** 2026-10-20 05:30-05:48 local (03:30-03:48Z) · **Area** the page document, and the one sentence of F-032 this entry takes
  back · **Method** a provenance pass over **every** session index in `captures/` for the two markers of a pane source
  (`chunkSize=25`, `category=`), then a re-read of the parser's own literal pool.
- **Measured: the handset has never asked for a pane's data source** Across every captured session - 41 directories today, 28 when
  the pass was first made - there are **23** exchanges whose path carries either marker, and they belong to **two** clients, both on
  this PC: 19 from `127.0.0.1` and 4 from `192.168.0.220`, the lab's own rehearsal. Not one carries `x-wp-device-id`, and the
  handset accounts for **zero** of them. A page has named eight pane sources since 2026-10-16 and the client has asked for none.
- **The sentence this takes back** F-032 read `14:50:54` on 2026-10-17 - `GET /v9/catalog/apps` `200`, one second after the pane
  document - as the data source being followed. It is not: that exchange is the **search** feed, preceded by four
  `/v8/catalog/queries?prefix=f` suggestions in the same second, which is the operator typing in the Store's search box. The
  ordering that made it look causal is what a human does after changing a config value, and the device id on that request says
  whose it was.
- **Why that mattered, and what it re-opens** A pane source that is written and never fetched is not a content problem: the client
  rejects the pane before it builds a download. The parser's own paths say what it needs to build one (`/Panes/Pane`,
  `/Templates/Template`), so a pane becomes a list through a **feed type and a URL pair**, and the lab had been sending
  `<Type>Collection</Type>` - a **page-family** token from a different pool (@29064, beside `sDynamicHub` @29010 and the page types)
  - into a field that names a feed.
- **The four tokens, and the one the lab was sending** The same module of literals holds exactly four feed types, each immediately
  beside its own parser: `Applications` (@139376) with `Marketplace_ParseAppsFeedIntoStoreObjects` (@139480), `FeaturedApps`
  (@139404) with `…ParseFeedIntoStoreObjects` (@139336), `Collections` (@139432) with `…ParseCollectionsFeedIntoStoreObjects`
  (@139524), `Categories` (@139456) with `…ParseCategoriesFeedIntoStoreObjects` (@139576). `Collection` is in none of them.
- **The single variable, armed and verified from the PC** `livestore.protocol.paneType` was **`Applications`** in `config.json`
  (`Collection` before it), the page was verified from this PC as `200` with `x-lab-pane-type: Applications`, and the reading was to
  be the next Store open: one value, one document, nothing else changed.
- **What the next open decides, and it is a binary** Either the client now asks for `chunkSize=25&category=…` - the pane built, the
  chain through - or it does not, and the field is not read at all. Both outcomes are worth more than another page body, because the
  first one turns "the page parses" into "the page is used", which no document experiment has managed.
- **Does not establish** Which of the two `<Type>` fields the client feeds into `Create StoreObjects`, or that it uses either: this
  entry reads the pools and the counts, not the call. It also does not prove the absolute path in the parser is where a *served*
  path resolves - `/Panes/Pane` is a path from the document root, and only the device says which root.
- **Undo** `paneType` back to `Collection` and `POST /__lab/reload` - the delivered page then returns to the shape of `05:29:53Z`.
  (Done the same morning; see F-037 for why the arm was withdrawn before the handset ever saw it.)

## F-037 The pane's property map separates its kind from its feed, and the panes have only ever been served under one of the two roots

- **Date** 2026-10-20 07:40-08:20 local · **Area** the page document, read from the client's own data instead of a served body ·
  **Method** the property maps in the carved `ZMarketplace.dll`, read as structures rather than as strings.
- **Measured: two pane maps, and the feed lives in the second one** The triples at `0x10004ca4`-`0x10004cd8` are one object's own
  fields, and the map that follows carries `/Type` as a field of the pane itself (@319-324 in the map at
  `0x10004ca4`-`0x10004d58), beside `/CollectionId`, `/MaxItems`, `/MinItems` (1, 323-330). The **feed type and URL are
  `/DataSource/Type`** (prop 326) **and `/DataSource/Url`** (prop 327) - a different pair, one level down. So the feed is named
  inside `/DataSource`, and the pane's `/Type` is its own kind.
- **What that takes back, one hour after writing it** F-036's arm moved `paneType` to `Applications` on the reading that the feed
  type belonged there. The map says otherwise: the two fields are different properties of different nodes, and `Create StoreObjects
  with FeedType = %S Url = %S` takes its arguments from `/DataSource`. The arm was withdrawn before the handset saw a delivery - the
  value is `Collection` again, the value every page since 2026-10-16 carried - and the comment in `config.json` now records the
  reading instead of the guess.
- **Measured: what a hub is drawn from, in the UI's own vocabulary** The same FFU region that carries the page's style names also
  carries the pane kinds the UI knows (`Store_HubCollectionUI_*`, `Store_HubFeaturedItemUI_*`) and the empty state
  `ForYouEmptyListUI_NoResults_Test`. So a hub draws a **background pane** with a picture, then one layout per pane; an empty hub is
  a picture with nothing under it - which is exactly what the handset shows, and it is a rendering of "no items", not of "no page".
- **Measured: the endpoint table names the page id and the art types** The same block, as text: the store page endpoint takes the id
  the client asks with (`typeId`) and answers a **layout**; the image endpoints are keyed by guid and `imagetype`, and they are what
  the background pane would draw from.
- **The single variable now armed, and it is a position** `/Panes/Pane` is an absolute path and the page document has two roots it
  could be read from: the page's own (`<StorePage>`, every delivery so far) and the feed nested inside it, which carries the
  entries (`/feed/entry`) and has never carried a pane. `livestore.protocol.panesInFeed` was **`true`**, with the response header
  `x-lab-pane-placement` saying `feed` or `page` so no capture can be read as the wrong arm. Suite **156/156**, exit 0, with a new
  check asserting the move: same panes, same count, other parent.
- **Why this is the next reading and not another guess** Three arrangements of content have been served and all three drew an
  empty hub: panes with a reference and no items, panes with inline items and no data source, panes with inline items and a data
  source. What has never moved is where the panes sit, and the only path that names them is absolute - so the document under test
  and the document the parser describes differ by exactly one parent element. If the blue background stayed after this, the
  placement would not be the gate either, and the remaining candidate would be the page root's own identity.
- **Read the same morning, and the arm answers itself: no** `npm run page:diff` on the fed-placed page reports `/Panes/Pane` and
  `/Templates/Template` **missing**, and the tool is right to: both paths are absolute from the document element, so a pane
  inside the feed is at `/StorePage/feed/Panes/Pane` and matches neither. The app list is the independent argument that settles
  which namespace an unprefixed path resolves against - its `<applications>` elements are in the catalog namespace and its items
  render, so the pane's own elements, which live in the same namespace, are the right spelling too. `panesInFeed` is therefore
  **`false`** again, kept in the code and asserted by the suite as the tool for the other reading, and the delivery is back to the
  `05:29:53Z` shape (`22 required path(s): 10 exactly, 12 prefix-only, 0 missing`). The arm cost one hour and no device run,
  which is the cheapest possible way for a wrong hypothesis to die.
- **What this leaves, with the map in hand** A pane's fields are fully carried (8/8 of the second map) and every absolute path
  the parser names is present, so the model's absence is not a missing element and not a wrong parent. The two readings that
  survive are about **values the client cross-references**: the page root's own identity (our `<a:id>`/`<a:title>` are invented
  strings, and the feed's header is the only part of the document with no observed counterpart on a StorePage), and the pane's
  `/Type`/`/SubType` values, which no source read so far constrains. Both are one-field experiments on an otherwise complete
  document, and both need the handset.
- **Does not establish** Which root the parser reads `/Panes/Pane` from - this is a one-bit experiment, not a proof. Nor that the
  carved image is the phone's own: it is **not**. The FFU's copy is 573 440 bytes and carries no `X-WP-StorePage-Cookie` string at
  all, where the phone's own file is 565 248 bytes and its string table has it at `@46984` (F-024, `src/store/vocabulary.mjs`) -
  so every offset in this entry is this image's and cannot be mapped onto the handset's build. The phone's copy is only readable
  from the handset itself.
- **Undo** `panesInFeed` back to `false`, restart the lab (a code path, not a config read): the page returns to the delivery at
  `05:29:53Z`, `x-lab-pane-placement: page`.
- **Rebuilt, and why it says so** The prose of F-036 and of this entry was rewritten on 2026-10-20 after an editor overwrote this
  file instead of appending to it. Every number quoted was then re-read from the artefact it names - the 23 pane-source exchanges
  and their two client addresses from `captures/*/index.jsonl`, the suite count from `npm run selftest`, the path verdict from
  `npm run page:diff` - and both entries reach the same conclusions they reached before the accident. The original wording is gone;
  the measurements are not, which is the only part of an entry this register promises.

## F-038 The silent fallback: a misspelt `dataSourceType` served a page that said nothing was wrong

- **Date** 2026-10-20 · **Area** `src/store/protocol.mjs`, and the rule this project spends its register on · **Method** the module
  read line by line against its own comments, then the resolver called directly instead of the server.
- **What the code said and did** `dataSourceType(value)` carried a comment promising that an unknown name "reads as the type that is
  served *and is logged where it happens*". It returned the fallback string, and the promise was never implemented: there is no
  logger in the function and no caller logged the substitution, so `dataSourceType: "Applicatons"` in `config.json` produced an
  ordinary page with `<Type>Applications</Type>` in every pane and **nothing anywhere** recording that the value armed was not the
  value served. A capture of that run reads exactly like a capture of the armed value.
- **Why this is a defect and not a nit** Every experiment here is one variable, and the reading is the capture. A config value that
  is silently replaced turns one variable into two and leaves no trace of which one ran - the same failure F-027 answered with a
  control and F-037 answers with a response header saying where the panes went.
- **The change, three parts** `dataSourceType()` is now `resolveDataSourceType()` and returns `{ type, requested, substituted }`
  instead of a bare string, so the substitution is a value a caller cannot drop by accident. The page delivery names it, only when
  it happens, in `x-lab-data-source-substituted: <requested>` - so the **absence** of that header is the statement "the armed value
  is the value served". The same substitution writes one `logger.warn` line naming the three types the client has parsers for.
- **Verified** `npm run selftest` **159/159**, exit 0, with three checks new: a known name is served as written and reports no
  substitution; an unknown one falls back to `Applications` *and* reports `substituted: true` beside the string it was given; and
  the armed delivery the suite is made against carries no substitution header at all (`header=(absent)`). The first of the three is
  the one that matters after a refactor: a resolver that answered `substituted: true` for everything would pass the second alone.
- **Does not establish** That any past run was affected: no capture in `captures/` was taken with an unknown `dataSourceType` (the
  value has been `Applications` since the field was introduced), so this is a defect that was reachable and never reached. It also
  does not turn the fallback into a refusal - a typo still serves a page, because a client in the middle of a one-variable
  experiment should not be handed a `502` for a config mistake the operator can read in a header.
- **Undo** Nothing to undo in `config.json`: no value changed. The code change is one function and two lines at the delivery, and
  the three checks are what would notice a partial revert.

## F-039 The configuration document derived its schemes from the listener, so an https fetch served a plaintext "Secure" base

- **Date** 2026-10-20 · **Area** `buildStoreConfiguration` (`src/store/catalog-feed.mjs`) · **Method** the same two requests the
  handset makes, sent from this PC to both listeners, then the settings compared line by line.
- **Measured, and it is a one-line reproduction** `curl` of `
  /v8/Configuration/Stores/OEMStores/NOKIA` over `http://` answers `WPAppsMarketplaceShop` on `http` and
  `WPAppsMarketplaceShopSecure` on `https` - correct. The same request over `https://` answers **`ShopSecure` on `http://`** and
  `ShopCdn` on `https://`, i.e. the document inverts both, because the function computed one scheme from the arrival and then gave
  the other to the setting whose *name* is what the client trusts.
- **Why it survived** The suite's configuration probes all set `scheme: 'http'`, so the only branch ever exercised was the one that
  happens to be right. That is the whole failure: a value derived from a request property that no check varied.
- **The change** Each base carries the scheme its own name has in the client's shipped file - `Shop` on `http`, `ShopSecure`,
  `Buy`, `Accounts`, `Review` and `Telemetry` on `https`, both CDNs on `http` - and only the **host** follows the request. The
  `scheme` parameter is gone from the builder and from its caller rather than left unused, because a parameter that decides nothing
  is the next reader's wrong assumption.
- **Verified** both listeners from this PC: `ShopSecure` `https://marketplaceedgeservice.windowsphone.com/`, `Shop`
  `http://…`, `ShopCdn` `http://cdn.…` on `:80` and on `:443`. Suite **160/160**, exit 0, with a check that fetches the document
  with `scheme: 'https'`, asserts the three bases by name **and** requires the body to be byte-identical to the plaintext one -
  the second half is what makes it a check about independence rather than about one string.
- **Does not establish** That the client prefers one listener over the other, or that either document is accepted: it asked for
  these endpoints eight times on 2026-10-16 and has not asked since a reboot (E-010), so nothing here has been read on the screen.
  Nor that the shipped file's schemes are the ones a *revived* service should answer with - they are the schemes the client was
  built against, which is the only claim made.
- **Undo** `git revert` of the one commit: nothing in `config.json` changed, and both listeners have to be re-read to see it.

## F-040 The suggestion download is its own feed type, and its URL is not spelled in `ZMarketplace.dll`

- **Date** 2026-10-20 · **Area** the endpoint this lab still answers `502` - `/v8/catalog/queries` - and the strings behind it ·
  **Method** the captured request read back field by field, then `ZMarketplace.strings.txt` searched for the classes and element
  names that would parse a reply (306 636 bytes, ASCII and UTF-16LE at every offset).
- **Measured: the request, whole** `GET http://cdn.marketplaceedgeservice.windowsphone.com/v8/catalog/queries?os=8.10.14219.0
  &zLocale=it-IT&cc=IT&lang=it-IT&prefix=f&chunksize=4&includeApplications=true&includeAlbums=false&includeArtists=false
  &includeTracks=false&includePodcasts=false&cf=` from `192.168.0.137`, `user-agent: ZDM/4.0; Windows Mobile 8.1` - the same
  transport the store page uses - and **without** the `x-wp-device-id` and `muid` headers the page carries, so the download is
  identified by its path and not by the device. Every one of these was answered `502` by this lab, which is a route with no handler.
- **Measured: the client has a downloader and a feed type for it** The same string table holds
  `PendingSuggestListDownload::{GetSendStream,GenerateBody,Begin,OnComplete}`, `GetApplicationSuggestionsRequest`, and
  `PendingPrefixSearchListDownload::PostParseFixup` - a parse fixup, i.e. a reply document this class reads. Beside
  `CMarketplaceObjectList_StoreObjects::CreateDownloader` and its log line `FeedType %S m_SourceUrl %S` sit the two names
  **`ApplicationSuggestions`** (@6228) and **`Suggestions`** (@6276), which is where the feed-type family lives - so a suggestion
  list is a feed with its own type, parsed by its own class, and not a variant of the application list.
- **Measured: the advice this endpoint does not need** The same region carries `AppendBingHeader`, `FormatDateTimeForBing`,
  `SearchTime`, `Cookie`, `X-Search-FBIDExpired` and `Content-Type: application/xml; charset=UTF-8`: the suggestion path is wired
  to a Bing-backed search identity, which is why its query names `includeAlbums`, `includeArtists`, `includeTracks` and
  `includePodcasts` next to `includeApplications` - the families a Zune-generation search answered, not the Store's app catalogue.
- **The trap worth writing down** `/Phone/Prefix` (@12160) sits in the *payment address* table, between `/Address/Country` and
  `/Phone/Extension`. A reader looking for the search's `prefix` finds it there and builds a `<Phone><Prefix>` request body for a
  GET that carries its prefix in the query string. It is a billing phone-number prefix and has nothing to do with search.
- **The negative that bounds it** The word `queries` **does not appear anywhere** in `ZMarketplace.strings.txt` - zero hits - so
  the URL this request uses is not spelled in this module: it is either assembled from parts or held by a component this readout
  never captured. Nothing here says which feed type name maps to which endpoint either; `ApplicationSuggestions` and `Suggestions`
  are two names beside a downloader factory, not a mapping.
- **What it changes in this lab, and what it does not** The `502` on that path stays. Answering it would mean inventing a document
  whose element names nobody has read, on an endpoint the phone has asked for **only** while a human typed in the search box -
  which is the correction to the sentence that called these "the search box's suggestions" in the plural and read them as store
  traffic. It is the Zune search transport asking, with the Store open, and a revival that answers the page does not need it.
- **Does not establish** That the client renders anything from a suggestion reply, or that the four retries in a row mean it
  wanted one: a `502` is retried the same way a page is (E-010), and no capture has ever contained a `200` for this path.

## F-041 The endpoint table settles the suggestion base, and says what `chunkSize` actually is

- **Date** 2026-10-20 · **Area** the client's endpoint table and its configuration settings, both in the signed retail FFU ·
  **Method** `npm run image:find -- --file <ffu> --pattern 'id="PrefixSearch"' --context 900`, plus the same tool run against
  `id="WPAppsMarketplaceShopCdn"` for the settings block. Both encodings, every hit with its offset.
- **Measured: four endpoints, whole, at @1177094311** The table spells the Store's calls as templates, and the four that matter
  here are:
  - `<ep id="Application" url="{WPAppsMarketplaceShop}v9/catalog/apps/{objectid}?os=…&oemId={DeviceRawOEMID}&moId={MOUniqueID}&cf={ContentFilter}{urltail}">`
    and `ApplicationSecure` with the `ShopSecure` base - the **detail** page is `v9/catalog/apps` by object id;
  - `<ep id="ApplicationSearch" url="{WPAppsMarketplaceShop}v9/catalog/apps?…&chunkSize={appsearchchunksize}&q={query}&cf={ContentFilter}">`
    - the **same path** is the search, and its `chunkSize` is a **search** parameter, not a list size;
  - `<ep id="PrefixSearch" url="{WPAppsMarketplaceAutoSuggest}v8/catalog/queries?…&prefix={query}&chunksize=4&includeApplications={includeapplications}&includeAlbums={includealbums}&includeArtists={includeartists}&includeTracks={includetracks}&includePodcasts={includepodcasts}&cf={ContentFilter}">`
    - F-040's request, its base, and the four music families all named by the build.
- **What that closes about F-036** The lab has spent a day asking why a pane source is never fetched, and why the device never
  sends `chunkSize=25`. The table answers the second: `chunkSize` is `{appsearchchunksize}`, filled in by the **search** UI, and a
  pane's source URL is this lab's own construction - `chunkSize` came from `pageSize`, a field of the lab, not of the client. So
  the absence of a `chunkSize` request is not a client refusal to send one; it is evidence the pane was never fetched at all.
- **Measured: the settings, whole, at @1177028332** The shipped `PROD` domain carries `WPAppsMarketplaceAccounts`, `AutoSuggest`
  (`http://cdn.marketplaceedgeservice.windowsphone.com/`), `Buy`, `EdgeHttpIn`, `EdgeHttpsIn`, `ImageService`, `MoServices`,
  `Review`, `Shop`, `ShopCdn`, `ShopSecure`, `Telemetry`, `TunerService`, `WindowsPhoneCom`, `WindowsPhoneComAppShareP` - each
  with a `nexus=` attribute and each on the scheme its name implies. The `DF` domain (@1177033512) is the same list under
  `dogfood.` hosts, which is what makes the five `<Domain>` ids real rather than decorative.
- **The gap this lab had, and the one-line change** `buildStoreConfiguration` wrote every base except `AutoSuggest` - so the
  document handed to the client named the page, the lists, the images and the update check, and left the suggestion endpoint's
  placeholder without a setting of its own. It is written now, named rather than derived (the CDN host on plain http, as the file
  has it), and a check asserts that exact line. Suite **161/161**, exit 0.
- **Measured, for free: the type table spells the page grammar** The same image carries a name table at @414020144 and @423843176
  that reads `… AppCollectionListResult StorePage Panes StorePaneListResult StorePane Templates StoreTemplate GetObjects
  StoreObjectListResult StoreObject …` - `StorePage`, `Panes`, `StorePane`, `Templates`, `StoreTemplate` as the client's own
  element names, in the same list as its object types. That is independent support for the spelling the served page uses, from a
  source that is neither the parser's path table nor an archived response.
- **Does not establish** The reply grammar of `/v8/catalog/queries`: the classes that would parse one are in the DLL
  (`PendingSuggestListDownload`, `PendingPrefixSearchListDownload::PostParseFixup`, `GetApplicationSuggestionsRequest`), no element
  name of the reply has been read, and answering it today would be inventing a document - which is why the route stays a `502`.
  Nor that the client reads the *served* configuration for this base: E-010 measured one configuration fetch per boot and none
  after a reboot, so the setting is a correction to a document nobody has been seen to adopt.
- **Limit** Every offset in this entry is the image's, build `3058.50000.1445.1005`; the handset runs `8.10.14219.0`. The table is
  data in a build, not a reading of this device's own copy.

## F-042 The push vocabulary of this build is BNS and WPN, and no push host is baked into it

- **Date** 2026-10-20 · **Area** the notification path, which this lab has never touched · **Method**
  `npm run image:find -- --file <ffu> --pattern 'notify.live.net' --pattern 'NotificationService' --pattern
  'PushChannel' --pattern 'mpns' --context 400`, both encodings, every hit with its offset.
- **Measured: the WP7-era names are absent** `notify.live.net` -> **0 hits**, `mpns` -> **0 hits**, ASCII and
  UTF-16LE, in 1 611 661 312 bytes. Whatever this client uses to reach a push service, it is not a host string
  this build carries.
- **Measured: what it does carry, at @677591480 (utf16)** `ID_CAP_BSS_PUSH_INTERFACE`, `BNSNotifyPushMsg`,
  `BNSNotifyNabSyncMsg`, `GetLightupStatus`, `GetWpnPhoneRegistrationEndpoint`, `RegisterWithPushChannel`,
  `UnregisterWithPushChannel`; and at @1008332561 (ascii) the error family `E_BNS_SYSTEM_SPOT_FULL`,
  `E_BNS_DUPLICATE_ITEM`, `E_BNS_ITEM_NOT_FOUND` beside `szPushChannel`, `_channelName`,
  `_pushRawMessage`, `set_Digest`, `_nabMessageHeader`, `_nabMessageBody`, `_nabMessageDigest`.
- **What that says, narrowly** Three names, three sentences. (1) A channel is registered against an endpoint the
  client *asks for* (`GetWpnPhoneRegistrationEndpoint`) and then `Register`/`UnregisterWithPushChannel` act on
  it - a registration flow, not a constant. (2) Delivery is a BNS message with its own classes
  (`BNSNotifyPushMsg`, `BNSNotifyNabSyncMsg`) and its own error codes. (3) A notification payload carries a
  **NAB header, body and digest** - a framing this lab has no code for, because the lab has never answered a
  push request at all.
- **What it changes here, and the honest answer is nothing yet** The lab has no push host hijacked, no capture of
  a push request, and no finding that a notification was ever delivered to this handset. This entry exists
  because the vocabulary is what a later pass would start from, and because a zero on `notify.live.net` is the
  kind of negative that stops someone from wiring up an MPNS endpoint that this client cannot be talking to.
- **Does not establish** That the client speaks BNS/WPN *to the exclusion of* NSP, that the `E_BNS_*` codes are
  the ones a device meets, or which host `GetWpnPhoneRegistrationEndpoint` returns - that is a runtime answer and
  this is a byte search of a build. Nor that this build is the handset's: the phone runs `8.10.14219.0`, the
  image is `3058.50000.1445.1005`, and a vocabulary can differ between them.

## F-043 The pane kind is not one of the client's object codes, and the app list stopped being drawn the evening the entry shape changed

**PARTLY WITHDRAWN by F-045**: the regression reading in this entry does not survive the byte comparison - the document that drew on
2026-10-17 already carried `<k>` and no bare `<title>`, which is the shape the lab serves again. The `col` negative stands.

- **Date** 2026-10-20 13:53-13:58 local (11:53-11:58Z) · **Area** the pane's kind, and the application list · **Method** one
  device run with `paneType: col` armed, the delivery verified from this PC before the open (8 panes with `<Type>col</Type>`,
  `x-lab-pane-type: col`, `content-length: 58427`), then the session read from its own index:
  `captures/session-2026-10-20_08-41-48/index.jsonl`, 31 exchanges, all from `192.168.0.136`.
- **Measured: `col` is negative** Three page deliveries - `11:53:33`, `11:55:28`, `11:57:31Z`, one per Store open - each `200`,
  and **zero** requests carrying `chunkSize=25` or `category=`. The only pane-source-looking markers in the session are the search
  feed's own `chunksize=4`, which is F-036's typing, not a pane. So three tokens have now been put in the field the pane's own map
  calls its kind - `inv`, `Collection`, `col` - and the client has not built a list from any of them. `app`, `fea` and `sto` are the
  three left in the client's object-code table, and nothing read so far prefers one.
- **Measured: the application list is not being drawn at all, and the search is where it shows** `/v9/catalog/apps?…&chunkSize=50&q=f`
  answered `200` with **17** applications (22 636 bytes, `x-lab-apps: 17`) at `11:53:41` and again at `11:58:00`, and in the whole
  session the handset asked for **zero** `icon_small` images - one `icon_large` for the detail page it opened (`9353589b…`,
  `11:53:45`) is the entire image traffic. On 2026-10-17 the same endpoint with the same 17 apps produced **240** icon requests within
  a second (F-031). A list that requests no art for 17 rows is a list whose rows were never built, which is what the empty blue screen
  is made of.
- **The regression window, and it is two minutes wide** Commit `e10db61` (2026-10-17 16:32 local) took the bare `<title>` out of every
  application entry (`appListEntryTitle: false`) and put `<k>` in (`appListRank: 4`); F-031's image arming was at 16:30. Every list
  served after that commit has been drawn blank, and F-035 read the missing art as the cost of `offerMediaInstance` - which is
  **off** in this session (`x-lab-offer-media-instance: none`) and the art is still absent. F-035's suspicion does not survive this
  reading, and neither does the idea that the list was ever fine after the entry shape changed.
- **Armed: `appListEntryTitle: true` alone** `appListRank` stays at 4, so one half of that commit moves. Verified from this PC before
  the open: every entry carries `<title>` again (23 130 bytes, +494 over the 17 rows), header `x-lab-applist-entry-title: yes`. The
  reading is the same search and it is self-observing: 17 `icon_small` requests mean the row was built and the bare title was the
  gate; none means it was the `<k>`, and the next arm is `appListRank` back to `""`.
- **Also measured, and the lab answers with 502** `/v8/catalog/queries` ×16 and `/v8/catalog/appCategories/windowsphone.Social` ×4.
  Both are known fall-throughs (F-031's note), but this is the first session where the category one sits on the path a finger took:
  five detail fetches at `11:53:44`-`11:53:47` and then the category feed, four times, refused. Whatever the handset draws for that
  refusal is on screen, and the page it leaves is the empty blue one.
- **A diagnostic that had stopped matching the server** `tools/store-page.mjs` passed four options fewer than the handler does - no
  `dataSource`, `paneType`, `paneSubType`, `paneBackgroundImage` - and so printed panes carrying neither `<Type>` nor `<DataSource>`:
  a document the lab has never served. Corrected the same day and compared byte for byte against the live delivery (58 427 = 58 427,
  identical except `<a:updated>` and `impressionId`), and the tool now prints the pane type and source it built. It is not yet covered
  by a suite check - the comparison above is the evidence, not a test.
- **Does not establish** That the rows are missing rather than invisible: zero image requests say no row was built to draw, not why.
  Nor that the bare `<title>` is what the client reads - that is what the armed value is for. And it does not close the pane kind:
  three values tried is three values, and the field may carry something that is not a code from that table at all.
- **Undo** `appListEntryTitle` back to `false`, `paneType` back to `Collection`, then `POST /__lab/reload`.

## F-044 The two requests a finger makes are answered now, and the list is back to the shape that drew

**PARTLY WITHDRAWN by F-045**: the two endpoints and the search filter stand and are covered by four checks; the paragraph that
restores the entry shape was aimed at the wrong document and the values are back where they were (`appListRank: 4`,
`appListEntryTitle: false`), which F-045 shows is byte-identical to the 2026-10-17 delivery.

- **Date** 2026-10-20 14:04 local · **Area** `src/store/protocol.mjs`, `config.json` · **Method** F-043's session re-read
  route by route against `ROUTES`, then each path driven from this PC with the phone's own query string and the reply read
  header by header; suite run after every change.
- **The one that was a refusal, not a wrong document** `/v8/catalog/appCategories/<id>` matched no route, so the relay resolved the
  hijacked name back to this process and answered `502 upstream_loop` - four times in F-043's session, on the path a finger took
  after five detail fetches. It is the application list the lab already serves, filtered by the category id the client named
  (`windowsphone.Social`), matched through the same name→id table the entries are written with (`categoryId` in
  `catalog-feed.mjs`), so a category cannot be called one thing in an entry and another in a route. Verified from this PC:
  `200`, `x-lab-protocol: appCategories`, `x-lab-category-id: windowsphone.Social`, `x-lab-apps: 2`, the two social apps in the
  body and neither of the others; an id nobody carries answers `200` with `x-lab-apps: 0` and a well-formed feed, because an
  empty category is a fact and a `404` would be this lab's opinion.
- **The one that was a lie** `/v9/catalog/apps?…&q=f` - the client's own `ApplicationSearch` endpoint (F-041) - was answered with
  the whole catalog: `x-lab-apps: 17` for a query that names three entries. A search that returns everything is indistinguishable
  from no search, on the screen and in a capture. `q` now filters on title, sort title and tags; **not** on publisher, because every
  fixture entry is published by "Lab Fixture" and the first version of this filter answered `f` with all 17 - caught in the same
  minute by the count, which is why the count is a response header. Verified: `q=f` → 3 (`Filodiretto`, `Spesa in Fila`, `Favole a
  letto`), `q=zzzz` → 0 with a well-formed feed, no `q` → 17 and `x-lab-query: none`.
- **The list is back to the 2026-10-17 shape** `appListRank` is `""` and `appListEntryTitle` is `true` again - no `<k>`, the bare
  `<title>` present - which is byte-for-byte the document that produced 240 icon requests on 10-17 at 16:30, before commit
  `e10db61` (16:32) changed it. F-043's first arm moved only the title and the screen stayed empty; both halves are reverted here
  because the commit changed both at once, and a document that never existed on a working service is not the thing to compare
  against. Verified from this PC: 23 005 bytes, `x-lab-applist-rank: none`, `x-lab-applist-entry-title: yes`.
- **Suite** 165/165, exit 0, with four checks new: a category chip is answered with the apps that carry it; a category nobody
  carries is an empty list and not a refusal; a search answers with the entries that match and not the catalog; a search with no
  match is empty while no query is the whole list. The third and fourth are the pair that matters - a filter that returned nothing
  would pass the third alone.
- **Does not establish** That the screen changes: every check above is this PC talking to this lab. The category reply is a list
  the client has never been handed on that path, and whether it draws rows is a device reading. Nor is the hub page touched: the
  page still parses into a model that draws its background and no panes, and that remains F-037's open question with two candidates.
- **Undo** `git revert` for the route and the filter; `appListRank` back to `4` and `appListEntryTitle` back to `false` for the
  entry shape - one value each, and every delivery before this entry is then comparable again.

## F-045 The document that drew the list in October is the one the lab serves now, byte for byte, and the metric that said otherwise was the client's image cache

- **Date** 2026-10-20 14:05-14:10 local · **Area** the application list, and two entries written an hour earlier · **Method** the
  response the handset received on 2026-10-17 at `14:21:34Z` (`captures/session-2026-10-17_14-17-31/bodies/0016-res.bin`,
  22 636 bytes - the delivery that was followed within a second by 240 `icon_small` requests) compared byte for byte with what this
  lab answers now for the same request, normalising only the clock (`<a:updated>`), the impression id, the date inside the feed id
  and the `&q=f` of the self link.
- **Measured: identical** 20 833 characters of each, equal. 22 628 bytes against 22 636, the 8 bytes being the `q=f` in the self
  href. So the entry shape the lab serves today - `<k>` present, no bare `<title>` (`appListRank: 4`, `appListEntryTitle: false`) -
  **is** the shape that drew 17 rows on 10-17. Nothing about the entry changed, and nothing about the entry can be the reason a
  screen is empty.
- **What that withdraws, stated plainly** F-043 read commit `e10db61` (10-17 16:32) as the regression that stopped the list being
  drawn, and F-044 restored an earlier shape on that reading. Both are wrong: the `14:21Z` delivery already carried `<k>` and no
  bare `<title>`, so the document that drew is the document the commit produced. The second arm - `appListEntryTitle: true`, tried
  on the handset at `11:59Z` because the first one did not change the screen - is likewise withdrawn, and the values are back where
  the config had them.
- **The measurement that misled, and why** "the client asked for zero icons" was read as "no row was built". It cannot carry that:
  the client caches image bytes by guid, and the placeholder for those 17 guids had already been fetched on 10-17 and again on
  10-20 at `04:50`. A list that is drawn from cache asks for nothing, and so does a list that is not drawn - the two are the same
  number. The same flaw sits under F-035's conclusion that `offerMediaInstance` cost the list its art: that field is off, the
  document is the one that drew, and the request count is still zero. **A request count on a cached resource is not evidence of
  rendering**, and this register had been using it that way.
- **What is left of the list problem, then** Either the list is drawn and the screen the operator called "azure" is another screen,
  or the list is not drawn for a reason no response body here can show - and the next reading is the device's, not a document: one
  search with the lab answering exactly the 10-17 bytes, and the screen described before and after.
- **Does not establish** That the list is drawn today. It establishes that the bytes are the ones that drew once, which is the
  strongest statement a response can make about itself. Nor does it say anything about the hub page: no document of this project
  has ever been followed by a request, and the pane question stays where F-037 left it.
- **Undo** Nothing to undo: `appListRank: 4` and `appListEntryTitle: false` are the values the config carried before F-043/F-044,
  and the comparison above is why.

## F-046 The list drew, the icons did not, and the detail page was titled with the list's own placeholder

- **Date** 2026-10-20 14:20 local (12:19-12:20Z) · **Area** the application list's art, the app detail's title · **Method** one
  device run against the lab as F-045 left it (17-entry list byte-identical to the 10-17 delivery, `appCategories` new, `q`
  filtering), read from `captures/session-2026-10-20_12-04-33/index.jsonl` - 37 exchanges - and from what the operator reported
  seeing on the handset.
- **Measured: the list draws, so the document was never the problem** Search for `f` showed **three rows** in the Store, which is
  the reply `q=f` now returns (`Filodiretto`, `Spesa in Fila`, `Favole a letto`). With F-045's byte identity this closes the
  question the last two entries spent themselves on: the list endpoint was correct all along, and the empty blue screen was either
  another screen or a search that returned entries the screen did not draw for its own reasons.
- **Measured: the category path is answered and used** `/v8/catalog/appCategories/windowsphone.Social` was answered `200` at
  `12:20:16Z` - the first `200` this path has ever had - and the operator opened the app's **related** list and saw other
  applications in it. So the route works end to end: request, reply, rendered list. What used to be four `502`s in a row is now a
  screen with content.
- **Measured: no logo, and no image request at all** In the whole session there are **zero** requests to
  `cdn.marketplaceimages.windowsphone.com`, while three rows were drawn. So the client is drawing icon slots it does not ask this
  lab to fill. The one explanation that fits the history is its own cache: it stores an image under the guid it was asked for and
  does not ask again, and the 17 guids this lab mints were first requested on 2026-10-17, when the CDN was still being answered
  `502` (F-031) - so what the handset holds under them is a failure, and no later bitmap can change what it draws under a guid it
  will not re-request.
- **The lever, and why only the art moves** `livestore.protocol.imageSalt`, armed as `r2`: `uuidForImage`, `uuidForBackground` and
  `uuidForEditorial` derive from the salted name, and `uuidForApp` / `uuidForCollection` do not - the client names an application
  back to this lab by its own guid (`/v9/catalog/apps/<guid>`) and a collection by the one its pane holds, so moving those would
  break the routes that work in order to fix the ones that do not. Verified from this PC: the same three rows now carry
  `5c7ad249…`, `74697f3b…`, `03912dd4…`, none of them a guid this lab has ever served before; clearing the salt restores every
  earlier guid (`setImageSalt('')` is in the suite as a check).
- **Measured: the detail screen's title was a placeholder** The operator reported **"List Of Items"** as the heading over
  Filodiretto's own page. That string is `buildApplicationListFeed`'s *feed* title default, and the screen reads the feed's
  `<a:title>`, not the entry's - which was already the app's name. The detail route now titles the feed with the app's name.
  Verified from this PC: `Filodiretto` in both places, and a check asserts the feed title against the fixture entry so the
  placeholder cannot come back.
- **Suite** 167/167, exit 0, two checks new: an app detail page is titled with the app and not with the list placeholder; the image
  salt moves the art guids and leaves the app guids where they were, clearing it restoring the original.
- **Does not establish** That the handset will draw the icons from the new guids: that is the next device reading, and the
  mechanism it tests (a cache that never re-asks) is inferred from a request count of zero plus a history of `502`s, not from the
  cache itself. Nor does it say anything about the home page, which is unchanged and still draws nothing.
- **Undo** `imageSalt: ""` restores every guid; the detail title is one argument in `src/store/protocol.mjs`.

## F-047 The marked placeholder draws once the guid is new, so the cache is the mechanism - and the same lever is now on the pane's own art

- **Date** 2026-10-20 14:25 local · **Area** the art the client draws, and the one question the home page has never answered · **Method**
  one device run with `imageSalt: "r2"` armed, the delivery verified from this PC first (three rows carrying `5c7ad249…`,
  `74697f3b…`, `03912dd4…`, none servable before), then what the operator saw on the handset.
- **Measured: the placeholder appears** With fresh guids the search list drew **the marked square - dark field, light frame, diagonal
  cross** - where before it drew nothing at all. That is the PNG this lab serves (`x-lab-image-shape: 48x48 field+frame+X`, 279 bytes),
  so the client: asked for an image it had never asked for, took the reply, and drew it. The reading of the empty slot is now settled:
  the client caches an image **by guid and does not re-ask**, and the guids this lab minted before had first been answered `502`
  (F-031), so what it held under them was a failure. F-046's inference is now a measurement.
- **What that retires** The art is no longer a hypothesis to test: an image this lab mints is drawn, and the only thing that ever
  stopped it was a guid the client had already answered for itself. `offerMediaInstance` is not implicated in any of it, and neither
  is the entry shape.
- **Armed now: the pane's own background art** `paneBackgroundImage: true`, so every one of the eight panes carries
  `/BackgroundImage/id` - the one path of the pane's field map that a hub tile would draw with, minted through the salted
  derivation (`d5ad4b82…`, `01a01e1e…`, `3f8d6b1f…`, …). Verified from this PC: the page carries **8** of them, `content-length:
  59139`, header `x-lab-pane-background: guid`, and the image endpoint answers each with the marked PNG
  (`200`, `image/png`, `x-lab-image: placeholder`).
- **Why this is the reading and not another content guess** It is the first experiment in this project on the home page whose answer
  is **self-observing**: a client that walks `/Panes` at all must fetch the art those panes name, and a client that never reaches the
  panes cannot. So the capture answers F-037's open question in either direction, without anyone reading the screen - eight image
  requests mean the pane model is built and the emptiness is in the pane's contents; zero means the client never walks the block, and
  the page's frame is wrong in a way no served document has yet varied.
- **Does not establish** That a pane's background draws, or that the hub gains rows. A request for the art says the pane was read; it
  does not say the pane was rendered. And a 48x48 placeholder stretched into a background slot is what would be seen if it does - not
  artwork, and not a claim about how the real service filled that field.
- **Undo** `paneBackgroundImage: false` (the page returns to 58 427 bytes), and `imageSalt: ""` to restore every earlier guid.

## F-048 The client never walks the pane block at all, and the two sources that name it disagree

- **Date** 2026-10-20 14:26-14:37 local (12:26-12:37Z) · **Area** the home page's frame, and the question F-037 left open · **Method** one
  device run with `paneBackgroundImage: true` (eight panes, each naming its own art under salted guids), then the capture read
  request by request; then the other element spelling served and verified from this PC.
- **Measured: the pane block is not read** `captures/session-2026-10-20_12-22-53/index.jsonl`, 19 exchanges from `192.168.0.136`, the
  page delivered **three times** (`12:32:55`, `12:33:34`, `12:36:30Z`, each `200`, `content-length: 59139`, `x-lab-pane-background:
  guid`) and the handset requested **none** of the eight background images. The only art it fetched all session is the three app
  icons of the search list (`5c7ad249…`, `74697f3b…`, `03912dd4…`) and one repeat of the first on the detail page - all of them from
  the application list, none from the page. A client that walked `/Panes` would have had to fetch what those panes name; it did not
  fetch a single one. So the pane model is not built, and **every served-pane hypothesis since F-032 has been asking a question about
  a subtree the client never enters**.
- **What that converts into** The failure is in the page's *frame* - the elements that lead a reader to the panes - and not in what a
  pane carries. `paneType`, `CollectionId`, `DataSource`, `MaxItems`, `SubType`, the placement of the panes, and whether a pane holds
  items or a reference are all inside the block the client skips: no value there can be the answer, which is why five of them have been
  read as negatives.
- **The two sources, and the one that has not been tried** The parser's path table says `/Panes/Pane` and `/Templates/Template`
  (handset module, 69 asserted offsets) - the spelling every page in this project has carried. The retail build's type table (F-041)
  lists `StorePage Panes StorePane Templates StoreTemplate GetObjects …` - `StorePane` and `StoreTemplate` beside the root. One of the
  two must be the names that reader walks, and only the first has ever been served. An element the reader does not find is not an
  error it reports: it is an empty model, which is exactly the silence on this screen.
- **Armed: `pageElements: "typetable"`** `<StorePane>` and `<StoreTemplate>` in place of `<Pane>` and `<Template>`, and **nothing else** -
  same panes, same field order, same `<Type>`, `<DataSource>`, `<BackgroundImage>`, same template type `003`, same feed underneath.
  Verified from this PC: the page carries **8** `<StorePane>` and **1** `<StoreTemplate>`, no `<Pane>`/`<Template>` tag at all,
  `content-length: 59229`, and the tool that prints the page prints the same document (`store-page.mjs` applies this switch and the
  image salt, 59 229 = 59 229).
- **The reading is the one already built** The eight background guids are still in every pane, so a client that now walks the block
  must fetch them: eight image requests mean the spelling was the gate, zero means it is not and the frame is wrong in a third way.
  Nobody has to watch the screen for that number.
- **Suite** 168/168, exit 0, one check new: serving the other spelling renames the pane and the template and nothing else - the
  document renames back to the parser one exactly, which is the assertion that keeps this a one-variable change.
- **Does not establish** Which spelling the *handset's* build walks: the type table is the retail FFU's (`3058.50000.1445.1005`), the
  handset runs `8.10.14219.0`, and F-041 says every offset in that entry is the image's. Nor that a pane would draw if it were read -
  art would be fetched, which is all this measures.
- **Undo** `pageElements: "parser"` + `POST /__lab/reload`: the page returns to `<Pane>` and the 59 139-byte delivery.

## F-049 Neither spelling is read, so the next question is whether the pane block is parsed at all - and a control that answers it

- **Date** 2026-10-20 14:39 local (12:39:01Z) · **Area** the page's frame · **Method** one device run with `pageElements:
  "typetable"` (eight `<StorePane>`, one `<StoreTemplate>`, eight background guids), the capture read exchange by exchange.
- **Measured: one request, nothing else** `captures/session-2026-10-20_12-37-34/index.jsonl` holds **one** device exchange - the page
  at `12:39:01Z`, `200` - and **zero** image requests. So the other spelling is not the gate either: `<StorePane>` is as unread as
  `<Pane>`. Two spellings, two negatives, and the eight background guids fetched by neither.
- **What is now excluded, and how much of the register it covers** Every field inside a pane (`/Type`, `/SubType`, `/CollectionId`,
  `/MaxItems`, `/MinItems`, `/DataSource`, `/BackgroundImage`, items inline against a reference) and both element spellings. If the
  reader never enters `/Panes`, none of those can be the answer, and the negatives recorded in F-032, F-036, F-037, F-043 and F-048
  are all negatives *about a subtree that may never be parsed* - which is a weaker statement than each of them claimed.
- **The control, built because the two outcomes look identical from outside** `serve: "control-pane"`: the page the client accepts,
  cut off **four characters into the first pane's first child** - deliberately unparseable, with a correct `content-length`, served
  as `application/atom+xml`. E-008's control (F-027) cut the document at an arbitrary point and drew `0xc00cee23` on the handset,
  which proves the client reaches *a parser*; this one cuts at a known depth, so the answer separates a reader that never walks into
  `/Panes` from one that walks in and discards what it finds. A code on screen means it got there; the usual silence means it did not.
- **Verified from this PC** `200`, `content-length: 210`, `x-lab-control: pane-truncated`, body ending `<Panes><StorePane><Id>` and
  unparseable (`unclosed <Id>`); the handler refuses with `502 control_unavailable` if a page ever carries no pane, so the control
  cannot silently degrade into an ordinary delivery. Suite **169/169**, exit 0, one check new: the control is a page, is unparseable
  inside the first pane, and its declared length is the length it serves.
- **Does not establish** Anything yet: it is an armed question, not a reading. And it says nothing about *why* the client stops before
  the panes if it does - that would be the next frame experiment, with the 2013 feed as the only real document in hand and its
  `88675309` as the one refusal on record.
- **Undo** `serve: "generated"` + `POST /__lab/reload`.
## F-050 `c00cee01` is the control's own answer: the client *does* walk into `/Panes`, and three config cuts made while the control was armed read nothing

- **Date** 2026-10-20 15:0x local · **Area** the lab's armed state and the page's frame · **Method** four device opens, then the
  capture read exchange by exchange.
- **Measured: the handset was never shown a page.** `serve: "control-pane"` (F-049) was still armed, so every open delivered the
  210-byte truncated control - `x-lab-control: pane-truncated`, `content-length: 210`, body ending `<Panes><StorePane><Id>` - and
  the three config changes written and reloaded during those opens (`pageElements` back to `parser`, `pageFormat` back to
  `storePage`, `paneBackgroundImage` back to `false`) could not be read, because the control path never builds a page. Three
  negatives that carry no information, and the reload's `200` said only that the file had been re-read.
- **The answer, and why it is the answer** The handset drew `c00cee01` four times (four retries of the same open). That is the
  control's code: it differs from the arbitrary cut's `0xc00cee23` (F-027) because the cut point differs, and it agrees with it on
  the only thing both were built to ask. This document is cut **four characters into the first pane's first child**, so a code and
  not silence means the client reached a parser *and* walked into `/Panes`.
- **What this corrects** F-049 rested its reading on the possibility that the pane block is never parsed, which made the negatives in
  F-032, F-036, F-037, F-043 and F-048 negatives about a subtree nobody reads. That doubt is now settled the other way: the block is
  read, so a field inside a pane that was ignored was ignored *by a parser that was looking*. The frame, not the pane, is where the
  next experiment belongs.
- **Verified from this PC** after `serve: "generated"` + `POST /__lab/reload`: `200`, **33 086 bytes**, no `x-lab-control` header,
  `x-lab-page-format: storePage`, `x-lab-pane-type: col`, `x-lab-pane-background: none`, body ending `</a:feed></StorePage>`.
  Suite **169/169**, exit 0.
- **Does not establish** That the built page renders, or that any of the three reverted values is wrong: they were never delivered.
  The next open is the first one in this session that shows the handset a page this lab built.
- **Undo of the three cuts** Each is one value and none was read: `pageElements: "typetable"`, `pageFormat: "panes"`,
  `paneBackgroundImage: true`. `serve` stays `"generated"`: the control is not a thing to leave armed.
## F-051 The handset accepts the built page, then a lab-injected 502 on `ssl-api.bing.com` is the only failure left in its sequence

- **Date** 2026-10-20 15:2x local (12:50:03Z) · **Area** the client's start-up path · **Method** one device open with the page
  served (`serve: "generated"`), the capture and the DNS log read together, then the hosts measured from this PC against a public
  resolver.
- **Measured: the code is gone, the page is taken** `captures/session-2026-10-20_12-40-22/index.jsonl`, last exchange: the page at
  `12:50:03Z`, `200`, **33 166 bytes**, no error on screen. Four opens before it had drawn `c00cee01` because they were served the
  control (F-050); this is the first delivery in this session that was a built page, and it is the first that drew no code. What
  the screen showed instead is the client's own "not connected to the Store" dialog after a few seconds, then a spinner that never
  ends.
- **Measured: nothing follows the page** Zero exchanges after it - no `DataSource` fetch for any of the eight panes, no image
  request, no second page. A document the client had refused would have answered with a code; a document it wants more of would
  have produced a request. It produced neither, which is F-019's sign of a parsed page that yields no model.
- **The one failure in the sequence, and it is this lab's** In the same 90 seconds the handset queried `www.msftncsi.com`,
  `discoveryservice.windowsphone.com`, `ssl-api.bing.com`, `sup.live.net.co` and the page host. Of those, `ssl-api.bing.com` was
  hijacked and intercepted, and the lab answered `502` (451-byte error body) at `12:50:01Z`, two seconds before the page. E-003
  had kept the name because it "answers nothing on the real network either". **That is false**: from a public resolver the name
  resolves (`150.171.73.13`, `150.171.74.13`) and the path the phone asks for
  (`/winphone/clientconfig/rwsettingbluegdr1qfex.xml`) answers **302**. The lab was inventing a failure where the real service
  redirects - the same defect F-031 found on the image CDN, on a host that sits on the client's start-up path.
- **Armed: the name is out of both lists** Removed from `dns.hijack.names` and `proxy.mitm.hosts` together, because a name in one
  and not the other is a tunnel. Verified on the running lab after `POST /__lab/reload`: `200`, and `/__lab/status` reports no
  `bing` entry in either list. Suite **169/169**, exit 0.
- **Does not establish** That the dialog was caused by this 502: it is the only injected failure in the window and it sits on the
  path the client walks before it draws, but the reading is the next open. Nor that `discoveryservice.windowsphone.com` is innocent:
  it resolves to a real Akamai edge whose TLS handshake now fails from this PC (`000`, exit 35), so it is dead but *not* touched by
  this lab, and if the dialog survives this change it becomes the next candidate - which would need a capture first, and that needs
  the name intercepted.
- **Undo** Put `"ssl-api.bing.com"` back at the end of both lists + `POST /__lab/reload`.
## F-052 With the 502 gone the dialog goes too, and the client never asks `discoveryservice` at all - so the spinner is the page's own emptiness

- **Date** 2026-10-20 15:3x local (12:54:29Z) · **Area** the client's start-up path · **Method** one device open with
  `discoveryservice.windowsphone.com` added to both `dns.hijack.names` and `proxy.mitm.hosts`, the capture and the DNS log read after it.
- **Measured: the dialog is gone with the 502** The open before this one drew "not connected to the Store" with `ssl-api.bing.com`
  answered `502` (F-051); after the name left both lists the dialog did not appear. The 502 was the dialog's cause.
- **Measured: the arm found nothing, because the client does not ask** In the 12:54:29Z open the handset made exactly **one** DNS
  query - the page host (`hijack`) - and **one** exchange, the page, `200`, **33 166 bytes**. It did **not** query or contact
  `discoveryservice.windowsphone.com`, although the name was hijacked and intercepted at that moment and it had resolved it nine
  minutes earlier. So the name is not on the path this open walks, and the next-candidate role F-051 gave it is withdrawn.
- **What the silence now means** Page delivered, validator satisfied (no code), no follow-up of any kind - no `DataSource` fetch, no
  image, no second page - and the screen spinning. Nine documents have now produced this same second group (F-027, F-032, F-049), and
  today's two repairs removed the two *errors* that were hiding it rather than changing it. The remaining defect is that the client
  builds no page model from a document whose every parser path it carries.
- **Does not establish** Why. Nothing in this entry distinguishes an empty model from a model whose drawing throws, and no served body
  will: the surface that would say which is the device's own state, which has never been read after a failed open
  (`Data\SharedData\Comms\Unistore\data`, `AggregateCache.uca`, `EdmCache`).
- **Undo** Remove the name from both lists + `POST /__lab/reload`; it is still armed as the instrument for the other reading.
## F-053 The phone's own state after a failed open: the page is cached, nothing else is written, and its DLL has no `StorePane`

- **Date** 2026-10-20 15:0x local · **Area** the device's state, read for the first time after a failed open · **Method** mass
  storage mode (`H:`), `tools/phone-readout.ps1` run elevated (`-OutDir .phone-read2`), then direct reads of the mounted volume.
- **Measured: the page is taken and kept** `Data\SharedData\EdmCache\Short\9\7f3c9a52…$48b1e555$2B74.zmz`, `33166` bytes, written
  `14:54:27` local - the delivery the capture shows at `12:54:29Z`. The five opens before it cached `210`, `210`, `205`, `205`, `205`
  bytes: the control (F-050). So the client stores the built page exactly as it stores the control, and the cache is not the place
  where the two differ.
- **Measured: nothing follows, in the device's own record** The report's "modified after the threshold" list ends at that entry.
  After `14:54:27` the phone wrote **no** Store-related file at all: no second response, no `AggregateCache.uca` update (last write
  `14:13:32`, i.e. before the open), no `*.error.txt`, no crash drop. The `Data\Users\Public\Documents\Debug` directory still holds
  only the 2026-10-19 entry. This is the device-side confirmation of F-052's one request and nothing else.
- **Measured: the handset's binary does not know the spelling F-048 tried** `H:\Windows\System32\ZMarketplace.dll`, 565 248 bytes:
  `StorePane`, `StoreTemplate` and `StorePaneListResult` occur **zero** times, in ASCII and in UTF-16. The only `Panes` is inside
  the log line `Found %d Store Panes` (@28800). The three-level shape `Panes > StorePaneListResult > StorePane` (F-041's retail
  type table) is therefore not this build's grammar, and F-048's `typetable` arm was reading a different generation's naming.
- **Measured: the path strings are UTF-16, and the citations are right** `50 00 61 00 6e 00 65 00 73 00` at `@28776` is
  `/Panes/Pane` and `@28824` is `/Templates/Template`. An ASCII-only scan of the same bytes finds neither - which is how this entry
  found them missing on the first pass and then proved itself wrong. The whole path vocabulary is 15 UTF-16 strings that begin with
  `/`; every one the page parser walks is among them, and none of them is deeper than two segments.
- **Measured: no parse configuration ships on the device** The binary logs `LoadEntryPropertiesFromParseConfig`,
  `GetConfigAndElementPath`, `Prop: %d, %s, path {%S}, value {%S}`, `found`, `missing` - a per-property trace of what the parse read.
  A name search over `H:\Windows`, `H:\Data` and `H:\Programs` for `*parse*`, `*tuner*`, `*storepage*`, `*marketplace*` finds no such
  file (481 hits, all Bing configuration, audio tuners, DSM policy and the EdmCache entries). A search of every file under
  `Data\SystemData`, `Windows\Logs` and `Data\Users\Public` modified in the six hours before the read (16 files) finds **no** line
  carrying `Store Panes`, `Store Templates`, `Prop: ` or `StoreObjects`: the trace exists as code and is not being written to a file
  this device keeps.
- **What the hub's own UI asks for** `ZuneAssets480x800.dll`, the hub's style names, 47 of them: the item kinds are
  `Store_HubCollectionUI_*` and `Store_HubFeaturedItemUI_*` (with `Store_ChartCollectionUI_*` / `Store_ChartFeaturedItemUI_*` for a
  chart), and the layouts are `TemplateType003` (list), `004`, `015`, `017`. A hub is drawn from a **collection** item kind and a
  **featured** item kind - and the page this lab serves carries eight panes of one kind, `col`, all under `TemplateType003`.
- **Does not establish** That a featured pane would be drawn, or that the missing piece is the pane kind at all: the client caches
  the page and stops, which is consistent with an empty model for any reason. It also does not tell whether `AggregateCache.uca` is
  written on exit or on a built model - the one write in the window (`14:13:32`) precedes the open that followed it, so this entry
  does not claim it as a signal.
## F-054 The hub's own UI names two item kinds, and the page now carries both

- **Date** 2026-10-20 15:2x local · **Area** the page document · **Method** the UI asset names read on the mounted phone
  (`H:\Windows\System32\ZuneAssets480x800.dll`), then one value in the builder and a check in the suite.
- **Measured: the hub has two kinds of item, not one** 47 `Store_*` names in that DLL. The item kinds are
  `Store_HubCollectionUI_ArtSize/ArtMargin/TitleMargin` and `Store_HubFeaturedItemUI_Margin`, with the chart page's pair beside
  them; the layouts are `TemplateType003` (list), `004`, `015` and `017`. Every page this lab has ever served carried **one** kind
  for all eight panes (`col`, `Collection`, `inv`, one at a time) and one layout, `003` - a shape this vocabulary never describes.
  A hub is a featured item plus collections.
- **The change, and it is the first pane and nothing else** `livestore.protocol.paneTypeFeatured`: when set, the **first** pane
  carries that kind and the rest carry `paneType`. Nothing else moves - same sections, same order, same `Id`/`Title`/`CollectionId`,
  same `DataSource`, same `MaxItems`/`MinItems`, same template block, same entries. An empty value leaves every earlier document
  byte for byte, and the suite asserts both arms.
- **Verified from this PC** after a **restart** (a reload re-reads `config.json` only, not the modules - the served page kept the old
  kind until `node src/main.mjs` was started again): `200`, `content-length: 33144`, `x-lab-pane-type: FeaturedItem+Collection`,
  `<Type>FeaturedItem</Type>` exactly once (the `social` pane, index 1) and `<Type>Collection</Type>` seven times, the last pane
  `books + reference` still a collection. `paneType` is `Collection` again rather than `col`, because `Collection` is the word the
  UI itself uses and `col` was the object-code guess (F-043, negative).
- **Suite** **170/170**, exit 0, one check new (the featured pane is the first one and only the first) and one changed rather than
  weakened: the existing check that the served page and the header agree now reads both kinds off both surfaces, so a builder that
  wrote a kind the header did not report still fails.
- **Does not establish** That the client draws either kind. The hypothesis is that a hub with only collection panes builds no
  model, and the reading is the next open: an image request, a `DataSource` fetch, or an `AggregateCache.uca` write would each say
  the panes were used; the same silence would say the kind is not the gate.
- **Undo** Empty `paneTypeFeatured` and put `paneType` back to `col`, then restart the lab.
## F-055 The featured pane is read and changes nothing either, so the kind is not the gate

- **Date** 2026-10-20 15:1x local (13:11:09Z) · **Area** the page document · **Method** one open with `paneTypeFeatured:
  "FeaturedItem"` armed (F-054), the capture and the DNS log read after it.
- **Measured** One exchange: the page, `200`, **33 224 bytes** (the same document the PC verifies, 80 bytes longer because the
  handset's own query string travels back in the self link), and **nothing after it** - no `DataSource` fetch for any pane, no image,
  no second page. One DNS query, the page host. Byte for byte the shape of F-052's silence.
- **What that excludes** The pane's `/Type` as the thing that decides whether a pane becomes a list, on its fourth value and the first
  one taken from the handset's UI vocabulary rather than from the parser's: `inv` (F-043), `Collection`, `col` (F-043) and now
  `FeaturedItem` beside it. Four tokens, four silences. Whatever the pane parser wants, it is not being told by `/Type`.
- **Also checked, because it was the one pane field never compared against a real document** The pane's `<link><type>`. The lab
  writes `ApplicationCollection` on the pane's own link and on the entry's, `Application` on each of the 17 applications - and the
  archived 2013 response uses exactly those two, `ApplicationCollection` once and `Application` fourteen times. So the link type is
  not a mismatch this lab introduced.
- **Does not establish** That the panes are used at all. Four kinds rejected silently is also what a client that never looks at
  `/Panes` after parsing it would do - F-050 proved the parser *enters* the block (the control's code), not that the model builder
  consumes it.
- **Undo** Empty `paneTypeFeatured`, `paneType` back to `col`, and the lab restarted: the page then returns to the 33 086-byte
  delivery of the morning.
## F-056 The layout is not the gate either, and the client re-asks for the same page while it spins

- **Date** 2026-10-20 15:1x local (13:13:16Z) · **Area** the page document · **Method** one open with `templateType: "017"` armed
  (paired to F-054's featured first pane), the capture read with the response headers the lab itself recorded.
- **Measured** Three deliveries of the same page in two minutes - `13:11:09` (`003`), `13:12:33` (`003`), `13:13:16` (**`017`**),
  every one `200`, `33 224` bytes, `x-lab-pane-type: FeaturedItem+Collection` - and after each of them **nothing**: no `DataSource`
  fetch, no image, no second endpoint. The header proves the last delivery really carried the new layout, so the silence is not an
  un-armed arm read as a negative.
- **What that excludes** The template layout as the thing that turns a parsed page into a model: `003` (plain list, every earlier
  delivery) and `017` (rich list item, the layout the hub's UI assets pair with `RightPanel`/`Price`/`SuggestedReason`) both leave
  the client spinning with no follow-up.
- **Measured: the client keeps asking** Three requests for one URL with nothing in between is the client's retry, not a new intent -
  the same shape F-051 saw four times. A page it had accepted and used would not be asked for again two minutes later.
- **What is left, stated plainly** Seven structural and field-level variables have now been delivered and read with the page parser
  confirmed (F-032, F-043, F-048, F-054, F-055, this entry, plus the two controls): element spelling, pane position, pane kind (four
  values), background art, data source, source type, template layout, items inline against referenced. None moves the client past
  the page. The surface that would say *why* - the client's own database under `Data\Users\DefApps` - has never been read, because a
  normal and an elevated read are both denied (F-004).
- **The way in that is not a write** Backup semantics (`SeBackupPrivilege`, i.e. `robocopy /B`) read a file regardless of its ACL
  without changing an owner or a permission. That is the next read to try, and it is read-only: it needs the phone in mass storage
  and nothing else.
- **Undo** `templateType` back to `003` + `POST /__lab/reload`; the page returns to the 33 144-byte delivery of F-054.
## F-057 Backup semantics open the folder the ACL refused - and it is the other client's state, not the Store's

- **Date** 2026-10-20 15:3x local · **Area** the device's private state · **Method** phone in mass storage, `robocopy /B` (backup
  semantics, `SeBackupPrivilege`) copying `H:\Data\Users\DefApps` out; no owner, ACL or permission touched.
- **Measured: the read that F-004 said was impossible is possible without a write** `robocopy /B` copied **316 files** from
  `Data\Users\DefApps` (305 under `APPDATA\Local\Packages`, 11 under `APPDATA\Local\Microsoft`). The earlier failures were an ACL
  problem, not a privilege one: backup semantics read what ownership-taking would have been needed for, and they leave the device
  exactly as they found it.
- **Measured: that folder does not hold the Store's state** No copied file contains the string `storePages` or `ZMarketplace`. The
  only package written after 14:30 on 2026-10-20 is `0d6b0d63-5770-4ee0-a79c-31767f7be5fc_h37gyvpph0nvj` - **One Live Network**, the
  second client of F-029/F-030 (its `settings.dat` carries `OneLiveId`, `access_token`, `id_token`, `refresh_lease`,
  `NotificationPoller`, `contacts.lastSyncUtc`). Nothing in this tree is the system Store's model, cache or log.
- **What that closes** The plan that F-056 left open - read the client's own database to learn why the model is empty - does not apply
  to this surface, because the system Store keeps no data here. The Store's only state on this device is the shared one already read
  in F-053: `Data\SharedData\EdmCache` (the responses, page included) and `Data\SharedData\Comms\Unistore` (compressed, no readable
  strings). Both were read; neither says why.
- **Restored, because a read arm is not a thing to leave armed** `templateType` back to `003`, `paneTypeFeatured` empty, `paneType`
  back to `col`, and `discoveryservice.windowsphone.com` out of both lists (F-052 measured that the handset never asks it). The lab
  is back on the page every earlier delivery was compared against. Lab restarted (pid 14960) after an earlier instance died at
  `13:13:16Z` and left one request falling through to the real CDN - the first delivery of that window that was not this lab's.
- **Does not establish** Anything about the model. It only removes a surface from the list, and it corrects a standing claim: F-004's
  "the client's own database stays out of reach" is about *owner and ACL*, not about reading - backup semantics reach it.
## F-058 The page without panes - the archived shape - is a fourth silence, and the document is now excluded

- **Date** 2026-10-20 15:2x local (13:24:39Z) · **Area** the page document · **Method** one open with `withoutPanes: true`
  (F-057's builder change), the capture read with its own headers.
- **Measured** One exchange: the page, `200`, **28 767 bytes**, `x-lab-pane-placement: none` - the document verified from this PC
  as 0 `<Pane>`, 1 `<Templates>`, 8 `a:entry`, 17 applications - and **nothing after it**. Same silence as every delivery with panes.
- **What this closes** The arrangement the register kept pointing at: the one real page response this project holds has no `<Panes>`,
  its items hang off the root's entries, and three entries (F-014, F-027, F-049) reasoned about a document that differs from ours in
  exactly this. Served, it changes nothing. Together with F-052 to F-056 the page document is now excluded as the cause of the empty
  model: element spelling, pane position, pane kind (four values), background art, data source and its type, template layout, items
  inline against referenced, panes present against absent.
- **Also closed: the data-source type** The client has four feed parsers (`Applications`, `FeaturedApps`, `Collections`,
  `Categories`, F-036) and only the first has a builder here - `/v8/catalog/appCategories/<id>` answers with an *application* list,
  not a categories feed, so arming `Categories` would pair a type with a body that contradicts it. That arm is not available without
  writing a categories feed, and it is not armed.
- **A bug this arm found and fixed** The first implementation removed the template block together with the panes, because both sat in
  one branch; the suite check written for the arm caught it (`3 entries, 0 panes, 0 templates`), the builder now takes the two
  decisions separately, and the check asserts that the no-panes document equals the with-panes one minus the pane block. Suite
  **171/171**, exit 0.
- **Restored** `withoutPanes: false` + `POST /__lab/reload`: the lab serves the 33 086-byte page again, 8 panes.
- **Does not establish** What the client is waiting for. Fourteen deliveries across seven sessions and nine structural variants, all
  accepted, none producing a model. The next step is not another body: it is to see the client's own decisions, which means either
  the trace (`Prop: %d, %s, path {%S}, value {%S}` - not written to any file this device keeps, F-053) or a genuine v9 page response
  from the real service, neither of which this lab can manufacture.

## F-059 The page cache holds five 205-byte pages, the E-008 control and three `{"probe":true}` bodies under the page's own key

- **Date** 2026-10-20 16:36 local · **Area** the client's response cache · **Method** mass storage read with
  `tools/phone-readout.ps1` (elevated, backup semantics), every `EdmCache` entry copied to
  `captures/phone-2026-10-20-mass-storage` and decoded here.
- **Why it was looked at** The home had stopped loading with **no request reaching the lab at all** between 16:03
  and 16:36, while the same phone was resolving update hosts through this lab's DNS - so the client was not
  failing at the network, it was not asking. A client that believes it already holds a page does exactly that.
- **Measured** 78 cache entries. Under the page's key (`Short\9\7f3c9a52...$48b1e555`, the page-cookie name)
  the client holds **eleven** documents: today's real 310 091-byte `<StorePage>`, one 55 373-byte page from
  2026-10-15 21:46, **five 205-210 byte `<StorePage>` documents** written 14:42-14:47 today, the **872-byte
  truncated control of E-008**, and - under `Short\0\og_storePages...`, the same request by URL - **three
  14-byte bodies that decode to `{"probe":true}`**, a JSON probe this lab no longer produces. A 205-byte
  StorePage and a 14-byte JSON body cannot draw a store, and nothing in this repository answers the page URL
  with either today.
- **What it changes** The register's page-side experiments all assumed the client was rendering the body it had
  just fetched. It keeps several bodies per key and has kept failures; which one it picks is unknown, and one
  of the candidates is a document this lab deliberately broke.
- **Not established** That a cached body is what it renders. That is answered by removing the nine bodies that
  cannot be a page and watching whether the client asks again - `tools/phone-clear-page-cache.ps1`, whose
  selection was verified on a reconstructed tree (9 files chosen, the 310 091-byte page and the 55 373-byte one
  kept). The run itself needs elevation; the first prompt was declined, so it is not done.

## F-060 The cache was not the gate: with the bad bodies removed the client asked again, was served a fresh page, and drew nothing

- **Date** 2026-10-20 16:44 local (14:44Z) · **Area** the client's response cache vs. the page delivery · **Method** F-059's
  removal run actually executed on the handset (`tools/phone-clear-page-cache.ps1`, elevated, **9 files removed**, the
  310 091-byte page and the 55 373-byte one kept), then the Store opened with `tools/watch.mjs` listening.
- **Measured** The client asked for the page **again** at 14:44:53Z - the first page request since 14:03 - and the lab answered
  `200`, **310 091 bytes**, `x-lab-protocol: storePages`, `x-lab-source: zinc:live store (203 apps)`. After it: **no image
  request, no application list**, and instead two configuration exchanges 28 s later
  (`/v8/Configuration/Stores/OEMStores/NOKIA` 14:45:21Z and `/v8/Configuration/Stores/MOStores/` 14:45:22Z, both `200`,
  `x-lab-protocol: configuration`, `x-lab-invented: 1`), then silence from 192.168.0.136.
- **Measured, second open - after the restart (14:47:17Z-14:47:33Z)** `tools/restart-lab.cmd` replaced the process at 14:46:25Z
  (pid 7240, all four listeners, first run of the source fix), and the next open is **not** the same silence: page `200`
  `310 091`, then four `/v8/catalog/queries?prefix=…` `502` in one second (the suggestion route with no handler, F-040), then the
  application list `200` `10 909`, then **six image requests, all `200` with real bitmaps** (`3 333`, `5 178`, `34 486` jpeg,
  `1 867`, `58 700`, `66 555` bytes), then the page **again** at 14:47:33Z. All six guids are `<editorialItem><image>` guids in the
  body just served - Files, Freda, Fantasia Painter, Foreca Weather, Fhotoroom, Face Mask - so the client resolved the **first
  pane's items** and fetched their art, which no delivery before this one produced. It then discarded the model and asked for the
  page a second time: F-056's loop, now with art in it.
- **What this closes** F-059's open question, and in the direction that removes a suspect: the client does not need to be
  starved of a cached body to ask. Five 205-byte StorePages, the E-008 control and the three `{"probe":true}` bodies were gone,
  the fresh request was answered with the document the lab believes in, and the outcome is the same silence as every delivery
  from F-052 to F-058. So the empty model is not "it rendered an old failure"; the failure is produced from the body just served.
- **What it opens** Two things sit in the window between the page and its re-request: the four `502`s on the suggestion route
  (`/v8/catalog/queries`, F-040 - a route this lab has never answered, in the same second the model is built) and the two
  configuration answers, which are the lab's **invention** (`x-lab-source: built: no capture of this endpoint exists`) and arrive
  *after* the page rather than before it, the reverse of the order E-008 and E-009 assumed. Neither is proven to matter; both are
  injected failures or inventions inside the loop.
- **Does not establish** Which of the two orders the client requires, or that the configuration body is at fault. It establishes
  only that the cache is excluded and that the configuration pair is what the client reaches for next.

## F-061 A lab that is green in the source can still be serving old code, so every code change ends in a restart

- **Date** 2026-10-20 16:46 local · **Area** how this project is operated, not the protocol · **Method** the search fix was green
  in `npm run selftest` while the running lab (pid 11712, started 16:01) still answered `q=f` with 50 apps and no
  `x-lab-query-match`.
- **Why it matters** `POST /__lab/reload` re-reads `config.json` only. Every change under `src/` reaches the device **only**
  after the process is started again, and a capture taken in between is attributed to code that is not in the repository.
- **Fixed by** `tools/restart-lab.cmd` (wrapper, raises UAC) -> `tools/restart-lab.ps1`: stop by **port** (80/443/8899 tcp,
  53 udp), never by command line - an elevated node shows an **empty** `CommandLine` to a non-elevated query, so a name-based
  kill finds nothing and reports success - refuse to touch a non-node holder (Windows ICS parks a `svchost` on `0.0.0.0:53`
  while the lab binds the LAN address, so port 53 has two owners and only one is the lab), wait for the ports to be free,
  start detached with a fresh log under `logs/`, wait for `/__lab/status`, and write the outcome to `logs/lab-restart.txt`.
- **Verified** The restart that produced pid 7240 reported `result OK` with all four listeners owned by it, and the same
  process then answered `q=f` with **8** apps (`x-lab-query-match: title-prefix`), no query with 50, `q=zzzz` with 0 - the
  first time the fix has been observed in the process that the phone talks to.

## F-062 The client walks the first pane and nothing else, and the application list asks for no art in either session

- **Date** 2026-10-20 16:47 local (14:47Z) · **Area** which part of the page the client resolves · **Method** the two sessions of the
  evening read the same way: every image guid the device requested matched against the body of the page and the body of the
  application list it had just been served.
- **Measured** Session `14-01-32`: **16** image requests, **16 of 16** guids present in the page as `<editorialItem><image>`,
  **0** present in the application list. Session `14-46-26`: **6** image requests, **6 of 6** editorial, **0** in the list. Every
  request is `imagetype=icon_small`. The six of the second session are the first pane's items - Files, Freda, Fantasia Painter,
  Foreca Weather, Fhotoroom, Face Mask - and the page is re-requested **10 s** after them (F-060).
- **What it says** The client resolves the **featured pane first** and gets its art, then discards the model and asks for the page
  again: the re-request sits between pane 1 and the rest, not at the end of the page. The application list's 17 rows never ask for
  an icon in either session, which retires the reading F-035 was pointing at - that a field in the list entry (`<k>`,
  `appListRank: 4`, or the missing bare `<title>`, `appListEntryTitle: false`) costs the list its art. The list asks for nothing
  because the client has already restarted before it lays the list out; the entry shape is not reached.
- **Does not establish** Why pane 1 ends the run. It is the first model the client builds and the first one it throws away, so the
  next variable belongs inside that pane rather than in the page as a whole.

## F-063 The one 5xx left in the page flow is a suggestion route nobody ever answered, and it is asked at open, not while typing

- **Date** 2026-10-20 16:50 local (14:50Z) · **Area** `/v8/catalog/queries` in the sequence that builds the home · **Method** the
  full tool battery run against the restarted lab (`selftest` 183/183, `rehearse` 44/44, `doctor`, `store:page`, `page:diff`,
  `verify-rootreg`, `canary`, `dnsprobe`, `analyze`, `sequence`), then every image guid of the evening's two sessions matched
  against the body that named it.
- **Measured: the battery** every check green before the change and **185/185** with the two checks added below. `page:diff`'s
  root-children difference against the archive is explained and not a defect: the archived root *is* the Atom feed, ours is a
  `<StorePage>` wrapping one, and the feed inside carries `a:updated` exactly as the archive does. `dnsprobe` needs
  `--server 192.168.0.220`: the lab binds the LAN address and never loopback, so `127.0.0.1:53` is silent by design.
- **Measured: the device, alone in the room** after the cache clear the handset re-requests the page **every 2.5-3 minutes** with
  nothing after it (`14:47:33Z`, `14:50:13Z`, `14:53:05Z`), so the loop is observable without an operator. On the one open
  that had to refetch art (14:47:17Z) it asked `/v8/catalog/queries?…&prefix=f` **four times in one second**, in the same second
  as the application list, *before* the page's art. **CORRECTION, 2026-10-20 18:0x:** the operator was typing in the search box at
  that moment (`prefix=f`, and `prefix=w` at 15:52:40Z is the same gesture), so this is **not** evidence that the route is asked
  without a human - it is exactly what F-040 said, asked *while typing*. The four-in-a-second is the retry of a failing request
  while the keyboard is still open, not a prefetch.
- **Measured: every link the page hands out resolves** each `editorialItem`'s `<link><target>` was requested from this PC: the five
  that name apps the page carries (Files, Freda, Fantasia Painter, Fhotoroom, Face Mask) answer `200`, `x-lab-protocol: appDetail`.
  (A `fetch` with a `Host` header is not a test here - Node drops it, the request lands on the loopback host and comes back `502`
  from the relay's own loop guard. `curl -H "Host: …"` is what proves it.)
- **Fixed** `/v[89]/catalog/queries` now has a route: an **empty** Atom feed with the catalog namespace, the feed's own
  `rel="self"`, `a:updated`, `a:title`, `a:id` and no entries, carrying `x-lab-protocol: suggestions`, `x-lab-prefix`,
  `x-lab-suggestions: 0`, `x-lab-source: built: no capture of this endpoint exists` and `x-lab-invented: 1`. Nothing is
  reconstructed - no reply to this endpoint exists anywhere - and "no suggestions" is the true answer to a prefix with nothing
  behind it. The reasoning is F-051's: an injected failure inside the window that builds the model is removed before anything
  else in that window is read.
- **Does not establish** That the four `502`s were what kept the page from drawing: they are asked **while the operator types in
  the search box**, never on the page retries. Fixing the route still matters - a search that answers `502` while the user types
  is a failure this lab injected on a path a human is using - but it is a defect of the **search** surface, not evidence about
  the home page. What the change establishes is narrower: the flow no longer contains a 5xx this lab injected.
- **Suite** two new checks: the suggestion route answers `200` with a feed and no `<a:entry>` and names its prefix; a request
  without a prefix is answered and says `x-lab-prefix: none`. **185/185**, exit 0.

## F-064 The search surface renders and the home does not, on the same client, in the same minute

- **Date** 2026-10-20 17:52 local (15:52Z) · **Area** what the client does with the page when the last 5xx is gone · **Method** the
  phone rebooted, the Store opened while the lab (pid 23312) answered `/v8/catalog/queries` with the empty feed of F-063; the
  session read with `sequence`-style extraction per client address.
- **Measured** 48 exchanges from `192.168.0.136`, and a shape no earlier session has: page `200` (310 076) -> **suggestions `200`**
  (705, `prefix=w`) -> application list `200` (17 299, with `q=`) -> **11 images** -> `appDetail /v9/catalog/apps/626c5f06…`
  **eight times** `200` -> `appCategories/windowsphone.Social` `200` (32 562) -> application list `200` (64 625, the 25 apps of that
  category) -> **11 more images** -> `appDetail /v9/catalog/apps/fab00e25…` four times `200`. Details and category paths had
  **never** been requested in any session before this one.
- **Who caused it - correction, and it is the point** the operator was **typing in the search box and tapping results** the whole
  time (`prefix=w`, `q=`, then a category chip, then details). So this is not the client wandering: the client **drew a search
  surface the operator could read, type into and tap**, and every one of those taps produced a request that the lab answered. On
  the same client, in the same minute, the **home page** is the surface that paints nothing. The register's earlier exclusions
  (F-052 to F-058) were read as "no follow-up request = no model"; a surface that draws does not have to ask for anything, so
  that inference was weaker than it looked.
- **Measured: the bitmaps are real** all **26** image responses read back - 19 from `bodies/`, 7 from `inlineBase64` - and checked by
  magic bytes: **24 PNG, 2 JPEG**, none WebP/AVIF. `content-length` and the bytes actually stored agree exactly (**471 098** = the
  sum of both sides), so nothing is truncated. The seven inline ones are the reason a first pass counted 19: reading only
  `body.file` reports an empty buffer, which is a reader's bug and not a capture's. So the art the client fetched is decodable by an
  8.1 device - the images are not the reason nothing is painted.
- **Measured: the screen** the operator reports the **home** drawing nothing, and reports browsing through searches - which is
  only possible on a rendered list. So the failure is specific to the hub page document this lab generates for
  `typeId=DynamicHub.Main`, not to the client's rendering, not to the art, and not to the entry shape: the list and the detail
  answer with the **same** `buildApplicationListFeed` builder whose entries draw there.
- **Confound, stated plainly** two things changed together: the suggestion route stopped answering `502`, and the phone rebooted.
  The clean comparison is the 16:47 open (cache cleared, no reboot, `queries` `502`, F-060): there the run stopped after six images
  and asked for the page again; here it goes on to details and a category. That is consistent with the `502` having been the gate,
  and it does not prove it.
- **What this moves** The question is no longer "does this client draw anything this lab serves" - it does - but "what does the
  hub page carry that a list and a detail do not, and that stops it being drawn". The difference is exactly the `<Panes>` block and
  the `<StorePage>` root: everything else in the page - entries, editorial items, applications, offers, images - is the same
  builder that renders on the search surface. The repeated `appDetail` (8x, then 4x) is the operator tapping, not a retry.
- **Does not establish** Why painting fails. That needs the client's own view state, which this device does not write anywhere
  readable (F-053), or a page response from the real service to diff against.

## F-065 The page root was the gate: rooted at `<a:feed>` the home draws, rooted at `<StorePage>` it never did

- **Date** 2026-10-20 17:58 local (15:58Z) · **Area** the home page document, and everything the register concluded about it ·
  **Method** one config value (`livestore.protocol.pageFormat`: `storePage` -> `atom`), applied with `POST /__lab/reload`, no
  restart, no code change, nothing else touched; then the Store was brought back to the home. The oracle was built an hour
  earlier by F-064: on this client the search list, the app detail and a category **draw**, and all three are flat `<a:feed>`
  documents from this same builder, so "the client cannot render what the lab serves" was already false.
- **Measured** With the same 15 panes, 15 entries, 203 applications and 309 745 bytes, only the document element changed - from
  `<StorePage>` to `<a:feed>` - and the handset **accepted the page and drew its title** where it had drawn nothing.
  **Correction, same evening:** the operator reports that what is visible is the Dynamic Hub **title only** - the panes and their
  items still render nothing. So this entry measures the **page envelope**, not the sections: the root was one gate, and the
  content is another. The word "drew the home" would have been an overclaim. The header said `x-lab-page-format: atom`,
  `x-lab-pane-placement: none`, so no capture can be read as the wrong arm. After it drew, the phone stopped re-requesting the
  page: **one** exchange after the change (the page itself at 15:58:41Z, 309 914 bytes) and silence where five evenings of
  deliveries had produced a page request every 2.5-3 minutes.
- **Why the register missed it for five evenings** Every page-side experiment from F-014 to F-058 was run on documents rooted at
  `<StorePage>`, so each one varied the *contents* of a document the client was already rejecting at its root: element spelling,
  pane position, pane kind, background art, data source, template layout, items inline against referenced, panes present against
  absent. Each was a real variable and each produced the same silence, which was read as "the contents do not matter". The one
  constant in all fourteen deliveries was the root. F-058 got closest - it served the archived *arrangement* (no panes, items at
  the root) - but kept the `<StorePage>` root, so it differed from the archive in the one place the archive could not be compared.
- **Why the parser's path table said otherwise, and what it is actually evidence of** The parser names `/Panes/Pane` and
  `/Templates/Template` as absolute paths, and `/StorePage` is in its store-page grammar, which is why the builder was rooted
  there and why `page:diff` reported the panes as carried. That table describes what the parser *can read out of a document it has
  accepted*; it never said which root the hub renderer accepts. The archived real page - an `<a:feed>` root - was the only witness
  about the root, and the register treated it as evidence about the *contents* instead.
- **The evidence this overrides** Nothing measured on the device is contradicted: every prior arm's "no follow-up request" was
  true, and the inference drawn from it ("the contents were rejected") is what this entry retires. The archived page is now read
  the way it was always written: root `<a:feed>`, `a:updated`, `a:title`, `a:id`, `impressionId`, then the entries.
- **Made the default** `pageFormat` now defaults to `atom` in `protocolSettings`, and `normalizePageFormat` falls back to `atom`
  for a value it does not recognise - a typo must land on the document the device draws, not on the one that was blank for five
  evenings. `storePage` and `panes` remain reachable by name: they are the arms the register measured, not the default.
- **The checks this moved, and why none were weakened** Four vocabulary checks failed the moment the default moved, and the cause
  was that they had been reading the *default* instead of naming the document they are about. They now build with
  `pageFormat: 'storePage'` explicitly and still assert every path of the parser's grammar, the `<StorePage>` root, the namespace
  declarations and the pane placement. A fifth check was added for the question the old four were silently asking: a builder call
  that names no format must produce the `<a:feed>` root the device drew. `tools/rehearse.mjs` asserted `root === 'StorePage'` as
  "rooted where the parser looks" - it now asserts `root === 'a:feed'`, with the comment recording that the old assertion was the
  opposite of what the handset wants. Suite **186/186**, exit 0; `rehearse` **44/44**.
- **Does not establish** That the panes render - they do not: the title is what appears. It also does not establish that the root
  was the *only* thing wrong, only that it was a gate, and that the fourteen arms before it were read through a closed door. The
  next single variable is the one the archive spells: `<a:feed>` **without** `<Panes>`, the section's `<a:entry>` at the root
  carrying its own `<editorialItems>` and `<applications>`, which is what the 2013 response actually is.

## F-066 Error 88675309 says what this endpoint is not: `/v9/catalog/storePages` requires the panes the archive does not have

- **Date** 2026-10-20 18:2x local · **Area** the home endpoint's own shape, now that the envelope is accepted (F-065) · **Method** the
  archive's arrangement served to the *same* endpoint: `pageFormat: atom` + `withoutPanes: true` (with the F-063-era builder fixed so
  the flag reaches the feed header), applied by a restart - pid 8596 - which served root `<a:feed>`, **0 `<Pane>`**, 1 `<Templates>`,
  15 `a:entry` at the root, 301 515 bytes.
- **Measured** The handset answered with **error 88675309** on screen. Reverted to `withoutPanes: false` the same minute (`POST
  /__lab/reload`, 309 745 bytes, 15 panes) and the accepted state came back: title drawn, no error.
- **What it establishes** The archived 2013 document is a response of `/v8/catalog/hubs?…&hub=games` - a **different endpoint**, from
  a different generation - and its arrangement (no panes, items hanging off root entries) is not what `/v9/catalog/storePages`
  accepts. This is the error F-058 reasoned about and the distinction F-058 missed: it served the archive's *arrangement* to an
  endpoint that never emitted that arrangement, kept the `<StorePage>` root, and read the silence as "the arrangement does not
  matter". The truth is narrower: for this endpoint the panes are **required**, and 88675309 is what it says when they are missing.
- **A useful side effect** An error code is a better instrument than silence. From here the client distinguishes three outcomes for
  a page: **error** (rejected at the envelope - the no-panes document), **title only** (accepted, sections refused - the panes
  present with an invented `<Type>col</Type>`), and **drawn**. The middle one is where the work is, and it is a state the register
  did not have before tonight.
- **Also fixed, and it mattered for the reading** `withoutPanes` was silently ignored whenever the document was an `<a:feed>`: the
  first attempt changed the flag and produced byte-identical output (309 745 both times), which would have been read as "the arm did
  nothing". The builder now drops the feed's pane block when the flag is set, and the suite asserts it (`panes=0, templates=1,
  entries present`). Suite **187/187**, exit 0.
- **Does not establish** Anything about the pane's own fields. That is the next variable and it is armed: `paneType: ""` - the
  `<Type>col</Type>` the panes carried is a value no capture supports, and with it removed the document is 309 505 bytes with
  `x-lab-pane-type: none`.
- **Result of that arm, same evening** The operator reopened the home and reports **the same title, nothing below it**: removing
  `/Type` from every pane changes nothing visible. So `/Type` is not what the hub renderer needs to place a pane - the field is
  read by the parser, but its presence or absence does not move the screen. The arm is still the served state (`x-lab-pane-type:
  none`), because reverting a variable that changed nothing would hide which document the last capture belongs to.
- **What is left of the pane, measured** Of the **12** paths `PANE_FIELDS` lists, the served pane carries **8**: `/Id`, `/Title`,
  `/DataSource/Type`, `/DataSource/Url`, `/CollectionId`, `/MaxItems`, `/MinItems` and (as an element) no more `/Type`. Absent:
  **`/SubType`** (@14004), `/BackgroundImage/id` (@14024), `/LiveTileUpdateInterval` (@14064), `/StoreObjectsForLiveTile`
  (@14248). `vocabulary.mjs` says plainly that the *paths* are evidenced and the **values** of `Type`/`SubType` are not, so the next
  probe is a value (`Collection`, the one with a delivery history, or a `SubType`), not another structural guess.

## F-067 The header is the feed's own `<a:title>`, so the client is reading and painting our document

- **Date** 2026-10-20 18:3x local · **Area** what the handset does with the accepted page · **Method** a spike with one value moved:
  `hubTemplate` `DynamicHub` -> `DynamicChart` (`whyNotATemplate` admits both), hot reload, device refetched at `16:31:36Z` and the
  capture confirms it received `<templateName>DynamicChart</templateName>`.
- **Measured** The header on the handset reads **`dynamichub.main-IT-WindowsPhone81`** - the feed's `<a:title>`, verbatim, down to
  the lower-case `d` and the mixed case of the locale. It did **not** follow the template name.
- **What it establishes** The client parses the document, reaches the feed header and **paints it**, and the string it paints is
  ours. That is stronger than "the page is accepted": a document this lab built is on screen, with a value this lab chose. The
  template name is not what labels the page, so `hubTemplate` is a rendering hint and not a title source.
- **A consequence to fix, not a finding** The label is the `typeId`-derived string, which is why it looks like a machine name. A
  nicer title is a one-line change in the page builder, and now we know it lands on the screen.
- **Does not establish** Anything about the panes, which remain the open question: the header paints and the pane area is empty.
  The next variable is the pane's own vocabulary - `/SubType` and the `Type` *values*, neither of which any capture evidences -
  or the template block's numbers, which are evidenced.
