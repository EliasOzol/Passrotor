/**
 * playground.js — an in-page simulation of the extension + a website, so the
 * idea can be tried without installing anything (docs/index.html).
 *
 * Uses the real derivePassword/normalizeDomain (kdf.js) and RotationStore
 * (rotation-store.js), loaded first as plain scripts. The "website" is just a
 * map of domain -> stored password, with the same rules as test-site/server.js:
 * changing the password needs the current one, and login compares exactly.
 * The rotation is the same two steps as popup.js: change on the site, then
 * confirm before the counter moves.
 */

const $ = (id) => document.getElementById(id);

const store = new RotationStore();
/** domain -> { password, log: [{ at, text }] } */
const sites = new Map();
/** domain -> target counter of a rotation in progress */
const pending = new Map();
/** Derivation takes ~100 ms, so remember results for this tab's lifetime. */
const derived = new Map();

let reveal = false;
let renderToken = 0;

const domain = () => normalizeDomain($("site").value);
const master = () => $("master").value;

function derive(counter) {
  const key = JSON.stringify([master(), domain(), counter]);
  if (!derived.has(key)) derived.set(key, derivePassword(master(), domain(), counter));
  return derived.get(key);
}

function requireInputs() {
  if (!domain()) {
    $("site").focus();
    throw new Error("Enter a site first.");
  }
  if (!master()) {
    $("master").focus();
    throw new Error("Enter a master password first.");
  }
}

function say(text, kind = "") {
  $("result").textContent = text;
  $("result").className = `result ${kind}`;
}

function log(d, text) {
  sites.get(d).log.unshift({ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), text });
}

const mask = (pw) => "•".repeat(pw.length);

// --- Rendering ---------------------------------------------------------------

async function render() {
  const token = ++renderToken;
  const d = domain();
  const counter = store.get(d);
  const target = pending.get(d);
  const rotating = target !== undefined;
  const site = sites.get(d);

  $("counter").innerHTML = rotating ? `${counter}<span class="next"> → ${target}</span>` : String(counter);
  $("down").disabled = !d || rotating || counter === 0;
  $("up").disabled = !d || rotating;

  $("site-title").textContent = d || "No site";
  $("site-sub").textContent = site ? "You have an account here." : "No account yet.";
  $("stored").textContent = site ? site.password : "Nothing";
  $("stored").classList.toggle("empty", !site);

  $("signup").disabled = !d || !!site || rotating;
  $("login").disabled = !site || rotating;
  $("rotate").disabled = !site || rotating;
  $("account-actions").hidden = rotating;
  $("steps").hidden = !rotating;
  if (rotating) $("steps-title").textContent = `Rotating ${counter} → ${target}`;

  $("log-title").hidden = !site?.log.length;
  $("log").innerHTML = "";
  for (const entry of site?.log.slice(0, 6) ?? []) {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = entry.at;
    li.append(time, document.createTextNode(entry.text));
    $("log").append(li);
  }

  $("next-row").hidden = !rotating;
  if (!master() || !d) {
    $("current").textContent = !d ? "Enter a site" : "Enter a master password";
    $("current").classList.add("empty");
    return;
  }

  const [current, next] = await Promise.all([derive(counter), rotating ? derive(target) : null]);
  if (token !== renderToken) return; // a newer render started while we were deriving
  $("current").textContent = reveal ? current : mask(current);
  $("current").classList.remove("empty");
  if (rotating) $("next").textContent = reveal ? next : mask(next);
}

// --- Actions -----------------------------------------------------------------

async function signUp() {
  requireInputs();
  const d = domain();
  const password = await derive(store.get(d));
  sites.set(d, { password, log: [] });
  log(d, `Account created with the rotation ${store.get(d)} password`);
  say("Signed up. Now try logging in.", "good");
}

async function logIn() {
  requireInputs();
  const d = domain();
  const password = await derive(store.get(d));
  if (sites.get(d).password === password) {
    log(d, "Logged in");
    say(`Logged in with the rotation ${store.get(d)} password.`, "good");
  } else {
    log(d, "Login rejected: wrong password");
    say("Wrong password. Passrotor's counter doesn't match what the site has. Step the rotation with − / + to fix it.", "bad");
  }
}

async function startRotation() {
  requireInputs();
  const d = domain();
  pending.set(d, store.get(d) + 1);
  say("Step 1: change the password on the site.");
}

async function changeOnSite() {
  requireInputs();
  const d = domain();
  const site = sites.get(d);
  const [current, next] = await Promise.all([derive(store.get(d)), derive(pending.get(d))]);
  if (site.password !== current) {
    log(d, "Password change rejected: current password is wrong");
    say("The site rejected the change: the current password is wrong.", "bad");
    return;
  }
  if (site.password === next) {
    say("The site already has the new password. Click “It worked”.");
    return;
  }
  site.password = next;
  log(d, "Password changed");
  say("The site has the new password. Step 2: click “It worked”.", "good");
}

async function confirmRotation() {
  const d = domain();
  store.set(d, pending.get(d));
  pending.delete(d);
  say(`Rotation ${store.get(d)} is now active. The old password no longer works here.`, "good");
}

async function cancelRotation() {
  pending.delete(domain());
  say("Rotation cancelled. Nothing changed in Passrotor.");
}

async function step(delta) {
  const d = domain();
  store.set(d, Math.max(0, store.get(d) + delta));
  say(`Rotation set to ${store.get(d)}.`);
}

/** Runs an action, shows its error if any, then re-renders. */
function handle(action) {
  return async () => {
    try {
      await action();
    } catch (err) {
      say(err.message, "bad");
    }
    render();
  };
}

// --- Wiring ------------------------------------------------------------------

let typingTimer;
function renderSoon() {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(render, 250);
}

$("master").addEventListener("input", renderSoon);
$("site").addEventListener("input", () => {
  say("");
  renderSoon();
});
$("reveal").addEventListener("click", () => {
  reveal = !reveal;
  $("reveal").textContent = reveal ? "Hide" : "Show";
  $("reveal").setAttribute("aria-pressed", String(reveal));
  render();
});

$("signup").addEventListener("click", handle(signUp));
$("login").addEventListener("click", handle(logIn));
$("rotate").addEventListener("click", handle(startRotation));
$("change").addEventListener("click", handle(changeOnSite));
$("confirm").addEventListener("click", handle(confirmRotation));
$("cancel").addEventListener("click", handle(cancelRotation));
$("down").addEventListener("click", handle(() => step(-1)));
$("up").addEventListener("click", handle(() => step(1)));

render();
