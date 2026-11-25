/**
 * popup.js — the extension popup.
 *
 * Uses derivePassword/normalizeDomain (kdf.js) and RotationStore
 * (rotation-store.js), which popup.html loads first as plain scripts.
 *
 * What is stored:
 *   chrome.storage.sync  "counters"         {domain: counter}  (follows you across devices)
 *   chrome.storage.local "pendingRotations" {domain: targetCounter} (a rotation started on this device)
 * The master password and derived passwords are never stored. They only live
 * in this popup, which is thrown away as soon as it closes.
 *
 * Rotation is manual and two-step, because the site has no "rotor" of its
 * own (see README): first the new password is set through the site's own
 * change-password form, and only after the user confirms it worked does the
 * counter advance. The popup closes when you click into the page, so the
 * "rotation in progress" state is saved and shown again on reopen.
 */

const COUNTERS_KEY = "counters";
const PENDING_KEY = "pendingRotations";

const $ = (id) => document.getElementById(id);

let store = new RotationStore();
let pending = {};
let tabId = null;
let tabDomain = null;

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function currentDomain() {
  return normalizeDomain($("domain").value);
}

async function saveCounters() {
  await chrome.storage.sync.set({ [COUNTERS_KEY]: store.counters });
}

async function savePending() {
  await chrome.storage.local.set({ [PENDING_KEY]: pending });
}

function hideOutput() {
  $("output").value = "";
  $("output").type = "password";
  $("output").hidden = true;
  $("show").textContent = "Show";
}

function render() {
  const domain = currentDomain();
  const counter = store.get(domain);
  const target = domain ? pending[domain] : undefined;
  const rotating = target !== undefined;

  $("counter").textContent = domain ? String(counter) : "–";
  $("counter-down").disabled = !domain || rotating || counter === 0;
  $("counter-up").disabled = !domain || rotating;

  $("normal-actions").hidden = rotating;
  $("rotate-panel").hidden = !rotating;
  if (rotating) {
    $("rotate-info").textContent = `Rotating ${domain}: ${counter} → ${target}`;
  }

  // Only fill the page we're actually on: never put example.com's password
  // into some other site's form.
  const canFill = tabId !== null && domain !== "" && domain === tabDomain;
  $("fill").disabled = !canFill;
  $("fill-change").disabled = !canFill;
  $("fill").title = canFill ? "" : "Only works when the site field matches the open tab";

  hideOutput();
}

/** Derives the password for the current site at a given counter, or throws a friendly error. */
async function derive(counter) {
  const master = $("master").value;
  const domain = currentDomain();
  if (!domain) throw new Error("Enter a site first.");
  if (!master) {
    $("master").focus();
    throw new Error("Enter your master password first.");
  }
  return derivePassword(master, domain, counter);
}

/**
 * Injected into the page with chrome.scripting.executeScript, so it must be
 * fully self-contained (no references to anything outside this function).
 *
 * Login mode (newPassword === null): every visible password field gets the
 * current password.
 * Change mode: fields that look like "new"/"confirm" fields get the new
 * password, the rest get the current one. If nothing is marked, assume the
 * common layout: current, new, confirm.
 */
function fillPasswordFields(currentPassword, newPassword) {
  const fields = Array.from(document.querySelectorAll('input[type="password"]')).filter(
    (f) => !f.disabled && !f.readOnly && f.getClientRects().length > 0
  );

  let newFields = [];
  if (newPassword !== null) {
    newFields = fields.filter(
      (f) => f.autocomplete === "new-password" || /new|confirm|repeat|again/i.test(`${f.name} ${f.id}`)
    );
    if (newFields.length === 0) newFields = fields.slice(1);
  }

  // Use the native setter and fire events so React/Vue-style forms notice.
  const setValue = (field, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const counts = { current: 0, new: 0 };
  for (const field of fields) {
    if (newFields.includes(field)) {
      setValue(field, newPassword);
      counts.new++;
    } else {
      setValue(field, currentPassword);
      counts.current++;
    }
  }
  return counts;
}

async function fillPage(currentPassword, newPassword = null) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillPasswordFields,
    args: [currentPassword, newPassword],
  });
  return injection.result;
}

async function copy(password, label) {
  await navigator.clipboard.writeText(password);
  setStatus(`Copied the ${label} password. It stays on the clipboard until you copy something else.`);
}

// --- Actions -----------------------------------------------------------------

