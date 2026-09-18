import { createWriteStream, existsSync, mkdirSync, statSync, unlink } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { Errors } from '../util/errors.js';
import { logger } from '../util/logger.js';

/**
 * RecordingService (P1.10) - server-side tee of desktop relay frames.
 * One active recording per device at a time. relaySocket calls
 * recordFrame() for every agent->browser payload while a recording is
 * active for that device; frames land in a .vyomrec container:
 *   header: "VYOMREC1" [ver:1=0x01][channel:1][reserved:2 zero]
 *   frame:  [tsMs:8 LE u64][len:4 BE u32][payload]
 * Payload is the raw desktop sub-protocol msg ([msgType:1][body]) so the
 * player can replay JPEG frames with original timing.
 * (Server-side recording concept from MeshCentral recordings; container
 * format original, tuned for the VyomLink desktop sub-protocol.)
 */

const MAGIC = Buffer.from('VYOMREC1', 'ascii');
const VERSION = 0x01;
const HEADER_SIZE = MAGIC.length + 1 + 1 + 2;
const FRAME_META = 8 + 4;

export interface RecordingRow {
  id: string;
  device_id: string;
  channel: number;
  user_id: string | null;
  path: string;
  bytes: number;
  frames: number;
  started_at: string;
  ended_at: string | null;
}

interface ActiveRec {
  rowId: string;
  deviceId: string;
  ws: import('node:fs').WriteStream;
  bytes: number;
  frames: number;
  startedAtMs: number;
}

export class RecordingService {
  private active = new Map<string, ActiveRec>();

  constructor(
    private db: Knex,
    private dataDir: string,
  ) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  isRecording(deviceId: string): boolean {
    return this.active.has(deviceId);
  }

  /** Start a recording for a device (fails if one is already active). */
  async start(deviceId: string, userId: string | null, channel = 2): Promise<RecordingRow> {
    if (this.active.has(deviceId)) throw Errors.conflict('recording already active for device');
    const id = randomUUID();
    const filename = `${deviceId}-${Date.now()}.vyomrec`;
    const relPath = join('recordings', filename);
    const absPath = join(this.dataDir, relPath);
    mkdirSync(join(this.dataDir, 'recordings'), { recursive: true });
    const ws = createWriteStream(absPath);
    // header
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(header, 0);
    header[MAGIC.length] = VERSION;
    header[MAGIC.length + 1] = channel & 0xff;
    ws.write(header);
    const row = {
      id,
      device_id: deviceId,
      channel,
      user_id: userId,
      path: relPath.replace(/\\/g, '/'),
      bytes: HEADER_SIZE,
      frames: 0,
      started_at: new Date().toISOString(),
    };
    await this.db('recordings').insert({
      id,
      device_id: deviceId,
      channel,
      user_id: userId,
      path: row.path,
      bytes: row.bytes,
      frames: 0,
      started_at: this.db.fn.now() as unknown as string,
    });
    this.active.set(deviceId, {
      rowId: id,
      deviceId,
      ws,
      bytes: HEADER_SIZE,
      frames: 0,
      startedAtMs: Date.now(),
    });
    logger.info({ deviceId, recording: id }, 'recording started');
    return row as unknown as RecordingRow;
  }

  /** Tee a relay payload into the active recording (if any). */
  recordFrame(deviceId: string, payload: Buffer): void {
    const rec = this.active.get(deviceId);
    if (!rec) return;
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64LE(BigInt(Date.now() - rec.startedAtMs));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length, 0);
    rec.ws.write(Buffer.concat([ts, len, payload]));
    rec.bytes += FRAME_META + payload.length;
    rec.frames++;
  }

  /** Stop the active recording; flush + close the file, update the row. */
  async stop(deviceId: string): Promise<void> {
    const rec = this.active.get(deviceId);
    if (!rec) throw Errors.notFound('active recording for device');
    this.active.delete(deviceId);
    await new Promise<void>((resolve) => rec.ws.end(resolve));
    await this.db('recordings').where({ id: rec.rowId }).update({
      bytes: rec.bytes,
      frames: rec.frames,
      ended_at: this.db.fn.now() as unknown as string,
    });
    logger.info({ deviceId, frames: rec.frames, bytes: rec.bytes }, 'recording stopped');
  }

  async list(deviceId?: string): Promise<RecordingRow[]> {
    const q = this.db('recordings').select('*');
    if (deviceId) q.where({ device_id: deviceId });
    return q.orderBy('started_at', 'desc').limit(50);
  }

  async get(id: string): Promise<RecordingRow | undefined> {
    return this.db('recordings').where({ id }).first();
  }

  /** Absolute path for a recording row (player download). */
  absPath(row: RecordingRow): string {
    return join(this.dataDir, row.path);
  }

  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    if (!row) throw Errors.notFound('Recording');
    if (this.active.get(row.device_id)?.rowId === id) {
      throw Errors.conflict('recording is active; stop it first');
    }
    await this.db('recordings').where({ id }).del();
    const abs = this.absPath(row);
    unlink(abs, () => {});
  }
}