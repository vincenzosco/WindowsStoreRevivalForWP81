# How this project records what it knows

Three registers, one job each. Keeping them apart is what stops a measurement from turning
into a belief: a finding says *what is true and how it was shown*, maintenance says *what to
run and in what order*, and the spec says *what was designed and why*.

| Register | File | Answers |
| --- | --- | --- |
| Findings | [`FINDINGS.md`](FINDINGS.md) | What do we know about the phone, the Store and the lab, and what measured it? |
| Maintenance | [`MAINTENANCE.md`](MAINTENANCE.md) | How do I keep this working, and how do I re-measure something that may have rotted? |
| Design | [`superpowers/specs/2026-10-15-wp81-store-revival-design.md`](superpowers/specs/2026-10-15-wp81-store-revival-design.md) | What was designed, what was decided, what was thrown away. |
| Domains | [`DOMAINS.md`](DOMAINS.md) | Which host is which service, who says so, and what this lab does with it today. Every row carries its provenance, because most of them are not measurements of this phone. |
| Operator | [`../README.md`](../README.md), [`../README.it.md`](../README.it.md) | How to run it today, in English and in Italian. |

`FINDINGS.md` is the one that grows. The other three are edited when the thing they describe
actually changes.

## How to add a finding

A finding is one question, answered, with the method attached. The method is the part that
matters: a conclusion nobody can re-run is a story.

1. **One question per entry.** "The client fetches the page and does not render it" is one
   finding. "The Store is broken" is a mood.
2. **Give it an id and a date.** `F-014`, `2026-10-15`. Ids are never reused, not even for a
   finding that turns out to be wrong.
3. **Name the method.** The exact command, or the exact steps, plus which machine and which
   device. `npm run read-vocabulary`, not "we read the phone".
4. **Point at the raw evidence.** File path, byte count, hash, timestamp - and say plainly if
   that file is gitignored. `captures/`, `ca/` and `.selftest/` are not in the repository, so
   a finding must stay re-derivable from its command alone.
5. **Separate measured from inferred from assumed.** All three are allowed in one entry; mixing
   them silently is not. This repository's own phrasing is *measured*, *inferred*, *assumed*.
6. **Write down what it does not establish.** Every finding here has a limit, and the limit is
   usually the next question. A cached response is not a rendered one; a served page is not a
   parsed one.
7. **If it changes a default, name the file and the old value.** `config.json`
   `livestore.protocol.pageFormat` was `storePage`, now `panes` - so the experiment can be
   undone without a search.
8. **Never delete an overturned finding.** Mark it `SUPERSEDED by F-###` and keep the method
   and the raw numbers underneath. What gets re-run is the method, and the wrong answer is the
   evidence that the next one is different.
9. **No credentials, tokens or account data in the register.** `captures/` can hold account
   tokens; a finding cites the capture, it never quotes the token.

## How to add a measurement

Measurements live inside the finding that needed them, and in the table at the top of
`FINDINGS.md` when they are a headline number. Record:

- the command and the device state it needs (normal mode, mass storage, lab running),
- the date and the time **in the device's own clock**, and say whether the stamp is UTC or
  local - on this phone `EdmCache` timestamps are local, the lab's capture index is UTC, and
  the two differ by two hours,
- the raw number: bytes, milliseconds, entry counts, hashes,
- and the one line that says what the number rules **out**.

## What is deliberately not here

- The lab's own protocol documentation: that is `README.md`, and it is written for someone who
  wants to run the thing, not to audit it.
- The design's open questions: they are in the spec, under `Roadmap`, and they should move here
  only once something is measured about them.
