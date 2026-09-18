// E2E agent self-update test:
// 0.1.0 agent runs -> publish 0.2.0-test build -> POST /devices/:id/update
// -> agent downloads, verifies sha, swaps, acks, restarts with new version.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await api("POST", "/api/v1/auth/login", null, {
    email: "e2e@test.local",
    password: "TestPass123!",
  });
  const tok = login.body.token;

  // device info BEFORE
  const devs = await api("GET", "/api/v1/devices", tok);
  const device = devs.body.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  const before = await api("GET", `/api/v1/devices/${device.id}`, tok);
  const oldVersion = before.body.device.agentVersion;
  console.log("[test] agent version before:", oldVersion);

  // read the published manifest
  const manifestRes = await fetch(`${BASE}/downloads/agent/latest.json`);
  const manifest = await manifestRes.json();
  console.log("[test] manifest version:", manifest.version);
  if (!manifest.version || manifest.version === oldVersion)
    throw new Error("manifest version must differ from running version");

  // trigger the update
  const upd = await api("POST", `/api/v1/devices/${device.id}/update`, tok, {});
  console.log("[test] update push:", upd.status, JSON.stringify(upd.body));
  if (upd.status !== 202) throw new Error("update push failed: " + JSON.stringify(upd.body));

  // wait for reconnect with the new version (agent restarts; backoff up to ~30s)
  let newVersion = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const d = await api("GET", `/api/v1/devices/${device.id}`, tok);
    if (d.body.device.online && d.body.device.agentVersion === manifest.version) {
      newVersion = d.body.device.agentVersion;
      break;
    }
  }
  if (!newVersion) throw new Error("agent did not come back with the new version");
  console.log("[test] agent version after:", newVersion);

  // audit trail
  const updLog = await api("POST", `/api/v1/devices/${device.id}/update`, tok).catch(() => null);
  console.log("[test] PASS: agent self-updated", oldVersion, "->", newVersion);
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});