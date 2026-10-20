# Windows Phone 8.1 Store revival — on-device patcher design

Date: 2026-10-15
Status: superseded the same day. The app this document designs was built, measured on the
device, then removed from the repository. What follows is the record of that attempt and of
what it measured. None of it is a way to do anything today. The route in use is mass storage
mode, in `README.md`.

## Removal (2026-10-15, after the measurements below)

The operator asked for the app to come out of the repo. The measurements already argued for
it. On this build the runtime refuses native calls from app code, so an app can neither read
nor write the device certificate store. What was left of the app's job was handing a file to
the phone's own console. That is a cable and a boot away from the shorter path: editing the
phone's registry hive on this PC, with its filesystem mounted as a drive.

Removed: `StorePatcher/` (the solution and project) and `tools/app.mjs` (the patch set, XAP
build, USB deploy, `push-ca`, toolchain probe), with the `npm run app:*` scripts and the
`.gitignore` rules that only covered its build output. The mass-storage route and the registry
files it uses are untouched, as are the checks in `npm run selftest` that assert their bytes.

## Problem

The lab hijacks the Store host names by DNS and intercepts the traffic. A device only
cooperates when two things are true on the phone itself:

1. it trusts the lab root CA, otherwise every TLS handshake on a hijacked name is
   refused before any capture happens;
2. it is pointed at the lab (DNS), which the operator sets by hand.

Step 1 is a manual procedure today. Mount the phone registry with WPinternals, then import
`ca/install-root-ca.reg`. It is a desktop workflow that needs a cable, and it has blocked
every capture attempt so far.

## Goal

Ship an app that installs on the Lumia, applies the patch set on the phone, and ends on an
explicit **"reboot required"** screen. Then the device-side setup stops being a cable and a
registry editor.

## Non-goals for v1

- No Store protocol emulation (that stays in `src/store/`, fed by captures).
- No network configuration of the phone (Wi-Fi DNS is still set by hand).
- No guessed registry keys. v1 ships exactly one patch, the one the lab already proved.

## Decisions (agreed with the operator)

| Decision | Choice |
| --- | --- |
| v1 patch set | Root CA install + reboot prompt. Nothing speculative. |
| Nested app repository | Removed; the app files are imported into the single repository. |
| Repository | One repo, root = this project folder, private, named `WindowsStoreRevivalForWP81`. |
| Language of code and comments | English. The lab's Italian operator document is preserved as `README.it.md`. |

## Architecture

Three pieces, each with one job. The middle one and the tool above it no longer exist:

```
tools/app.mjs          PC side: generates the patch set from the live CA, builds the XAP,
                       deploys it. No knowledge of what a patch means.
        |
        | writes patches.json (embedded in the XAP)
        v
StorePatcher/          The app: reads the patch set, applies it, reports per patch.
  Store Patcher/       Patch engine, registry interop, capability probe, English UI.
        ^
        | MSBuild 14.0 -> XAP -> AppDeployCmd.exe (USB)
        |
        +--- WPinternals / CMD Injector remain the fallback channels
```

The app never hardcoded the certificate. The patch set was data, generated from the same
`ca/ca.der` the lab serves. That kept one source of truth for the CA, and it stopped the
classic failure where the phone gets patched with a certificate the lab no longer uses. The
same principle survives the removal, one level down. What goes into the phone's hive is the
blob and the `.reg` this repository generates and verifies, never something formatted on the
device.

## Interfaces

