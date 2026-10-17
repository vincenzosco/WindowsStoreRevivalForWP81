# Maintenance

How to keep this lab working and how to re-measure it when something moves. The register of
what is currently known is [`FINDINGS.md`](FINDINGS.md); this file is the work around it.

## The one rule

**One variable at a time, and write down the value you replaced.** The page this lab serves is
described by about six settings in `config.json` (`pageFormat`, `templateType`, `templateTypeForm`,
`hubTemplate`, `pageSize`, `catalogFile`), and every one of them changes the bytes the device
receives. Two at once and the device's answer belongs to neither.

Two more settings describe the **application list** rather than the page, and neither of them can
move the page's bytes: `appListRank` (the `<k>` the first entry carries; `''` writes none) and
`appListEntryTitle` (the bare `<title>` a list entry used to carry and neither archived feed entry
has). They were armed from `src/store/fixtures/archive/real-apps-feed-*.xml` - see F-021 and F-022 in
[`FINDINGS.md`](FINDINGS.md), and `applicationEntryXml` in `src/store/catalog-feed.mjs`.

Two switches describe endpoints rather than the page, and both are off in code so that a config which
does not mention them behaves as the lab did before: `serve: "control-broken"` answers the page
endpoints with a deliberately unparseable body (`controlFile`), and `configuration.enabled` answers
the `/v8/Configuration/Stores/...` requests the phone makes before the page - which, with it off,
fall through to passthrough and come back `502 upstream_loop`. Read what each is for, and what it
does **not** establish, in `FINDINGS.md` under E-008 and E-009. The control refuses to serve a
fixture that has been repaired, so a green suite is the only proof that the control is still a
control.

Changing a setting needs **no restart**: the protocol reads its settings and its catalog file on
each request.

```bash
# after editing config.json or a catalog fixture
curl -X POST http://<lab address>:8899/__lab/reload
```

## The commands that prove things

| Command | What it proves | Needs |
| --- | --- | --- |
| `npm run selftest` | 128 end-to-end checks: the lab's own behaviour, the page's shape, the application list's entry shape, the configuration answer, the malformed-page control, the mass-storage registry bytes, that the page carries every path of the parser's page grammar, and that a capture is attributed to the right client and device | nothing but a working upstream resolver - one check forwards `example.com` to the real network and times out if it is down (footgun 9) |
| `npm run read-vocabulary` | One check per name and path in `src/store/vocabulary.mjs` - page types, template types, the parser's whole page-grammar run, every byte offset - still present on the phone. The tool prints the count | phone in mass storage, elevated |
| `npm run store:page` | What the page *carries* right now, read back from the file that was written | nothing |
| `npm run doctor` | One-screen state: config, listeners, CA, device traffic, the next step | lab running |
| `npm run watch` | Live device-only traffic, answered 200s and refused handshakes named | lab running |
| `npm run rehearse` | The whole chain against the real host names, without the device | nothing |
| `npm run make-rootreg -- --verify` | The generated registry blob is byte-identical to what Windows writes | nothing |
| `npm run analyze` | Protocol report from the last capture session: **who asked** (per client address, this PC marked) and **which device** (per `x-wp-device-id`), then the endpoints with the clients that reached them | a capture |
| `npm run sequence` | What one Store open looked like **in order**, per device: every exchange, then the counts the two open experiments are read by - configuration requests per store with their retries, page deliveries, and what came after the first page. `--session <name>`, `--device <id prefix>`, `--compare <a> <b>`, `--json`. This is the reading `analyze` cannot give: a census says who asked, not what happened next | a capture |
| `powershell -File tools/find-store-config.ps1` | Where the `/v8/Configuration` URL is built: byte search (ASCII and UTF-16LE) of the mounted volume for `mpcVersion`, `OEMStores`, `MOStores`, `v8/Configuration`, `LKGOEMStoreConfigOverride` and `marketplaceedgeservice`, every hit with its offset, every unreadable file named. Needed because `ZMarketplace.dll` holds none of those tokens (E-009) | phone in mass storage; `-Deep` also walks `Data\Users\Public` and the Unistore cache |
| `npm run analyze -- --all-sessions` | The same census over every session at once, plus `captures/census-report.md` - the reading that answers "how many devices are in this capture" (F-023) | a capture |
| `powershell -File tools/phone-readout.ps1` | What the device kept (`EdmCache`, each entry with size, SHA-256 and its `<a:updated>` values), the crash drop under `Public\Documents\Debug`, the ACLs that decide what stays out of reach, and everything under `Data` touched since `-Since`. Its first section also prints **which volume it chose, and on what evidence** - read that line, and the `Accesso negato` lines, before the counts (footguns 7, 8) | phone in mass storage, **elevated** |

