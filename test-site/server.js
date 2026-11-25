/**
 * test-site/server.js — a fake website to try the Passrotor extension on,
 * without risking a real account. Run with: npm run test-site
 * (or: node test-site/server.js), then open http://localhost:8080
 *
 * No dependencies, Node only. Everything is kept in memory, so restarting
 * the server wipes all accounts — handy for testing drift on purpose.
 *
 * Pages:
 *   /register                      sign up (password + confirm)
 *   /login                         log in
 *   /account                       shows what the site has stored (THIS IS A TEST SITE: it shows passwords)
 *   /change-password               well-labelled form (autocomplete="current-password"/"new-password")
 *   /change-password?variant=plain unlabelled form (fields p1/p2/p3), tests the popup's fallback heuristic
 *   /reset                         wipe all accounts and sessions
 *
 * Always use http://localhost:8080, not 127.0.0.1: Passrotor treats those as
 * two different sites (it derives passwords from the hostname, port ignored).
 */

const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 8080;

/** username -> { password, history: [{ at, event }] } */
const users = new Map();
/** sessionId -> username */
const sessions = new Map();

// --- Helpers -----------------------------------------------------------------

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} · Rotor Test Site</title>
  <style>
    body { max-width: 440px; margin: 40px auto; padding: 0 16px; font: 15px/1.5 system-ui, sans-serif; color: #1d1d1f; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; margin-bottom: 20px; }
    header a { font-size: 13px; }
    label { display: block; margin-bottom: 12px; font-weight: 600; }
    input { box-sizing: border-box; width: 100%; margin-top: 4px; padding: 8px; font: inherit; border: 1px solid #c7c7cc; border-radius: 6px; }
    button { padding: 8px 14px; font: inherit; border: none; border-radius: 6px; background: #2f6fde; color: #fff; cursor: pointer; }
    .error { padding: 8px 12px; border-radius: 6px; background: #fdecea; color: #c0392b; }
    .ok { padding: 8px 12px; border-radius: 6px; background: #e8f6ec; color: #1e7b34; }
    .debug { margin-top: 24px; padding: 10px 12px; border: 1px dashed #f0c36d; border-radius: 6px; background: #fff8e6; font-size: 13px; }
    code { font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
    ul { padding-left: 18px; }
  </style>
</head>
<body>
  <header>
    <h2>🧪 Rotor Test Site</h2>
    <a href="/reset">reset everything</a>
  </header>
  ${body}
</body>
</html>`;
}

function notice(params) {
  if (params.error) return `<p class="error">${escapeHtml(params.error)}</p>`;
  if (params.ok) return `<p class="ok">${escapeHtml(params.ok)}</p>`;
  return "";
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

function withMessage(path, key, message) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy(new Error("body too large"));
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function currentUser(req) {
  const match = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie ?? "");
  const username = match && sessions.get(match[1]);
  return username && users.has(username) ? username : null;
}

function log(username, event) {
  users.get(username).history.push({ at: new Date().toLocaleTimeString(), event });
}

// --- Pages -------------------------------------------------------------------

function loginPage(params) {
  return page("Log in", `
  <h3>Log in</h3>
  ${notice(params)}
  <form method="post" action="/login">
    <label>Username <input name="username" autocomplete="username" value="${escapeHtml(params.username ?? "")}" required></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
    <button>Log in</button>
  </form>
  <p>No account? <a href="/register">Register</a></p>`);
}

function registerPage(params) {
  return page("Register", `
  <h3>Register</h3>
  ${notice(params)}
  <p>Tip: type a username, then use Passrotor's <strong>Fill login</strong>: it fills both password fields with your rotation-0 password.</p>
  <form method="post" action="/register">
    <label>Username <input name="username" autocomplete="username" required></label>
    <label>Password <input name="password" type="password" autocomplete="new-password" required></label>
    <label>Confirm password <input name="confirm_password" type="password" autocomplete="new-password" required></label>
    <button>Create account</button>
  </form>
  <p>Already registered? <a href="/login">Log in</a></p>`);
}

function accountPage(username, params) {
  const user = users.get(username);
  const history = user.history.map((h) => `<li>${escapeHtml(h.at)} · ${escapeHtml(h.event)}</li>`).join("");
  return page("Account", `
  <h3>Hi, ${escapeHtml(username)} 👋</h3>
  ${notice(params)}
  <p>You're logged in.</p>
  <ul>
    <li><a href="/change-password">Change password</a> (well-labelled form)</li>
    <li><a href="/change-password?variant=plain">Change password</a> (unlabelled form, tests the fallback)</li>
  </ul>
  <form method="post" action="/logout"><button>Log out</button></form>
  <div class="debug">
    <strong>Debug (test site only):</strong> the site currently stores<br>
    <code>${escapeHtml(user.password)}</code>
    <p>Compare it with Passrotor's <em>Show</em>. History:</p>
    <ul>${history}</ul>
  </div>`);
}

function changePasswordPage(params) {
  const plain = params.variant === "plain";
  // The plain variant has no autocomplete hints and meaningless names, like
  // many real sites; the popup must fall back to "current, new, confirm" order.
  const fields = plain
    ? `
    <label>Password <input name="p1" id="p1" type="password" required></label>
    <label>Password <input name="p2" id="p2" type="password" required></label>
    <label>Password again <input name="p3" id="p3" type="password" required></label>`
    : `
    <label>Current password <input name="current_password" id="current_password" type="password" autocomplete="current-password" required></label>
    <label>New password <input name="new_password" id="new_password" type="password" autocomplete="new-password" required></label>
    <label>Confirm new password <input name="confirm_password" id="confirm_password" type="password" autocomplete="new-password" required></label>`;
  return page("Change password", `
  <h3>Change password${plain ? " (unlabelled)" : ""}</h3>
  ${notice(params)}
  <p>In Passrotor: <strong>Rotate this site's password…</strong> → <strong>Fill change form</strong>, then submit here.</p>
  <form method="post" action="/change-password${plain ? "?variant=plain" : ""}">
    ${fields}
    <button>Change password</button>
  </form>
  <p><a href="/account">Back to account</a></p>`);
}

// --- Handlers ----------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const params = Object.fromEntries(url.searchParams);
  const username = currentUser(req);
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case "GET /":
      return redirect(res, username ? "/account" : "/login");

    case "GET /login":
      return send(res, 200, loginPage(params));

    case "POST /login": {
      const form = await readForm(req);
      const user = users.get(form.username);
      if (!user || user.password !== form.password) {
        if (user) log(form.username, "failed login (wrong password)");
        return redirect(res, withMessage(`/login?username=${encodeURIComponent(form.username ?? "")}`, "error", "Wrong username or password."));
      }
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, form.username);
      log(form.username, "logged in");
      return redirect(res, "/account", { "Set-Cookie": `session=${sessionId}; HttpOnly; SameSite=Lax; Path=/` });
    }

    case "GET /register":
      return send(res, 200, registerPage(params));

    case "POST /register": {
      const form = await readForm(req);
      if (!form.username || !form.password) return redirect(res, withMessage("/register", "error", "Fill in all fields."));
      if (users.has(form.username)) return redirect(res, withMessage("/register", "error", "That username is taken."));
      if (form.password !== form.confirm_password) return redirect(res, withMessage("/register", "error", "The passwords don't match."));
      users.set(form.username, { password: form.password, history: [] });
      log(form.username, "registered");
      return redirect(res, withMessage(`/login?username=${encodeURIComponent(form.username)}`, "ok", "Account created. Now log in."));
    }

    case "GET /account":
      if (!username) return redirect(res, "/login");
      return send(res, 200, accountPage(username, params));

    case "GET /change-password":
      if (!username) return redirect(res, "/login");
      return send(res, 200, changePasswordPage(params));

    case "POST /change-password": {
      if (!username) return redirect(res, "/login");
      const form = await readForm(req);
      const plain = params.variant === "plain";
      const current = plain ? form.p1 : form.current_password;
      const next = plain ? form.p2 : form.new_password;
      const confirm = plain ? form.p3 : form.confirm_password;
      const back = plain ? "/change-password?variant=plain" : "/change-password";
      const user = users.get(username);

      if (current !== user.password) {
        log(username, "change-password rejected (wrong current password)");
        return redirect(res, withMessage(back, "error", "Current password is wrong."));
      }
      if (!next || next !== confirm) return redirect(res, withMessage(back, "error", "The new passwords don't match."));
      if (next === current) return redirect(res, withMessage(back, "error", "The new password must be different."));

      user.password = next;
      log(username, `password changed${plain ? " (unlabelled form)" : ""}`);
      return redirect(res, withMessage("/account", "ok", "Password changed. Now click “It worked” in Passrotor."));
    }

    case "POST /logout":
      return redirect(res, "/login", { "Set-Cookie": "session=; Max-Age=0; Path=/" });

    case "GET /reset":
      users.clear();
      sessions.clear();
      return redirect(res, withMessage("/register", "ok", "Everything was wiped."));

    default:
      return send(res, 404, page("Not found", `<p>Nothing here. <a href="/">Home</a></p>`));
  }
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, page("Error", `<p class="error">${escapeHtml(err.message)}</p>`));
    });
  })
  .listen(PORT, () => {
    console.log(`Rotor Test Site running at http://localhost:${PORT}`);
    console.log("Accounts live in memory only: restarting the server wipes them.");
  });
