# Windows Store Revival for WP8.1

Two projects that work together to give a Windows Phone 8.1 Lumia a working Store
experience again, after Microsoft shut the original backend down on 2019-12-16.

| Project | Path | What it does |
| --- | --- | --- |
| **Lab** | `src/`, `tools/`, `config.json` | Hijacks the Store host names by DNS and intercepts only that traffic, so the real Store protocol can be captured and later mapped onto a live catalog. |
| **Store Patcher** | `StorePatcher/Store Patcher/` | Windows Phone 8.1 app that patches the phone itself: installs the lab root CA as a trusted root, then asks for the reboot it needs. Also the only place that can answer what an interop app is allowed to do on this build, through its capability probe. |

The app and the lab are one system: the lab generates the patch set from its own
certificate, so the phone is always patched with the CA the lab is actually serving.

## Status

The lab runs and captures. The Store backend is dead — `wscont*.apps.microsoft.com` and
the Zune catalog hosts no longer resolve — so today an intercepted Store request ends in a
deliberate `502`, and that `502` is the list of endpoints to emulate. The translation
layer is not written yet.

The on-device patcher **compiles, deploys and runs**: it was installed and launched on a
Lumia 625 over USB, and its reports were read back off the phone with ISETool.

That first real run settled the question the design left open, and the answer is no: on
this phone build the runtime refuses native calls from app code
(`NotSupportedException: DllImport cannot be used on user-defined methods`), so **the app
cannot install the CA itself**. It still detects whether the CA is present and
byte-identical to the lab's, and it still asks for the reboot. Installing the CA stays on
the desktop path: `ca/install-root-ca.reg` through WPinternals or CMD Injector.

Design, decisions and the full measurement are in
[`docs/superpowers/specs/2026-10-15-wp81-store-revival-design.md`](docs/superpowers/specs/2026-10-15-wp81-store-revival-design.md).

## Quick start (lab)

```bash
npm start                # DNS on :53, TLS on :443, plain HTTP on :80, proxy on :8899
npm run doctor           # one command: config, ports, CA, device traffic, next step
npm run watch            # only the traffic that comes from the device, not this PC
```

Then point the phone's Wi-Fi DNS at this PC and reboot it. Requests to the hijacked
names are captured under `captures/session-*/index.jsonl`.

```bash
npm run selftest         # end-to-end checks, no device needed
npm run rehearse         # replays the whole chain against the real host names
npm run analyze          # report from the last capture session
```

## Repository map

```
src/                     lab: DNS, selective TLS MITM, rules, capture, store handlers
tools/                   lab tooling: selftest, watch, doctor, canary, analyze, root CA
config.json              everything the lab does is driven by this file
StorePatcher/            the WP8.1 app (Visual Studio solution + project)
docs/                    design specs
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
| `npm run rehearse` | Replay the phone's chain against the real names. |
| `npm run analyze` | Report of the last capture session. |
| `npm run canary` | Listen on ports the lab does *not* serve, to catch a wrong-port attempt. |
| `npm run dnsprobe` | Raw DNS query against an arbitrary server/port. |
| `npm run make-rootreg` | Generate `ca/install-root-ca.reg` for the phone registry. |
| `npm run verify-rootreg` | Prove the generated blob is byte-identical to what Windows writes. |
| `npm run start:wp80` | TLS 1.0 variant, for Windows Phone 8.0 devices. |
| `npm run app:status` | What is present: app project, patch set, XAP, MSBuild, deployment tool. |
| `npm run app:patch` | Generate the app's patch set from the lab CA. |
| `npm run app:build` | Compile the XAP and verify the patch set and capability inside it. |
| `npm run app:deploy` | Install the XAP on the phone over USB (`--dry-run` to just print). |

## The phone side

The root CA has to be trusted on the device before any hijacked TLS name can be
intercepted; until then the phone connects and is refused during the handshake, which
produces no capture at all. Two ways to do it:

1. **Store Patcher app** — on this build it cannot install the CA (the runtime refuses
   native calls from app code, measured on device, see Status above); it verifies the CA
   and asks for the reboot. Build, deploy and read its reports from here:

   ```bash
   npm run app:build        # generate the patch set from the lab CA, compile, verify
   npm run app:deploy       # phone attached over USB, developer unlocked
   ```

   ```bash
   npm run app:report       # pull probe.txt and patches.txt back off the phone
   ```

   The app runs the capability probe on every launch and saves its report to isolated
   storage, so the device can be diagnosed without transcribing a screen. Pulling reports
   needs the phone awake and unlocked: ISETool dies with an access violation on a sleeping
   device.

   Tapping the status card on the phone opens the authority picker: it lists the CA
   embedded in this build and any certificate pushed into the app's isolated storage,
   and selecting one shows the DNS address that authority belongs to, the names it
   answers for, and whether its bytes are identical to the lab's CA. To put a second
   authority (and the address it owns) on the phone:

   ```bash
   npm run app:push-ca -- ca/ca.crt --dns 192.168.0.220
   npm run app:toolchain    # whether the WP8.1 native tools are installed
   ```
2. **WPinternals** — mount the phone registry and import `ca/install-root-ca.reg`
   (generate it with `npm run make-rootreg`).

`CMD Injector` (`fadilfadz01/CMD.Injector_WP8`) is the documented fallback runner for
privileged steps: a command prompt on the phone, requiring WP8.1 with bootloader and
interop unlock, driven by command files placed in a "CMD Injector" folder on the phone.

## Known limits

- The Store lookups, search and images are served over **HTTP on port 80**, not only TLS;
  the lab listens on both.
- **Certificate pinning** in the Store app would defeat interception; it would show up as
  a TLS error in the logs.
- Captures can contain **account tokens**: `captures/` is gitignored, do not publish it.
- The full, detailed operator documentation is the Italian lab document:
  [`README.it.md`](README.it.md).