Run `npm run doctor` first when something looks broken: it reports the missing piece by name
instead of leaving you to infer it, and it distinguishes "the device never reached us" from
"the device reached us and was refused".

## Before and after a change

**Before**

1. `npm run selftest` - a failure you did not cause is not a failure you should debug.
2. Note the current value of the single setting you are about to change, and the command that
   puts it back.
3. If the change touches the phone's filesystem, take the copy first: `ca/phone-backups/` holds
   the hives as found, and both are kept on purpose (mounting a hive rewrites its bytes even when
   nothing inside changed).

**After**

1. `npm run selftest` again, and read the failures rather than the count.
2. If the change affects the page, `npm run store:page` and look at what it carries - the bytes,
   the root element, the template type, and how many items sit inside `<Panes>`.
3. If the change is meant to change the device's behaviour, the only measurement that counts is
   the device's next request: `npm run watch`, and read the capture for what it asks *after* the
   answer - per `client.address` and `user-agent`, never in aggregate (footgun 4). A page-shaped
   experiment runs itself on every Store open, so its result is usually **already in the capture**
   before anybody goes looking for it: E-001 was answered by six deliveries nobody had read (F-014).
4. Record the outcome as a finding, including the negative result. A variable that did not move
   the device is the most valuable line in the register, because it removes a suspect.

## What rots, and how to catch it

| Thing | How it rots | How to catch it |
| --- | --- | --- |
| The vocabulary (`src/store/vocabulary.mjs`) | The offsets were read off **one** phone. Another model, another OS build or another Store client moves them | `npm run read-vocabulary` - it fails on drift rather than reporting success |
| The root CA | A regenerated CA has a new thumbprint, and the device still trusts the old one | `npm run doctor` prints the thumbprint; the phone's hive has the one that was installed |
| The demo catalog | GUIDs are derived from the entry ids; a renamed app silently changes the page the device is compared against | `npm run selftest` asserts each app is named exactly once as a link and once as a record |
| The fixtures | An edited fixture makes "identical to what we served" meaningless | compare against a committed fixture, never against a copy taken earlier in the same session |
| The archived page | It is the `hub=games` page of an older generation, so it changes the page type, the grammar and the template's owner all at once | it is served with `x-lab-archive-warning` headers saying so; `npm run rehearse` fails if it is served without them |
| The device's clock vs ours | `EdmCache` stamps are local, the capture index is UTC - two hours apart here | compare like with like before concluding anything moved |
| The drive letter of the phone | It is a property of the PC session: `G:` one day, `H:` the next | discover the volume by looking for `\Data\SharedData\EdmCache`, never by assuming a letter |

## The two device modes, and what each one allows

**Normal mode** (phone booted, USB or Wi-Fi): the phone talks. This is the only mode in which
anything can be *served* and in which the device's behaviour is measurable at all. The lab must
be running, the phone's Wi-Fi DNS must point at the lab, and the CA must already be trusted -
otherwise `npm run watch` shows handshakes refused rather than requests intercepted.

**Mass storage mode** (phone halted, volume mounted as a drive): the phone is a filesystem and
nothing else. No request can be served in this mode. What it allows is the device's own state:
the registry hive (F-010), the response cache (F-003), the logs, and the files under
`Data\Users\Public`. Two things to keep straight:

- Some trees answer only to an **elevated** prompt - `Windows\System32\config` (SYSTEM and
  Administrators only) and `Data\SharedData\EdmCache`, which denied a normal listing on
  2026-10-15 while the earlier session had read it. `Data\Users\DefApps\APPDATA` answers `Accesso
  negato` even elevated (F-004), and getting past that means changing ownership: a write to the
  device, and a decision, not a mechanic.
- Eject the volume and reboot the phone afterwards: the certificate store is read at boot, and a
  mounted hive stays locked until it is unloaded.

⚠️ Nothing in this project runs elevated by default, and nothing stores elevated credentials.
Keep it that way: no administrator password in a script, a config file or a document, and no
scheduled task left behind after an elevated read.

