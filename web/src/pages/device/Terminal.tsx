import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * TerminalPage - browser terminal over the /relay.ashx byte pipe.
 * Flow: REST POST /devices/:id/sessions -> one-time token -> WS /relay.ashx
 * -> frames [channel][flags][len] -> agent PTY -> output back.
 */

const CH_TERMINAL = 1;

export default function TerminalPage() {
  const { id = "" } = useParams();
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let term: Terminal | null = null;
    let ws: WebSocket | null = null;

    async function connect() {
      // 1. create relay session (one-time token)
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
          body: JSON.stringify({ channel: CH_TERMINAL }),
        });
        if (!res.ok) throw new Error(`session create failed (${res.status})`);
        const body = await res.json();
        token = body.token;
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "session create failed");
        return;
      }
      // 2. connect relay WS and send the token as first message
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/relay.ashx`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        ws!.send(token);
      };
      ws.onmessage = (e) => {
        if (typeof e.data === "string") return;
        const buf = new Uint8Array(e.data as ArrayBuffer);
        const flags = buf[1]!;
        const len = (buf[2]! << 8) | buf[3]!;
        const payload = buf.subarray(4, 4 + len);
        if (flags === 0x01) {
          setStatus("live");
          term?.writeln("\r\n\x1b[32m*** connected to agent terminal ***\r");
          if (term) sendResize(term.cols, term.rows); // sync initial PTY size
          return;
        }
        term?.write(new TextDecoder().decode(payload));
      };
      ws.onclose = () => {
        setStatus("closed");
        term?.writeln("\r\n\x1b[31m*** disconnected ***\r");
      };
      ws.onerror = () => {
        setStatus("error");
        setError("relay websocket error");
      };
    }

    term = new Terminal({
      convertEol: true,
      fontFamily: "Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: { background: "#0c0f16", foreground: "#e2e8f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (termRef.current) {
      term.open(termRef.current);
      fit.fit();
    }
    const sendResize = (cols: number, rows: number) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // resize control payload: [0x00][0x01][cols:2 BE][rows:2 BE]
      const f = new Uint8Array(10);
      f[0] = CH_TERMINAL;
      f[1] = 0x00;
      f[2] = 0;
      f[3] = 6;
      f[4] = 0x00;
      f[5] = 0x01;
      f[6] = (cols >> 8) & 0xff;
      f[7] = cols & 0xff;
      f[8] = (rows >> 8) & 0xff;
      f[9] = rows & 0xff;
      ws.send(f);
    };
    term.onData((d) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const enc = new TextEncoder();
        const bytes = enc.encode(d);
        const frame = new Uint8Array(4 + bytes.length);
        frame[0] = CH_TERMINAL;
        frame[1] = 0x00;
        frame[2] = (bytes.length >> 8) & 0xff;
        frame[3] = bytes.length & 0xff;
        frame.set(bytes, 4);
        ws.send(frame);
      }
    });
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    term.onResize(({ cols, rows }) => sendResize(cols, rows));
    connect();

    return () => {
      window.removeEventListener("resize", onResize);
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      term?.dispose();
    };
  }, [id]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to={`/devices/${id}`} className="text-sm text-brand-400 hover:underline">
          &larr; Device
        </Link>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full ${status === "live" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-rose-500"}`} />
        <h1 className="text-xl font-bold">Terminal</h1>
        <span className="text-xs text-slate-400">{status}</span>
      </div>
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
      <div ref={termRef} className="mt-4 bg-[#0c0f16] border border-slate-800 rounded-xl p-2 min-h-[480px]" />
    </div>
  );
}