import { useState } from "react";
import { useParams } from "react-router-dom";

/**
 * ShareLinkPage - public guest access page (no login required).
 * Guest opens /share/:slug (pasted by the tech); if the link has a
 * password it is prompted here. On resolve, the guest gets a one-time
 * relay session and the remote desktop opens in the browser.
 */

type Status = "idle" | "resolving" | "error";

export default function ShareLinkPage() {
  const { slug = "" } = useParams();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("resolving");
    setError(null);
    try {
      const res = await fetch("/api/v1/share-links/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          ...(password ? { password } : {}),
          channel: 2, // Desktop
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `resolve failed (${res.status})`);
      // stash token for the viewer page, then navigate
      sessionStorage.setItem("vyom_qs_token", body.token);
      sessionStorage.setItem("vyom_qs_device", body.deviceId);
      sessionStorage.setItem("vyom_qs_channel", String(body.channel));
      location.assign("/share/session");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "resolve failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={connect} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Vyom<span className="text-brand-400">Desk</span> Guest Access
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            You have been invited to a remote support session. Click connect to open the shared desktop.
          </p>
        </div>
        {status === "error" && error && <p className="text-sm text-rose-500">{error}</p>}
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
            Password <span className="text-slate-500 normal-case">(if provided by the host)</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={status === "resolving" || !slug}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 font-medium"
        >
          {status === "resolving" ? "Connecting…" : "Connect"}
        </button>
        <p className="text-xs text-slate-500">
          This link was created by the device owner and can be used until it expires. No account needed.
        </p>
      </form>
    </div>
  );
}