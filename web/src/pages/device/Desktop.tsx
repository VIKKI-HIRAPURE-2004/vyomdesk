import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";

/**
 * DesktopPage - browser remote desktop over the /relay.ashx pipe (channel 2).
 * Agent sends [1=JSON meta][2=JPEG] messages; browser renders JPEG frames on a
 * canvas and forwards mouse/keyboard input as JSON control messages.
 *
 * Guest mode: when quick-support token `vyom_qs_token` is present in
 * sessionStorage (set by /join), it is used directly instead of creating
 * a session via the authed API; UI chrome that assumes a logged-in user
 * is hidden (no device link).
 */

const CH_DESKTOP = 2;

type Status = "connecting" | "live" | "error" | "closed";

export default function DesktopPage() {
  const { id = "" } = useParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState(55);
  const [monitors, setMonitors] = useState<Array<{ x: number; y: number; w: number; h: number; primary: boolean }>>([]);
  const [fps, setFps] = useState(10);
  const [scale, setScale] = useState(0.75);
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    async function connect() {
      let token = "";
      // Quick-support path: a guest may arrive with an already-redeemed
      // one-time relay token (created via /join); skip the authed session API.
      const qsToken = sessionStorage.getItem("vyom_qs_token");
      if (qsToken) {
        sessionStorage.removeItem("vyom_qs_token");
        setGuest(true);
        token = qsToken;
      } else {
        try {
          const res = await fetch(`/api/v1/devices/${id}/sessions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(localStorage.getItem("vyom_token")
                ? { Authorization: `Bearer ${localStorage.getItem("vyom_token")}` }
                : {}),
            },
            body: JSON.stringify({ channel: CH_DESKTOP }),
          });
          if (!res.ok) throw new Error(`session create failed (${res.status})`);
          token = (await res.json()).token;
        } catch (e) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "session create failed");
          return;
        }
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
        const len = (buf[2]! << 8) | buf[3]!;
        if (flags === 0x01) {
          setStatus("live");
          return; // open ack
        }
        const payload = buf.subarray(4, 4 + len);
        if (payload.length < 1) return;
        const msgType = payload[0]!;
        const body = payload.subarray(1);
        if (msgType === 2) {
          // JPEG frame
          const blob = new Blob([body], { type: "image/jpeg" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            if (canvas.width !== img.width || canvas.height !== img.height) {
              canvas.width = img.width;
              canvas.height = img.height;
            }
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
          };
          img.src = url;
        } else if (msgType === 1 || msgType === 3) {
          try {
            const meta = JSON.parse(new TextDecoder().decode(body));
            if (meta.type === "error") {
              setStatus("error");
              setError(String(meta.message ?? "agent error"));
            } else if (meta.type === "size" && Array.isArray(meta.monitors)) {
              setMonitors(meta.monitors);
            }
          } catch {
            /* ignore malformed meta */
          }
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
  }, [id]);

  const sendCtrl = (obj: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const frame = new Uint8Array(4 + bytes.length);
    frame[0] = CH_DESKTOP;
    frame[1] = 0x00;
    frame[2] = (bytes.length >> 8) & 0xff;
    frame[3] = bytes.length & 0xff;
    frame.set(bytes, 4);
    ws.send(frame);
  };

  // push setting changes live
  useEffect(() => {
    sendCtrl({ type: "quality", value: quality });
  }, [quality]);
  useEffect(() => {
    sendCtrl({ type: "fps", value: fps });
  }, [fps]);
  useEffect(() => {
    sendCtrl({ type: "scale", value: scale });
  }, [scale]);

  const canvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasPos(e);
    sendCtrl({ type: "mouse", action: "move", x, y });
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasPos(e);
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    sendCtrl({ type: "mouse", action: "down", button, x, y });
  };
  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasPos(e);
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    sendCtrl({ type: "mouse", action: "up", button, x, y });
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasPos(e);
    sendCtrl({ type: "mouse", action: "dblclick", button: "left", x, y });
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    sendCtrl({ type: "wheel", deltaY: e.deltaY });
  };

  const keyHandler = (action: "down" | "up") => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "F5" || (e.ctrlKey && e.key === "r")) return; // allow refresh
    e.preventDefault();
    sendCtrl({ type: "key", action, key: e.key.toLowerCase() });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto" tabIndex={0}>
      <div className="flex items-center gap-3">
        {!guest && (
          <Link to={`/devices/${id}`} className="text-sm text-brand-400 hover:underline">
            &larr; Device
          </Link>
        )}
        {guest && <span className="text-xs text-slate-500">Quick Support session</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            status === "live" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-rose-500"
          }`}
        />
        <h1 className="text-xl font-bold">Remote Desktop</h1>
        <span className="text-xs text-slate-400">{status}</span>

        <div className="ml-auto flex items-center gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-1">
            Quality
            <input
              type="range" min={10} max={90} step={5} value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="accent-brand-500"
            />
            <span className="w-7 text-slate-400">{quality}</span>
          </label>
          <label className="flex items-center gap-1">
            FPS
            <input
              type="range" min={1} max={30} step={1} value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="accent-brand-500"
            />
            <span className="w-6 text-slate-400">{fps}</span>
          </label>
          <label className="flex items-center gap-1">
            Scale
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="bg-slate-800 rounded px-1 py-0.5"
            >
              <option value={1}>100%</option>
              <option value={0.75}>75%</option>
              <option value={0.5}>50%</option>
              <option value={0.25}>25%</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
      <div
        className="relative mt-4 bg-black border border-slate-800 rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-500"
        tabIndex={0}
        onKeyDown={keyHandler("down")}
        onKeyUp={keyHandler("up")}
      >
        <canvas
          ref={canvasRef}
          className="block w-full cursor-crosshair"
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {monitors.length > 1 && (
          <div className="absolute inset-0 pointer-events-none">
            {monitors.map((m, i) => (
              <div
                key={i}
                className="absolute border border-brand-500/60 rounded-sm"
                style={{
                  left: `${(m.x / (canvasRef.current?.width ?? 1)) * 100}%`,
                  top: `${(m.y / (canvasRef.current?.height ?? 1)) * 100}%`,
                  width: `${(m.w / (canvasRef.current?.width ?? 1)) * 100}%`,
                  height: `${(m.h / (canvasRef.current?.height ?? 1)) * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 text-[10px] bg-slate-900/80 text-brand-400 rounded px-1">
                  {m.primary ? "Primary" : `Monitor ${i + 1}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Click the frame to capture keyboard. Mouse and wheel are forwarded live.
      </p>
    </div>
  );
}