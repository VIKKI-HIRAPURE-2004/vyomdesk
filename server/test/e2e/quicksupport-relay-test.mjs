// E2E: redeem a quick-support code and open a real relay WS session (desktop ch2),
// verifying the guest end-to-end path: code -> token -> WS -> open-ack -> JPEG frames.
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
  const admin = await api("POST", "/api/v1/auth/login", null, {
    email: "e2e@test.local",
    password: "TestPass123!",
  });
  if (admin.status !== 200) throw new Error("login failed");
  const devs = await api("GET", "/api/v1/devices", admin.body.token);
  const device = devs.body.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");

  const created = await api("POST", `/api/v1/quick-support/${device.id}`, admin.body.token, {});
  if (created.status !== 201) throw new Error("code create failed");
  const code = created.body.code;
  console.log("[test] code created");

  const redeem = await api("POST", "/api/v1/quick-support/redeem", null, { code, channel: 2 });
  if (redeem.status !== 200) throw new Error("redeem failed: " + JSON.stringify(redeem.body));
  console.log("[test] redeemed, connecting WS with token");

  const ws = new WebSocket("ws://localhost:4430/relay.ashx");
  ws.binaryType = "arraybuffer";
  let gotAck = false;
  let gotFrame = false;
  const timeout = setTimeout(() => {
    console.error("[test] TIMEOUT: ack=" + gotAck + " frame=" + gotFrame);
    process.exit(1);
  }, 20000);

  ws.onopen = () => ws.send(redeem.body.token);
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    if (flags === 0x01 && !gotAck) {
      gotAck = true;
      console.log("[test] open-ack received (desktop channel live)");
      return;
    }
    const len = (buf[2] << 8) | buf[3];
    const payload = buf.subarray(4, 4 + len);
    if (payload.length >= 1 && payload[0] === 2) {
      // JPEG frame: check SOI marker FFD8
      if (payload.length > 2 && payload[1] === 0xff && payload[2] === 0xd8) {
        gotFrame = true;
        console.log("[test] JPEG frame received (" + payload.length + " bytes, SOI OK)");
        clearTimeout(timeout);
        ws.close();
        console.log("[test] PASS: quick-support guest relay session end-to-end");
        process.exit(0);
      }
    }
  };
  ws.onerror = () => {
    console.error("[test] WS error");
    process.exit(1);
  };
  ws.onclose = (e) => {
    if (!gotFrame) {
      console.error("[test] closed before frame, code:", e.code, e.reason);
      process.exit(1);
    }
  };
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});