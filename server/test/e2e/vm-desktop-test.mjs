// VM desktop test: open channel 2, count meta + JPEG frames from GDI capture
const BASE = "http://localhost:4430";
const VM_DEVICE = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }),
  });
  const login = await loginRes.json();
  if (!loginRes.ok) throw new Error("login failed");

  const sessRes = await fetch(`${BASE}/api/v1/devices/${VM_DEVICE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 2 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session create failed: " + JSON.stringify(sess));
  console.log("[desk-test] session token OK (channel 2)");

  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  let meta = null, frames = 0, bytes = 0, errText = null, acked = false;

  ws.onopen = () => { console.log("[desk-test] relay WS open"); ws.send(sess.token); };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    const payload = buf.subarray(4, 4 + len);
    if (flags === 0x01) { acked = true; console.log("[desk-test] channel open ack"); return; }
    if (payload.length === 0) return;
    const msgType = payload[0];
    const body = Buffer.from(payload.subarray(1));
    if (msgType === 1) { meta = body.toString("utf8"); console.log("[desk-test] META:", meta); }
    else if (msgType === 2) { frames++; bytes += body.length; if (frames <= 2) console.log(`[desk-test] JPEG frame #${frames}: ${body.length}B`); }
    else if (msgType === 3) { errText = body.toString("utf8"); console.error("[desk-test] AGENT ERROR:", errText); }
    else { console.log(`[desk-test] unknown msgType ${msgType}: ${body.length}B`); }
  };
  ws.onerror = (e) => { console.error("[desk-test] WS error:", e.message); process.exit(1); };
  ws.onclose = () => { console.log("[desk-test] WS closed"); };

  await sleep(10000);
  console.log(`--- RESULT: ack=${acked} meta=${meta ? "yes" : "NO"} frames=${frames} totalBytes=${bytes} err=${errText}`);
  ws.close();
  process.exit(frames > 0 ? 0 : 1);
}
main().catch((e) => { console.error("[desk-test] FAIL:", e.message); process.exit(1); });
