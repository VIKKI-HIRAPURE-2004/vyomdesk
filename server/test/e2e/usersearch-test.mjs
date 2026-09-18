// user-directory e2e: admin search, non-admin forbidden, self lookup.
// Run: node test/e2e/usersearch-test.mjs   (server must be up on 4430)
const BASE = "http://localhost:4430/api/v1";
const ts = Date.now();

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`[test] ${name} OK`);
  else { console.log(`[test] ${name} FAIL ${extra}`); failures++; }
}

// register a fresh non-admin
const email = `usersearch-${ts}@test.local`;
const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ email, name: "User Search", password: "TestPass123!" }) });
check("register non-admin", reg.status === 201 || reg.status === 200, `status=${reg.status}`);

const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "TestPass123!" }) });
check("login", login.status === 200);
const token = login.body?.token;

// non-admin: must be 403
const forbidden = await api(`/users?q=x`, { headers: { Authorization: `Bearer ${token}` } });
check("non-admin 403", forbidden.status === 403, `status=${forbidden.status}`);

// admin
const adminLogin = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }) });
check("admin login", adminLogin.status === 200);
const adminToken = adminLogin.body?.token;
const auth = { Authorization: `Bearer ${adminToken}` };

// search finds the fresh user by email substring
const found = await api(`/users?q=${email}`, { headers: auth });
check("admin search finds fresh user", found.status === 200 && found.body?.users?.some((u) => u.email === email), `status=${found.status} count=${found.body?.users?.length}`);

// self is in the list
const self = await api(`/users?q=e2e@test.local`, { headers: auth });
check("admin search finds self", self.status === 200 && self.body?.users?.some((u) => u.email === "e2e@test.local"));

// limit honored
const limited = await api(`/users?q=test&limit=2`, { headers: auth });
check("limit honored", limited.status === 200 && limited.body?.users?.length <= 2, `count=${limited.body?.users?.length}`);

// no password_hash leak
const leaky = found.body?.users?.[0] || {};
check("no password_hash leak", !("password_hash" in leaky) && !("passwordHash" in leaky), JSON.stringify(leaky).slice(0, 120));

if (failures > 0) { console.log(`[test] FAIL: ${failures} checks failed`); process.exit(1); }
console.log("[test] PASS: user directory search (admin-only, no secrets)");
process.exit(0);