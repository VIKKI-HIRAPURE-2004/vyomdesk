import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client.js";

/** Add Device: issues a one-time per-user install token and shows agent install steps. */
export default function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const issue = useMutation({ mutationFn: () => api.devices.enrollToken() });
  const data = issue.data ?? null;

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.installToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Add Device</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {!data && (
          <>
            <p className="text-sm text-slate-400 mb-4">
              Generate a one-time installation token bound to your account. The agent installed with this
              token will appear only in your dashboard.
            </p>
            {issue.isError && (
              <p className="text-sm text-red-400 mb-3">
                {issue.error instanceof ApiError ? issue.error.message : "Failed to generate token"}
              </p>
            )}
            <button
              onClick={() => issue.mutate()}
              disabled={issue.isPending}
              className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
            >
              {issue.isPending ? "Generating…" : "Generate Token & Download Agent"}
            </button>
          </>
        )}

        {data && (
          <>
            <p className="text-sm text-slate-400 mb-2">Your installation token (one-time use, expires in 24h):</p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm font-mono select-all">
                {data.installToken}
              </code>
              <button
                onClick={copy}
                className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside mb-4">
              <li>Download the VyomLink agent (.exe) below.</li>
              <li>Run it on the client PC — paste the token when asked.</li>
              <li>The PC appears here as Online. The token is then consumed.</li>
            </ol>
            <a
              href="/downloads/agent/windows-amd64/vyomlink.exe"
              className="block text-center w-full rounded-lg bg-brand-600 hover:bg-brand-500 px-4 py-2 text-sm font-medium mb-2"
            >
              Download Agent (.exe)
            </a>
            <p className="text-xs text-slate-500 text-center">
              Bound to {data.emailHint ?? "your account"} · expires {new Date(data.expiresAt).toLocaleString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