## Footguns learned the hard way

1. **`npm run selftest` wipes `.selftest/`.** Every readout, every copy taken off the phone and
   every comparison written there is gone after a suite run - which is exactly what happened on
   2026-10-15, two hours after the readouts were taken. Keep the *command* in the register and the
   *script* under `tools/`; treat `.selftest/` as scratch.
2. **A scheduled task cannot be created at a higher run level from a non-elevated prompt**
   (`schtasks /create /rl HIGHEST` answers `Accesso negato`), so knowing the administrator
   password does not remove the UAC click: the consent dialog wants a click, not a credential.
   Plan the elevated passes for when somebody is at the machine.
3. **`tools/phone-readout.ps1` targets Windows PowerShell 5.1**, which is what ships with
   Windows, and 5.1 has two traps the Internet's examples will walk you into: `$a ? $b : $c` is a
   **parse error** (it arrived in PowerShell 7), and **variable names are case-insensitive**, so
   `$out` and `$Out` are the same variable - the first version of that script assigned the report
   path over the output directory and created a directory named `phone-readout.txt`. Check the
   file parses before shipping it:

   ```powershell
   $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("$PWD\tools\phone-readout.ps1", [ref]$null, [ref]$e); $e
   ```

4. **A capture holds this PC's own traffic as well as the device's.** `npm run rehearse` and every replay
   run through the lab and land in `captures/`, and the aggregate report counts them: 75 of the 113
   exchanges in the 2026-10-15 session were ours, and reading the summary alone made the device look like
   it was asking for six hosts it never asked for (F-012). **Sort before reading**, by `client.address`:
   every address of this machine means us, and it is the *only* field that does. **The user agent is not a
   marker** - `tools/rehearse.mjs` replays the phone's requests with the phone's own agent, so 308 354 of
   this PC's 329 304 exchanges carry `ZDM/4.0; Windows Mobile 8.1` and the marker this note used to point
   at (`wp8-store-lab-rehearsal`) covers 338 of them (F-023, and `npm run selftest` now fails if the rule
   is written the other way). `Windows Phone Search` and `IEMobile` are other *system components*, which is
   a statement about what a request is for, not about which machine sent it. `npm run watch` drops this
   machine's addresses in its DNS section; `npm run analyze` reports who asked, per address and per device
   id, and is where the confusion came from when it reported only the aggregate.
5. **Do not redirect the suite's output into `.selftest/`.** That directory is deleted by the run itself,
   so the log of a green run disappears with it. Write logs to `%TEMP%` or anywhere outside the tree.
6. **Our own inspection tools build a slightly different page than the device is served.** `npm run
   store:page` and `npm run rehearse` use a query reconstructed from the capture, which omits the six
   `Flight`/`SEG0`-`SEG5` parameters the phone sends (F-013): 116 bytes, all of them in the echoed self
   link. The live handler echoes the real request, so this is a difference in what *we* look at, not in
   what the device gets - worth knowing before a difference in the bytes is read as a difference in the
   response.
7. **A probe that discovers its own target can discover the wrong one, silently.** `tools/phone-readout.ps1`
   scored `\Windows\System32\config\SOFTWARE` as a phone marker in an earlier version. A normal prompt
   cannot see that path on this PC; an **elevated** one can - so the elevated run, the only mode the tool
   exists for, matched this machine's own Windows installation, chose `C:`, and reported the phone's cache,
   logs and ACLs as **absent**. *Absent reads as proof*, which is what made it dangerous rather than merely
   wrong. The fix weights phone-only structure (`EdmCache` 3, `\Data\Users\Public` 2, `\Data\SharedData` 1,
   the hive **0** - printed, never decisive), excludes `$env:SystemDrive` outright, and prints every
   volume's score and the markers that produced it, so the choice can be falsified from the report alone
   (F-016). Generalise: **when a tool guesses, make it print its evidence** - and when reading a report,
   read the selection line before the counts.
8. **An unreadable tree prints as an empty one.** `Data\SharedData` grants `Administrators` and nobody else,
   and `Data\Users\DefApps\APPDATA` grants the app owner and not even Administrators (F-004), so a sweep run
   from an ordinary prompt answers *0 files touched* whether or not anything moved: the file the elevated pass
   found had been written inside the unelevated run's own window, in a directory that run reported as
   `Accesso negato` (E-002). The tool prints that denial where the entries would be; the habit that matters is
   **reading the permission line before the count line**, and never quoting a count taken from a tree the
   prompt could not enumerate.
