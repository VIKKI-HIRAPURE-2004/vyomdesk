// E2E recording test: start recording -> open relay desktop session ->
// collect frames -> stop -> verify row (frames>0, bytes>0) -> download file
// -> verify VYOMREC1 magic + parse frames -> delete.
// Covers P1.10 session recording.
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
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed, raw: text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const admin = await api("POST", "/api/v1/auth/login", null, {
    email: "e2e@test.local",
    password: "TestPass123!",
  });
  if (admin.status !== 200) throw new Error("login failed");
  const tok = admin.body.token;
  console.log("[test] login OK");

  const devs = await api("GET", "/api/v1/devices", tok);
  const device = devs.body.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  console.log("[test] online device:", device.id);

  // 1. start recording
  const started = await api("POST", `/api/v1/recordings/${device.id}/start`, tok, {});
  if (started.status !== 201) throw new Error("recording start failed: " + JSON.stringify(started.body));
  const recId = started.body.recording.id;
  console.log("[test] recording started:", recId);

  // 2. duplicate start -> 409
  const dup = await api("POST", `/api/v1/recordings/${device.id}/start`, tok, {});
  if (dup.status !== 409) throw new Error("expected 409 duplicate, got " + dup.status);
  console.log("[test] duplicate start rejected 409 OK");

  // 3. open a real desktop relay session to generate frames
  const sess = await api("POST", `/api/v1/devices/${device.id}/sessions`, tok, { channel: 2 });
  if (sess.status !== 200) throw new Error("session create failed");
  const ws = new WebSocket("ws://localhost:4430/relay.ashx");
  ws.binaryType = "arraybuffer";
  let frames = 0;
  ws.onopen = () => ws.send(sess.body.token);
  ws.onmessage = () => { frames++; };
  await sleep(5000);
  console.log("[test] frames received live:", frames);
  ws.close();
  await sleep(500);

  // 4. stop recording
  const stopped = await api("POST", `/api/v1/recordings/${device.id}/stop`, tok, {});
  if (stopped.status !== 200) throw new Error("stop failed: " + stopped.status);
  console.log("[test] recording stopped");
  // 5. list shows row with frames > 0
  const list = await api("GET", `/api/v1/recordings?deviceId=${device.id}`, tok);
  const row = list.body.recordings.find((r) => r.id === recId);
  if (!row) throw new Error("recording row missing");
  if (!(row.frames > 0)) throw new Error("no frames recorded (frames=" + row.frames + ")");
  if (!(row.bytes > 0)) throw new Error("no bytes recorded");
  console.log("[test] row OK: frames=" + row.frames + " bytes=" + row.bytes + " ended=" + row.ended_at);

  // 6. download + verify container format
  const dl = await fetch(`${BASE}/api/v1/recordings/${recId}/download`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (dl.status !== 200) throw new Error("download failed: " + dl.status);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.subarray(0, 8).toString("ascii") !== "VYOMREC1") throw new Error("bad magic");
  console.log("[test] download OK, magic VYOMREC1, size=" + buf.length);
  let off = 12;
  let parsed = 0;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off + 8);
    off += 12 + len;
    parsed++;
  }
  console.log("[test] parsed frames in file:", parsed, "(row said " + row.frames + ")");
  if (parsed !== row.frames) throw new Error("frame count mismatch: file " + parsed + " vs row " + row.frames);
  if (buf.length !== row.bytes) throw new Error("size mismatch: file " + buf.length + " vs row " + row.bytes);

  // 7. active-recording download guard
  const again = await api("POST", `/api/v1/recordings/${device.id}/start`, tok, {});
  if (again.status !== 201) throw new Error("second start failed: " + JSON.stringify(again.body));
  const guard = await fetch(`${BASE}/api/v1/recordings/${again.body.recording.id}/download`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (guard.status !== 409) throw new Error("expected 409 while active, got " + guard.status);
  await api("POST", `/api/v1/recordings/${device.id}/stop`, tok, {});
  console.log("[test] active-recording download blocked 409 OK");

  // 8. delete both recordings
  const del1 = await api("DELETE", `/api/v1/recordings/${recId}`, tok);
  const del2 = await api("DELETE", `/api/v1/recordings/${again.body.recording.id}`, tok);
  if (del1.status !== 204 || del2.status !== 204) throw new Error("delete failed");
  const after = await api("GET", `/api/v1/recordings?deviceId=${device.id}`, tok);
  if (after.body.recordings.some((r) => r.id === recId)) throw new Error("row not deleted");
  console.log("[test] rows deleted OK");

  console.log("[test] PASS: recording full cycle");
  process.exit(0);
}
main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});