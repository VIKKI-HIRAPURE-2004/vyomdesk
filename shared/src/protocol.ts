/**
 * VyomLink protocol v1 - shared message types.
 * Spec: docs/06-AGENT-PROTOCOL.md
 */

export const PROTOCOL_VERSION = 1;

/** Relay channel numbers (aligned with MeshCentral relay concept). */
export const Channel = {
  Terminal: 1,
  Desktop: 2,
  Power: 3,
  Registry: 4,
  Files: 5,
  Chat: 200,
} as const;

export type ChannelId = (typeof Channel)[keyof typeof Channel];

/** JSON control envelope used on the agent control socket. */
export interface AgentEnvelope {
  v: number;
  id: string;
  cmd: string;
  ts: number;
  data?: unknown;
}

/** Binary tunnel frame header (after TLS/WS binaryData framing). */
export const FRAME_HEADER_SIZE = 4;

export const FrameFlag = {
  Data: 0x00,
  Open: 0x01,
  Close: 0x02,
  Ping: 0x04,
  Pong: 0x08,
} as const;

/** Parse a tunnel frame header (channel byte, flags byte, uint16 BE length). */
export function parseFrameHeader(buf: Uint8Array): {
  channel: number;
  flags: number;
  length: number;
} {
  if (buf.length < FRAME_HEADER_SIZE) throw new Error("frame too short");
  const channel = buf[0]!;
  const flags = buf[0 + 1]!;
  const length = (buf[2]! << 8) | buf[3]!;
  return { channel, flags, length };
}