async function onFill() {
  const password = await derive(store.get(currentDomain()));
  const counts = await fillPage(password);
  if (counts.current === 0) {
    setStatus("No visible password field on this page. Use Copy instead.", true);
  } else {
    setStatus(`Filled ${counts.current} password field(s).`);
  }
}

async function onCopy() {
  await copy(await derive(store.get(currentDomain())), "current");
}

async function onShow() {
  if (!$("output").hidden) {
    hideOutput();
    return;
  }
  $("output").value = await derive(store.get(currentDomain()));
  $("output").type = "text";
  $("output").hidden = false;
  $("show").textContent = "Hide";
}

async function onStartRotation() {
  const domain = currentDomain();
  if (!domain) throw new Error("Enter a site first.");
  pending[domain] = store.get(domain) + 1;
  await savePending();
  render();
  setStatus("Rotation started. Nothing changes until you click “It worked”.");
}

async function onFillChange() {
  const domain = currentDomain();
  const [currentPassword, newPassword] = await Promise.all([
    derive(store.get(domain)),
    derive(pending[domain]),
  ]);
  const counts = await fillPage(currentPassword, newPassword);
  if (counts.new === 0) {
    setStatus("Couldn't find a new-password field here. Use Copy current / Copy new.", true);
  } else {
    setStatus(
      `Filled current password in ${counts.current} field(s) and new in ${counts.new}. ` +
        "Submit the form, then reopen Passrotor and click “It worked”."
    );
  }
}

async function onCopyCurrent() {
  await copy(await derive(store.get(currentDomain())), "current");
}

async function onCopyNew() {
  await copy(await derive(pending[currentDomain()]), "new");
}

async function onConfirmRotation() {
  const domain = currentDomain();
  store.set(domain, pending[domain]);
  delete pending[domain];
  await Promise.all([saveCounters(), savePending()]);
  render();
  setStatus(`Done: ${domain} is now on rotation ${store.get(domain)}.`);
}

async function onCancelRotation() {
  const domain = currentDomain();
  delete pending[domain];
  await savePending();
  render();
  setStatus("Rotation cancelled. The site keeps its current password.");
}

async function onStepCounter(delta) {
  const domain = currentDomain();
  store.set(domain, Math.max(0, store.get(domain) + delta));
  await saveCounters();
  render();
  setStatus(`Counter for ${domain} set to ${store.get(domain)}.`);
}

/** Wraps a handler so any error shows up in the popup instead of vanishing. */
function handle(action) {
  return async () => {
    try {
      await action();
    } catch (err) {
      setStatus(err.message, true);
    }
  };
}

async function init() {
  const [{ [COUNTERS_KEY]: counters = {} }, { [PENDING_KEY]: savedPending = {} }] = await Promise.all([
    chrome.storage.sync.get(COUNTERS_KEY),
    chrome.storage.local.get(PENDING_KEY),
  ]);
  store = new RotationStore(counters);
  pending = savedPending;

  // activeTab gives us the URL of the tab the popup was opened on.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https?:/.test(tab.url ?? "")) {
    tabId = tab.id;
    tabDomain = normalizeDomain(new URL(tab.url).hostname);
    $("domain").value = tabDomain;
    $("master").focus();
  } else {
    $("domain").focus();
    setStatus("Not on a website: you can still type a site and copy its password.");
  }

  $("domain").addEventListener("input", render);
  $("master").addEventListener("input", hideOutput);
  $("master").addEventListener(
    "keydown",
    (e) => e.key === "Enter" && handle(!$("fill").disabled && $("rotate-panel").hidden ? onFill : onShow)()
  );

  $("fill").addEventListener("click", handle(onFill));
  $("copy").addEventListener("click", handle(onCopy));
  $("show").addEventListener("click", handle(onShow));
  $("start-rotation").addEventListener("click", handle(onStartRotation));
  $("fill-change").addEventListener("click", handle(onFillChange));
  $("copy-current").addEventListener("click", handle(onCopyCurrent));
  $("copy-new").addEventListener("click", handle(onCopyNew));
  $("confirm-rotation").addEventListener("click", handle(onConfirmRotation));
  $("cancel-rotation").addEventListener("click", handle(onCancelRotation));
  $("counter-down").addEventListener("click", handle(() => onStepCounter(-1)));
  $("counter-up").addEventListener("click", handle(() => onStepCounter(1)));

  render();
}

handle(init)();
