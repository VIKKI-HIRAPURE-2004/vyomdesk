// role management e2e: promote tech->viewer->admin, self-demotion blocked,
// non-admin forbidden, invalid role rejected. Run: node test/e2e/roles-test.mjs
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

// fresh non-admin
const email = `roles-${ts}@test.local`;
const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ email, name: "Roles Test", password: "TestPass123!" }) });
check("register fresh user", reg.status === 201 || reg.status === 200, `status=${reg.status}`);
check("fresh user is tech", reg.body?.user?.role === "tech", `role=${reg.body?.user?.role}`);
const userId = reg.body?.user?.id;

const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "TestPass123!" }) });
const token = login.body?.token;
check("login fresh user", login.status === 200);

// non-admin cannot change roles (even their own)
const forbidden = await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }), headers: { Authorization: `Bearer ${token}` } });
check("non-admin PATCH 403", forbidden.status === 403, `status=${forbidden.status}`);

// admin login
const adminLogin = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }) });
const auth = { Authorization: `Bearer ${adminLogin.body?.token}` };
const adminId = adminLogin.body?.user?.id;
check("admin login", adminLogin.status === 200);

// invalid role
const badRole = await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "superhacker" }), headers: auth });
check("invalid role rejected", badRole.status === 400, `status=${badRole.status}`);

// promote to viewer
const toViewer = await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "viewer" }), headers: auth });
check("promote to viewer", toViewer.status === 200 && toViewer.body?.user?.role === "viewer", `status=${toViewer.status}`);

// promote to admin
const toAdmin = await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }), headers: auth });
check("promote to admin", toAdmin.status === 200 && toAdmin.body?.user?.role === "admin", `status=${toAdmin.status}`);

// demote back to tech
const toTech = await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "tech" }), headers: auth });
check("demote to tech", toTech.status === 200 && toTech.body?.user?.role === "tech", `status=${toTech.status}`);

// self-demotion blocked
const selfDemote = await api(`/users/${adminId}`, { method: "PATCH", body: JSON.stringify({ role: "tech" }), headers: auth });
check("self-demotion blocked 400", selfDemote.status === 400, `status=${selfDemote.status}`);

// self-staying-admin is a no-op success (not blocked)
const selfKeep = await api(`/users/${adminId}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }), headers: auth });
check("self keep admin ok", selfKeep.status === 200, `status=${selfKeep.status}`);

// unknown user 404
const missing = await api("/users/00000000-0000-0000-0000-000000000000", { method: "PATCH", body: JSON.stringify({ role: "admin" }), headers: auth });
check("unknown user 404", missing.status === 404, `status=${missing.status}`);

if (failures > 0) { console.log(`[test] FAIL: ${failures} checks failed`); process.exit(1); }
console.log("[test] PASS: role management (promote/demote/self-guard/403/400/404)");
process.exit(0);