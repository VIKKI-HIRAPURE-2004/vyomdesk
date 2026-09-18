import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.js";

interface MetricSample {
  ts: number;
  cpu_pct: number | null;
  mem_pct: number | null;
}

/** Minimal inline sparkline (no chart lib dependency yet). */
function Spark({ samples, pick, color }: { samples: MetricSample[]; pick: (s: MetricSample) => number | null; color: string }) {
  const pts = samples
    .map((s) => pick(s))
    .filter((v): v is number => v != null)
    .slice(-60);
  if (pts.length < 2) return <div className="h-12 flex items-center text-xs text-slate-500">no data</div>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const norm = pts.map((v) => 40 - ((v - min) / (max - min || 1)) * 36);
  const d = norm.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 100},${y}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-12">
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-1 top-0 text-xs" style={{ color }}>
        {last.toFixed(1)}
      </span>
    </div>
  );
}

export default function DeviceDetail() {
  const { id = "" } = useParams();
  const wsRef = useRef<WebSocket | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["device", id],
    queryFn: () => api.devices.get(id),
    refetchInterval: 15_000,
  });
  const { data: metrics } = useQuery({
    queryKey: ["device-metrics", id],
    queryFn: () => api.devices.metrics(id),
    refetchInterval: 10_000,
  });

  // live events
  useEffect(() => {
    const token = localStorage.getItem("vyom_token") ?? "";
    const ws = new WebSocket(`ws://${location.host}/api/v1/events?token=${token}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "metrics" && msg.data?.deviceId === id) {
          // react-query will refetch; could also patch cache directly
        }
      } catch {}
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [id]);

  const d = data?.device;
  const samples = metrics?.samples ?? [];

  const [qsCode, setQsCode] = useState<string | null>(null);
  const [qsErr, setQsErr] = useState<string | null>(null);
  const [qsBusy, setQsBusy] = useState(false);
  const [slSlug, setSlSlug] = useState<string | null>(null);
  const [slErr, setSlErr] = useState<string | null>(null);
  const [slBusy, setSlBusy] = useState(false);
  const [recActive, setRecActive] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  const makeQuickCode = async () => {
    setQsBusy(true);
    setQsErr(null);
    setQsCode(null);
    try {
      const res = await api.quickSupport.create(id);
      setQsCode(res.code);
    } catch (e) {
      setQsErr(e instanceof Error ? e.message : "failed to create code");
    } finally {
      setQsBusy(false);
    }
  };
  const makeShareLink = async () => {
    setSlBusy(true);
    setSlErr(null);
    setSlSlug(null);
    try {
      const res = await api.shareLinks.create(id);
      setSlSlug(location.origin + res.url);
    } catch (e) {
      setSlErr(e instanceof Error ? e.message : "failed to create share link");
    } finally {
      setSlBusy(false);
    }
  };
  const toggleRecording = async () => {
    setRecBusy(true);
    setRecErr(null);
    try {
      if (recActive) {
        await api.recordings.stop(id);
        setRecActive(false);
      } else {
        await api.recordings.start(id);
        setRecActive(true);
      }
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : "recording toggle failed");
    } finally {
      setRecBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/devices" className="text-sm text-brand-400 hover:underline">
        â† Devices
      </Link>
      {isLoading && <p className="mt-4 text-slate-400">Loadingâ€¦</p>}
      {d && (
        <>
          <div className="mt-3 flex items-center gap-3">
            <span className={`inline-block w-3 h-3 rounded-full ${d.online ? "bg-emerald-400" : "bg-slate-600"}`} />
            <h1 className="text-2xl font-bold">{d.name}</h1>
            <span className="text-xs uppercase tracking-wide bg-slate-800 rounded-full px-2 py-0.5">{d.platform}</span>
            {d.online && (
              <div className="ml-auto flex items-center gap-2">
                <Link
                  to={`/devices/${id}/terminal`}
                  className="text-sm bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5"
                >
                  Terminal
                </Link>
                <Link
                  to={`/devices/${id}/desktop`}
                  className="text-sm bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5"
                >
                  Desktop
                </Link>
                <Link
                  to={`/devices/${id}/files`}
                  className="text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-3 py-1.5"
                >
                  Files
                </Link>
              </div>
            )}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-slate-300 mb-2">CPU %</h2>
              <Spark samples={samples} pick={(s) => s.cpu_pct} color="#59adff" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-slate-300 mb-2">Memory %</h2>
              <Spark samples={samples} pick={(s) => s.mem_pct} color="#34d399" />
            </div>
          </div>
          <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 space-y-1">
            <p>Agent: {d.agentVersion ?? "â€”"}</p>
            <p>Arch: {d.arch ?? "â€”"}</p>
            <p>Last IP: {d.lastIp ?? "â€”"}</p>
            <p>Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "never"}</p>
            <p>Tags: {d.tags.length ? d.tags.join(", ") : "â€”"}</p>
          </div><div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 space-y-2">
            <h2 className="text-sm font-medium text-slate-300">Quick Support</h2>
            <p className="text-xs text-slate-500">
              One-time 9-digit code: share it with anyone (no account needed). They open
              the public /join page, enter the code, and get a single desktop session.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={makeQuickCode}
                disabled={qsBusy || !d.online}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
              >
                {qsBusy ? "Generating" : "Generate code"}
              </button>
              {qsCode && (
                <span className="font-mono text-2xl tracking-[0.3em] text-brand-400 select-all">
                  {qsCode}
                </span>
              )}
            </div>
            {qsErr && <p className="text-xs text-rose-500">{qsErr}</p>}
          </div>
          <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 space-y-2">
            <h2 className="text-sm font-medium text-slate-300">Share Link</h2>
            <p className="text-xs text-slate-500">
              Reusable guest link: anyone with the URL (and optional password) can
              open a desktop session until it expires or is revoked.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={makeShareLink}
                disabled={slBusy || !d.online}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
              >
                {slBusy ? "Creating" : "Create link"}
              </button>
              {slSlug && (
                <span className="font-mono text-sm text-brand-400 select-all break-all">{slSlug}</span>
              )}
            </div>
            {slErr && <p className="text-xs text-rose-500">{slErr}</p>}
          </div>
          <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 space-y-2">
            <h2 className="text-sm font-medium text-slate-300">Session Recording</h2>
            <p className="text-xs text-slate-500">
              Record the desktop stream server-side (.vyomrec). Start it, run your
              session, stop it - the file lands in Recordings for download.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleRecording}
                disabled={recBusy || !d.online}
                className={`rounded-lg px-3 py-1.5 disabled:opacity-50 ${
                  recActive ? "bg-rose-600 hover:bg-rose-500 text-white" : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                {recBusy ? "..." : recActive ? "Stop recording" : "Start recording"}
              </button>
              {recActive && (
                <span className="flex items-center gap-1.5 text-xs text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  REC
                </span>
              )}
            </div>
            {recErr && <p className="text-xs text-rose-500">{recErr}</p>}
            <Link to={`/devices/${id}/recordings`} className="inline-block text-xs text-brand-400 hover:underline">
              View all recordings &rarr;
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
