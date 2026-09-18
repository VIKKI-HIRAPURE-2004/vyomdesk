import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { Errors } from '../util/errors.js';
import { logger } from '../util/logger.js';
import type { AgentHub } from '../ws/agentHub.js';

/**
 * AlertService (P1.9) - threshold rules over device metrics.
 * Evaluated inline on each metrics.push (cheap: rules indexed by device,
 * per-rule active state kept in memory). State machine per (rule, device):
 *   metric breaches threshold -> active event row (+ notify once)
 *   metric back under threshold -> event resolved_at set
 * Channels: webhook (POST JSON, 5s timeout) | email (SMTP when configured)
 * | none (UI-only). Heartbeat/dead-man alerting lives in agentSocket
 * offline broadcast (P2 rollups).
 */

export const METRICS = ['cpu_pct', 'mem_pct', 'mem_used_mb', 'net_rx_kb', 'net_tx_kb'] as const;
export type MetricName = (typeof METRICS)[number];
const OPERATORS = ['>', '>=', '<'] as const;
const CHANNELS = ['webhook', 'email', 'none'] as const;

export interface AlertRuleRow {
  id: string;
  name: string;
  device_id: string | null;
  metric: string;
  operator: string;
  threshold: number;
  duration_s: number;
  channel: string;
  webhook_url: string | null;
  email_to: string | null;
  enabled: number; // sqlite boolean as 0/1
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEventRow {
  id: string;
  rule_id: string;
  device_id: string;
  value: number;
  started_at: string;
  resolved_at: string | null;
  notified: number;
}

interface RuleState {
  /** active alert event id per device, if this rule is currently triggered */
  active: Map<string, string>;
  /** first breach timestamp per device (for duration_s hold check) */
  breachSince: Map<string, number>;
}

export interface AlertNotifier {
  /** Fire a notification for a triggered rule. */
  notify(rule: AlertRuleRow, deviceId: string, value: number): Promise<void>;
}

export class AlertService {
  private rules = new Map<string, { row: AlertRuleRow; state: RuleState }>();
  private loaded = false;

  constructor(
    private db: Knex,
    private hub: AgentHub,
    private notifier: AlertNotifier,
  ) {}

  /** Load enabled rules from DB (call once at boot; refresh on rule CRUD). */
  async load(): Promise<void> {
    const rows = (await this.db('alert_rules').where({ enabled: 1 })) as AlertRuleRow[];
    this.rules.clear();
    for (const row of rows) {
      this.rules.set(row.id, { row, state: { active: new Map(), breachSince: new Map() } });
    }
    this.loaded = true;
    logger.info({ count: rows.length }, 'alert rules loaded');
  }

  // ---------- evaluation ----------

  /** Evaluate incoming metrics sample against all matching rules. */
  async evaluate(deviceId: string, sample: Partial<Record<MetricName, number | undefined>>): Promise<void> {
    if (!this.loaded) return;
    for (const { row, state } of this.rules.values()) {
      if (!row.enabled) continue;
      if (row.device_id && row.device_id !== deviceId) continue;
      const value = sample[row.metric as MetricName];
      if (value == null || !Number.isFinite(value)) continue;
      const breached = compare(value, row.operator, row.threshold);
      if (breached) {
        await this.onBreach(row, state, deviceId, value);
      } else {
        await this.onRecover(row, state, deviceId);
      }
    }
  }

  private async onBreach(row: AlertRuleRow, state: RuleState, deviceId: string, value: number): Promise<void> {
    const activeId = state.active.get(deviceId);
    if (activeId) return; // already alerted, stay silent until recovery
    const since = state.breachSince.get(deviceId) ?? Date.now();
    state.breachSince.set(deviceId, since);
    if (row.duration_s > 0 && Date.now() - since < row.duration_s * 1000) return; // not yet held long enough
    state.breachSince.delete(deviceId);
    // insert event + notify once
    const id = randomUUID();
    await this.db('alert_events').insert({
      id,
      rule_id: row.id,
      device_id: deviceId,
      value,
      started_at: this.db.fn.now() as unknown as string,
      notified: 0,
    });
    state.active.set(deviceId, id);
    let notified = false;
    try {
      await this.notifier.notify(row, deviceId, value);
      notified = true;
    } catch (e) {
      logger.error({ err: e, rule: row.id }, 'alert notify failed');
    }
    await this.db('alert_events').where({ id }).update({ notified: notified ? 1 : 0 });
    this.hub.broadcast('alert.triggered', { ruleId: row.id, ruleName: row.name, deviceId, value, channel: row.channel });
  }

  private async onRecover(row: AlertRuleRow, state: RuleState, deviceId: string): Promise<void> {
    const activeId = state.active.get(deviceId);
    state.breachSince.delete(deviceId);
    if (!activeId) return;
    await this.db('alert_events').where({ id: activeId }).update({ resolved_at: this.db.fn.now() as unknown as string });
    state.active.delete(deviceId);
    this.hub.broadcast('alert.resolved', { ruleId: row.id, ruleName: row.name, deviceId });
  }

  // ---------- CRUD ----------

  async listRules(): Promise<Array<Omit<AlertRuleRow, 'enabled'> & { enabled: boolean }>> {
    const rows = (await this.db('alert_rules').orderBy('created_at', 'desc')) as AlertRuleRow[];
    return rows.map((r) => ({ ...r, enabled: !!r.enabled }));
  }

