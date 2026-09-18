import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client.js";

/**
 * UsersPage - admin user directory + role management.
 *  - search by email substring (debounced, 2+ chars)
 *  - promote/demote: admin / tech / viewer
 *  - self-demotion blocked server-side; UI hides it too
 */

const ROLES = ["admin", "tech", "viewer"] as const;

export default function UsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.auth.me() });

  const users = useQuery({
    queryKey: ["users", searchKey],
    queryFn: () => api.auth.users(searchKey ?? ""),
    staleTime: 30_000,
  });

  const setRole = useMutation({
    mutationFn: (p: { id: string; role: string }) => api.auth.setUserRole(p.id, p.role),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "failed"),
  });

  const myId = me.data?.user?.id;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Users</h1>
      <p className="mt-1 text-sm text-slate-400">
        Admin-only directory. Roles: <span className="text-slate-200">admin</span> (full
        access), <span className="text-slate-200">tech</span> (devices + sessions),{" "}
        <span className="text-slate-200">viewer</span> (read-only).
      </p>

      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}

      <div className="mt-5">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            const t = e.target.value.trim();
            setSearchKey(t.length >= 2 ? t : null);
          }}
          placeholder="search by email…"
          className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-4 space-y-2">
        {users.isLoading && <p className="text-sm text-slate-500">loading…</p>}
        {users.data?.users.length === 0 && (
          <p className="text-sm text-slate-500">no users match.</p>
        )}
        {users.data?.users.map((u) => {
          const isSelf = u.id === myId;
          return (
            <div
              key={u.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{u.email}</p>
                <p className="text-xs text-slate-500 truncate">
                  {u.name || "no name"} · {u.id.slice(0, 8)}…
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {ROLES.map((r) => {
                  const active = u.role === r;
                  const disabled = setRole.isPending || (isSelf && r !== "admin");
                  return (
                    <button
                      key={r}
                      disabled={disabled}
                      onClick={() => setRole.mutate({ id: u.id, role: r })}
                      className={`text-xs rounded-full px-2.5 py-1 border disabled:opacity-40 ${
                        active
                          ? "bg-brand-500/20 border-brand-500/60 text-brand-300"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
                {isSelf && <span className="text-xs text-slate-500 ml-1">(you)</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}