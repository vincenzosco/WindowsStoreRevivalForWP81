# Maintenance

How to keep this lab working, and how to measure it again when something moves. What we know
right now is in [`FINDINGS.md`](FINDINGS.md). This file is the work around that register.

## The one rule

**Change one variable at a time, and write down the value you replaced.** Six settings in
`config.json` describe the page this lab serves (`pageFormat`, `templateType`, `templateTypeForm`,
`hubTemplate`, `pageSize`, `catalogFile`). Every one of them changes the bytes the device gets.
Change two at once and the device's answer belongs to neither change.

Two more settings describe the **application list**, not the page. Neither can move the page's
bytes: `appListRank` (the `<k>` the first entry carries, and `''` writes none) and
`appListEntryTitle` (the bare `<title>` a list entry used to carry, which neither archived feed
entry has). We took both from `src/store/fixtures/archive/real-apps-feed-*.xml`. See F-021 and
F-022 in [`FINDINGS.md`](FINDINGS.md), and `applicationEntryXml` in `src/store/catalog-feed.mjs`.

Two other switches describe endpoints, not the page. Both are off in code, so a config that never
mentions them behaves as the lab did before. `serve: "control-broken"` answers the page endpoints
with a body no parser can read (`controlFile`). `configuration.enabled` answers the
`/v8/Configuration/Stores/...` requests the phone makes before the page; with it off they fall
through to passthrough and come back `502 upstream_loop`. Read what each one is for, and what it
does **not** establish, in `FINDINGS.md` under E-008 and E-009. The control will not serve a
fixture that has been repaired, so a green suite is the only proof that the control is still a
control.

Changing a setting needs **no restart**. The protocol reads its settings and its catalog file on
every request.

```bash
# after editing config.json or a catalog fixture
curl -X POST http://<lab address>:8899/__lab/reload
```

Changing **code** needs a restart, and nothing else will do. `/__lab/reload` re-reads `config.json`
and stops there, so a fix that passes `npm run selftest` may still not be the code the phone is
talking to (F-061). One command does it, and it raises its own UAC prompt:

```bat
tools\restart-lab.cmd
```

It stops the copy that owns 80/443/8899 and 53. It finds that copy by port, because an elevated
node reports an empty command line to a non-elevated query, so a kill by name silently finds
nothing. Then it starts a detached copy with a fresh log under `logs/`, waits for `/__lab/status`,
and writes the outcome to `logs/lab-restart.txt`. Read the `result` line: `OK` means the new pid
owns every listener.

## The commands that prove things

| Command | What it proves | Needs |
| --- | --- | --- |
| `npm run selftest` | 190 end-to-end checks: the lab's own behaviour, the page's shape, the application list's entry shape, the configuration answer, the malformed-page control, the mass-storage registry bytes, that the page carries every path of the parser's page grammar, and that a capture is attributed to the right client and device | nothing but a working upstream resolver - one check forwards `example.com` to the real network and times out if it is down (footgun 9) |
| `npm run read-vocabulary` | One check per name and path in `src/store/vocabulary.mjs` - page types, template types, the parser's whole page-grammar run, every byte offset - still present on the phone. The tool prints the count | phone in mass storage, elevated |
| `npm run store:page` | What the page *carries* right now, read back from the file that was written | nothing |
| `npm run trace:install` | What one attempt to install an app asked for: every exchange from the device in order, every name it resolved, and - the column that matters - the names it resolved that the lab **never answered**, i.e. the traffic that went to the real network. `--session`, `--device`, `--since HH:MM`, `--json`. Read this before deciding which host to intercept next | a capture |
| `GET /__lab/images` | How many images the CDN handler served, per `imagetype`, with distinct guids and the last request - counted in the handler, so it does not need capture to be on. A count of responses: the screen is the only witness to what the device drew | lab running |
| `npm run page:diff` | Whether the page carries the constructs the client's parser names: every `PAGE_PARSE_PATHS` entry and the first pane's own field map, each reported as spelled exactly, carried under a prefix only, or missing, beside the archived real response. Reads the document through the real router, so it is the response the device would get, not a reconstruction | nothing |
| `npm run doctor` | One-screen state: config, listeners, CA, device traffic, the next step | lab running |
| `npm run watch` | Live device-only traffic, answered 200s and refused handshakes named | lab running |
| `npm run rehearse` | The whole chain against the real host names, without the device | nothing |
| `npm run make-rootreg -- --verify` | The generated registry blob is byte-identical to what Windows writes | nothing |
| `npm run analyze` | Protocol report from the last capture session: **who asked** (per client address, this PC marked) and **which device** (per `x-wp-device-id`), then the endpoints with the clients that reached them | a capture |
| `npm run sequence` | What one Store open looked like **in order**, per device: every exchange, then the counts the two open experiments are read by - configuration requests per store with their retries, page deliveries, and what came after the first page. `--session <name>`, `--device <id prefix>`, `--compare <a> <b>`, `--json`. This is the reading `analyze` cannot give: a census says who asked, not what happened next | a capture |
| `powershell -File tools/find-store-config.ps1` | Where the `/v8/Configuration` URL is built: byte search (ASCII and UTF-16LE) of the mounted volume for `mpcVersion`, `OEMStores`, `MOStores`, `v8/Configuration`, `LKGOEMStoreConfigOverride` and `marketplaceedgeservice`, every hit with its offset, every unreadable file named. Needed because `ZMarketplace.dll` holds none of those tokens (E-009) | phone in mass storage; `-Deep` also walks `Data\Users\Public` and the Unistore cache |
| `npm run analyze -- --all-sessions` | The same census over every session at once, plus `captures/census-report.md` - the reading that answers "how many devices are in this capture" (F-023) | a capture |
| `powershell -File tools/phone-readout.ps1` | What the device kept (`EdmCache`, each entry with size, SHA-256 and its `<a:updated>` values), the crash drop under `Public\Documents\Debug`, the ACLs that decide what stays out of reach, and everything under `Data` touched since `-Since`. Its first section also prints **which volume it chose, and on what evidence** - read that line, and the `Accesso negato` lines, before the counts (footguns 7, 8) | phone in mass storage, **elevated** |

