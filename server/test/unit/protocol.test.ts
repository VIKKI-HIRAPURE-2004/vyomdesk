import { describe, expect, it } from "vitest";
import { Channel, parseFrameHeader, PROTOCOL_VERSION } from "@vyomdesk/shared";
import { canUseChannel, hasRight, Rights } from "@vyomdesk/shared";

describe("protocol", () => {
  it("exposes v1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("parses a tunnel frame header", () => {
    // channel=2 (desktop), flags=0x02 (keyframe), len=0x0102
    const buf = new Uint8Array([0x02, 0x02, 0x01, 0x02]);
    const h = parseFrameHeader(buf);
    expect(h.channel).toBe(Channel.Desktop);
    expect(h.flags).toBe(0x02);
    expect(h.length).toBe(258);
  });

  it("rejects short frames", () => {
    expect(() => parseFrameHeader(new Uint8Array(3))).toThrow();
  });
});

describe("rights", () => {
  it("checks bits", () => {
    const r = Rights.RemoteControl | Rights.Console;
    expect(hasRight(r, Rights.RemoteControl)).toBe(true);
    expect(hasRight(r, Rights.ServerFiles)).toBe(false);
  });

  it("gates channels with No* overrides", () => {
    const r = Rights.RemoteControl | Rights.Console | Rights.ServerFiles | Rights.NoDesktop;
    expect(canUseChannel(r, Channel.Desktop)).toBe(false); // NoDesktop blocks
    expect(canUseChannel(r, Channel.Terminal)).toBe(true);
  });
});