### `patches.json` (embedded resource in the XAP)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-15T04:43:26.000Z",
  "lab": { "advertiseIp": "192.168.0.220" },
  "patches": [
    {
      "id": "lab-root-ca",
      "kind": "cert-root",
      "hive": "HKLM",
      "store": "Root",
      "thumbprint": "2DE30E6BB059296AB07F5754511D97E16ED81D8D",
      "blobBase64": "...",
      "requiresReboot": true,
      "description": "Install the lab root CA as a trusted root"
    }
  ]
}
```

The `blobBase64` payload is byte-identical to the value `npm run verify-rootreg` proved
against what Windows itself writes for the same certificate. So the app does not re-implement
the blob layout. It writes the bytes the desktop side already verified.

### Patch kinds

| Kind | v1 | Meaning |
| --- | --- | --- |
| `cert-root` | yes | Install an encoded certificate as a trusted root. |
| `url-map` | v2 | Replace a Store endpoint URL with the lab address. |
| `reg-binary` | reserved | Write an arbitrary REG_BINARY value. Not shipped in v1. |

Every kind has the same shape: `id`, `kind`, target fields, `requiresReboot`, `description`.
An unknown kind is reported as `skipped:unknown-kind` instead of failing the run, so an
older app can still apply a patch set from a newer lab.

### PC CLI

Gone with the app: these commands no longer exist. The block stays so the interfaces above
read as a record, not as instructions:

```
node tools/app.mjs patch            # regenerate patches.json from ca/
node tools/app.mjs build            # MSBuild the XAP, verify it exists and contains it
node tools/app.mjs deploy [--dry-run]# AppDeployCmd.exe over USB
node tools/app.mjs all              # patch, build, deploy
```

`patch` was safe to run at any time. `build` and `deploy` refused to run when the CA was
missing, instead of producing an app with an empty patch set.

## The capability probe (this is the spike, and it ships)

One assumption in this design was unverified: what a WP8.1 Silverlight app with
`ID_CAP_INTEROPSERVICES` can actually do on the device. So the probe is a first-class screen
in the app, always available, and not a throwaway build:

1. read a known registry value and print it;
2. write a test value under the app's own key, read it back, compare it, delete it;
3. report whether the reboot call is available (without invoking it).

The probe writes its findings to the screen and to a log file in isolated storage, so the
operator can send back exact evidence. Every heavy path in the patch engine is report-only
until the probe has run on the device at least once.

## Applying a patch

For `cert-root` the app tries two routes in order, and the outcome names the one that worked:

1. **Certificate store API** (`CertAddEncodedCertificateToStore`): the semantic route, where
   the OS decides how to persist the certificate.
2. **Direct registry write**: the verified blob written to
   `HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates\<SHA1>` with the NT
   registry APIs, the same thing `ca/install-root-ca.reg` does on the desktop.

Every patch is idempotent and verified after writing:

- if the value is already present and byte-identical → `already-present`, no write;
- if present but different → overwrite and report `replaced`;
- after writing, read the value back and compare; only then report `applied`.

## Outcomes and error handling

Per patch: `applied`, `already-present`, `replaced`, `failed:<reason>`, `skipped:<reason>`.
A failed patch never aborts the run. The remaining patches are still attempted, and the
summary lists what needs the fallback channel. When at least one patch reports
`requiresReboot`, the app lands on the reboot screen.

Failure of **both** routes is a legitimate result to report, not a crash. It means the
device does not allow this from an app, and the operator falls back to
`ca/install-root-ca.reg` through WPinternals or CMD Injector. The app still has a job then:
it reports whether the CA is already on the device, and asks for the reboot.

## Deployment

Local toolchain, verified present on this machine:

- `MSBuild 14.0` builds `Store Patcher/Store Patcher.csproj` with `-p:Platform=AnyCPU`
  (exit 0, 73,929 byte XAP reproduced);
- the solution file needs `-p:Platform="Any CPU"`; Git Bash rewrites `/p:` arguments, so
  the runner uses `-p:` and sets `MSYS2_ARG_CONV_EXCL`;
- `AppDeployCmd.exe` (WP8.1 SDK) deploys over USB; `IpOverUsbSvc` is running.

Two fallback channels are documented but not automated, because they cannot be tested here:
the WPinternals registry mount, and CMD Injector (`fadilfadz01/CMD.Injector_WP8`), which
needs WP8.1 plus bootloader and interop unlock. This phone is already in that state.

Correction (2026-10-15, read from the upstream source). This section used to say that CMD
Injector is driven by "command files placed in a CMD Injector folder on the phone". That is
wrong. It is an interactive command prompt: you press *Inject*, reboot, and type commands
into a console on the phone, with a `BootConfig` surface for boot-time execution. No folder
is watched and no command file is read. One more fact, reported rather than measured here:
upstream's issue tracker names this model, a Lumia 625 on WP8.1 Update 2 (GDR2), among the
cases where installing CMD Injector left every user app unable to open. The only recovery is
editing the registry in mass storage mode, or a hard reset.

## Roadmap

- **v2: native component or full-trust deployment**. The only route to an install that needs
  no console and no typing. Blocked today by the missing WP8.1 ARM compiler (`npm run
  app:toolchain` measures it). It is also the experiment that would answer whether the
  refusal depends on the capability rather than being unconditional.
- **v2: `url-map`**. Rewrite Store endpoint URLs to the lab address, so the device finds the
  lab even where DNS redirection cannot reach. A cached or hardcoded CDN address is the
  standing suspect in the lab notes. The design provision is made now: the patch schema is
  open-ended, and the engine already reports unknown kinds as skipped.
- **v3: verification surface**. The app reports which Store endpoints it can reach, so the
  lab's capture and the device agree on one list.

## Testing

This is what can be verified on this machine, and is: 50/50 in `npm run selftest`, plus the
artifact checks below:

- generator: the `patches.json` thumbprint equals `sha1(ca.der)`, and `blobBase64` decodes to
  exactly `buildCertBlob(ca.der)`, asserted in the self-test suite;
- generator, the install file: the carried `regFileBase64` equals
  `buildRegFileBuffer(ca.der)` byte for byte, begins with a UTF-16LE BOM, names the registry
  key to create, and its hex payload decodes back to `buildCertBlob(ca.der)`. The test
  decodes the payload instead of comparing text, so a formatter that drifted would fail
  rather than agree with itself;
- generator, the runbook's path: `app.productId` in the patch set is the `ProductID` from
  `Properties/WMAppManifest.xml`, read through the same function the build uses;
- app: MSBuild compiles the XAP (exit status checked), and the built XAP is inspected for
  the embedded patch set, the install file and the interop capability;
- artifact, checked by hand against the real files after a build: `patches.json` and the
  `patches.json` inside the XAP both carry schema 2, the product id equal to the manifest's,
  and a `.reg` identical to the file generated for `ca/ca.der`;
- no test asserts on-device behaviour. Those results come back from the phone: the probe
  screen, `runbook.txt`, `trust.txt`, and the console's own output.

## Measured on the device (2026-10-15, Lumia 625, RM-941)

The app was built, deployed over USB (`AppDeployCmd.exe /installlaunch … /targetdevice:de`)
and launched on the phone. Its reports were pulled back with ISETool. The probe answered
the one open question, and the answer is **no**:

```
registry read : False    registry write: False    cert store API: False
FAIL  read HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProductName
      - call unavailable - NotSupportedException: DllImport cannot be used on user-defined methods
