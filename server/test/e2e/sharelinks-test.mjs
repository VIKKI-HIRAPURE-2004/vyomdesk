// E2E share-link test: create link (auth) -> masked list -> public resolve
// (no auth) -> wrong password -> multi-use (same link resolves twice!) ->
// custom expiry validation -> revoke.
// Covers guest share links (P1.8).
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

  // 1. create a link WITH password
  const created = await api("POST", `/api/v1/share-links/${device.id}`, adminTok, {
    password: "guest99",
    guestName: "Ravi",
  });
  if (created.status !== 201) throw new Error("link create failed: " + JSON.stringify(created.body));
  const slug = created.body.slug;
  if (created.body.url !== `/share/${slug}`) throw new Error("url mismatch: " + created.body.url);
  console.log("[test] link created, url:", created.body.url, "expires:", created.body.expiresAt);

  // 2. masked list shows it
  const list = await api("GET", `/api/v1/share-links/${device.id}`, adminTok);
  if (list.status !== 200) throw new Error("list failed: " + list.status);
  const masked = list.body.links.find((l) => l.slug.includes("***"));
  if (!masked) throw new Error("masked slug missing in list");
  if (masked.useCount !== 0) throw new Error("useCount should be 0, got " + masked.useCount);
  console.log("[test] masked list OK:", masked.slug, "useCount:", masked.useCount);

  // 3. public resolve with WRONG password -> 401
  const bad = await api("POST", "/api/v1/share-links/resolve", null, {
    slug,
    password: "wrong-pass",
    channel: 2,
  });
  if (bad.status !== 401) throw new Error("expected 401 wrong password, got " + bad.status);
  console.log("[test] wrong password rejected 401 OK");

  // 4. public resolve (no auth header) with right password -> token
  const good = await api("POST", "/api/v1/share-links/resolve", null, {
    slug,
    password: "guest99",
    channel: 2,
  });
  if (good.status !== 200) throw new Error("resolve failed: " + JSON.stringify(good.body));
  if (!good.body.token) throw new Error("no token in resolve response");
  console.log("[test] public resolve OK (token issued)");

  // 5. MULTI-USE: same link resolves again -> 200 (unlike quick-support!)
  const again = await api("POST", "/api/v1/share-links/resolve", null, {
    slug,
    password: "guest99",
    channel: 2,
  });
  if (again.status !== 200) throw new Error("expected 200 multi-use, got " + again.status);
  console.log("[test] multi-use OK (second resolve got fresh token)");

  // 6. use count incremented in list
  const list2 = await api("GET", `/api/v1/share-links/${device.id}`, adminTok);
  const used = list2.body.links.find((l) => l.useCount > 0);
  if (!used) throw new Error("useCount not incremented");
  console.log("[test] useCount incremented OK:", used.useCount);

  // 7. invalid slug rejected
  const badSlug = await api("POST", "/api/v1/share-links/resolve", null, {
    slug: "doesnotexist99",
    channel: 2,
  });
  if (badSlug.status !== 404) throw new Error("expected 404 unknown slug, got " + badSlug.status);
  console.log("[test] unknown slug 404 OK");

  // 8. custom expiry: past date rejected
  const pastExpiry = await api("POST", `/api/v1/share-links/${device.id}`, adminTok, {
    expiresAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  if (pastExpiry.status !== 400) throw new Error("expected 400 past expiry, got " + pastExpiry.status);
  console.log("[test] past expiresAt rejected 400 OK");

  // 9. revoke flow: create, revoke, resolve -> 409 conflict
  const c2 = await api("POST", `/api/v1/share-links/${device.id}`, adminTok, {});
  const slug2 = c2.body.slug;
  const rev = await api("DELETE", `/api/v1/share-links/${device.id}`, adminTok, { slug: slug2 });
  if (rev.status !== 204) throw new Error("revoke failed: " + rev.status);
  const afterRevoke = await api("POST", "/api/v1/share-links/resolve", null, {
    slug: slug2,
    channel: 2,
  });
  if (afterRevoke.status !== 409) throw new Error("expected 409 after revoke, got " + afterRevoke.status);
  console.log("[test] revoke -> 409 on resolve OK");

  console.log("[test] PASS: share-link full cycle");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});