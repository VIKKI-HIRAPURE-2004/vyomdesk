// E2E relay test: login -> create session -> WS relay -> run command -> get output
const BASE = "http://localhost:4430";

async function main() {
  // 1. login
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }),
  });
  const login = await loginRes.json();
  if (!loginRes.ok) throw new Error("login failed: " + JSON.stringify(login));
  console.log("[test] login OK");

  // 2. device list -> find real agent
  const devRes = await fetch(`${BASE}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const devs = await devRes.json();
  const device = devs.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  console.log("[test] online device:", device.id, device.name);

  // 3. create relay session (terminal channel = 1)
  const sessRes = await fetch(`${BASE}/api/v1/devices/${device.id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 1 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session create failed: " + JSON.stringify(sess));
  console.log("[test] relay session token OK");

  // 4. connect WS and send token
  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  let gotOutput = false;
  const timeout = setTimeout(() => {
    console.error("[test] TIMEOUT waiting for terminal output");
    process.exit(1);
  }, 20000);

  ws.onopen = () => {
    console.log("[test] relay WS open, sending token");
    ws.send(sess.token);
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    const payload = Buffer.from(buf.subarray(4, 4 + len)).toString("utf8");
    if (flags === 0x01) {
      console.log("[test] channel open ack received");
      // send a command: echo vyomrelay-test-123
      const cmd = "echo vyomrelay-test-123\r\n";
      const bytes = Buffer.from(cmd, "utf8");
      const frame = Buffer.alloc(4 + bytes.length);
      frame[0] = 1; // channel
      frame[1] = 0x00; // data
      frame[2] = (bytes.length >> 8) & 0xff;
      frame[3] = bytes.length & 0xff;
      bytes.copy(frame, 4);
      ws.send(frame);
      return;
    }
    if (payload.includes("vyomrelay-test-123")) {
      gotOutput = true;
      console.log("[test] >>> terminal output received, contains marker:", JSON.stringify(payload.slice(0, 120)));
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    } else if (payload.length) {
      console.log("[test] output chunk:", JSON.stringify(payload.slice(0, 80)));
    }
  };
  ws.onerror = (e) => {
    console.error("[test] WS error", e.message ?? "");
    process.exit(1);
  };
  ws.onclose = (e) => {
    if (!gotOutput) {
      console.error("[test] closed before output, code:", e.code, e.reason);
      process.exit(1);
    }
  };
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});