When something looks broken, run `npm run doctor` first. It names the missing piece instead of
leaving you to guess, and it tells "the device never reached us" apart from "the device reached us
and was refused".

## Before and after a change

**Before**

1. `npm run selftest`. A failure you did not cause is not a failure you should debug.
2. Write down the value of the one setting you are about to change, and the command that puts it
   back.
3. If the change touches the phone's filesystem, copy it first. `ca/phone-backups/` holds the
   hives as we found them, and both are kept for a reason: mounting a hive rewrites its bytes
   even when nothing inside changed.

**After**

1. `npm run selftest` again, and read the failures, not the count.
2. If the change affects the page, run `npm run store:page` and look at what it carries: the bytes,
   the root element, the template type, and how many items sit inside `<Panes>`. Then run
   `npm run page:diff`, which asks the same question of the client's own parser. A `missing` there
   is a defect the eye would not catch.
3. If the change is meant to change what the device does, the only measurement that counts is the
   device's next request. Run `npm run watch` and read the capture for what it asks *after* the
   answer. Sort by `client.address` and `user-agent`, never read the aggregate (footgun 4). A page
   experiment runs itself on every Store open, so its result is usually **already in the capture**
   before anyone goes looking: six deliveries nobody had read answered E-001 (F-014).
4. Write the outcome down as a finding, negative results included. A variable that did not move
   the device is the most useful line in the register, because it removes a suspect.

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

**Normal mode** (phone booted, USB or Wi-Fi): the phone talks. Only in this mode can anything be
*served*, and only here is the device's behaviour measurable at all. The lab has to be running,
the phone's Wi-Fi DNS has to point at it, and the CA has to be trusted already. Otherwise
`npm run watch` shows refused handshakes instead of intercepted requests.

**Mass storage mode** (phone halted, volume mounted as a drive): the phone is a filesystem and
nothing more. Nothing can be served in this mode. What you get is the device's own state: the
registry hive (F-010), the response cache (F-003), the logs, and the files under
`Data\Users\Public`. Two things to keep straight:

- Some trees answer only to an **elevated** prompt: `Windows\System32\config` (SYSTEM and
  Administrators only) and `Data\SharedData\EdmCache`, which refused a normal listing on
  2026-10-15 although an earlier session had read it. `Data\Users\DefApps\APPDATA` answers
  `Accesso negato` even when elevated (F-004). Getting past that means changing ownership, which
  is a write to the device: a decision, not a mechanic.
- Eject the volume and reboot the phone afterwards. The certificate store is read at boot, and a
  mounted hive stays locked until it is unloaded.

⚠️ Nothing in this project runs elevated by default, and nothing stores elevated credentials.
Keep it that way. No administrator password in a script, a config file or a document, and no
scheduled task left behind after an elevated read.

## Footguns learned the hard way

1. **`npm run selftest` wipes `.selftest/`.** Every readout, every copy taken off the phone and
   every comparison written there is gone after a suite run. That is what happened on 2026-10-15,
   two hours after the readouts were taken. Keep the *command* in the register and the *script*
   under `tools/`. Treat `.selftest/` as scratch.
2. **A scheduled task cannot be created at a higher run level from a non-elevated prompt.**
   `schtasks /create /rl HIGHEST` answers `Accesso negato`, so knowing the administrator password
   does not save you the UAC click: the consent dialog wants a click, not a credential. Plan the
   elevated passes for a moment when somebody is at the machine.
3. **`tools/phone-readout.ps1` targets Windows PowerShell 5.1**, the version that ships with
   Windows. It has two traps that examples on the internet will walk you into. `$a ? $b : $c` is a
   **parse error**, because the ternary arrived in PowerShell 7. And **variable names are
   case-insensitive**, so `$out` and `$Out` are the same variable: the first version of that script
   assigned the report path over the output directory and created a directory named
   `phone-readout.txt`. Check that the file parses before you ship it:

   ```powershell
   $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile("$PWD\tools\phone-readout.ps1", [ref]$null, [ref]$e); $e
   ```

