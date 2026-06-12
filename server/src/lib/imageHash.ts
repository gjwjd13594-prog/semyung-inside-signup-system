import sharp from "sharp";
import { createHash } from "crypto";

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// 지각 해시(aHash) — 64bit → 16자 hex
export async function aHash(buffer: Buffer): Promise<string> {
  const px = await sharp(buffer).grayscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  const avg = px.reduce((s: number, v: number) => s + v, 0) / px.length;
  let bits = "";
  for (const v of px) bits += v >= avg ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// 두 aHash 해밍 거리
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
