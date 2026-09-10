/**
 * rotation-store.js — persists only {domain: counter} pairs. No secrets,
 * no derived passwords, no master password ever touch this file.
 *
 * In the real extension this will back onto chrome.storage.sync so the
 * counter stays consistent across devices (see README open problem on
 * cross-device sync). For now it's a plain in-memory/JSON-backed store so
 * the derivation logic and a future login-detector can be developed and
 * tested independently of the extension runtime.
 */

class RotationStore {
  constructor(initial = {}) {
    this.counters = { ...initial };
  }

  get(domain) {
    return this.counters[domain] ?? 0;
  }

  increment(domain) {
    const next = this.get(domain) + 1;
    this.counters[domain] = next;
    return next;
  }

  toJSON() {
    return JSON.stringify(this.counters, null, 2);
  }

  static fromJSON(json) {
    return new RotationStore(JSON.parse(json));
  }
}

module.exports = { RotationStore };
