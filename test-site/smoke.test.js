/**
 * test-site/smoke.test.js — run with: node test-site/smoke.test.js (or: npm test)
 *
 * Starts the test site on a spare port and walks the full Passrotor flow
 * over HTTP, using real derived passwords from kdf.js and the counter from
 * RotationStore — what the extension does, minus the browser:
 *
 *   register (rotation 0) → log in → rotate 0→1 (labelled form) → log in with 1
 *   → old password rejected → rotate 1→2 (unlabelled form) → log in with 2
 *
 * The popup's DOM filling still needs a manual check in the browser.
 */

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const { derivePassword } = require("../kdf.js");
const { RotationStore } = require("../rotation-store.js");

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const MASTER = "correct horse battery staple";

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("running at")) resolve(server);
    });
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
  });
}

/** POSTs a form without following the redirect; returns { status, location, cookie }. */
async function post(pathname, fields, cookie = "") {
  const res = await fetch(BASE + pathname, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams(fields).toString(),
  });
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

async function get(pathname, cookie = "") {
  const res = await fetch(BASE + pathname, { redirect: "manual", headers: { Cookie: cookie } });
  return { status: res.status, location: res.headers.get("location") ?? "", html: await res.text() };
}

async function login(username, password) {
  return post("/login", { username, password });
}

async function run() {
  console.log("Running test-site smoke test...\n");

  // Same as the popup: normalizeDomain(new URL(tab.url).hostname), so the port is dropped.
  const domain = new URL(BASE).hostname;
  const store = new RotationStore();
  const pw = (counter) => derivePassword(MASTER, domain, counter);

  {
    const pages = await Promise.all(["/login", "/register"].map((p) => get(p)));
    pages.forEach((p) => assert.strictEqual(p.status, 200));
    console.log("✓ pages: /login and /register load");
  }

  const pw0 = await pw(store.get(domain));
  {
    const res = await post("/register", { username: "elias", password: pw0, confirm_password: pw0 });
    assert.match(res.location, /^\/login\?/, "register should redirect to login");
    assert.match(decodeURIComponent(res.location), /Account created/);
    console.log("✓ register with the rotation-0 password");
  }

  let cookie;
  {
    const res = await login("elias", pw0);
    assert.strictEqual(res.location, "/account", "login with rotation 0 should succeed");
    cookie = res.cookie;
    const account = await get("/account", cookie);
    assert.ok(account.html.includes(pw0.replace(/&/g, "&amp;")), "account page shows the stored password");
    console.log("✓ login with rotation 0, account page shows it");
  }

  {
    const form = await get("/change-password", cookie);
    for (const name of ["current_password", "new_password", "confirm_password"]) {
      assert.ok(form.html.includes(`name="${name}"`), `labelled form has ${name}`);
    }
    const pw1 = await pw(store.get(domain) + 1);
    const res = await post("/change-password", { current_password: pw0, new_password: pw1, confirm_password: pw1 }, cookie);
    assert.match(decodeURIComponent(res.location), /Password changed/);
    store.increment(domain); // "It worked"
    console.log("✓ rotate 0 → 1 through the labelled change-password form");
  }

  {
    const old = await login("elias", pw0);
    assert.match(old.location, /^\/login\?/, "the old password must be rejected");
    const res = await login("elias", await pw(store.get(domain)));
    assert.strictEqual(res.location, "/account", "login with rotation 1 should succeed");
    cookie = res.cookie;
    console.log("✓ after rotating: old password rejected, rotation 1 accepted");
  }

  {
    const pw1 = await pw(store.get(domain));
    const pw2 = await pw(store.get(domain) + 1);
    const wrong = await post("/change-password?variant=plain", { p1: pw0, p2: pw2, p3: pw2 }, cookie);
    assert.match(decodeURIComponent(wrong.location), /Current password is wrong/, "wrong current password is rejected");
    const res = await post("/change-password?variant=plain", { p1: pw1, p2: pw2, p3: pw2 }, cookie);
    assert.match(decodeURIComponent(res.location), /Password changed/);
    store.increment(domain);
    const again = await login("elias", await pw(store.get(domain)));
    assert.strictEqual(again.location, "/account");
    console.log("✓ rotate 1 → 2 through the unlabelled form, then log in with rotation 2");
  }

  {
    await get("/reset");
    const res = await login("elias", await pw(store.get(domain)));
    assert.match(res.location, /^\/login\?/, "reset wipes accounts");
    console.log("✓ /reset wipes accounts");
  }

  console.log("\nAll tests passed.");
}

startServer()
  .then(async (server) => {
    try {
      await run();
    } catch (err) {
      console.error("\n✗ Test failed:", err.message);
      process.exitCode = 1;
    } finally {
      server.removeAllListeners("exit");
      server.kill();
    }
  })
  .catch((err) => {
    console.error("\n✗ Could not start the test site:", err.message);
    process.exit(1);
  });
