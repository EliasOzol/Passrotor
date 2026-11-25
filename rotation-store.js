/**
 * rotation-store.js — persists only {domain: counter} pairs. No secrets,
 * no derived passwords, no master password ever touch this file.
 *
 * The class itself is a plain in-memory store so it can be unit-tested in
 * Node. The extension popup (popup.js) loads/saves `store.counters` from
 * chrome.storage.sync so the counter follows you across devices (see README
 * open problem on cross-device sync).
 *
 * Domains are normalized with the same rule as kdf.js, so
 * "https://www.example.com/login" and "example.com" share one counter.
 */

// Node: pull normalizeDomain from kdf.js. Browser: kdf.js is loaded first as
// a plain <script>, so normalizeDomain is already a global.
const { normalizeDomain: normalizeRotationDomain } =
  typeof module !== "undefined" && module.exports ? require("./kdf.js") : globalThis;

class RotationStore {
  constructor(initial = {}) {
    this.counters = { ...initial };
  }

  get(domain) {
    return this.counters[normalizeRotationDomain(domain)] ?? 0;
  }

  increment(domain) {
    const next = this.get(domain) + 1;
    this.counters[normalizeRotationDomain(domain)] = next;
    return next;
  }

  /**
   * Sets the counter explicitly. Used to confirm a finished rotation and for
   * manual drift recovery (stepping the counter back or forward by hand).
   */
  set(domain, counter) {
    if (!Number.isInteger(counter) || counter < 0) {
      throw new RangeError(`counter must be a non-negative integer, got ${counter}`);
    }
    this.counters[normalizeRotationDomain(domain)] = counter;
    return counter;
  }

  toJSON() {
    return JSON.stringify(this.counters, null, 2);
  }

  static fromJSON(json) {
    return new RotationStore(JSON.parse(json));
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RotationStore };
}
