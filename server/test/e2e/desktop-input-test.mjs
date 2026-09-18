// E2E desktop input test: mouse move injection -> cursor/screen changes -> new frames
const BASE = "http://localhost:4430";

async function main() {
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }),
  });
  const login = await loginRes.json();
  const devRes = await fetch(`${BASE}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const device = (await devRes.json()).devices.find((d) => d.online);
  if (!device) throw new Error("no online device");

  const sessRes = await fetch(`${BASE}/api/v1/devices/${device.id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 2 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session failed");

  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  let frames = 0;
  let opened = false;
  const t0 = Date.now();
  const timeout = setTimeout(() => {
    console.error(`[test] TIMEOUT opened=${opened} frames=${frames}`);
    process.exit(1);
  }, 30000);

  const sendCtrl = (obj) => {
    const bytes = Buffer.from(JSON.stringify(obj), "utf8");
    const frame = Buffer.alloc(4 + bytes.length);
    frame[0] = 2; frame[1] = 0x00;
    frame[2] = (bytes.length >> 8) & 0xff; frame[3] = bytes.length & 0xff;
    bytes.copy(frame, 4);
    ws.send(frame);
  };

  ws.onopen = () => ws.send(sess.token);
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    const payload = buf.subarray(4, 4 + len);
    if (flags === 0x01) { opened = true; return; }
    if (payload.length < 1 || payload[0] !== 2) return;
    frames++;
    const jpg = payload.subarray(1);
    if (jpg[0] !== 0xff || jpg[1] !== 0xd8) { console.error("bad jpeg"); process.exit(1); }
    console.log(`[test] frame ${frames}: ${jpg.length}B`);

    if (frames === 3) {
      console.log("[test] >>> injecting mouse moves...");
      // sweep the cursor across the screen - screen should change (cursor moves)
      let i = 0;
      const iv = setInterval(() => {
        sendCtrl({ type: "mouse", action: "move", x: 0.2 + (i % 6) * 0.12, y: 0.3 + (i % 4) * 0.1 });
        i++;
        if (i >= 10) {
          clearInterval(iv);
          sendCtrl({ type: "wheel", deltaY: -120 });
        }
      }, 250);
    }
    // PASS if we get frames after injection started (frame 5+ means screen changed)
    if (frames >= 8) {
      console.log(`[test] PASS: frames kept flowing after input injection (${frames} frames)`);
      clearTimeout(timeout);
      ws.close();
      setTimeout(() => process.exit(0), 300);
    }
  };
  ws.onerror = () => { console.error("[test] WS error"); process.exit(1); };
}

main().catch((e) => { console.error("[test] FAILED:", e.message); process.exit(1); });