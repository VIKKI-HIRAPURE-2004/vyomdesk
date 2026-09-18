import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client.js";
import { RIGHTS_LABELS } from "@vyomdesk/shared";

/**
 * GroupsPage - admin group management + per-user rights editor.
 * Backend routes exist since session 9; this is the missing UI:
 *  - create/delete groups (soft-delete)
 *  - per-group user permission rows (rights bitmask chips)
 *  - device assignment via checkboxes
 * Grants resolve users via the admin user-directory search
 * (GET /api/v1/users?q=email-substring). Non-admins only see groups
 * they hold permissions on.
 */

const DEFAULT_PERM_RIGHTS = 0x8 | 0x10 | 0x20; // RemoteControl|Console|ServerFiles

export default function GroupsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [permEmail, setPermEmail] = useState("");
  const [permUser, setPermUser] = useState<{ id: string; email: string } | null>(null);
  const [permErr, setPermErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.groups.list(),
  });

  const groupDetail = useQuery({
    queryKey: ["group", selected],
    queryFn: () => api.groups.get(selected!),
    enabled: !!selected,
  });

  const devices = useQuery({
    queryKey: ["devices-all"],
    queryFn: () => api.devices.list({}),
    enabled: !!selected,
  });

  // admin-only user directory search (email substring) - debounced
  const [userSearchKey, setUserSearchKey] = useState<string | null>(null);
  const userSearch = useQuery({
    queryKey: ["users", userSearchKey],
    queryFn: () => api.auth.users(userSearchKey ?? ""),
    enabled: !!userSearchKey,
    staleTime: 30_000,
  });

  const createGroup = useMutation({
    mutationFn: () => api.groups.create({ name: newName, description: newDesc || undefined }),
    onSuccess: () => {
      setNewName("");
      setNewDesc("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "failed"),
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.groups.remove(id),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "failed"),
  });

  const addPermission = useMutation({
    mutationFn: () => api.groups.setPermission(selected!, permUser!.id, DEFAULT_PERM_RIGHTS),
    onSuccess: () => {
      setPermUser(null);
      setPermEmail("");
      setUserSearchKey(null);
      setPermErr(null);
      qc.invalidateQueries({ queryKey: ["group", selected] });
    },
    onError: (e) => setPermErr(e instanceof Error ? e.message : "failed"),
  });

  const toggleRight = useMutation({
    mutationFn: (p: { userId: string; rights: number }) =>
      api.groups.setPermission(selected!, p.userId, p.rights),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["group", selected] }),
  });

  const removePermission = useMutation({
    mutationFn: (userId: string) => api.groups.clearPermission(selected!, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["group", selected] }),
  });

  const setDevices = useMutation({
    mutationFn: (p: { deviceIds: string[]; action: "add" | "remove" }) =>
      api.groups.setDevices(selected!, p.deviceIds, p.action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", selected] });
      qc.invalidateQueries({ queryKey: ["devices-all"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const g = groupDetail.data?.group;
  const perms = groupDetail.data?.permissions ?? [];
  const currentDeviceIds = new Set(
    devices.data?.devices.filter((d) => d.groupId === selected).map((d) => d.id) ?? [],
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold">Groups</h1>
      <p className="mt-1 text-sm text-slate-400">
        Device groups scope permissions: a user with a permission row on a group gets those
        rights on every device in it.
      </p>

      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* left column: create + list */}
        <div>
          <form
            onSubmit={(e) => { e.preventDefault(); createGroup.mutate(); }}
            className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2"
          >
            <h2 className="text-sm font-medium text-slate-300">New group</h2>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={createGroup.isPending}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium"
            >
              {createGroup.isPending ? "Creating…" : "Create group"}
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {groups.data?.groups.map((gr) => (
              <button
                key={gr.id}
                onClick={() => setSelected(gr.id === selected ? null : gr.id)}
                className={`w-full text-left rounded-lg px-4 py-3 border text-sm ${
                  selected === gr.id
                    ? "bg-brand-500/10 border-brand-500/50"
                    : "bg-slate-900 border-slate-800 hover:border-slate-700"
                }`}
              >
                <span className="font-medium">{gr.name}</span>
                <span className="block text-xs text-slate-500">{gr.deviceCount} devices</span>
              </button>
            ))}
            {groups.data?.groups.length === 0 && (
              <p className="text-sm text-slate-500">No groups yet.</p>
            )}
          </div>
        </div>

        {/* right column: detail */}
        {selected && g ? (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold">{g.name}</h2>
                <p className="text-xs text-slate-500">{g.description || "no description"}</p>
              </div>
              <button
                onClick={() => deleteGroup.mutate(g.id)}
                className="ml-auto bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded-lg px-3 py-1.5 text-xs"
              >
                Delete group
              </button>
            </div>

            {/* permissions */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">User permissions</h3>
              <div className="flex gap-2 relative">
                <input
                  value={permEmail}
                  onChange={(e) => {
                    setPermEmail(e.target.value);
                    setPermUser(null);
                    const q = e.target.value.trim();
                    setUserSearchKey(q.length >= 2 ? q : null);
                  }}
                  placeholder="search user by email…"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => addPermission.mutate()}
                  disabled={addPermission.isPending || !permUser}
                  className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm"
                >
                  Grant
                </button>
                {!permUser && permEmail.trim().length >= 2 && userSearch.data?.users && (
                  <div className="absolute z-10 mt-11 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {userSearch.data.users.length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-400">no match</p>
                    )}
                    {userSearch.data.users.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setPermUser(u);
                          setPermEmail(u.email);
                          setUserSearchKey(null);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm"
                      >
                        <span className="text-slate-200">{u.email}</span>
                        <span className="ml-2 text-xs text-slate-500">{u.name} · {u.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {permUser && (
                <p className="mt-2 text-xs text-emerald-400">
                  selected: {permUser.email}
                </p>
              )}
              {permErr && <p className="mt-2 text-xs text-rose-500">{permErr}</p>}

              <div className="mt-4 space-y-2">
                {perms.length === 0 && <p className="text-xs text-slate-500">No permission rows yet.</p>}
                {perms.map((p) => (
                  <div key={p.userId} className="border border-slate-800 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{p.email ?? p.userId.slice(0, 8)}</span>
                      <button
                        onClick={() => removePermission.mutate(p.userId)}
                        className="ml-auto text-xs text-rose-400 hover:underline"
                      >
                        remove
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {RIGHTS_LABELS.map((r) => {
                        const on = (p.rights & r.bit) === r.bit;
                        return (
                          <button
                            key={r.bit}
                            onClick={() =>
                              toggleRight.mutate({
                                userId: p.userId,
                                rights: on ? p.rights & ~r.bit : p.rights | r.bit,
                              })
                            }
                            className={`text-[11px] rounded-full px-2 py-0.5 border ${
                              on
                                ? "bg-brand-500/20 border-brand-500/60 text-brand-300"
                                : "bg-slate-800 border-slate-700 text-slate-400"
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* devices */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Devices in this group</h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {devices.data?.devices.map((d) => {
                  const inGroup = currentDeviceIds.has(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={inGroup}
                        onChange={(e) =>
                          setDevices.mutate({ deviceIds: [d.id], action: e.target.checked ? "add" : "remove" })
                        }
                        className="accent-brand-500"
                      />
                      <span>{d.name}</span>
                      <span className={`ml-1 w-2 h-2 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center text-slate-500 text-sm min-h-40">
            Select a group to manage its permissions and devices.
          </div>
        )}
      </div>
    </div>
  );
}