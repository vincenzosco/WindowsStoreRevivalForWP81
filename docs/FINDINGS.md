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
| Checks in the suite | 147, all passing | `npm run selftest`, 2026-10-17 |
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
- **The candidates left, ranked, with what each rests on**
  1. **A pane field that is wanted and absent** - `BackgroundImage/id` first, because a hub tile draws art and the
     pane map names it (@14024). Evidence that it is required: none. Evidence that it is used at all: the name is
     in the pane's own property map. This is the next probe and it is one variable: write a
     `<BackgroundImage><id>urn:uuid:…</id></BackgroundImage>` into each pane with a guid this lab mints, which the
     image endpoint now answers for any guid (`F-031`).
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
