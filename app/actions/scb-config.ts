"use server"

import { randomBytes } from "node:crypto"
import QRCode from "qrcode"
import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireOwner, storeErrorMessage, type StoreContext } from "@/lib/session"
import { createQrCode, resetTokenCache, SCB_PRODUCTION_BASE, SCB_SANDBOX_BASE } from "@/lib/payment-provider/scb"
import { getStoreScb } from "@/lib/scb-store"
import { encryptSecret, isSecretBoxConfigured } from "@/lib/secret-box"
import { firstIssueMessage, scbCredentialsSchema, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// SCB Open API ของร้าน (Phase 15c — โหมด ข) · เฉพาะเจ้าของร้าน · credential เข้ารหัสก่อนลงฐานเสมอ (lib/secret-box.ts)
///
/// ลำดับที่ร้านต้องทำ: กรอก credential → ได้ URL callback ต่อร้านไปลงทะเบียนในพอร์ทัล SCB (คู่ Biller ID + ref3 prefix) →
/// กด "ทดสอบการเชื่อมต่อ" จ่าย 1 บาทจริง → callback เข้า → scbVerifiedAt ประทับ → เลือกโหมด SCB_BILLER ได้
/// **ห้ามเปิดปิดบิลอัตโนมัติก่อนผ่านการทดสอบ** (spec) — getStoreScb() ไม่คืน credential ของร้านที่ยังไม่ verified

const TEST_AMOUNT = 1
const TEST_REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

function revalidateScbPages() {
  revalidatePath("/mobile-order/settings")
  revalidatePath("/admin/stores")
  revalidatePath("/order", "layout")
}

/// ref1 ทดสอบขึ้นต้น T ให้แยกจาก ref1 ของโต๊ะได้ด้วยตา (ยาว 12 ตามข้อจำกัด A-Z0-9 ≤ 20 ของ SCB)
function testRef1(): string {
  const bytes = randomBytes(11)
  let out = "T"
  for (let i = 0; i < 11; i += 1) out += TEST_REF_ALPHABET[bytes[i] % TEST_REF_ALPHABET.length]
  return out
}

export async function updateScbCredentials(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  if (!isSecretBoxConfigured()) {
    return { ok: false, error: "ระบบยังไม่ได้ตั้งกุญแจเข้ารหัส (PAYMENT_CONFIG_KEY) — ติดต่อผู้ดูแลแพลตฟอร์ม" }
  }

  const parsed = scbCredentialsSchema.safeParse({
    environment: formData.get("environment"),
    apiKey: formData.get("apiKey") ?? "",
    apiSecret: formData.get("apiSecret") ?? "",
    billerId: formData.get("billerId"),
    ref3Prefix: formData.get("ref3Prefix"),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { environment, apiKey, apiSecret, billerId, ref3Prefix } = parsed.data
  const db = forStore(ctx.storeId)

  const existing = await db.storePaymentConfig.findUnique({
    where: { storeId: ctx.storeId },
    select: { scbApiKeyEnc: true, scbApiSecretEnc: true, scbWebhookToken: true, scbApiBase: true, scbBillerId: true, scbRef3Prefix: true, scbVerifiedAt: true },
  })
  // เว้นว่าง = คงค่าเดิม (แก้ Biller ID/prefix โดยไม่ต้องพิมพ์ secret ซ้ำ) · ครั้งแรกต้องกรอกทั้งคู่
  const keyEnc = apiKey ? encryptSecret(apiKey) : (existing?.scbApiKeyEnc ?? null)
  const secretEnc = apiSecret ? encryptSecret(apiSecret) : (existing?.scbApiSecretEnc ?? null)
  if (!keyEnc || !secretEnc) {
    return { ok: false, error: "กรุณากรอก API key และ API secret ของ SCB", fieldErrors: { apiKey: !keyEnc ? "กรุณากรอก" : "", apiSecret: !secretEnc ? "กรุณากรอก" : "" } }
  }

  const base = environment === "sandbox" ? SCB_SANDBOX_BASE : SCB_PRODUCTION_BASE
  // credential ชุดใหม่ (key/secret/biller/prefix/สภาพแวดล้อม เปลี่ยนตัวใดตัวหนึ่ง) → ต้องทดสอบใหม่ทั้งชุด
  const changed =
    Boolean(apiKey) || Boolean(apiSecret) || existing?.scbApiBase !== base || existing?.scbBillerId !== billerId || existing?.scbRef3Prefix !== ref3Prefix
  const webhookToken = existing?.scbWebhookToken ?? randomBytes(32).toString("base64url")

  await db.storePaymentConfig.upsert({
    where: { storeId: ctx.storeId },
    update: {
      scbApiBase: base,
      scbApiKeyEnc: keyEnc,
      scbApiSecretEnc: secretEnc,
      scbBillerId: billerId,
      scbRef3Prefix: ref3Prefix,
      scbWebhookToken: webhookToken,
      ...(changed ? { scbVerifiedAt: null, scbTestRef1: null, scbTestStartedAt: null } : {}),
      updatedById: ctx.user.id,
    },
    create: {
      storeId: ctx.storeId,
      scbApiBase: base,
      scbApiKeyEnc: keyEnc,
      scbApiSecretEnc: secretEnc,
      scbBillerId: billerId,
      scbRef3Prefix: ref3Prefix,
      scbWebhookToken: webhookToken,
      updatedById: ctx.user.id,
    },
  })
  // token เก่าของ key เดิมใช้ไม่ได้แล้วถ้าเปลี่ยน key — ล้างทั้งหมดง่ายกว่าไล่ตาม
  resetTokenCache()

  // ร้านที่อยู่โหมด SCB อยู่แล้วแต่ credential เปลี่ยน → ยังไม่ verified → getStoreScb ตกไป env/ไม่มี → ลูกค้าจะไม่ได้ QR ธนาคาร
  revalidateScbPages()
  return {
    ok: true,
    message: changed
      ? "บันทึก credential แล้ว — ลงทะเบียน URL callback ในพอร์ทัล SCB แล้วกด “ทดสอบการเชื่อมต่อ” ก่อนเปิดใช้"
      : "บันทึกแล้ว (ไม่มีอะไรเปลี่ยน)",
  }
}

/// ถอด SCB ของร้านออกทั้งชุด — ถ้าอยู่โหมด SCB_BILLER อยู่ ให้กลับเป็นพร้อมเพย์ตรงทันที (ไม่ปล่อยให้ค้างโหมดที่ไม่มี credential)
export async function clearScbCredentials(): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const db = forStore(ctx.storeId)
  await db.$transaction(async (tx) => {
    await tx.storePaymentConfig.updateMany({
      where: { storeId: ctx.storeId },
      data: { scbApiBase: null, scbApiKeyEnc: null, scbApiSecretEnc: null, scbBillerId: null, scbRef3Prefix: null, scbVerifiedAt: null, scbTestRef1: null, scbTestStartedAt: null, updatedById: ctx.user.id },
    })
    await tx.store.updateMany({ where: { id: ctx.storeId, paymentMode: "SCB_BILLER" }, data: { paymentMode: "PROMPTPAY_DIRECT" } })
  })
  resetTokenCache()
  revalidateScbPages()
  return { ok: true, message: "ถอด SCB ของร้านออกแล้ว — กลับไปรับเงินด้วยพร้อมเพย์ตรง" }
}

/// ออก QR 1 บาทด้วย credential ของร้าน (ยังไม่ verified) แล้วรอ callback เข้า URL ต่อร้าน — ผ่านแล้ว lib/scb-webhook.ts จะประทับ scbVerifiedAt
export async function startScbConnectionTest(): Promise<ActionResult<{ qrDataUrl: string; ref1: string }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const scb = await getStoreScb(ctx.storeId, { allowUnverified: true })
  if (!scb || scb.source !== "store") return { ok: false, error: "กรอกและบันทึก credential SCB ของร้านก่อน" }

  const ref1 = testRef1()
  const issued = await createQrCode(scb.creds, { amount: TEST_AMOUNT, ref1 })
  if (!issued.ok) return { ok: false, error: `ธนาคารออก QR ไม่สำเร็จ — ตรวจ API key/secret/Biller ID: ${issued.error}` }

  await forStore(ctx.storeId).storePaymentConfig.update({
    where: { storeId: ctx.storeId },
    data: { scbTestRef1: ref1, scbTestStartedAt: new Date() },
  })
  const qrDataUrl = await QRCode.toDataURL(issued.data, { width: 320, margin: 1, errorCorrectionLevel: "M" })
  revalidatePath("/mobile-order/settings")
  return { ok: true, message: "สแกนจ่าย 1 บาทแล้วรอ callback จากธนาคาร (ไม่เกิน 2 นาที)", data: { qrDataUrl, ref1 } }
}

export type ScbTestStatus = { verifiedAt: Date | null; testStartedAt: Date | null; pendingRef1: string | null }

/// หน้าตั้งค่าโพลถามระหว่างรอ callback
export async function getScbTestStatus(): Promise<ActionResult<ScbTestStatus>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const row = await forStore(ctx.storeId).storePaymentConfig.findUnique({
    where: { storeId: ctx.storeId },
    select: { scbVerifiedAt: true, scbTestStartedAt: true, scbTestRef1: true },
  })
  return { ok: true, message: "", data: { verifiedAt: row?.scbVerifiedAt ?? null, testStartedAt: row?.scbTestStartedAt ?? null, pendingRef1: row?.scbTestRef1 ?? null } }
}
