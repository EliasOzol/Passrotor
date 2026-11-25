# Passrotor

A browser extension for deterministic, per-site passwords that **evolve over time** instead of staying fixed forever — like an Enigma machine: the same keystroke produces a different output once the rotors have stepped.

Type the exact same master password everywhere. The extension derives a different real password per site, and that derived password *changes* each time you rotate it — without you ever having to remember, store, or sync the password itself.

---

## Try the prototype

The repository root is an unpacked Manifest V3 extension (Chrome / Edge).

1. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
2. Click **Load unpacked** and pick the cloned `Passrotor` folder.
3. Pin Passrotor, open any website, click the icon.

In the popup:

- **Site** is filled in from the open tab (normalized: no protocol, `www.` or path). You can type another site to copy its password.
- **Master password** is never stored.
- **Fill login** puts the current derived password into every visible password field on the page (only when the site field matches the open tab). **Copy** / **Show** are there for everything else.
- **Rotate this site's password…** starts a two-step rotation:
  1. go to the site's change-password page and click **Fill change form** (current password → "current" field, next password → "new"/"confirm" fields), then submit it on the page;
  2. reopen Passrotor and click **It worked**. Only then does the counter advance. **Cancel** drops the rotation.
- **− / +** next to the counter step it by hand, to recover from drift.

Counters are saved in `chrome.storage.sync` (they follow your browser account). A rotation in progress is saved in `chrome.storage.local`, so it survives the popup closing.

Run the tests (Node 19+):

```
npm test
```

## The idea

Deterministic password managers already exist (LessPass, SuperGenPass, Master Password) — they turn `(master password, site domain)` into a unique password per site via a one-way key derivation function (KDF), so nothing is stored, only recomputed.

**What this project adds:** those tools produce the *same* password for a site forever. This one adds a **rotation state** — a small counter per site that advances when you rotate — so the derived password for a given site changes over its lifetime, while your typed master password never does.

```
derived_password = KDF(master_password, site_domain, rotation_counter)
```

**Important asymmetry vs. TOTP/Enigma:** TOTP and Enigma both work because *both sides* independently derive the same value from a shared secret + step — neither side has to tell the other anything. This scheme is not symmetric: the website has no "rotor," it only has whatever password was last actually set. Advancing the local counter does **not** by itself make the site accept the new derived password — the new derived value has to be set through the site's own change-password flow *before* the counter can safely advance. The prototype does this semi-manually (fill the form, you submit and confirm); automating it is the biggest open risk (see below).

## Improvement over existing deterministic password tools

| | Static deterministic (LessPass, SuperGenPass) | Passrotor |
|---|---|---|
| Same master password, same site → same output | Always | Only until the next rotation |
| Compromise of one derived password | Site password is permanently guessable from the same formula | Rotation state means past/future derivations differ even with the same formula |
| Sync requirement | None (fully stateless) | One small integer per site must stay in sync across devices |

## What needs testing / open problems

Roughly in order of "will kill the project if unsolved" → "polish":

- [ ] **Automating the site's own change-password flow.** Every site's flow differs (re-enter current password, email/2FA confirmation, CAPTCHA, rate limits), and some may block automation entirely. The prototype only fills the form; you submit and confirm by hand.
- [ ] **Login-success detection.** Needed to rotate automatically after a login. Candidate approaches: URL change after submit, disappearance of the login form/error element, a timeout heuristic.
- [ ] **Cross-device state sync.** Counters use `chrome.storage.sync`; still undefined what happens when a device is offline and out of sync.
- [ ] **Drift recovery.** The prototype has manual −/+ buttons. Better: try counters N-2 … N+2 when a derived password fails.
- [ ] **Partial-failure lockout.** If the change-password step fails partway, the site's real password may match *neither* derived value. The prototype never advances the counter without your confirmation, but can't detect a half-applied change.
- [ ] **KDF choice and parameters.** Currently PBKDF2-SHA256 with 250,000 iterations; Argon2 would resist offline brute force better.
- [ ] **What "domain" actually means.** Subdomains (`login.example.com` ≠ `example.com` today), regional TLDs (`.co.uk` vs `.com`) and site migrations need a defined rule.
- [ ] **Site password policies.** Max length caps, disallowed symbols, etc.
- [ ] **First-run / existing-account migration.** Today: on the site's change-password page, type your old password yourself, paste **Copy** (rotation 0) into the new-password fields, and only use Passrotor's fill from then on.

## Layout

```
Passrotor/
├── manifest.json            # Manifest V3, permissions: activeTab, scripting, storage
├── popup.html / popup.js    # master password entry, fill/copy, two-step rotation
├── kdf.js                   # derivation logic, never persists the master password
├── rotation-store.js        # {domain: counter} pairs only — no secrets stored
├── kdf.test.js              # node kdf.test.js
├── rotation-store.test.js   # node rotation-store.test.js
└── package.json             # npm test
```

**Explicitly never stored:** the master password itself (held in the popup only while it's open), and any derived password. Only `{domain, counter}` pairs (plus in-progress rotation targets) are persisted or synced.

## Status

Working prototype: derive, fill, copy and manually confirmed rotation in a loadable extension. Automatic rotation (login detection + change-password automation) is not built yet.