FAILED  lab-root-ca  call unavailable - NotSupportedException: DllImport …
```

Every native call is refused by the runtime before it reaches the OS. That is a property of
the app model, not of the patch set: managed native calls from app code are not permitted
here, and the interop capability declared in `WMAppManifest.xml` does not change it. A
second hypothesis was tested and closed with evidence. Declaring the capability in
`Package.appxmanifest` instead grants nothing; it fails the build with `APPX3024`, because
that manifest validates against the appx capability vocabulary, which has no `ID_CAP_*`.

The consequences are the fallbacks this design already specified:

1. The CA is installed with `ca/install-root-ca.reg` through WPinternals or CMD Injector.
2. The app keeps its other job, and does it well: it reports whether the CA is present and
   byte-identical to the one the lab serves, and it asks for the reboot.
3. The `url-map` and `reg-binary` patch kinds planned for v2 share the same blocked route,
   so v2 is only worth building if a working write route appears.

Still unknown: whether a differently packaged app (native component, or a deployment that
actually grants interop) can do it. Not resolved from here, and not claimed.

### Why a native DLL of our own would not settle it

The plan was to add a native ARM DLL with one export. If the call worked, the capability is
granted and the registry route reopens. If it failed with the same error, the platform
refuses native calls outright. Reading the error again closes most of that gap without a
compiler. The refusal names **the method**, not the library, and it fires for `ntdll.dll`,
`crypt32.dll` and `advapi32.dll` alike. It happens before library resolution, so changing
the target library, ours included, gives the same answer.

The message is not specific to this phone either. It is what any Windows Phone Silverlight
app gets for `DllImport`. Two unrelated developers hit it verbatim while trying to load an
ordinary C++ DLL from a Silverlight app. It is the app model speaking, not this device and
not this patch set.

That leaves one question. Does the check depend on the capability being granted, or is it
unconditional? A native DLL in the package answers it, *if* it can be built. Which brings us
to the toolchain.

### The WP8.1 native toolchain on this machine (measured)

`node tools/app.mjs toolchain` reports what is actually present, instead of guessing which
installer component is missing:

| Piece | State |
| --- | --- |
| Windows Phone 8.1 ARM libraries (`Windows Phone Kits/8.1/lib/ARM/WindowsPhoneCore.lib`) | **present** |
| MSBuild targets (`Microsoft.Cpp.WindowsPhone.8.1.targets`) | **present** |
| ARM compiler for the WP81 toolset (`VC/WPSDK/WP81/.../cl.exe`) | **missing** |

So the SDK half is installed already. What is missing is the C++ compiler side, which VS2019
dropped and only VS2013 Update 4+ or VS2015 ships. A separate finding: VS2012 is on this
machine with the **WP8.0** cross-compiler `VC/WPSDK/WP80/bin/x86_arm/cl.exe`. It builds ARM
code, but for the 8.0 toolset, which does not produce a component an 8.1 app can load. It
does not substitute for the missing piece.

Until that compiler exists, the experiment is not runnable here, and no claim is made about
its outcome.

### The certificate picker, and how far it is verified

Tapping the status card answers a question it used to leave open: *which* authority, and
*which* DNS address it belongs to. The card lists every authority the phone is offered. The
one embedded in the patch set comes first, then any pushed into isolated storage under
`certificates/`. Selecting one shows its DNS address, the names that address answers for,
its SHA-1, and whether its bytes match the lab's CA.

An address is never inferred. It comes from `lab.advertiseIp` for the embedded CA, or from a
`lab.txt` companion file for a pushed one, and the screen says "not declared" when neither
exists. `node tools/app.mjs push-ca <file> --dns <address>` places a certificate and that
companion file on the phone, and verifies the upload with `dir` rather than trusting the
`rs` exit status.

Verified: the app compiles with `X509Certificate` on this platform, the self-test passes
(including that a pushed CA reads identically from PEM and DER, that it carries the same
thumbprint as the patch set, and that a file which is not a certificate is refused rather
than uploaded), and the XAP was built and deployed to the Lumia.

### Verified on the device (2026-10-15)

The reports come back. `npm run app:report` pulled `probe.txt` and `runbook.txt` off the
Lumia, so the device's own conclusions no longer need anyone transcribing a screen. What
they say:

- The probe's answer is the one this design expected and feared: every native call refused,
  each line carrying the runtime's own words, `NotSupportedException: DllImport cannot be
  used on user-defined methods`. The registry read, the registry write and the certificate
  store API all report `False`, and that is why the runbook exists.
- The install file the phone wrote is byte-identical to the one generated here. That is not
  the app's own claim: `app:report` copies the whole isolated store off the device, and the
  copy taken over USB compares equal to `ca/install-root-ca.reg` with `cmp`: 5716 bytes,
  SHA-1 `E4AD16BB…`, the same value `buildRegFileBuffer()` produces from `ca/ca.der` and the
  same one embedded in the XAP. The first two bytes decode to the UTF-16LE `Windows Registry
  Editor` header, so the BOM and the format crossed to the device intact.
- The runbook is readable from the PC. `runbook.txt` used to carry only the three composed
  lines, so the text the operator actually reads, the one explaining where to look and what
  a hit means, existed only on the phone's screen and could not be checked from here. It now
  saves the full text, split by the same helper the screen uses, so the two cannot disagree.
  Reading it back caught a real defect: splitting on both `\r` and `\n` turned every CRLF
  into an extra empty line, so every blank line between paragraphs was doubled on the screen
  and in the file.
- The device's own report timestamps run about 25 seconds behind this PC's clock, so they are
  not an ordering signal: a report can appear to predate the build that wrote it. The build
  stamp is the reliable one, because it is written by the PC into the package and read back
  out of the running one.
- The authority list read back too: one authority offered, the patch set's, `dns
  192.168.0.220`, which is what the picker shows.

The device taught two things the desktop could not. Both were found by running it, and both
are fixed in the app:

- **The single screen did not scroll.** A `Grid` with an `Auto` row for the status card and
the seven buttons and a `*` row for the log does not fit this screen. The `Auto` row took the
height, the star row got nothing, and the buttons below the fold could not be reached because
nothing on the page moved. The page is now one `ScrollViewer`. The log is an `ItemsControl`
inside it and not a `ListBox`, because a `ListBox` carries its own scroll owner and would
swallow the swipe. The authority list, which has to stay a `ListBox` for its selection, has
that inner scroller switched off for the same reason.

  The page measures itself on every launch and saves the numbers to `layout.txt`. A gesture
cannot be tested over a cable, but the property the gesture needs can. On the Lumia:

  | | |
  | --- | --- |
  | viewport (what fits, tray excluded) | 768 px |
  | extent (what the page needs) | 1770 px |
  | scrollable (how far it can move) | 1002 px |

  That is the old failure, quantified. The buttons run from 401 to 905 px and the log occupies
  948 to 1746, so on a 768 px viewport `apply patches`, `reboot phone` and the whole log began
  below the fold. With no scroller on the page there was nowhere for them to come from. Every
  control is now measured inside the scrollable extent, and that measurement is in the report
  rather than in an assumption.
- **A deployment over a running app is invisible.** With the app already open, `AppDeployCmd
/installlaunch` answers `Completato` and updates the package underneath the running page,
which is never reloaded. The previous build's UI stays on screen and its reports stay on
disk, so a fixed build looks exactly like an unfixed one. Every report now names the build
that wrote it, read from the patch set embedded in the running package, which is regenerated
on each build. A clean start needs `/uninstall` first, and that needs the phone awake.
`/launch` and `/uninstall` both die with an access violation on a sleeping device, while
`/installlaunch` still answers `Completato`.

## Decision (2026-10-15): the phone does it, the app prepares and verifies

The operator's constraint was **everything on the phone, no PC**. That is harder than the
constraint this design was written under, and it removes the route the design had been
relying on.

| Route | Verdict |
| --- | --- |
| The app writes the registry itself | Excluded by measurement: the runtime refuses native calls from app code. |
| PC in mass storage (`reg load`/`reg add` on the mounted hive) | Excluded by the constraint: that route *is* the PC. |
| Our own native component or a full-trust deployment | The only route to a fully automatic install, and still blocked: the WP8.1 ARM compiler is not installed here. Parked as v2, not promised. |
| The phone's own console (CMD Injector) | **Chosen.** It is the only privileged executor that exists on the phone today. |

The constraint that produced this table did not outlive it. The operator dropped it, the app
went with it, and the route in use now is the one this table excludes: the phone's hive edited
on this PC with its filesystem mounted as a drive. The rows stay because the exclusions were
measured, not argued.

So the app's job changed, and not as a consolation prize. It carried the install file, wrote
it where the phone could reach it, printed the exact line that imports it, and answered the
only question that mattered afterwards, *is this CA trusted*, by *using* it.

### What the app did

1. **The patch set carries the whole `.reg` file** (`regFileBase64`, `regFileName`, schema 2),
   generated by `buildRegFileBuffer()` in `tools/make-rootreg.mjs`: UTF-16LE with a BOM, the
   form regedit writes. The phone writes those bytes. It does not format a `.reg` of its own,
   for the same reason it does not re-implement the blob. A second implementation of a
   verified format is a second chance to drift.
2. **It also carries the app's product id** (`app.productId`), read from `WMAppManifest.xml`
   at generation time. There is no runtime API for it, and the install path is composed from
   it. An invented path would be worse than no path, because it looks actionable.
3. **`InstallRunbook` writes the file and verifies it**: written into isolated storage, then
   read back and compared byte for byte before it is called ready, plus a SHA-1 so a copy can
   be compared afterwards.
4. **The runbook says exactly what to type**, and starts with the check that settles the one
   assumption left:
   ```
   dir /s /b \install-root-ca.reg
   reg import "<the path it printed>"
   ```
   Step 1 searches the whole device for that file name, starting from the root of whatever
   drive the console is on, rather than one composed path. It was scoped to the app storage
   tree at first. That scope was a guess with a cost: a miss there read as *this route is
   closed on this phone*, when the file may simply have been somewhere the console could read
   perfectly well. The operator's **Downloads** folder is that case, which is why the search
   starts at the root. The app cannot put anything there, because there are no native calls
   from app code and `Windows.Storage.DownloadsFolder` does not exist on Windows Phone 8.1 at
   all. But a copy carried over from a PC imports the same way, and a hit in Downloads removes
   the dependence on whether the console may enter this app's storage. The runbook says which
   location means which, so a hit can be read instead of just being a path.
   Step 1 prints nothing when the file is nowhere on the device. Then this route is closed on
   this phone, and the screen says so instead of sending the operator down a path that cannot
   work.

### Verification changes hands

Reading the registry was how the app checked the CA, and that is refused on this build for
the same reason writing it is. The replacement asks a better question: **does a TLS
handshake to a name the lab hijacks complete?** That needs no capability, and it proves what
the registry check only implied: this phone accepts the lab's certificate for that name. A
502 from the lab counts as success. It is a completed handshake, and that status is
the lab's deliberate answer for an endpoint it does not emulate yet.

Failures are split by cause, because each needs a different fix and "it does not work" sends
people to the wrong one: the name does not resolve (**Wi-Fi DNS**), the certificate was
refused (**the root CA is missing**), or nothing answered (**the lab is not running**).

### The one assumption left, and how it is settled

Nothing here has measured whether CMD Injector's console can read this app's isolated
storage, or whether `reg.exe` exists on WP8.1 at all. Both are answerable on the phone in
about two minutes with the console that is already there: `dir`, `reg /?`, and whether a
paste works. The runbook's step 1 is the same check in usable form. If all three come back
no, **no phone-only route exists on this device today**, and that is the honest answer rather
than a runbook that cannot work.

## The translation layer, started (2026-10-15)

v1 declared "no Store protocol emulation (that stays in `src/store/`, fed by captures)" as a
non-goal. It has started anyway, and the reason is a measurement, not a change of mind.

**The backend is a shell, and that is now measured.** The real hosts were asked from this PC
through a public resolver, so the lab's own DNS could not answer in their place.
`marketplaceedgeservice.windowsphone.com`, `catalog.zune.net` and `wscont1.apps.microsoft.com`
are NXDOMAIN. `cdn.marketplaceedgeservice.windowsphone.com` still resolves (CNAME to Akamai),
and its edge answers `503 Service Unavailable - DNS failure`. So the deliberate `502` an
intercepted Store request used to end in could not be improved by forwarding it better. There
is nowhere for it to go. The page has to be produced here.

**The format is recovered, not invented.** `src/store/catalog-feed.mjs` builds the Zune
catalog XML from responses of the real service kept by the Wayback Machine: three
generations of one grammar, each element in that file naming the capture it came from.
`/v3.2/…/hubTypes/marketplace/hub` is the marketplace home page (`MarketplaceHub`),
`/v8/catalog/hubs?…&hub=games` is `GamesHub` with `<editorialItems>` and the `<applications>`
they point at, and `/v8|catalog/apps` `/v9|catalog/apps` are application lists. All are Atom
feeds in `http://schemas.zune.net/catalog/apps/2008/02` with a `<templates>` block naming the
UI template that renders the page. That is why `storePages?typeId=DynamicHub.Main`, the
endpoint the phone's Store actually opens with, is servable at all.

