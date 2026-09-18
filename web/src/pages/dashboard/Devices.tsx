import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import AddDeviceModal from "./AddDeviceModal.js";

interface Device {
  id: string;
  name: string;
  platform: string;
  platformVersion: string | null;
  arch: string | null;
  agentVersion: string | null;
  lastSeen: string | null;
  lastIp: string | null;
  online: boolean;
  tags: string[];
}

export default function DevicesPage() {
  const [filterOnline, setFilterOnline] = useState<boolean | null>(null);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["devices", filterOnline, filterGroup],
    queryFn: () =>
      api.devices.list(
        filterOnline === null && filterGroup === null
          ? {}
          : {
              ...(filterOnline === null ? {} : { online: String(filterOnline) }),
              ...(filterGroup ? { groupId: filterGroup } : {}),
            },
      ),
    refetchInterval: 10_000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.groups.list(),
  });
  const groups = groupsData?.groups ?? [];

  const devices = (data?.devices ?? []).filter((d: Device) =>
    search ? d.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Devices</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-brand-600 hover:bg-brand-500 px-3 py-1.5 text-sm font-medium"
          >
            + Add Device
          </button>
          <button
            onClick={() => refetch()}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>
      {showAdd && <AddDeviceModal onClose={() => { setShowAdd(false); refetch(); }} />}

      <div className="flex gap-2 mb-4 text-sm">
        <button
          onClick={() => setFilterOnline(null)}
          className={`rounded-full px-3 py-1 ${filterOnline === null ? "bg-brand-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          All
        </button>
        <button
          onClick={() => setFilterOnline(true)}
          className={`rounded-full px-3 py-1 ${filterOnline === true ? "bg-brand-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          Online
        </button>
        <button
          onClick={() => setFilterOnline(false)}
          className={`rounded-full px-3 py-1 ${filterOnline === false ? "bg-brand-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          Offline
        </button>
        {groups.length > 0 && (
          <select
            value={filterGroup ?? ""}
            onChange={(e) => setFilterGroup(e.target.value || null)}
            className="ml-2 rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.deviceCount})
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && <p className="text-slate-400">Loading devicesâ€¦</p>}
      {error && <p className="text-red-400">Failed to load devices</p>}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {devices.map((d) => (
          <Link
            key={d.id}
            to={`/devices/${d.id}`}
            className="block bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-brand-500 transition"
          >
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`}
              />
              <div className="min-w-0">
                <p className="font-medium truncate">{d.name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {d.platform} {d.platformVersion ?? ""} Â· {d.arch ?? "?"} Â· agent {d.agentVersion ?? "?"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <span>{d.lastIp ?? "â€”"}</span>
              <span>{d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "never"}</span>
            </div>
          </Link>
        ))}
      </div>

      {!isLoading && devices.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">No devices yet</p>
          <p className="text-sm mt-1">Install a VyomLink agent to get started.</p>
        </div>
      )}
    </div>
  );
}
