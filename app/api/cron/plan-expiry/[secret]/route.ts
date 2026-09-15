import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPlanExpiryMail } from "@/lib/mail"
import { expiryNoticeLevel, remainingDays } from "@/lib/subscription"
import { publicBaseUrl } from "@/lib/urls"

/// งานตามเวลา: เตือนแพ็กเกจใกล้หมดอายุ 7 / 3 / 1 วัน (Phase 14b)
///
/// แอปไม่มี scheduler ในตัว — ops/install-cron.sh บน VPS ยิง GET มาที่นี่วันละครั้ง (env CRON_SECRET ใน path)
/// dedupe ด้วย Store.expiryNoticeLevel: ส่งเฉพาะเมื่อระดับปัจจุบัน "ต่ำกว่า" ที่เคยส่ง (7 → 3 → 1) และรีเซ็ตเป็น 0 ตอนต่ออายุ
/// ค้นข้ามร้านโดยตั้งใจ — ผู้เรียกคือ cron ของแพลตฟอร์ม ไม่ใช่ผู้ใช้
export const dynamic = "force-dynamic"

function secretMatches(given: string): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? ""
  if (!expected || expected.length < 16) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(_request: Request, context: RouteContext<"/api/cron/plan-expiry/[secret]">) {
  const { secret } = await context.params
  if (!secretMatches(secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
  const stores = await prisma.store.findMany({
    where: { status: "ACTIVE", planExpiresAt: { not: null, gt: now, lte: horizon } },
    select: {
      id: true,
      name: true,
      planExpiresAt: true,
      expiryNoticeLevel: true,
      members: { where: { role: "OWNER" }, select: { user: { select: { email: true } } } },
    },
  })

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const store of stores) {
    const level = expiryNoticeLevel(now, store.planExpiresAt)
    // ระดับที่ต้องส่งครั้งแรก หรือต่ำกว่าที่เคยส่ง (7 แล้วค่อย 3 แล้วค่อย 1) — ที่เคยส่งแล้วข้าม
    const due = level > 0 && (store.expiryNoticeLevel === 0 || level < store.expiryNoticeLevel)
    if (!due || !store.planExpiresAt) {
      skipped += 1
      continue
    }
    const daysLeft = remainingDays(now, store.planExpiresAt)
    const results = await Promise.all(
      store.members.map((m) =>
        sendPlanExpiryMail(m.user.email, { storeName: store.name, daysLeft, expiresAt: store.planExpiresAt as Date, url: `${publicBaseUrl()}/billing` }),
      ),
    )
    if (results.some((r) => !r.ok)) {
      failed += 1
      console.error("[plan-expiry] ส่งอีเมลเตือนไม่สำเร็จบางฉบับ:", store.id, results.filter((r) => !r.ok))
      // ไม่บันทึกระดับ — รอบหน้าจะลองใหม่
      continue
    }
    await prisma.store.update({ where: { id: store.id }, data: { expiryNoticeLevel: level } })
    sent += 1
  }

  return NextResponse.json({ ok: true, checked: stores.length, sent, skipped, failed }, { headers: { "Cache-Control": "no-store" } })
}
