# The hosts this era of phone talks to, and what this lab does about each

One table, three questions per row: what the name is, who says so, and what this lab does
with it today. The file exists because `config.json` answers only the third question, one
list at a time. It says `marketplaceedgeservice.windowsphone.com` is hijacked. It does not
say what that host is for, or which other host did the same job under another generation's
name.

## How to read the "who says so" column

Nothing here is a measurement of the handset unless it says so. The tags are:

| Tag | Meaning |
| --- | --- |
| **F-0xx** | A finding in [`FINDINGS.md`](FINDINGS.md), measured on this phone, this lab or this FFU. The strongest thing here. |
| **capture** | Seen in this lab's own capture or DNS log, uninterpreted. A name the phone asked for shows that it asks. It does not show what the answer means. |
| **ReLiveWP** | [`ReLiveWP/ReLiveWP`](https://github.com/ReLiveWP/ReLiveWP), another project reversing the same era of handsets (WP7/8). Its `docs/known_domains.md` and the `server_name` map in its `nginx.conf` are the only written account of several of these names. Second-hand: useful, but not a measurement of this device. |
| **inferred** | Follows from the rows around it. Marked as inference so it can be argued with. |

Their internal names (`*.int.relivewp.net`, `*.zest.int.relivewp.net`, `mid.live.com`) are
their own addressing scheme, not hosts this lab would hijack. They are left out on purpose:
a name that exists to point at someone else's server would be a hijack target with nothing
behind it.

## The marketplace / Store family

| Host | What it is | Who says so | This lab today |
| --- | --- | --- | --- |
| `marketplaceedgeservice.windowsphone.com` | The Store's edge service: the `ShopSecure` base, and the same host carries `Accounts`, `Buy`, `Review` and `Telemetry` | **F-024** (the endpoint table in the client's own FFU), ReLiveWP ("functionally equivalent to `catalogue.zune.net`") | Hijacked and intercepted. `store-protocol` answers the catalog paths. Everything else, `Buy` included, falls through to passthrough and so to this lab's own `502`. |
| `cdn.marketplaceedgeservice.windowsphone.com` | `ShopCdn`: the page, the application lists and the search that the edge points at | **F-024** | Hijacked and intercepted; `store-protocol` answers it. `/v8/catalog/queries` answers an **empty** feed labelled `x-lab-invented: 1` (F-063). That route is the client's suggestion download (`PendingSuggestListDownload`, feed type `ApplicationSuggestions`, F-040), and its query names albums, artists, tracks and podcasts beside applications. It had no handler, so the client was getting a `502` at page open, before anybody had typed anything (F-063). |
| `cdn.marketplaceimages.windowsphone.com` | `ImageService`: every icon, screenshot and background | **F-024**, F-031 | Hijacked and intercepted; `store-images` answers a marked 48x48 placeholder PNG (F-031). Before that handler, 420 fabricated `502`s in one search. |
| `*.marketplacecontent.windowsphone.com` | Content CDN for the same family | capture (listed in the lab's config since it was first written) | Hijacked and intercepted, with no handler, so every request is a `502` this lab injects. Never seen in a capture. |
| `marketplaceconfigservice.windowsphone.com` | `TunerService`: the tuner/config backend the Store shares with the Zune generation | **F-024** (as the `WPAppsMarketplaceTunerService` base) **and** ReLiveWP (`tuners.zune.net`), two independent readings that agree | **Not hijacked and not intercepted, on purpose.** The configuration document F-024 serves leaves this setting out instead of pointing it at a host that would answer. |
| `wscont1.apps.microsoft.com`, `wscont2.apps.microsoft.com`, `*.apps.microsoft.com` | App content hosts: the package and its assets | capture, and the packages' own firewall guidance quoted in the config's comment | Hijacked and intercepted. No package and no download: `store-protocol` serves a catalog and nothing executable. |
| `catalog.zune.net`, `image.catalog.zune.net`, `tuners.zune.net`, `catalog-ssl.zune.net`, `tuners-ssl.zune.net` | The Zune-era names of the four rows above, from before the `windowsphone.com` generation | ReLiveWP | `catalog.zune.net` and `*.zune.net` are hijacked and intercepted, and answer through `store-protocol` the way the Store does. |
| `mangoclient.consumermarketplace.msid.windowsphone.com` | A marketplace Relying Party named by a `RequestSecurityToken` call, which is the string an install **would** be asking for a token against | **ReLiveWP only** (its "Misc" list, "mentioned in RequestSecurityToken") | **Not hijacked, never observed by this lab.** The most interesting unmeasured row here. F-033 found an install attempt that produced no request at all, so a name that only appears inside a token request is a name the install never got far enough to need. |
| `mobilling.microsoft.com`, `kdc.xboxlive.com`, `live.xbox.com`, `live.zune.net` | The other Relying Parties the same `RequestSecurityToken` call names | **ReLiveWP only** | None hijacked, none observed. |
| `disco.moservices.microsoft.com` | Operator discovery: the mobile operator's own storefront (`MoServices`), which the client asks about store ids it does not carry | **F-024** (as a setting) and ReLiveWP (with one endpoint, `GET /Mobi/Discovery/v1/Operators`) | Not hijacked, never observed. |

## The device-identity family

| Host | What it is | Who says so | This lab today |
| --- | --- | --- | --- |
| `devicecertificateservice.windowsphone.com` | The 8.x name that the lab's capture analysis treated as Store traffic ever since it had a host list | capture (host list in `tools/analyze-captures.mjs`), **no capture of a request** | `store-provisioning` answers `POST /dcs/certificaterequest` and `/certificaterequest` with a chain signed by the lab CA, **off by default** (F-034). Before it existed this was another self-inflicted `502`. |
| `dcs.windowsphone.net` | The WP7 name for the same job: `POST /dcs/certificaterequest`, `application/pkcs10`, a base64 PKCS#10 in and a PKCS#7 chain out, and `409` for an activation code the server will not honour | **ReLiveWP** (its Activation service implements this, and its docs note the device "will refuse to connect to any Windows Live services without a valid certificate chain") | Not hijacked. The *contract* in F-034 comes from here; the *host* does not. |
| `login.live.com`, `clientconfig.passport.net` | Account sign-in and the client's Passport configuration blob | capture (the phone asked for both) and ReLiveWP (`RST2.srf`, `ppcrlconfig600.bin`) | **Not hijacked**, and there is a reason: they answer on the real network, so intercepting them would replace a working flow with this lab's failure (E-004). |
| `account.nokia.com`, `az717532.vo.msecnd.net`, `ssl-api.bing.com` | Operator account, Azure CDN, and a client-config XML that is dead everywhere | capture (all three were asked for in one open), F-006 for `ssl-api.bing.com` | Only `ssl-api.bing.com` stays hijacked, because it answers nothing on the real network either. Hijacking it changes which failure the device gets, not whether it fails. |
| `store-api.live.net.co`, `id.live.net.co` | The **second** client on the handset, a community Live Store app, and the sign-in that app uses | F-029, from that app's own cache | `store-live-client` answers the JSON API. Off by default, and arming it needs the host in two lists as well (F-029, F-030). |

## What is deliberately not in this table

The rest of ReLiveWP's list is real, and outside what this lab is for: mail, contacts,
`docs.live.net`, `apis.live.net`, `activeauth.xboxlive.com`, `m.hotmail.com`, the Bing app's
hosts. Any of them is one lookup away if a capture ever names one. Copying them here would
make this file look like a survey of the whole platform, when it is a map of one Store.

## Why this file is not a finding

A table of other people's claims is the thing this project's registers are built to keep
apart from a measurement. Two rows here are measured on this device (the **F-024** family),
one is a hypothesis with an endpoint attached (F-034), and the rest are names seen in a DNS
log or listed by a second-hand source. If one of them ever matters, it earns a finding with
a method in it. The row here is where that starts, not where it ends.