9. **One suite check leaves the machine.** `dns: unrelated names still resolve normally` starts the lab's DNS
   on a test port and asks it to forward `example.com`, which is deliberate - the point is that a name the lab
   does *not* hijack is still resolvable through it - but it makes the suite non-hermetic: with the upstream
   resolver slow or unreachable the check fails while nothing in the repository changed (seen once on
   2026-10-15, passing on the next run, `99/99`). Re-run before debugging it, and read the detail line - it
   prints the answers it got, so `no upstream available` reads differently from a wrong answer.
10. **A reader that holds a capture in one string reports a capture that is not there.** `readFileSync(file,
   'utf8')` on an index or a DNS log throws `ERR_STRING_TOO_LONG` once the file passes Node's maximum string
   length, and every reader that caught that and fell back to a count answered **zero exchanges** - a session's
   own record of what the device did, reported as "nothing intercepted yet", at exactly the sizes where the
   capture matters. `captures/dns-queries-*.jsonl` is the file that does it first here (19 615 records over three
   daily files). Use `readJsonl` from `src/capture.mjs`, which chunks and never joins the whole file; a torn last line
   is skipped, a blank one ignored. Both readers in `tools/analyze-captures.mjs` are written that way, and
   "the capture is empty" is now a sentence no tool in this repository can say without having read it.

## Data and what is safe to keep

| Path | Content | In the repository? |
| --- | --- | --- |
| `captures/` | Full request/response sessions, including headers and bodies | **No** - and it can contain account tokens: never publish it |
| `ca/` | The lab's CA, its **private key** and the leaf certificates | No |
| `.selftest/` | Readouts, copies taken off the phone, comparison output | No — and ⚠️ **`npm run selftest` deletes this directory on every run** (`fs.rmSync` at the top of the suite). Never keep the only copy of anything here: re-take it with the command that produced it |
| `%TEMP%\wp-massstorage\*.strings.txt` | String runs of the phone's `ZMarketplace.dll` and `ZuneAssets480x800.dll`, extracted by hand on 2026-10-15 | No - and it is the only copy of the client's strings that does not need the phone. Windows may clear `%TEMP%`; the durable route is `npm run read-vocabulary` with the phone mounted. Anything read out of these dumps belongs in `src/store/vocabulary.mjs`, with its offset, or it is gone with them |
| `%TEMP%\wp-massstorage\readouts-<date>\*.txt` | Readout reports copied **out of `.selftest/`** before a suite run, hash-compared to the original - the 2026-10-15 pair is `unelevated-2059.txt` and `elevated-2105.txt` | No, and no more durable than `.selftest/` (Windows may clear `%TEMP%`): keep it as a courtesy to the next reader, never as the evidence. The evidence is the command and the numbers in `FINDINGS.md` |
| `src/store/fixtures/` | The catalog and the archived page the page is built from | Yes - this is the baseline |
| `docs/` | This register | Yes |

A finding that depends on a file under the first three must stay re-derivable from its command:
those directories do not travel with the repository.

## Re-measuring after the device changes

A different phone, a different OS build or a reset Lumia invalidates the vocabulary first and
everything else second. In order:

1. `npm run read-vocabulary` - the offsets are the most device-specific knowledge in the project,
   and the command exists to fail loudly when they move.
2. Install the root CA by the mass-storage route (`README.md`) and verify it as that section says:
   read the entry back, compare hashes, read the hive off the phone a second time.
3. `npm run selftest`.
4. Point the phone's Wi-Fi DNS at the lab, reboot it, and open the Store with `npm run watch`
   running. From here the question is the same one F-005 leaves open, and the answer is the
   device's next request.
5. Write down what changed about the device in the header of `FINDINGS.md`, and add a finding for
   every conclusion that no longer holds.

## When a finding is overturned

Do not delete it. Mark it `SUPERSEDED by F-###` under its title, keep the method and the raw
numbers, and put the reason in one sentence. The register's value is not that it is right - it is
that the next person can re-run the method and see which of the two answers the device gives now.

## The measurement template

```
F-### <the question, as a sentence>
Date / Area
Method     : the exact command, and the device state it needed
Evidence   : path, byte count, hash, timestamp (say local or UTC)
Conclusion : what it shows
Does not   : what it does not establish
```
