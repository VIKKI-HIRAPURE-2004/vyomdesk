import { useState } from "react";

/**
 * QuickSupportPage - public join page (no login required).
 * A helper enters the 9-digit code (+ optional password) shown by the
 * user's VyomLink agent; the code is redeemed for a one-time relay
 * session and the remote desktop opens directly in the browser.
 */

type Status = "idle" | "redeeming" | "error";

export default function QuickSupportPage() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 9) {
      setStatus("error");
      setError("Code must be 9 digits");
      return;
    }
    setStatus("redeeming");
    setError(null);
    try {
      const res = await fetch("/api/v1/quick-support/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: clean,
          ...(password ? { password } : {}),
          channel: 2, // Desktop
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `redeem failed (${res.status})`);
      // stash token for the viewer page, then navigate
      sessionStorage.setItem("vyom_qs_token", body.token);
      sessionStorage.setItem("vyom_qs_device", body.deviceId);
      sessionStorage.setItem("vyom_qs_channel", String(body.channel));
      location.assign(`/join/session`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "redeem failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Vyom<span className="text-brand-400">Desk</span> Quick Support
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter the 9-digit code the person you are helping reads out to you.
          </p>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">Code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000 000 000"
            inputMode="numeric"
            autoComplete="off"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
            Password <span className="text-slate-500 normal-case">(if provided)</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {status === "error" && error && <p className="text-sm text-rose-500">{error}</p>}
        <button
          type="submit"
          disabled={status === "redeeming"}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 font-medium"
        >
          {status === "redeeming" ? "Connecting…" : "Connect"}
        </button>
        <p className="text-xs text-slate-500">
          The code is single-use and expires automatically. No account needed.
        </p>
      </form>
    </div>
  );
}