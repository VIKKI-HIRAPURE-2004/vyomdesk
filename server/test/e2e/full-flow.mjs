// E2E: agent handshake (TOFU + challenge-response) + metrics + device API
import WebSocket from "ws";
import crypto from "node:crypto";

const BASE = "http://localhost:4430";

function log(...a) {
  console.log("[test]", ...a);
}

async function waitWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMsg(ws) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws timeout")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(String(raw)));
    });
    ws.once("close", (c, r) => {
      clearTimeout(t);
      reject(new Error(`closed ${c} ${r}`));
    });
  });
}

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// --- 1. TOFU first contact ---
const deviceId = "e2e-dev-" + crypto.randomBytes(4).toString("hex");
{
  const ws = await waitWs("ws://localhost:4430/agent.ashx");
  ws.send(
    JSON.stringify({
      v: 1,
      id: "1",
      cmd: "hello",
      ts: Date.now(),
      data: {
        deviceId,
        hostname: "e2e-box",
        version: "0.1.0",
        platform: "windows",
        platformVersion: "10.0",
        arch: "x64",
        hardwareId: "hw-" + deviceId,
        publicKey: null, // first contact without key — must still register + authOk
      },
    }),
  );
  const ack = await nextMsg(ws);
  if (ack.cmd !== "authOk") throw new Error("expected authOk, got " + ack.cmd);
  // metrics push
  ws.send(
    JSON.stringify({
      v: 1,
      id: "2",
      cmd: "metrics.push",
      ts: Date.now(),
      data: { cpuPct: 42.5, memPct: 61.2, uptimeS: 1000 },
    }),
  );
  // ping
  ws.send(JSON.stringify({ v: 1, id: "3", cmd: "ping", ts: Date.now() }));
  const pong = await nextMsg(ws);
  if (pong.cmd !== "pong") throw new Error("expected pong, got " + pong.cmd);
  ws.close();
  log("TOFU register + metrics + ping OK");
}

// --- 2. Challenge-response with Ed25519 ---
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubHex = publicKey.export({ format: "der", type: "spki" }).toString("hex");

  // first register with key
  {
    const ws = await waitWs("ws://localhost:4430/agent.ashx");
    ws.send(
      JSON.stringify({
        v: 1,
        id: "1",
        cmd: "hello",
        ts: Date.now(),
        data: { deviceId: deviceId + "-b", hostname: "e2e-box2", platform: "linux", arch: "amd64", publicKey: pubHex },
      }),
    );
    const ack = await nextMsg(ws);
    if (ack.cmd !== "authOk") throw new Error("expected authOk (with key), got " + ack.cmd);
    ws.close();
  }

  // reconnect → challenge
  const ws = await waitWs("ws://localhost:4430/agent.ashx");
  ws.send(
    JSON.stringify({
      v: 1,
      id: "1",
      cmd: "hello",
      ts: Date.now(),
      data: { deviceId: deviceId + "-b", hostname: "e2e-box2", platform: "linux" },
    }),
  );
  const ch = await nextMsg(ws);
  if (ch.cmd !== "challenge") throw new Error("expected challenge, got " + ch.cmd);
  const nonce = Buffer.from(ch.data.nonce, "base64");
  const sig = crypto.sign(null, nonce, privateKey);
  ws.send(JSON.stringify({ v: 1, id: "2", cmd: "auth", ts: Date.now(), data: { sig: sig.toString("base64") } }));
  const ok = await nextMsg(ws);
  if (ok.cmd !== "authOk") throw new Error("expected authOk after sig, got " + ok.cmd);
  ws.close();
  log("Ed25519 challenge-response OK");
}

// --- 3. Bad signature rejected ---
{
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const ws = await waitWs("ws://localhost:4430/agent.ashx");
  ws.send(
    JSON.stringify({
      v: 1,
      id: "1",
      cmd: "hello",
      ts: Date.now(),
      data: { deviceId: deviceId + "-b", hostname: "e2e-box2", platform: "linux" },
    }),
  );
  const ch = await nextMsg(ws);
  if (ch.cmd !== "challenge") throw new Error("expected challenge");
  const nonce = Buffer.from(ch.data.nonce, "base64");
  const sig = crypto.sign(null, nonce, privateKey); // WRONG key
  ws.send(JSON.stringify({ v: 1, id: "2", cmd: "auth", ts: Date.now(), data: { sig: sig.toString("base64") } }));
  const closed = await new Promise((resolve) => {
    ws.on("close", (c) => resolve(c));
  });
  if (closed !== 4001) throw new Error("expected close 4001, got " + closed);
  log("bad signature rejected OK");
}

// --- 4. REST: register + list + metrics ---
{
  const email = "e2e-" + crypto.randomBytes(4).toString("hex") + "@test.local";
  const r1 = await api("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name: "E2E", password: "password123" }),
  });
  if (r1.status !== 201) throw new Error("register failed " + JSON.stringify(r1.body));
  const r2 = await api("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (r2.status !== 200) throw new Error("login failed");
  const token = r2.body.token;

  const r3 = await api("/api/v1/devices", {
    headers: { Authorization: "Bearer " + token },
  });
  if (r3.status !== 200) throw new Error("device list failed " + JSON.stringify(r3.body));
  const found = r3.body.devices.find((d) => d.id === deviceId);
  if (!found) throw new Error("device not found in list");
  log("device list contains", found.name, "online:", found.online);

  const r4 = await api(`/api/v1/devices/${deviceId}/metrics`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (r4.status !== 200) throw new Error("metrics failed " + JSON.stringify(r4.body));
  if (!r4.body.samples.length) throw new Error("no metric samples");
  log("metrics samples:", r4.body.samples.length, "first cpu:", r4.body.samples[0].cpu_pct);
}

console.log("ALL E2E PASSED");
process.exit(0);
