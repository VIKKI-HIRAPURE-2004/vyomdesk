// VM relay test: terminal round-trip against the VM agent (DESKTOP-56R4H9D)
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
  console.log("[vm-test] login OK");

  const sessRes = await fetch(`${BASE}/api/v1/devices/${VM_DEVICE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 1 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session create failed: " + JSON.stringify(sess));
  console.log("[vm-test] session token OK");

  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  let output = "";
  const timeout = setTimeout(() => {
    console.error("[vm-test] TIMEOUT waiting for VM terminal output. got:", JSON.stringify(output));
    process.exit(1);
  }, 25000);

  ws.onopen = () => {
    console.log("[vm-test] relay WS open");
    ws.send(sess.token);
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = new Uint8Array(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    const payload = Buffer.from(buf.subarray(4, 4 + len)).toString("utf8");
    if (flags === 0x01) {
      console.log("[vm-test] channel open ack");
      const cmd = "echo VM-RELAY-OK-98765\r\n";
      const bytes = Buffer.from(cmd, "utf8");
      const frame = Buffer.alloc(4 + bytes.length);
      frame[0] = 1; frame[1] = 0x00; frame[2] = bytes.length >> 8; frame[3] = bytes.length & 0xff;
      bytes.copy(frame, 4);
      ws.send(frame);
      console.log("[vm-test] sent: echo VM-RELAY-OK-98765");
    } else {
      output += payload;
      if (output.includes("VM-RELAY-OK-98765")) {
        console.log("[vm-test] ROUND-TRIP OUTPUT RECEIVED from VM:");
        console.log(output.split("\n").map((l) => "  | " + l.trim()).filter((l) => l.trim() !== "| ").slice(0, 12).join("\n"));
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
    }
  };
  ws.onerror = (e) => { console.error("[vm-test] WS error:", e.message); process.exit(1); };
}
main().catch((e) => { console.error("[vm-test] FAIL:", e.message); process.exit(1); });
