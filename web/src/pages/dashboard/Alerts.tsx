import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.js";

/**
 * AlertsPage (P1.9) - admin-only alert rules + live events view.
 * Rules: threshold over a metric (cpu/mem/...), operator, optional hold
 * duration, notify channel (webhook/email/none). Events list shows the
 * trigger history with resolve status.
 */

const METRICS = ["cpu_pct", "mem_pct", "mem_used_mb", "net_rx_kb", "net_tx_kb"] as const;
const OPERATORS = [">", ">=", "<"] as const;

export default function AlertsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<string>("cpu_pct");
  const [operator, setOperator] = useState<string>(">");
  const [threshold, setThreshold] = useState("90");
  const [durationS, setDurationS] = useState("0");
  const [channel, setChannel] = useState<string>("none");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => api.alerts.listRules(),
    refetchInterval: 15_000,
  });
  const events = useQuery({
    queryKey: ["alert-events"],
    queryFn: () => api.alerts.listEvents({ limit: 50 }),
    refetchInterval: 10_000,
  });

  const createRule = useMutation({
    mutationFn: () =>
      api.alerts.createRule({
        name,
        metric,
        operator,
        threshold: Number(threshold),
        durationS: Number(durationS) || 0,
        channel,
        ...(channel === "webhook" ? { webhookUrl } : {}),
        ...(channel === "email" ? { emailTo } : {}),
      }),
    onSuccess: () => {
      setName("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "failed"),
  });

  const toggleRule = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) => api.alerts.updateRule(p.id, { enabled: p.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.alerts.deleteRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      qc.invalidateQueries({ queryKey: ["alert-events"] });
    },
  });

  const ruleName = (id: string) => rules.data?.rules.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Alerts</h1>
      <p className="mt-1 text-sm text-slate-400">
        Threshold rules evaluated on every metrics tick. When a metric breaches, an event opens
        and (optionally) a webhook/email fires once; it resolves when the metric recovers.
      </p>

      {/* create form */}
      <form
        onSubmit={(e) => { e.preventDefault(); createRule.mutate(); }}
        className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
      >
        <h2 className="text-sm font-medium text-slate-300">New rule</h2>
        <div className="grid gap-3 md:grid-cols-6">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            required
            className="md:col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="90"
            inputMode="decimal"
            required
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={durationS}
            onChange={(e) => setDurationS(e.target.value)}
            placeholder="hold secs"
            inputMode="numeric"
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="none">No notification (UI only)</option>
            <option value="webhook">Webhook</option>
            <option value="email">Email</option>
          </select>
          {channel === "webhook" && (
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.example/..."
              className="md:col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
          )}
          {channel === "email" && (
            <input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="ops@example.com"
              className="md:col-span-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
          )}
        </div>
        {err && <p className="text-xs text-rose-500">{err}</p>}
        <button
          type="submit"
          disabled={createRule.isPending}
          className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          {createRule.isPending ? "Creating…" : "Create rule"}
        </button>
      </form>

      {/* rules list */}
      <h2 className="mt-8 text-sm font-medium text-slate-300">Rules</h2>
      <div className="mt-2 space-y-2">
        {rules.data?.rules.length === 0 && (
          <p className="text-sm text-slate-500">No rules yet.</p>
        )}
        {rules.data?.rules.map((r) => (
          <div key={r.id} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-sm">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${r.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span className="font-medium">{r.name}</span>
            <span className="text-slate-400">
              {r.metric} {r.operator} {r.threshold}
              {r.duration_s > 0 && ` (hold ${r.duration_s}s)`}
            </span>
            <span className="text-xs text-slate-500">{r.channel}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => toggleRule.mutate({ id: r.id, enabled: !r.enabled })}
                className="bg-slate-800 hover:bg-slate-700 rounded px-2.5 py-1 text-xs"
              >
                {r.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={() => deleteRule.mutate(r.id)}
                className="bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded px-2.5 py-1 text-xs"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* events */}
      <h2 className="mt-8 text-sm font-medium text-slate-300">Events</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm border border-slate-800 rounded-lg overflow-hidden">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Rule</th>
              <th className="text-left px-3 py-2">Value</th>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Resolved</th>
              <th className="text-left px-3 py-2">Notified</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.events.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-slate-500">No events yet.</td></tr>
            )}
            {events.data?.events.map((e) => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{ruleName(e.rule_id)}</td>
                <td className="px-3 py-2 font-mono">{e.value.toFixed(1)}</td>
                <td className="px-3 py-2 text-slate-400">{new Date(e.started_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {e.resolved_at ? (
                    <span className="text-emerald-400">{new Date(e.resolved_at).toLocaleString()}</span>
                  ) : (
                    <span className="text-amber-400 font-medium">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{e.notified ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}