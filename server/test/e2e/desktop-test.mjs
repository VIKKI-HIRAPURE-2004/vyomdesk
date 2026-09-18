// E2E desktop relay test: login -> session(ch2) -> WS -> JPEG frame received
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

  // 2. online device
  const devRes = await fetch(`${BASE}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const devs = await devRes.json();
  const device = devs.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  console.log("[test] online device:", device.id, device.name);

  // 3. desktop session (channel 2)
  const sessRes = await fetch(`${BASE}/api/v1/devices/${device.id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 2 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session create failed: " + JSON.stringify(sess));
  console.log("[test] desktop session token OK");

  // 4. WS + token
  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  let opened = false;
  let frames = 0;
  const timeout = setTimeout(() => {
    console.error(`[test] TIMEOUT (opened=${opened} frames=${frames})`);
    process.exit(1);
  }, 25000);

  ws.onopen = () => {
    console.log("[test] relay WS open, sending token");
    ws.send(sess.token);
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    const payload = buf.subarray(4, 4 + len);
    if (flags === 0x01) {
      opened = true;
      console.log("[test] channel open ack received");
      return;
    }
    if (payload.length < 1) return;
    const msgType = payload[0];
    if (msgType === 1 || msgType === 3) {
      const meta = Buffer.from(payload.subarray(1)).toString("utf8");
      console.log("[test] meta:", meta.slice(0, 120));
      if (msgType === 3) {
        console.error("[test] agent error message");
        clearTimeout(timeout);
        process.exit(1);
      }
      return;
    }
    if (msgType === 2) {
      const jpg = payload.subarray(1);
      // JPEG SOI marker check
      if (jpg[0] !== 0xff || jpg[1] !== 0xd8) {
        console.error("[test] bad JPEG (no SOI marker):", jpg[0], jpg[1]);
        process.exit(1);
      }
      frames++;
      if (frames === 1) {
        console.log("[test] >>> first JPEG frame:", jpg.length, "bytes - changing quality...");
        // live quality change control message
        const ctrl = JSON.stringify({ type: "quality", value: 80 });
        const bytes = Buffer.from(ctrl, "utf8");
        const frame = Buffer.alloc(4 + bytes.length);
        frame[0] = 2; // channel 2
        frame[1] = 0x00;
        frame[2] = (bytes.length >> 8) & 0xff;
        frame[3] = bytes.length & 0xff;
        bytes.copy(frame, 4);
        ws.send(frame);
      }
      if (frames >= 3) {
        console.log(`[test] PASS: ${frames} JPEG frames received`);
        clearTimeout(timeout);
        ws.close();
        setTimeout(() => process.exit(0), 300);
      }
    }
  };
  ws.onerror = () => {
    console.error("[test] WS error");
    process.exit(1);
  };
  ws.onclose = (e) => {
    if (frames === 0) {
      console.error("[test] closed before frames, code:", e.code, e.reason);
      process.exit(1);
    }
  };
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});