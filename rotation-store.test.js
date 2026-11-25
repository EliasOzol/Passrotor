/**
 * rotation-store.test.js — run with: node rotation-store.test.js (or: npm test)
 *
 * Plain assertions, same style as kdf.test.js.
 */

const assert = require("assert");
const { RotationStore } = require("./rotation-store.js");

function run() {
  console.log("Running rotation-store.js tests...\n");

  {
    const store = new RotationStore();
    assert.strictEqual(store.get("example.com"), 0, "unknown sites start at counter 0");
    assert.strictEqual(store.increment("example.com"), 1);
    assert.strictEqual(store.get("example.com"), 1);
    console.log("✓ counters start at 0 and increment");
  }

  // Same normalization rule as kdf.js, so the counter and the derivation
  // always agree on what "the same site" is.
  {
    const store = new RotationStore();
    store.increment("https://www.Example.com/login");
    assert.strictEqual(store.get("example.com"), 1, "www/protocol/path/case should share one counter");
    assert.deepStrictEqual(Object.keys(store.counters), ["example.com"]);
    console.log("✓ normalization: variants of a domain share one counter");
  }

  {
    const store = new RotationStore({ "example.com": 5 });
    assert.strictEqual(store.set("example.com", 3), 3);
    assert.strictEqual(store.get("example.com"), 3);
    assert.throws(() => store.set("example.com", -1), RangeError);
    assert.throws(() => store.set("example.com", 1.5), RangeError);
    console.log("✓ set: explicit counters for drift recovery, rejects invalid values");
  }

  {
    const store = new RotationStore({ "example.com": 2, "another.com": 7 });
    const restored = RotationStore.fromJSON(store.toJSON());
    assert.deepStrictEqual(restored.counters, store.counters);
    console.log("✓ JSON round trip keeps all counters");
  }

  console.log("\nAll tests passed.");
}

try {
  run();
} catch (err) {
  console.error("\n✗ Test failed:", err.message);
  process.exit(1);
}
