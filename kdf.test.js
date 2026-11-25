/**
 * kdf.test.js — run with: node kdf.test.js (or: npm test)
 *
 * Requires Node 19+ (global `crypto.subtle` available without imports).
 * No test framework yet — plain assertions, fails loudly with a non-zero
 * exit code so it can be wired into CI later.
 */

const assert = require("assert");
const { derivePassword, normalizeDomain } = require("./kdf.js");

async function run() {
  console.log("Running kdf.js tests...\n");

  // Same inputs must always produce the same output — this is the whole
  // point of a deterministic scheme.
  {
    const a = await derivePassword("correct horse battery staple", "example.com", 0);
    const b = await derivePassword("correct horse battery staple", "example.com", 0);
    assert.strictEqual(a, b, "same inputs should produce identical output");
    console.log("✓ deterministic: same inputs -> same output");
  }

  // Different counter must produce a different password — this is the
  // entire rotation mechanism.
  {
    const before = await derivePassword("correct horse battery staple", "example.com", 0);
    const after = await derivePassword("correct horse battery staple", "example.com", 1);
    assert.notStrictEqual(before, after, "incrementing the counter should change the password");
    console.log("✓ rotation: incrementing counter changes the password");
  }

  // Different domain, same counter, must produce a different password.
  {
    const a = await derivePassword("correct horse battery staple", "example.com", 0);
    const b = await derivePassword("correct horse battery staple", "another.com", 0);
    assert.notStrictEqual(a, b, "different domains should produce different passwords");
    console.log("✓ per-site: different domains -> different passwords");
  }

  // Domain normalization: protocol, www, and trailing path should not
  // change the derived password for what's really the same site.
  {
    assert.strictEqual(normalizeDomain("https://www.example.com/login"), "example.com");
    assert.strictEqual(normalizeDomain("example.com"), "example.com");
    assert.strictEqual(normalizeDomain("HTTPS://EXAMPLE.COM"), "example.com");
    console.log("✓ normalization: protocol/www/path/case are stripped");
  }

  // Output must satisfy a basic password policy: at least one of each
  // character class, and the requested length.
  {
    const pw = await derivePassword("correct horse battery staple", "example.com", 0, { length: 16 });
    assert.strictEqual(pw.length, 16, "password should match requested length");
    assert.ok(/[a-z]/.test(pw), "should contain a lowercase letter");
    assert.ok(/[A-Z]/.test(pw), "should contain an uppercase letter");
    assert.ok(/[0-9]/.test(pw), "should contain a digit");
    assert.ok(/[!@#$%^&*\-_=+]/.test(pw), "should contain a symbol");
    console.log("✓ policy: output contains lower/upper/digit/symbol at requested length");
  }

  console.log("\nAll tests passed.");
}

run().catch((err) => {
  console.error("\n✗ Test failed:", err.message);
  process.exit(1);
});
