import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/// กล่องเข้ารหัส credential ที่ร้านฝากไว้กับเรา (Phase 15c) — AES-256-GCM ด้วยกุญแจเดียวของแพลตฟอร์ม
///
/// env PAYMENT_CONFIG_KEY = 32 ไบต์ base64url (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`)
/// · ไม่ตั้ง = เข้ารหัส/ถอดรหัสไม่ได้ → ร้านผูก SCB เองไม่ได้ (fail closed) แต่ระบบส่วนอื่นทำงานปกติ
/// · **เปลี่ยนกุญแจ = credential ที่เก็บไว้ทั้งหมดถอดไม่ออก** ต้องให้ร้านกรอกใหม่ — ห้าม rotate โดยไม่มีแผน
/// · รูปแบบข้อความ: `v1.<iv>.<tag>.<ciphertext>` ทุกส่วน base64url · iv สุ่มใหม่ทุกครั้ง (GCM ห้ามซ้ำ iv กับกุญแจเดิม)
/// · ไม่พึ่ง server-only เพื่อให้ unit test import ได้ตรง — แต่ห้ามเรียกจาก Client Component (กุญแจอยู่ใน env ฝั่ง server)

const VERSION = "v1"
const KEY_BYTES = 32
const IV_BYTES = 12

function readKey(): Buffer | null {
  const raw = process.env.PAYMENT_CONFIG_KEY?.trim()
  if (!raw) return null
  const key = Buffer.from(raw, "base64url")
  return key.length === KEY_BYTES ? key : null
}

export function isSecretBoxConfigured(): boolean {
  return readKey() !== null
}

export function encryptSecret(plaintext: string): string {
  const key = readKey()
  if (!key) throw new Error("PAYMENT_CONFIG_KEY_MISSING")
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
}

/// คืน null เมื่อถอดไม่ได้ (กุญแจผิด/ข้อมูลถูกแก้/รูปแบบไม่รู้จัก) — ผู้เรียกต้องถือว่า "ไม่มี credential" ห้ามเดา
export function decryptSecret(sealed: string): string | null {
  const key = readKey()
  if (!key) return null
  const [version, ivText, tagText, dataText] = sealed.split(".")
  if (version !== VERSION || !ivText || !tagText || !dataText) return null
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"))
    decipher.setAuthTag(Buffer.from(tagText, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

/// แสดงเฉพาะ 4 ตัวท้ายให้เจ้าของร้านรู้ว่ากรอกอะไรไว้ โดยไม่เปิดเผยค่าจริง
export function maskSecretTail(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null
  return value.length <= visible ? "•".repeat(value.length) : `${"•".repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`
}
