// E2E groups + rights test: group CRUD -> device assignment -> permission
// grant/deny -> session-create rights enforcement via canUseChannel
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
  // login as the (admin) e2e user
  const admin = await api("POST", "/api/v1/auth/login", null, {
    email: "e2e@test.local",
    password: "TestPass123!",
  });
  if (admin.status !== 200) throw new Error("admin login failed");
  const adminTok = admin.body.token;
  console.log("[test] admin login OK");

  // 1. create group
  const gname = "e2e-group-" + Date.now();
  const created = await api("POST", "/api/v1/groups", adminTok, {
    name: gname,
    description: "e2e test group",
  });
  if (created.status !== 201) throw new Error("group create failed: " + JSON.stringify(created.body));
  const groupId = created.body.group.id;
  console.log("[test] group created:", groupId);

  // 2. duplicate name -> 409
  const dupe = await api("POST", "/api/v1/groups", adminTok, { name: gname });
  if (dupe.status !== 409) throw new Error("expected 409 for dupe, got " + dupe.status);
  console.log("[test] duplicate name rejected 409 OK");

  // 3. list groups
  const list = await api("GET", "/api/v1/groups", adminTok);
  const found = list.body.groups.find((g) => g.id === groupId);
  if (!found) throw new Error("created group not in list");
  console.log("[test] group listed:", found.name);

  // 4. register a second user to test permissions
  const uname = "tech-" + Date.now() + "@test.local";
  const reg = await api("POST", "/api/v1/auth/register", null, {
    email: uname,
    name: "Tech User",
    password: "TestPass123!",
  });
  if (reg.status !== 201) throw new Error("user register failed: " + JSON.stringify(reg.body));
  const techLogin = await api("POST", "/api/v1/auth/login", null, {
    email: uname,
    password: "TestPass123!",
  });
  const techTok = techLogin.body.token;
  const techId = reg.body.user.id;
  console.log("[test] tech user registered:", techId);

  // 5. tech cannot manage groups (403)
  const forbidden = await api("POST", "/api/v1/groups", techTok, { name: "nope-" + Date.now() });
  if (forbidden.status !== 403) throw new Error("expected 403 for tech group create, got " + forbidden.status);
  console.log("[test] tech group-create denied 403 OK");

  // 6. find an online device, assign it to the group
  const devs = await api("GET", "/api/v1/devices", adminTok);
  const device = devs.body.devices.find((d) => d.online);
  if (!device) throw new Error("no online device");
  const assign = await api("PATCH", `/api/v1/groups/${groupId}/devices`, adminTok, {
    deviceIds: [device.id],
    action: "add",
  });
  if (assign.status !== 204) throw new Error("device assign failed: " + assign.status);
  console.log("[test] device assigned to group");

  // 7. tech has NO permission row -> session create on the device must 403
  const denied = await api("POST", `/api/v1/devices/${device.id}/sessions`, techTok, { channel: 1 });
  if (denied.status !== 403) throw new Error("expected 403 without permission, got " + denied.status);
  console.log("[test] session denied without permission 403 OK");

  // 8. grant terminal rights (Rights.Console = 0x10)
  const grant = await api("PUT", `/api/v1/groups/${groupId}/permissions/${techId}`, adminTok, {
    rights: 0x10,
  });
  if (grant.status !== 204) throw new Error("permission grant failed: " + grant.status);
  console.log("[test] terminal right granted");

  // 9. tech CAN now open channel 1 (terminal)...
  const allowed = await api("POST", `/api/v1/devices/${device.id}/sessions`, techTok, { channel: 1 });
  if (allowed.status !== 200) throw new Error("expected 200 with Console right, got " + allowed.status + " " + JSON.stringify(allowed.body));
  console.log("[test] terminal session allowed with Console right OK");

  // 10. ...but channel 2 (desktop, RemoteControl 0x8) must 403
  const deniedDesk = await api("POST", `/api/v1/devices/${device.id}/sessions`, techTok, { channel: 2 });
  if (deniedDesk.status !== 403) throw new Error("expected 403 for desktop without RemoteControl, got " + deniedDesk.status);
  console.log("[test] desktop session denied without RemoteControl 403 OK");

  // 11. admin bypasses rights entirely
  const adminDesk = await api("POST", `/api/v1/devices/${device.id}/sessions`, adminTok, { channel: 2 });
  if (adminDesk.status !== 200) throw new Error("expected 200 for admin, got " + adminDesk.status);
  console.log("[test] admin bypass OK");

  // 12. clear permission -> 403 again
  await api("DELETE", `/api/v1/groups/${groupId}/permissions/${techId}`, adminTok);
  const deniedAgain = await api("POST", `/api/v1/devices/${device.id}/sessions`, techTok, { channel: 1 });
  if (deniedAgain.status !== 403) throw new Error("expected 403 after permission clear, got " + deniedAgain.status);
  console.log("[test] permission cleared -> denied again OK");

  // 13. unassign device, delete group
  await api("PATCH", `/api/v1/groups/${groupId}/devices`, adminTok, {
    deviceIds: [device.id],
    action: "remove",
  });
  const del = await api("DELETE", `/api/v1/groups/${groupId}`, adminTok);
  if (del.status !== 204) throw new Error("group delete failed: " + del.status);
  console.log("[test] group deleted");

  // 14. delete-with-devices -> 409
  const g2 = await api("POST", "/api/v1/groups", adminTok, { name: gname + "-2" });
  await api("PATCH", `/api/v1/groups/${g2.body.group.id}/devices`, adminTok, {
    deviceIds: [device.id],
    action: "add",
  });
  const delBusy = await api("DELETE", `/api/v1/groups/${g2.body.group.id}`, adminTok);
  if (delBusy.status !== 409) throw new Error("expected 409 for busy group, got " + delBusy.status);
  console.log("[test] busy group delete rejected 409 OK");
  // cleanup
  await api("PATCH", `/api/v1/groups/${g2.body.group.id}/devices`, adminTok, {
    deviceIds: [device.id],
    action: "remove",
  });
  await api("DELETE", `/api/v1/groups/${g2.body.group.id}`, adminTok);

  console.log("[test] PASS: groups + rights enforcement full cycle");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test] FAILED:", e.message);
  process.exit(1);
});