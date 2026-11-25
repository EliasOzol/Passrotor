/**
 * kdf.js — core password derivation.
 *
 * derived_password = f(master_password, domain, rotation_counter)
 *
 * This module is deliberately environment-agnostic: it only depends on the
 * Web Crypto API (available in both browser extension contexts and Node's
 * `crypto.webcrypto`), so it can be unit-tested without a browser or any
 * site automation. It never stores or logs the master password or any
 * derived password — callers are responsible for keeping the master
 * password in memory only for as long as a derivation takes.
 */

const ITERATIONS = 250_000; // tune based on measured perf; see README open problem on KDF choice
const KEY_LENGTH_BITS = 256;
const DEFAULT_PASSWORD_LENGTH = 20;

/**
 * Normalizes a domain so subdomains / protocol / trailing slashes don't
 * silently produce different derived passwords for what the user considers
 * "the same site". This is a first pass — see README open problem on what
 * "domain" actually means (regional TLDs, site migrations, etc.).
 */
function normalizeDomain(rawDomain) {
  let domain = rawDomain.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/\/.*$/, "");
  return domain;
}

/**
 * Derives raw key material from (masterPassword, domain, counter) using
 * PBKDF2. Returns a Uint8Array of key bytes — not yet formatted as a
 * usable password (see formatAsPassword below).
 */
async function deriveKeyMaterial(masterPassword, domain, counter) {
  const normalizedDomain = normalizeDomain(domain);
  const encoder = new TextEncoder();

  const salt = encoder.encode(`${normalizedDomain}:${counter}`);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    KEY_LENGTH_BITS
  );

  return new Uint8Array(derivedBits);
}

/**
 * Formats raw key bytes into a password string that satisfies common site
 * policies: includes at least one lowercase, uppercase, digit, and symbol,
 * and is a fixed printable length. This is a first-pass formatter — real
 * sites have wildly different policies (max length caps, disallowed
 * symbols, etc.), which is its own open problem, not yet tracked in the
 * README but worth adding once this needs testing against real sites.
 */
function formatAsPassword(keyBytes, length = DEFAULT_PASSWORD_LENGTH) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*-_=+";
  const allChars = lower + upper + digits + symbols;

  let result = "";
  for (let i = 0; i < length; i++) {
    result += allChars[keyBytes[i % keyBytes.length] % allChars.length];
  }

  // Force at least one of each required character class, deterministically
  // based on the key bytes (not Math.random) so the same inputs always
  // produce the same output.
  const forced = [
    lower[keyBytes[0] % lower.length],
    upper[keyBytes[1] % upper.length],
    digits[keyBytes[2] % digits.length],
    symbols[keyBytes[3] % symbols.length],
  ];
  const chars = result.split("");
  forced.forEach((ch, i) => {
    chars[i] = ch;
  });

  return chars.join("");
}

/**
 * Main entry point: derives the actual password to use for a given site
 * at a given rotation counter.
 */
async function derivePassword(masterPassword, domain, counter, options = {}) {
  const keyBytes = await deriveKeyMaterial(masterPassword, domain, counter);
  return formatAsPassword(keyBytes, options.length ?? DEFAULT_PASSWORD_LENGTH);
}

// In Node (tests) export as a CommonJS module. In the extension popup this
// file is loaded as a plain <script>, so the functions above are globals.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { derivePassword, normalizeDomain, deriveKeyMaterial, formatAsPassword };
}