4. **A capture holds this PC's traffic as well as the device's.** `npm run rehearse` and every replay go
   through the lab and land in `captures/`, and the aggregate report counts them: 75 of the 113
   exchanges in the 2026-10-15 session were ours, and the summary on its own made the device look like
   it asked for six hosts it never asked for (F-012). **Sort by `client.address` before reading.**
   Every address of this machine is us, and that is the *only* field that tells you.
   **The user agent is not a marker.** `tools/rehearse.mjs` replays the phone's requests with the
   phone's own agent, so 308 354 of this PC's 329 304 exchanges carry `ZDM/4.0; Windows Mobile 8.1`,
   and the marker this note used to point at (`wp8-store-lab-rehearsal`) covers 338 of them (F-023;
   `npm run selftest` now fails if the rule is written the other way). `Windows Phone Search` and
   `IEMobile` are other *system components*: that says what a request is for, not which machine sent
   it. `npm run watch` drops this machine's addresses from its DNS section, and `npm run analyze`
   reports who asked per address and per device id. Its aggregate-only report is where the confusion
   started.
5. **Do not redirect the suite's output into `.selftest/`.** The run deletes that directory, so the
   log of a green run goes with it. Write logs to `%TEMP%` or anywhere outside the tree.
6. **Our own inspection tools build a slightly different page than the device is served.**
   `npm run store:page` and `npm run rehearse` use a query rebuilt from the capture, and it leaves
   out the six `Flight`/`SEG0`-`SEG5` parameters the phone sends (F-013): 116 bytes, all of them in
   the echoed self link. The live handler echoes the real request, so this is a difference in what
   *we* look at, not in what the device gets. Worth knowing before a byte difference is read as a
   difference in the response.
7. **A probe that discovers its own target can silently discover the wrong one.** In an earlier version,
   `tools/phone-readout.ps1` scored `\Windows\System32\config\SOFTWARE` as a phone marker. A normal
   prompt cannot see that path on this PC, but an **elevated** one can, so the elevated run (the only
   mode the tool exists for) matched this machine's own Windows installation, chose `C:`, and reported
   the phone's cache, logs and ACLs as **absent**. *Absent reads as proof*, and that is what made the
   bug dangerous instead of merely wrong. The fix weights phone-only structure (`EdmCache` 3,
   `\Data\Users\Public` 2, `\Data\SharedData` 1, the hive **0**, printed and never decisive), excludes
   `$env:SystemDrive` outright, and prints every volume's score with the markers behind it, so the
   choice can be falsified from the report alone (F-016). The general rule: **when a tool guesses, make
   it print its evidence**, and when you read a report, read the selection line before the counts.
8. **An unreadable tree prints as an empty one.** `Data\SharedData` grants `Administrators` and nobody
   else, and `Data\Users\DefApps\APPDATA` grants the app owner and not even Administrators (F-004). A
   sweep from an ordinary prompt therefore answers *0 files touched* whether or not anything moved: the
   file the elevated pass found had been written inside the unelevated run's own window, in a directory
   that run reported as `Accesso negato` (E-002). The tool prints that denial where the entries would be.
   The habit that matters is **reading the permission line before the count line**, and never quoting a
   count from a tree the prompt could not enumerate.
9. **One suite check leaves the machine.** `dns: unrelated names still resolve normally` starts the
   lab's DNS on a test port and asks it to forward `example.com`. That is on purpose: a name the lab
   does *not* hijack should still resolve through it. It also makes the suite non-hermetic. If the
   upstream resolver is slow or unreachable, the check fails while nothing in the repository changed
   (seen once on 2026-10-15, passing on the next run, `99/99`). Re-run before debugging it, and read
   the detail line: it prints the answers it got, so `no upstream available` reads differently from a
   wrong answer.
10. **A reader that holds a capture in one string reports a capture that is not there.**
   `readFileSync(file, 'utf8')` on an index or a DNS log throws `ERR_STRING_TOO_LONG` once the file
   passes Node's maximum string length. Every reader that caught that and fell back to a count then
   answered **zero exchanges**: a session's own record of what the device did, reported as "nothing
   intercepted yet", at exactly the sizes where the capture matters. `captures/dns-queries-*.jsonl`
   is the file that hits it first here (19 615 records over three daily files). Use `readJsonl` from
   `src/capture.mjs`, which chunks and never joins the whole file. It skips a torn last line and
   ignores a blank one. Both readers in `tools/analyze-captures.mjs` are written that way, so "the
   capture is empty" is now a sentence no tool here can say without having read it.

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

If a finding depends on a file under the first three, it has to stay re-derivable from its command.
Those directories do not travel with the repository.

## Re-measuring after the device changes

A different phone, a different OS build or a reset Lumia invalidates the vocabulary first, and
everything else after it. In this order:

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
numbers, and give the reason in one sentence. The register is valuable because the next person
can re-run the method and see which of the two answers the device gives now, not because every
entry turned out to be right.

## The measurement template

```
F-### <the question, as a sentence>
Date / Area
Method     : the exact command, and the device state it needed
Evidence   : path, byte count, hash, timestamp (say local or UTC)
Conclusion : what it shows
Does not   : what it does not establish
```
