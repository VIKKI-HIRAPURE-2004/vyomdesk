// E2E ConPTY terminal test: session(ch1) -> WS -> ANSI shell with resize.
// Responds to ConPTY handshake queries like a real terminal (xterm.js does
// this automatically; conhost waits for mode replies before feeding the
// shell). Marker-driven with generous budgets (cold conhost + defender).
const BASE = "http://localhost:4430";

function frameStr(s) {
  const bytes = Buffer.from(s, "utf8");
  const f = Buffer.alloc(4 + bytes.length);
  f[0] = 1;
  f[1] = 0x00;
  f[2] = (bytes.length >> 8) & 0xff;
  f[3] = bytes.length & 0xff;
  bytes.copy(f, 4);
  return f;
}

function resizeFrame(cols, rows) {
  // payload: [0x00][0x01][cols:2 BE][rows:2 BE] = 6 bytes
  const f = Buffer.alloc(10);
  f[0] = 1;
  f[1] = 0x00;
  f[2] = 0;
  f[3] = 6;
  f[4] = 0x00;
  f[5] = 0x01;
  f[6] = (cols >> 8) & 0xff;
  f[7] = cols & 0xff;
  f[8] = (rows >> 8) & 0xff;
  f[9] = rows & 0xff;
  return f;
}

async function main() {
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }),
  });
  if (!loginRes.ok) throw new Error("login failed");
  const { token } = await loginRes.json();

  const devRes = await fetch(`${BASE}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const device = (await devRes.json()).devices.find((d) => d.online);
  if (!device) throw new Error("no online device");

  const sessRes = await fetch(`${BASE}/api/v1/devices/${device.id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: 1 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session failed");

  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";

  let out = "";
  const waitUntil = (pred, label, ms = 180000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (pred()) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          reject(new Error(`timeout waiting for ${label} (got ${out.length}B: ${JSON.stringify(out.slice(-120))})`));
        }
      }, 100);
    });

  const openedP = new Promise((r) => {
    ws.onopen = () => ws.send(sess.token);
    ws.onmessage = (e) => {
      if (typeof e.data === "string") return;
      const buf = Buffer.from(e.data);
      if (buf[1] === 0x01) return r(); // open ack
      const len = (buf[2] << 8) | buf[3];
      const chunk = buf.subarray(4, 4 + len).toString("utf8");
      out += chunk;
      // terminal emulation: reply to ConPTY mode queries so conhost
      // finishes init and starts feeding the shell (xterm.js does this)
      if (chunk.includes("\x1b[?9001h")) ws.send(frameStr("\x1b[?9001;2$y"));
      if (chunk.includes("\x1b[?1004h")) ws.send(frameStr("\x1b[?1004;2$y"));
    };
  });
  await openedP;
  console.log("[test] open ack");

  ws.send(frameStr("echo conpty-e2e-42\r\n"));
  await waitUntil(() => out.includes("conpty-e2e-42"), "first marker");
  console.log("[test] marker echoed");
  console.log("[test] ANSI sequences present (ConPTY):", /\x1b\[/.test(out));

  ws.send(resizeFrame(90, 25));
  ws.send(frameStr("echo after-resize-7\r\n"));
  await waitUntil(() => out.includes("after-resize-7"), "post-resize marker");
  console.log("[test] survives resize");

  console.log("[test] PASS: ConPTY shell + resize");
  ws.close();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});