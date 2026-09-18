import crypto from "node:crypto";

/** Encrypt a UTF-8 string with AES-256-GCM. Output: base64(iv|tag|ct). */
export function encryptString(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt AES-256-GCM base64(iv|tag|ct) produced by encryptString. */
export function decryptString(encB64: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const raw = Buffer.from(encB64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
