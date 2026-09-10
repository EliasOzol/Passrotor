# RotoPass *(working name — rename freely)*

A browser extension for deterministic, per-site passwords that **evolve over time** instead of staying fixed forever — like an Enigma machine: the same keystroke produces a different output once the rotors have stepped.

Type the exact same master password everywhere. The extension derives a different real password per site, and that derived password *changes* after each successful login — without you ever having to remember, store, or sync the password itself.

---

## The idea

Deterministic password managers already exist (LessPass, SuperGenPass, Master Password) — they turn `(master password, site domain)` into a unique password per site via a one-way key derivation function (KDF), so nothing is stored, only recomputed.

**What this project adds:** those tools produce the *same* password for a site forever. This one adds a **rotation state** — a small counter per site that advances every time you successfully log in — so the derived password for a given site changes over its lifetime, while your typed master password never does.

```
derived_password = KDF(master_password, site_domain, rotation_counter)
```

If you mistype and need to check what you typed, it's still checking against the *current* rotation — the password only steps forward *after* a confirmed successful login, never mid-attempt.

**Important asymmetry vs. TOTP/Enigma:** TOTP and Enigma both work because *both sides* independently derive the same value from a shared secret + step — neither side has to tell the other anything. This scheme is not symmetric: the website has no "rotor," it only has whatever password was last actually set. Advancing the local counter does **not** by itself make the site accept the new derived password — the extension must actively drive the site's own change-password flow to set the new derived value as the real stored password *before* the counter can safely advance. This is the single biggest open risk in the project (see below).

## Improvement over existing deterministic password tools

| | Static deterministic (LessPass, SuperGenPass) | RotoPass |
|---|---|---|
| Same master password, same site → same output | Always | Only until the next successful login |
| Compromise of one derived password | Site password is permanently guessable from the same formula | Rotation state means past/future derivations differ even with the same formula |
| Sync requirement | None (fully stateless) | One small integer per site must stay in sync across devices |

The rotation is the entire value proposition — and also the entire engineering risk (see below). This project is as much about proving the risk is manageable as it is about the derivation itself.

## What needs testing / open problems

These are listed roughly in order of "will kill the project if unsolved" → "polish":

- [ ] **Automating the site's own change-password flow.** The riskiest unknown in the whole project. After a login, the extension can't just start using a new derived password — it has to log into the site's *change-password* form and set the new derived password as the real one, before the local counter advances. Every site's flow differs (re-enter current password, email/2FA confirmation, CAPTCHA, rate limits), and some may block automation entirely. Worth hand-testing on 2-3 real sites *before* writing any extension code — if this turns out infeasible on most sites, the design may need to fall back to a manual "rotate now" button instead of automatic rotation.
- [ ] **Login-success detection.** Needed as a prerequisite to the above — the extension must know a login *succeeded* before it can even attempt the change-password step. Candidate approaches: URL change after submit, disappearance of the login form/error element, a short timeout heuristic, or a manual "confirm login" fallback if auto-detection fails.
- [ ] **Cross-device state sync.** The rotation counter must be identical on every device the extension runs on, or the same site will derive two different passwords on phone vs. laptop. Needs a sync mechanism (browser account sync storage is the obvious first candidate) and a defined behavior for what happens when a device is offline and out of sync.
- [ ] **Drift recovery.** What happens if the counter gets out of sync anyway (failed sync, extension reinstalled, etc.)? Needs a "resync" flow — e.g. try counters N-2 through N+2 when a derived password fails, or an explicit manual override.
- [ ] **Partial-failure lockout.** If the change-password step fails partway (site form bug, unhandled 2FA prompt), the site's real password may end up matching *neither* the old nor the new derived value — a genuine lockout, not just a sync annoyance. Needs a safe failure mode, e.g. never advance the local counter until the site confirms the change succeeded.
- [ ] **KDF choice and parameters.** PBKDF2 vs. HKDF vs. Argon2 for the derivation step; needs enough iterations/cost to resist offline brute force of the master password, balanced against not freezing the extension on every keystroke.
- [ ] **What "domain" actually means.** Subdomains, regional TLDs (`.co.uk` vs `.com`), and sites that migrate domains all need a defined normalization rule, or the same logical site silently derives different passwords.
- [ ] **First-run / existing-account migration.** How does someone adopt this on a site where they already have a real (non-derived) password set?

## Planned layout

```
rotopass/
├── extension/
│   ├── manifest.json          # Manifest V3
│   ├── background/
│   │   └── kdf.js             # derivation logic, never persists the master password
│   ├── content/
│   │   └── inject.js          # detects password fields, injects derived password
│   │   └── login-detector.js  # the success-detection heuristics (see open problems)
│   ├── popup/
│   │   └── popup.html/.js     # master password entry, per-site status
│   └── storage/
│       └── rotation-store.js  # {domain: counter} pairs only — no secrets stored
├── docs/
│   └── architecture.md        # component diagram + data flow, once drafted
├── tests/
│   └── kdf.test.js
└── README.md
```

**Explicitly never stored:** the master password itself (held in memory only during derivation), and any derived password. Only `{domain, counter}` pairs are persisted or synced.

## Status

Early architecture / proof-of-concept stage. Login-success detection is the first thing to prototype in isolation, before wiring up the full extension — see open problems above.
