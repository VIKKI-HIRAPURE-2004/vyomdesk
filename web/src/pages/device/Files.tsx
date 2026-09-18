import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";

/**
 * FilesPage - remote file manager over the /relay.ashx pipe (channel 5).
 * Agent replies [1=JSON] messages; download chunks arrive as
 * [2][seq:4][offset:8][bytes]. Browser sends plain JSON control messages.
 */

const CH_FILES = 5;

type Status = "connecting" | "live" | "error" | "closed";

interface FileEntry {
  name: string;
  size: number;
  dir: boolean;
  mode: string;
  modTime: number;
}

interface PendingReply {
  resolve: (v: any) => void;
}

export default function FilesPage() {
  const { id = "" } = useParams();
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const pendingRef = useRef<Map<number, PendingReply>>(new Map());
  const downloadRef = useRef<{
    seq: number;
    name: string;
    size: number;
    parts: Uint8Array[];
    onProgress: (bytes: number) => void;
  } | null>(null);
  const uploadRef = useRef<{ seq: number; name: string; size: number; resolve: () => void } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);

  const [root, setRoot] = useState<{ home: string; sep: string; drives: string[] } | null>(null);
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<{ name: string; bytes: number; total: number; dir: "dl" | "up" } | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const sendCtrl = useCallback((obj: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const frame = new Uint8Array(4 + bytes.length);
    frame[0] = CH_FILES;
    frame[1] = 0x00;
    frame[2] = (bytes.length >> 8) & 0xff;
    frame[3] = bytes.length & 0xff;
    frame.set(bytes, 4);
    ws.send(frame);
  }, []);

  const nextSeq = () => ++seqRef.current;

  const request = useCallback(
    (payload: Record<string, unknown>): Promise<any> =>
      new Promise((resolve) => {
        const seq = nextSeq();
        pendingRef.current.set(seq, { resolve });
        sendCtrl({ ...payload, seq });
      }),
    [sendCtrl],
  );

  // WebSocket is an ordered stream; agent chunk sizes can vary (f.Read may
  // return short reads), so chunks are appended in arrival order.
  const handleChunk = (body: Uint8Array) => {
    if (body.length < 12) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const seq = dv.getUint32(0);
    const dl = downloadRef.current;
    if (!dl || dl.seq !== seq) return;
    dl.parts.push(body.subarray(12));
    dl.onProgress(body.length - 12);
    sendCtrl({ type: "dl-ack", seq });
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    async function connect() {
      let token = "";
      try {
        const res = await fetch(`/api/v1/devices/${id}/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(localStorage.getItem("vyom_token")
              ? { Authorization: `Bearer ${localStorage.getItem("vyom_token")}` }
              : {}),
          },
          body: JSON.stringify({ channel: CH_FILES }),
        });
        if (!res.ok) throw new Error(`session create failed (${res.status})`);
        token = (await res.json()).token;
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "session create failed");
        return;
      }

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/relay.ashx`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => ws!.send(token);

      ws.onmessage = (e) => {
        if (typeof e.data === "string" || closed) return;
        const buf = new Uint8Array(e.data as ArrayBuffer);
        const flags = buf[1]!;
        if (flags === 0x01) {
          setStatus("live");
          return; // open ack
        }
        const len = (buf[2]! << 8) | buf[3]!;
        const payload = buf.subarray(4, 4 + len);
        if (payload.length < 1) return;
        const msgType = payload[0]!;
        const body = payload.subarray(1);
        if (msgType === 2) {
          handleChunk(body);
          return;
        }
        if (msgType !== 1) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(body));
          handleMsg(msg);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        if (!closed) setStatus("closed");
      };
      ws.onerror = () => {
        setStatus("error");
        setError("relay websocket error");
      };
    }

    connect();
    return () => {
      closed = true;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleMsg = (msg: any) => {
    switch (msg.type) {
      case "root": {
        setRoot({ home: msg.home, sep: msg.sep, drives: msg.drives ?? [] });
        if (!cwd) load(msg.home);
        break;
      }
      case "list": {
        const p = pendingRef.current.get(msg.seq);
        if (p) {
          pendingRef.current.delete(msg.seq);
          p.resolve(msg);
        }
        setEntries(msg.entries ?? []);
        setCwd(msg.path);
        break;
      }
      case "error": {
        const p = pendingRef.current.get(msg.seq);
        if (p) {
          pendingRef.current.delete(msg.seq);
          p.resolve(msg);
        }
        if (downloadRef.current && downloadRef.current.seq === msg.seq) downloadRef.current = null;
        const up = uploadRef.current;
        if (up && up.seq === msg.seq) {
          uploadRef.current = null;
          up.resolve(); // unblock a waiting upload stream
        }
        setTransfer(null);
        setError(String(msg.message ?? "agent error"));
        break;
      }
      case "download-start": {
        const dl = downloadRef.current;
        if (dl && dl.seq === msg.seq) {
          dl.size = msg.size;
          setTransfer({ name: dl.name, bytes: 0, total: msg.size, dir: "dl" });
        }
        break;
      }
      case "download-end": {
        const dl = downloadRef.current;
        if (dl && dl.seq === msg.seq) {
          const blob = new Blob(dl.parts as BlobPart[], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = dl.name;
          a.click();
          URL.revokeObjectURL(url);
          downloadRef.current = null;
          setTransfer(null);
        }
        break;
      }
      case "upload-ack": {
        const up = uploadRef.current;
        if (up && up.seq === msg.seq) up.resolve();
        break;
      }
      case "upload-progress": {
        const up = uploadRef.current;
        if (up && up.seq === msg.seq) {
          setTransfer({ name: up.name, bytes: msg.received, total: up.size, dir: "up" });
        }
        break;
      }
      case "upload-ok": {
        const up = uploadRef.current;
        if (up && up.seq === msg.seq) {
          uploadRef.current = null;
          setTransfer(null);
          uploadAbortRef.current = null;
          load(cwd);
        }
        break;
       }
      case "ok": {
        const p = pendingRef.current.get(msg.seq);
        if (p) {
          pendingRef.current.delete(msg.seq);
          p.resolve(msg);
        }
        if (msg.op === "mkdir" || msg.op === "delete" || msg.op === "rename") load(cwd);
        break;
      }
      default: {
        const p = pendingRef.current.get(msg.seq);
        if (p) {
          pendingRef.current.delete(msg.seq);
          p.resolve(msg);
        }
      }
    }
  };


  const load = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      try {
        await request({ type: "list", path });
      } finally {
        setBusy(false);
      }
    },
    [request],
  );

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const download = async (name: string, path: string) => {
    if (downloadRef.current) {
      setError("a download is already in progress");
      return;
    }
    const seq = nextSeq();
    downloadRef.current = {
      seq,
      name,
      size: 0,
      parts: [],
      onProgress: (bytes) =>
        setTransfer((t) => (t ? { ...t, bytes: t.bytes + bytes } : t)),
    };
    sendCtrl({ type: "download", path, seq });
  };

  const uploadFile = async (file: File, dir: string) => {
    if (uploadRef.current) {
      setError("an upload is already in progress");
      return;
    }
    const target = joinPath(dir, file.name);
    const seq = nextSeq();
    setTransfer({ name: file.name, bytes: 0, total: file.size, dir: "up" });
    const streamToAgent = new Promise<void>((resolve) => {
      uploadRef.current = { seq, name: file.name, size: file.size, resolve };
      sendCtrl({ type: "upload", path: target, seq });
    });
    await streamToAgent;
    const slice = 32 * 1024;
    for (let off = 0; off < file.size; off += slice) {
      const b64 = await file.slice(off, off + slice).arrayBuffer().then((ab) => arrayBufferToBase64(ab));
      sendCtrl({ type: "upload-data", seq, data: b64 });
    }
    sendCtrl({ type: "upload-done", seq });
  };

  const arrayBufferToBase64 = (ab: ArrayBuffer) => {
    const bytes = new Uint8Array(ab);
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(bin);
  };

  const joinPath = (dir: string, name: string) => {
    if (!dir) return name;
    const sep = root?.sep ?? "/";
    if (dir.endsWith(sep)) return dir + name;
    return dir + sep + name;
  };

  const onDelete = async (entry: FileEntry) => {
    if (!confirm(`Delete "${entry.name}"${entry.dir ? " and all contents" : ""}?`)) return;
    setBusy(true);
    await request({ type: "delete", path: joinPath(cwd, entry.name) });
    setBusy(false);
  };

  const onRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    await request({
      type: "rename",
      from: joinPath(cwd, renameTarget),
      to: joinPath(cwd, renameValue.trim()),
    });
    setBusy(false);
    setRenameTarget(null);
    setRenameValue("");
  };

  const onMkdir = async () => {
    if (!mkdirName.trim()) return;
    setBusy(true);
    await request({ type: "mkdir", path: joinPath(cwd, mkdirName.trim()) });
    setBusy(false);
    setMkdirOpen(false);
    setMkdirName("");
  };

  const breadcrumbs = () => {
    const sep = root?.sep ?? "/";
    const parts = cwd.split(sep).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    if (root?.drives.length) {
      // windows: first part is drive letter
      crumbs.push({ label: parts[0] ?? "", path: parts[0] + sep });
      for (let i = 1; i < parts.length; i++) {
        crumbs.push({ label: parts[i], path: crumbs[i - 1]!.path + parts[i] + (i < parts.length - 1 ? sep : "") });
      }
      if (parts.length === 1) crumbs[0]!.path = parts[0] + sep;
    } else {
      let acc = "";
      for (const p of parts) {
        acc += sep + p;
        crumbs.push({ label: p, path: acc });
      }
    }
    return crumbs;
  };

  const fmt = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 2 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(1)} GB`;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to={`/devices/${id}`} className="text-sm text-brand-400 hover:underline">
        &larr; Device
      </Link>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            status === "live" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-rose-500"
          }`}
        />
        <h1 className="text-xl font-bold">Files</h1>
        <span className="text-xs text-slate-400">{status}</span>
        {root?.drives.length ? (
          <select
            className="ml-2 bg-slate-800 rounded px-2 py-1 text-xs"
            value={cwd.slice(0, 3) === cwd.slice(0, 3).toUpperCase() && cwd.length >= 2 && cwd[1] === ":" ? cwd.slice(0, 3) : ""}
            onChange={(e) => load(e.target.value)}
          >
            {root.drives.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setMkdirOpen(true)}
            disabled={status !== "live" || busy}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm"
          >
            New folder
          </button>
          <label
            className={`bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-3 py-1.5 text-sm cursor-pointer ${
              status !== "live" || busy ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            Upload
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f, cwd);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-sm text-rose-500" onClick={() => setError(null)} title="click to dismiss">
          {error}
        </p>
      )}

      {transfer && (
        <div className="mt-3 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-sm flex items-center gap-3">
          <span className="text-brand-400">{transfer.dir === "dl" ? "↓" : "↑"}</span>
          <span className="truncate">{transfer.name}</span>
          <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{
                width: transfer.total > 0 ? `${Math.min(100, (transfer.bytes / transfer.total) * 100)}%` : "0%",
              }}
            />
          </div>
          <span className="text-xs text-slate-400">
            {fmt(transfer.bytes)}
            {transfer.total > 0 ? ` / ${fmt(transfer.total)}` : ""}
          </span>
          {transfer.dir === "dl" && (
            <button
              className="text-xs text-rose-400 hover:underline"
              onClick={() => {
                const dl = downloadRef.current;
                if (dl) sendCtrl({ type: "cancel", seq: dl.seq });
                downloadRef.current = null;
                setTransfer(null);
              }}
            >
              cancel
            </button>
          )}
        </div>
      )}

      <div className="mt-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-800/50 text-xs flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {breadcrumbs().map((c, i) => (
            <span key={c.path + i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-500">{root?.sep ?? "/"}</span>}
              <button className="hover:text-brand-400" onClick={() => load(c.path)}>
                {c.label}
              </button>
            </span>
          ))}
        </div>
        <div className="divide-y divide-slate-800/50">
          {busy && entries.length === 0 && <p className="p-4 text-sm text-slate-400">Loading…</p>}
          {!busy &&
            entries.map((e) => (
              <div key={e.name} className="px-4 py-2 flex items-center gap-3 text-sm hover:bg-slate-800/30">
                <span className="w-5 text-center">{e.dir ? "📁" : "📄"}</span>
                <button
                  className={`flex-1 text-left truncate ${e.dir ? "hover:text-brand-400" : ""}`}
                  onClick={() => (e.dir ? load(joinPath(cwd, e.name)) : download(e.name, joinPath(cwd, e.name)))}
                >
                  {e.name}
                </button>
                <span className="text-xs text-slate-500 w-20 text-right">{e.dir ? "" : fmt(e.size)}</span>
                <span className="text-xs text-slate-600 w-36 text-right hidden md:inline">
                  {new Date(e.modTime).toLocaleString()}
                </span>
                <button
                  className="text-xs text-slate-400 hover:text-white"
                  onClick={() => {
                    setRenameTarget(e.name);
                    setRenameValue(e.name);
                  }}
                >
                  rename
                </button>
                <button className="text-xs text-rose-400 hover:text-rose-300" onClick={() => onDelete(e)}>
                  delete
                </button>
              </div>
            ))}
          {!busy && entries.length === 0 && <p className="p-4 text-sm text-slate-500">empty directory</p>}
        </div>
      </div>

      {mkdirOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setMkdirOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold mb-2">New folder</h2>
            <input
              autoFocus
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onMkdir()}
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-sm"
              placeholder="folder name"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="text-sm text-slate-400 hover:text-white" onClick={() => setMkdirOpen(false)}>
                Cancel
              </button>
              <button className="bg-brand-500 hover:bg-brand-600 rounded-lg px-3 py-1.5 text-sm" onClick={onMkdir}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenameTarget(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold mb-2">Rename {renameTarget}</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRename()}
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-sm"
              placeholder="new name"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="text-sm text-slate-400 hover:text-white" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button className="bg-brand-500 hover:bg-brand-600 rounded-lg px-3 py-1.5 text-sm" onClick={onRename}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}