**One value is inferred, and it is labelled as such.** The template name a `DynamicHub` page
carries is the single thing no archived response could confirm. It is a config knob
(`livestore.protocol.hubTemplate`) and not a constant, because only the device can accept or
reject it.

**A second defect fell out of this, and it was the expensive one.** The `502 upstream timeout`
the phone's Store had been getting was not Microsoft refusing. This PC's own DNS still
pointed at the lab, so a hijacked name resolved *on this PC* to the lab itself, and
forwarding it upstream dialled the lab again. One hop waited on the next: 325,415 captured
exchanges that were the lab talking to itself, with a 20-second timeout at the end of each.
The loop guard that was already written and tested is now active in the running process. The
same request is refused in 53 ms with `upstream_loop` and a hint naming the cause.

**What this does not establish.** No part of this has been run against the Lumia. The handler
is verified here: well-formed feeds, escaping that survives a hostile catalog entry, a GUID
that round-trips, the exact phone path and query answered through the real proxy, off by
default and falling through when off (95 checks in `npm run selftest`, the same suite).
Whether the device renders the page is the device's answer, not this machine's. It serves the
browse surfaces only: no images, no licenses, no downloads.

## Risks

| Risk | Mitigation |
| --- | --- |
| An interop app cannot write HKLM on this build | **Confirmed on the device** (see above): the app reports it instead of pretending, and the `.reg` fallback takes over. |
| The console cannot read the app's isolated storage | Not assumed: runbook step 1 is the check, and the screen states that this route is closed when it prints nothing. Fallbacks named on the screen: the desktop `.reg` import, or a native component once a compiler exists. |
| `reg.exe` does not exist on WP8.1 | Not assumed. The runbook says to stop rather than fall back to typing the blob by hand, and the file form (UTF-16LE + BOM) is asserted in the self-test so the encoding is not part of the doubt. |
| CMD Injector damages this phone model | Upstream's issue tracker names the Lumia 625 on WP8.1 Update 2 among the cases where every user app stopped opening. It is stated in the runbook on the screen, before the operator gets there. |
| The trust check passes on a cached TLS session | The check is meant to be run after the reboot, when the cache is empty. Stated in the code, not hidden. |
| An interop app cannot reboot the phone | The screen still says "reboot required" with manual instructions; a reboot is not silently skipped or faked. |
| Patches the app applies are lost on reboot | Re-running the app is idempotent, and `already-present` proves persistence. |
| Certificate pinning in the Store app defeats MITM | Out of scope here; already listed as a known limit in the lab document. |
