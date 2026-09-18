// E2E files relay test: login -> session(ch5) -> WS -> root/list/upload/download/mkdir/rename/delete
const BASE = "http://localhost:4430";

function frame(obj) {
  const bytes = Buffer.from(JSON.stringify(obj), "utf8");
  const f = Buffer.alloc(4 + bytes.length);
  f[0] = 5; // channel 5
  f[1] = 0x00;
  f[2] = (bytes.length >> 8) & 0xff;
  f[3] = bytes.length & 0xff;
  bytes.copy(f, 4);
  return f;
}

async function main() {
  // 1. login
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e@test.local", password: "TestPass123!" }),
  });
  if (!loginRes.ok) throw new Error("login failed");
  const login = await loginRes.json();
  console.log("[test] login OK");

  // 2. online device
  const devRes = await fetch(`${BASE}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const devs = await devRes.json();
  const device = devs.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  console.log("[test] online device:", device.id);

  // 3. files session (channel 5)
  const sessRes = await fetch(`${BASE}/api/v1/devices/${device.id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ channel: 5 }),
  });
  const sess = await sessRes.json();
  if (!sessRes.ok) throw new Error("session create failed: " + JSON.stringify(sess));
  console.log("[test] files session token OK");

  // 4. WS + helpers
  const ws = new WebSocket(`ws://localhost:4430/relay.ashx`);
  ws.binaryType = "arraybuffer";
  const timeout = setTimeout(() => {
    console.error("[test] TIMEOUT");
    process.exit(1);
  }, 30000);

  const waiters = [];
  const waitMsg = (pred) => new Promise((resolve) => waiters.push({ pred, resolve }));
  const dlChunks = new Map();
  let opened = false;

  ws.onopen = () => ws.send(sess.token);
  ws.onerror = () => { console.error("[test] WS error"); process.exit(1); };

  ws.onmessage = (e) => {
    if (typeof e.data === "string") return;
    const buf = Buffer.from(e.data);
    const flags = buf[1];
    const len = (buf[2] << 8) | buf[3];
    if (flags === 0x01) { opened = true; console.log("[test] channel open ack"); return; }
    const payload = buf.subarray(4, 4 + len);
    if (payload.length < 1) return;
    const msgType = payload[0];
    const body = payload.subarray(1);
    if (msgType === 2) {
      const seq = body.readUInt32BE(0);
      const parts = dlChunks.get(seq) ?? [];
      parts.push(body.subarray(12));
      dlChunks.set(seq, parts);
      ws.send(frame({ type: "dl-ack", seq }));
      return;
    }
    if (msgType === 1) {
      const msg = JSON.parse(body.toString("utf8"));
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].pred(msg)) {
          const w = waiters[i];
          waiters.splice(i, 1);
          w.resolve(msg);
          return;
        }
      }
      if (msg.type === "error") {
        console.error("[test] agent error:", msg.message);
        process.exit(1);
      }
    }
  };

  const openP = new Promise((res) => {
    const t = setInterval(() => { if (opened) { clearInterval(t); res(); } }, 50);
  });
  await openP;

  let seq = 0;
  const nextSeq = () => ++seq;

  // ---- root ----
  ws.send(frame({ type: "root" }));
  const root = await waitMsg((m) => m.type === "root");
  console.log("[test] root: home=%s sep=%j drives=%j", root.home, root.sep, root.drives);
  if (!root.home) throw new Error("no home in root");

  // ---- list home ----
  const lseq = nextSeq();
  ws.send(frame({ type: "list", path: root.home, seq: lseq }));
  const list = await waitMsg((m) => m.type === "list" && m.seq === lseq);
  console.log("[test] list %s: %d entries", list.path, (list.entries ?? []).length);

  // ---- mkdir temp dir ----
  const testDir = root.sep === "\\" ? process.env.TEMP + "\\vyom-e2e-" + Date.now() : "/tmp/vyom-e2e-" + Date.now();
  const mseq = nextSeq();
  ws.send(frame({ type: "mkdir", path: testDir, seq: mseq }));
  const mk = await waitMsg((m) => m.type === "ok" && m.seq === mseq);
  console.log("[test] mkdir OK:", testDir);

  // ---- upload ----
  const upPath = testDir + root.sep + "upload-test.txt";
  const upContent = Buffer.from("hello vyomdesk files channel\n".repeat(60), "utf8");
  const useq = nextSeq();
  ws.send(frame({ type: "upload", path: upPath, seq: useq }));
  await waitMsg((m) => m.type === "upload-ack" && m.seq === useq);
  console.log("[test] upload-ack OK");
  ws.send(frame({ type: "upload-data", seq: useq, data: upContent.toString("base64") }));
  await waitMsg((m) => m.type === "upload-progress" && m.seq === useq);
  ws.send(frame({ type: "upload-done", seq: useq }));
  const upOk = await waitMsg((m) => m.type === "upload-ok" && m.seq === useq);
  if (upOk.size !== upContent.length) throw new Error(`upload size mismatch: ${upOk.size} != ${upContent.length}`);
  console.log("[test] upload-ok size verified:", upOk.size);

  // ---- list the temp dir (see the file) ----
  const lseq2 = nextSeq();
  ws.send(frame({ type: "list", path: testDir, seq: lseq2 }));
  const list2 = await waitMsg((m) => m.type === "list" && m.seq === lseq2);
  const found = (list2.entries ?? []).find((e) => e.name === "upload-test.txt");
  if (!found) throw new Error("uploaded file not visible in listing");
  console.log("[test] uploaded file visible in listing:", found.size, "bytes");

  // ---- download + verify bytes ----
  const dseq = nextSeq();
  dlChunks.set(dseq, []);
  ws.send(frame({ type: "download", path: upPath, seq: dseq }));
  const dlStart = await waitMsg((m) => m.type === "download-start" && m.seq === dseq);
  console.log("[test] download-start size:", dlStart.size);
  if (dlStart.size !== upContent.length) throw new Error("download size mismatch at start");
  await waitMsg((m) => m.type === "download-end" && m.seq === dseq);
  const got = Buffer.concat(dlChunks.get(dseq) ?? []);
  if (!got.equals(upContent)) throw new Error(`download mismatch: got ${got.length}B want ${upContent.length}B`);
  console.log("[test] download bytes verified:", got.length, "bytes");

  // ---- rename ----
  const rseq = nextSeq();
  const renamed = testDir + root.sep + "renamed.txt";
  ws.send(frame({ type: "rename", from: upPath, to: renamed, seq: rseq }));
  await waitMsg((m) => m.type === "ok" && m.op === "rename" && m.seq === rseq);
  console.log("[test] rename OK");

  // ---- delete file then dir ----
  const dseq2 = nextSeq();
  ws.send(frame({ type: "delete", path: renamed, seq: dseq2 }));
  await waitMsg((m) => m.type === "ok" && m.op === "delete" && m.seq === dseq2);
  const dseq3 = nextSeq();
  ws.send(frame({ type: "delete", path: testDir, seq: dseq3 }));
  await waitMsg((m) => m.type === "ok" && m.op === "delete" && m.seq === dseq3);
  console.log("[test] delete file + dir OK");

  console.log("[test] PASS: files channel full cycle");
  clearTimeout(timeout);
  ws.close();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});