  async createRule(p: {
    name: string;
    deviceId?: string | null;
    metric: string;
    operator: string;
    threshold: number;
    durationS?: number;
    channel?: string;
    webhookUrl?: string | null;
    emailTo?: string | null;
    createdBy?: string | null;
  }): Promise<AlertRuleRow> {
    const name = p.name?.trim();
    if (!name) throw Errors.badRequest('rule name required');
    if (name.length > 120) throw Errors.badRequest('rule name too long');
    if (!METRICS.includes(p.metric as MetricName)) throw Errors.badRequest(`metric must be one of ${METRICS.join(', ')}`);
    if (!OPERATORS.includes(p.operator as never)) throw Errors.badRequest('operator must be > , >= or <');
    if (!Number.isFinite(p.threshold)) throw Errors.badRequest('threshold must be a number');
    const channel = p.channel ?? 'none';
    if (!CHANNELS.includes(channel as never)) throw Errors.badRequest('channel must be webhook, email or none');
    if (channel === 'webhook' && !isValidHttpUrl(p.webhookUrl ?? '')) throw Errors.badRequest('webhookUrl required for webhook channel');
    if (channel === 'email' && !isValidEmail(p.emailTo ?? '')) throw Errors.badRequest('emailTo required for email channel');
    const durationS = Math.max(0, Math.min(3600, Number(p.durationS ?? 0)));
    const id = randomUUID();
    await this.db('alert_rules').insert({
      id,
      name,
      device_id: p.deviceId ?? null,
      metric: p.metric,
      operator: p.operator,
      threshold: p.threshold,
      duration_s: durationS,
      channel,
      webhook_url: p.webhookUrl ?? null,
      email_to: p.emailTo ?? null,
      enabled: 1,
      created_by: p.createdBy ?? null,
    });
    await this.load();
    return (await this.db('alert_rules').where({ id }).first()) as AlertRuleRow;
  }

  async updateRule(id: string, patch: {
    name?: string; enabled?: boolean; channel?: string; webhookUrl?: string | null; emailTo?: string | null;
  }): Promise<void> {
    const row = await this.db('alert_rules').where({ id }).first();
    if (!row) throw Errors.notFound('Alert rule');
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name?.trim();
      if (!name) throw Errors.badRequest('name cannot be empty');
      update.name = name;
    }
    if (patch.enabled !== undefined) update.enabled = patch.enabled ? 1 : 0;
    if (patch.channel !== undefined) {
      if (!CHANNELS.includes(patch.channel as never)) throw Errors.badRequest('channel must be webhook, email or none');
      update.channel = patch.channel;
    }
    if (patch.webhookUrl !== undefined) update.webhook_url = patch.webhookUrl;
    if (patch.emailTo !== undefined) update.email_to = patch.emailTo;
    await this.db('alert_rules').where({ id }).update(update);
    await this.load();
  }

  async deleteRule(id: string): Promise<void> {
    // delete children first (FK constraint; events reference rules)
    await this.db('alert_events').where({ rule_id: id }).del();
    const n = await this.db('alert_rules').where({ id }).del();
    if (!n) throw Errors.notFound('Alert rule');
    this.rules.delete(id);
  }

  async listEvents(filter: { unresolvedOnly?: boolean; limit?: number } = {}): Promise<AlertEventRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const q = this.db('alert_events').select('*');
    if (filter.unresolvedOnly) q.whereNull('resolved_at');
    return q.orderBy('started_at', 'desc').limit(limit);
  }

  /** Test-fire the notifier for a rule (POST /alerts/test). */
  async testNotify(ruleId: string): Promise<void> {
    const row = await this.db('alert_rules').where({ id: ruleId }).first();
    if (!row) throw Errors.notFound('Alert rule');
    await this.notifier.notify(row, 'test-device', 0);
  }
}

function compare(value: number, operator: string, threshold: number): boolean {
  if (operator === '>') return value > threshold;
  if (operator === '>=') return value >= threshold;
  return value < threshold;
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Webhook + email notifier. Webhook posts a JSON payload with a 5s
 * timeout; email uses nodemailer when SMTP is configured (server
 * package adds the dependency) else logs a warning and no-ops.
 */
export class HttpNotifier implements AlertNotifier {
  constructor(
    private smtp?: { host: string; port: number; user?: string; pass?: string; from: string },
  ) {}

  async notify(rule: AlertRuleRow, deviceId: string, value: number): Promise<void> {
    const payload = {
      type: 'alert.triggered',
      rule: { id: rule.id, name: rule.name, metric: rule.metric, operator: rule.operator, threshold: rule.threshold },
      deviceId,
      value,
      ts: Date.now(),
    };
    if (rule.channel === 'webhook' && rule.webhook_url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(rule.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      } finally {
        clearTimeout(t);
      }
    } else if (rule.channel === 'email') {
      if (!this.smtp) throw new Error('SMTP not configured (VYOM_SMTP_HOST required)');
      // email sending needs nodemailer; lazy-import so the dep is optional
      const mod = await import('nodemailer').catch(() => null);
      if (!mod) throw new Error('nodemailer not installed');
      const transport = mod.createTransport({
        host: this.smtp.host,
        port: this.smtp.port,
        secure: this.smtp.port === 465,
        auth: this.smtp.user ? { user: this.smtp.user, pass: this.smtp.pass } : undefined,
      });
      await transport.sendMail({
        from: this.smtp.from,
        to: rule.email_to ?? '',
        subject: `[VyomDesk] Alert: ${rule.name}`,
        text: JSON.stringify(payload, null, 2),
      });
    }
    // channel === 'none' -> UI-only alert (event row exists; browser live
    // events stream shows it); no external delivery attempted
  }
}