import "server-only"
import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"
import { buildPromptPayPayload } from "@/lib/promptpay"

/// ค่าตั้งของแพลตฟอร์ม (2026-10-05) — ข้อมูลอ้างอิงของแพลตฟอร์ม ไม่มี storeId จึงไม่อยู่ใน lib/queries.ts (เหมือน lib/plan-queries.ts)
///
/// พร้อมเพย์ที่ร้านโอนค่าใช้งานเข้า: ค่าในฐาน (ผู้ดูแลตั้งที่ /admin/settings) ชนะ → env PLATFORM_PROMPTPAY_ID เดิม → null
/// · **คนละเรื่องกับพร้อมเพย์รับเงินลูกค้าของร้าน** (getStorePaymentProfile ใน lib/payment-methods.ts)

export const PLATFORM_SETTING_ID = "platform"

export type PlatformPromptPay = {
  promptPayId: string
  promptPayName: string | null
  /// db = ตั้งจากหน้าผู้ดูแล · env = ยังใช้ค่าจาก .env บน VPS
  source: "db" | "env"
  updatedAt: Date | null
  updatedByName: string | null
}

export async function getPlatformPromptPay(): Promise<PlatformPromptPay | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { id: PLATFORM_SETTING_ID },
    select: { promptPayId: true, promptPayName: true, updatedAt: true, updatedBy: { select: { name: true } } },
  })
  if (row?.promptPayId) {
    return {
      promptPayId: row.promptPayId,
      promptPayName: row.promptPayName,
      source: "db",
      updatedAt: row.updatedAt,
      updatedByName: row.updatedBy?.name ?? null,
    }
  }
  const env = process.env.PLATFORM_PROMPTPAY_ID?.trim()
  return env ? { promptPayId: env, promptPayName: null, source: "env", updatedAt: null, updatedByName: null } : null
}

/// ข้อความเลขผู้รับใต้ QR — เลขเต็ม (ร้านพิมพ์โอนเองได้ถ้าสแกนไม่ได้) + ชื่อบัญชีให้เทียบในแอปธนาคาร
export function platformPromptPayLabel(platform: PlatformPromptPay | null): string | null {
  if (!platform) return null
  return platform.promptPayName ? `${platform.promptPayId} (${platform.promptPayName})` : platform.promptPayId
}

/// QR พร้อมเพย์ของแพลตฟอร์มตามยอด (data URL) — null = ยังไม่ได้ตั้งเลข หรือเลขใช้สร้าง QR ไม่ได้
export async function platformPromptPayQr(
  amount: number,
  platform: PlatformPromptPay | null,
  width = 240,
): Promise<string | null> {
  if (!platform) return null
  const payload = buildPromptPayPayload(amount, platform.promptPayId)
  return payload ? QRCode.toDataURL(payload, { margin: 1, width }) : null
}
