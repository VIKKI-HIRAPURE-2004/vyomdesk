// E2E quick-support test: create code (auth) -> masked list -> public redeem
// (no auth) -> wrong password -> single-use burn -> revoke.
// Covers the GetScreen-style ad-hoc support flow (P1.7).
const BASE = "http://localhost:4430";

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  // login as admin
  const admin = await api("POST", "/api/v1/auth/login", null, {
    email: "e2e@test.local",
    password: "TestPass123!",
  });
  if (admin.status !== 200) throw new Error("admin login failed");
  const adminTok = admin.body.token;
  console.log("[test] admin login OK");

  // online device needed
  const devs = await api("GET", "/api/v1/devices", adminTok);
  const device = devs.body.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  console.log("[test] online device:", device.id);

  // 1. create a code WITH password
  const created = await api("POST", `/api/v1/quick-support/${device.id}`, adminTok, {
    password: "help123",
  });
  if (created.status !== 201) throw new Error("code create failed: " + JSON.stringify(created.body));
  const code = created.body.code;
  if (!/^\d{9}$/.test(code)) throw new Error("code not 9 digits: " + code);
  console.log("[test] code created (9 digits OK), expires:", created.body.expiresAt);

  // 2. masked list shows it
  const list = await api("GET", `/api/v1/quick-support/${device.id}`, adminTok);
  if (list.status !== 200) throw new Error("list failed: " + list.status);
  const masked = list.body.codes.find((c) => c.code.includes("***"));
  if (!masked) throw new Error("masked code missing in list");
  console.log("[test] masked list OK:", masked.code);

  // 3. public redeem with WRONG password -> 401
  const bad = await api("POST", "/api/v1/quick-support/redeem", null, {
    code,
    password: "wrong-pass",
    channel: 2,
  });
  if (bad.status !== 401) throw new Error("expected 401 wrong password, got " + bad.status);
  console.log("[test] wrong password rejected 401 OK");

  // 4. public redeem (no auth header at all) with right password -> token
  const good = await api("POST", "/api/v1/quick-support/redeem", null, {
    code,
    password: "help123",
    channel: 2,
  });
  if (good.status !== 200) throw new Error("redeem failed: " + JSON.stringify(good.body));
  if (!good.body.token) throw new Error("no token in redeem response");
  console.log("[test] public redeem OK (token issued, wsUrl:", good.body.wsUrl + ")");

  // 5. code is single-use: second redeem -> 409
  const second = await api("POST", "/api/v1/quick-support/redeem", null, {
    code,
    password: "help123",
    channel: 2,
  });
  if (second.status !== 409) throw new Error("expected 409 reuse, got " + second.status);
  console.log("[test] single-use burn enforced 409 OK");

  // 6. invalid code format rejected
  const badCode = await api("POST", "/api/v1/quick-support/redeem", null, {
    code: "12345",
    channel: 2,
  });
  if (badCode.status !== 400) throw new Error("expected 400 invalid code, got " + badCode.status);
  console.log("[test] invalid code format rejected 400 OK");

  // 7. revoke flow: create, revoke, redeem -> 404
  const c2 = await api("POST", `/api/v1/quick-support/${device.id}`, adminTok, {});
  const code2 = c2.body.code;
  const rev = await api("DELETE", `/api/v1/quick-support/${device.id}`, adminTok, { code: code2 });
  if (rev.status !== 204) throw new Error("revoke failed: " + rev.status);
  const afterRevoke = await api("POST", "/api/v1/quick-support/redeem", null, {
    code: code2,
    channel: 2,
  });
  if (afterRevoke.status !== 404) throw new Error("expected 404 after revoke, got " + afterRevoke.status);
  console.log("[test] revoke -> 404 on redeem OK");

  console.log("[test] PASS: quick-support full cycle");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});