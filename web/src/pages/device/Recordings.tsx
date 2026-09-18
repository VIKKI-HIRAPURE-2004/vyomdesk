import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.js";

/**
 * RecordingsPage (P1.10) - list .vyomrec session recordings.
 * The .vyomrec container is downloadable; playback is a canvas player
 * (VYOMREC1 header + [tsMs:8][len:4 BE][payload] frames; payload msgType
 * 2 = JPEG frame). A minimal in-browser player is included for stopped
 * recordings.
 */

async function parseRecording(buf: ArrayBuffer): Promise<Array<{ delay: number; jpeg: Blob }>> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // header: VYOMREC1 [ver][ch][reserved 2]
  if (new TextDecoder().decode(u8.subarray(0, 8)) !== "VYOMREC1") throw new Error("bad magic");
  let off = 12;
  const frames: Array<{ delay: number; jpeg: Blob }> = [];
  let last = 0;
  while (off + 12 <= u8.length) {
    const ts = Number(dv.getBigUint64(off, true)); // LE
    const len = dv.getUint32(off + 8, false); // BE
    const payload = u8.subarray(off + 12, off + 12 + len);
    if (payload.length > 1 && payload[0] === 2) {
      frames.push({ delay: ts - last, jpeg: new Blob([payload.subarray(1)], { type: "image/jpeg" }) });
      last = ts;
    }
    off += 12 + len;
  }
  return frames;
}

export default function RecordingsPage() {
  const { id: deviceId } = useParams();
  const qc = useQueryClient();
  const [playing, setPlaying] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [fileBuf, setFileBuf] = useState<ArrayBuffer | null>(null);

  const recs = useQuery({
    queryKey: ["recordings", deviceId],
    queryFn: () => api.recordings.list(deviceId),
    refetchInterval: 10_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.recordings.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recordings"] }),
  });

  const play = async (id: string) => {
    setPlayErr(null);
    try {
      const token = localStorage.getItem("vyom_token") ?? "";
      const res = await fetch(api.recordings.downloadUrl(id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const buf = await res.arrayBuffer();
      setFileBuf(buf);
      setPlaying(id);
    } catch (e) {
      setPlayErr(e instanceof Error ? e.message : "play failed");
    }
  };

  // replay loop
  const replay = async (canvas: HTMLCanvasElement) => {
    if (!fileBuf) return;
    try {
      const frames = await parseRecording(fileBuf);
      for (const f of frames) {
        await new Promise((r) => setTimeout(r, Math.max(10, f.delay)));
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("frame decode"));
          img.src = URL.createObjectURL(f.jpeg);
        });
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
      }
    } catch (e) {
      setPlayErr(e instanceof Error ? e.message : "replay failed");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to={deviceId ? `/devices/${deviceId}` : "/devices"} className="text-sm text-brand-400 hover:underline">
        &larr; {deviceId ? "Device" : "Devices"}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Recordings</h1>
      <p className="mt-1 text-sm text-slate-400">
        Server-side desktop session captures (.vyomrec). Download the container or play it inline.
      </p>

      {playErr && <p className="mt-3 text-sm text-rose-500">{playErr}</p>}

      {playing && fileBuf && (
        <div className="mt-4 bg-black border border-slate-800 rounded-xl overflow-hidden">
          <canvas
            ref={(el) => { if (el) replay(el); }}
            className="block w-full"
          />
          <div className="px-3 py-2 bg-slate-900 text-xs text-slate-400">
            Playing {playing.slice(0, 8)}… <button className="ml-3 underline" onClick={() => { setPlaying(null); setFileBuf(null); }}>close</button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm border border-slate-800 rounded-lg overflow-hidden">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Ended</th>
              <th className="text-left px-3 py-2">Frames</th>
              <th className="text-left px-3 py-2">Size</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recs.data?.recordings.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-slate-500">No recordings yet.</td></tr>
            )}
            {recs.data?.recordings.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{new Date(r.started_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {r.ended_at ? new Date(r.ended_at).toLocaleString() : <span className="text-amber-400">active</span>}
                </td>
                <td className="px-3 py-2 font-mono">{r.frames}</td>
                <td className="px-3 py-2 font-mono">{(r.bytes / 1024 / 1024).toFixed(2)} MB</td>
                <td className="px-3 py-2 space-x-2">
                  {r.ended_at && (
                    <>
                      <a
                        href={api.recordings.downloadUrl(r.id)}
                        onClick={async (e) => {
                          e.preventDefault();
                          window.open(api.recordings.downloadUrl(r.id), "_blank");
                        }}
                        className="text-brand-400 hover:underline"
                      >
                        Download
                      </a>
                      <button onClick={() => play(r.id)} className="text-brand-400 hover:underline">Play</button>
                    </>
                  )}
                  <button
                    onClick={() => remove.mutate(r.id)}
                    className="text-rose-400 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}