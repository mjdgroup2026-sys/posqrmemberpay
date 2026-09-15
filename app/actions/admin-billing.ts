"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
// ผู้ดูแลแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ (ยืนยันจ่าย/เติมวัน/ตั้งเพดานให้ร้านใดก็ได้) — ไม่มี storeId ให้ forStore()
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requirePlatformAdmin, storeErrorMessage } from "@/lib/session"
import { computeRenewalPeriod, subscriptionRequestRef, TIER_SPEC, type PlanTierValue } from "@/lib/subscription"
import {
  confirmSubscriptionSchema,
  firstIssueMessage,
  grantCustomDaysSchema,
  planCodeSchema,
  publishPlanSchema,
  setTableLimitSchema,
  voidSubscriptionSchema,
  zodToFieldErrors,
} from "@/lib/validation"
import type { Prisma } from "@/generated/prisma/client"
import type { ActionResult } from "@/lib/types"

/// ค่าใช้งานแบบต่ออายุ — ฝั่งแพลตฟอร์ม (Phase 14b) · เฉพาะ isPlatformAdmin
///
/// ที่เดียวที่ทำให้ Store.planTier/tableLimit/planExpiresAt เปลี่ยน (นอกจาก TRIAL ที่ฟรี) — เสมอในทรานแซคชันเดียวกับ
/// แถว ledger (กติกาเดียวกับ product.quantity ↔ StockTransaction) · ledger append-only: ถอยรายการ PAID = สร้างแถว VOID
/// ชดเชยที่ชี้ reversesId ไม่แก้แถวเดิม · ยืนยันพร้อมกัน 2 ครั้ง → updateMany where PENDING ผ่านครั้งเดียว (กติกาข้อ 7)

class AdminBillingAbort extends Error {
  constructor(readonly reason: string) {
    super("ADMIN_BILLING_ABORT")
  }
}

type Tx = Prisma.TransactionClient

function revalidateAdminBilling(storeId?: string) {
  revalidatePath("/admin/stores")
  if (storeId) revalidatePath(`/admin/stores/${storeId}`)
  revalidatePath("/admin/plans")
  revalidatePath("/billing")
  revalidatePath("/", "layout")
}

async function uniqueRequestRef(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = subscriptionRequestRef(randomBytes(8))
    if (!(await tx.storeSubscription.findUnique({ where: { requestRef: ref }, select: { id: true } }))) return ref
  }
  throw new AdminBillingAbort("สร้างเลขอ้างอิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
}

/// tier/เพดานที่ "มีผลอยู่" จากแถว PAID ล่าสุดที่ยังไม่ถูกถอย — ใช้ตอนคำนวณใหม่หลัง void
async function effectivePlanFromLedger(tx: Tx, storeId: string) {
  return tx.storeSubscription.findFirst({
    where: { storeId, status: "PAID", reversal: null },
    orderBy: { paidAt: "desc" },
    select: { tier: true, tableLimit: true },
  })
}

/// ยืนยันว่าเงินเข้าแล้ว → PENDING → PAID พร้อมเลขอ้างอิงธนาคาร แล้วอัปเดตค่าบน Store ในทรานแซคชันเดียว
/// RENEWAL: คำนวณช่วงจริง ณ ตอนยืนยัน (stack จากวันหมดอายุปัจจุบัน) · UPGRADE: เปลี่ยน tier/เพดานทันที ไม่ยืดวัน
export async function confirmSubscription(formData: FormData): Promise<ActionResult> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdmin()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = confirmSubscriptionSchema.safeParse({ id: formData.get("id"), paymentReference: formData.get("paymentReference") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { id, paymentReference } = parsed.data

  try {
    const storeId = await prisma.$transaction(async (tx) => {
      // ★ ด่านจริง — สองคนกดยืนยันพร้อมกัน ผ่านได้แค่ 1 (อีกคน count = 0)
      const now = new Date()
      let closed: { count: number }
      try {
        closed = await tx.storeSubscription.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "PAID", paymentReference, paidAt: now, confirmedById: adminId },
        })
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          throw new AdminBillingAbort("เลขอ้างอิงธนาคารนี้ถูกใช้ยืนยันรายการอื่นไปแล้ว — ตรวจสอบว่าไม่ได้ยืนยันซ้ำ")
        }
        throw error
      }
      if (closed.count === 0) throw new AdminBillingAbort("รายการนี้ไม่ได้อยู่ในสถานะรอยืนยัน (ถูกยืนยันหรือยกเลิกไปแล้ว)")

      const row = await tx.storeSubscription.findUniqueOrThrow({
        where: { id },
        select: { storeId: true, kind: true, tier: true, tableLimit: true, days: true, store: { select: { planExpiresAt: true } } },
      })

      // ดาวน์เกรดต้องผ่านเพดานอีกครั้งตอนยืนยัน — ร้านอาจเพิ่มโต๊ะระหว่างรอ
      const tableCount = await tx.table.count({ where: { storeId: row.storeId } })
      if (tableCount > row.tableLimit) {
        throw new AdminBillingAbort(
          `ยืนยันไม่ได้ — ร้านมี ${tableCount} โต๊ะ เกินเพดาน ${row.tableLimit} ของแพ็กเกจนี้ ให้ร้านลบโต๊ะก่อนหรือยกเลิกคำขอ`,
        )
      }

      if (row.kind === "UPGRADE") {
        // ไม่ยืดวัน — periodEnd = วันหมดอายุปัจจุบัน
        await tx.storeSubscription.update({ where: { id }, data: { periodStart: now, periodEnd: row.store.planExpiresAt ?? now } })
        await tx.store.update({ where: { id: row.storeId }, data: { planTier: row.tier, tableLimit: row.tableLimit } })
      } else {
        const { start, end } = computeRenewalPeriod(now, row.store.planExpiresAt, row.days)
        await tx.storeSubscription.update({ where: { id }, data: { periodStart: start, periodEnd: end } })
        await tx.store.update({
          where: { id: row.storeId },
          data: { planTier: row.tier, tableLimit: row.tableLimit, planExpiresAt: end, expiryNoticeLevel: 0 },
        })
      }
      return row.storeId
    })

    revalidateAdminBilling(storeId)
    return { ok: true, message: "ยืนยันการชำระแล้ว — แพ็กเกจของร้านมีผลทันที" }
  } catch (error) {
    if (error instanceof AdminBillingAbort) return { ok: false, error: error.reason }
    console.error("[admin-billing] confirmSubscription:", error)
    return { ok: false, error: "ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ยกเลิกรายการ — PENDING → VOID ตรง ๆ · PAID → สร้างแถว VOID ชดเชย (reversesId) แล้วถอย Store กลับ:
/// RENEWAL/TRIAL/CUSTOM ลบวันที่รายการนั้นเติม (periodEnd − periodStart) ออกจาก planExpiresAt ·
/// UPGRADE/ทุก kind → tier/เพดานกลับเป็นของแถว PAID ล่าสุดที่เหลือ
export async function voidSubscription(formData: FormData): Promise<ActionResult> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdmin()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = voidSubscriptionSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  const { id, reason } = parsed.data

  try {
    const storeId = await prisma.$transaction(async (tx) => {
      const row = await tx.storeSubscription.findUnique({
        where: { id },
        include: { reversal: { select: { id: true } }, store: { select: { planExpiresAt: true } } },
      })
      if (!row) throw new AdminBillingAbort("ไม่พบรายการนี้")
      if (row.status === "VOID") throw new AdminBillingAbort("รายการนี้ถูกยกเลิกไปแล้ว")
      if (row.reversal) throw new AdminBillingAbort("รายการนี้ถูกถอยไปแล้ว")

      const now = new Date()
      if (row.status === "PENDING") {
        const closed = await tx.storeSubscription.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "VOID", voidedAt: now, voidedById: adminId, note: `ผู้ดูแลยกเลิก: ${reason}` },
        })
        if (closed.count === 0) throw new AdminBillingAbort("รายการเพิ่งถูกยืนยันไป กรุณาโหลดใหม่")
        return row.storeId
      }

      // PAID → แถวชดเชย (append-only) — ตัวเลขติดลบเพื่อให้ยอดรวมใน ledger ถูก
      await tx.storeSubscription.create({
        data: {
          storeId: row.storeId,
          planId: row.planId,
          kind: row.kind,
          tier: row.tier,
          tableLimit: row.tableLimit,
          days: -row.days,
          ratePerDay: row.ratePerDay,
          discountPercent: row.discountPercent,
          listPrice: row.listPrice.neg(),
          amount: row.amount.neg(),
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          status: "VOID",
          paymentMethod: row.paymentMethod,
          requestRef: await uniqueRequestRef(tx),
          reversesId: row.id,
          voidedAt: now,
          voidedById: adminId,
          createdById: adminId,
          note: `ถอยรายการ ${row.requestRef}: ${reason}`,
        },
      })

      const effective = await effectivePlanFromLedger(tx, row.storeId)
      const data: Prisma.StoreUpdateInput = {
        planTier: effective?.tier ?? null,
        tableLimit: effective?.tableLimit ?? TIER_SPEC.S.tableLimit,
      }
      if (row.kind !== "UPGRADE" && row.store.planExpiresAt) {
        const contributed = row.periodEnd.getTime() - row.periodStart.getTime()
        const rolledBack = new Date(row.store.planExpiresAt.getTime() - contributed)
        // ไม่มีแถว PAID เหลือเลย → กลับเป็น "ยังไม่มีแพ็กเกจ"
        data.planExpiresAt = effective ? rolledBack : null
      }
      await tx.store.update({ where: { id: row.storeId }, data })
      return row.storeId
    })

    revalidateAdminBilling(storeId)
    return { ok: true, message: "ยกเลิกรายการแล้ว — ค่าแพ็กเกจของร้านถูกถอยกลับ" }
  } catch (error) {
    if (error instanceof AdminBillingAbort) return { ok: false, error: error.reason }
    console.error("[admin-billing] voidSubscription:", error)
    return { ok: false, error: "ยกเลิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เติมวันแบบ CUSTOM (ชดเชย/ปรับวัน) — PAID/FREE ทันที stack ต่อท้าย · tier ไม่ระบุ = tier ปัจจุบัน (หรือ S ถ้าไม่มี)
export async function grantCustomDays(formData: FormData): Promise<ActionResult> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdmin()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = grantCustomDaysSchema.safeParse({
    storeId: formData.get("storeId"),
    days: formData.get("days"),
    tier: formData.get("tier") || undefined,
    note: formData.get("note"),
  })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  const { storeId, days, note } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { planTier: true, tableLimit: true, planExpiresAt: true } })
      if (!store) throw new AdminBillingAbort("ไม่พบร้านนี้")
      const tier = (parsed.data.tier ?? store.planTier ?? "S") as PlanTierValue
      const spec = TIER_SPEC[tier]
      // เพดานคง "ค่าพิเศษ" ที่ผู้ดูแลเคยตั้งไว้ถ้าสูงกว่าของ tier (setTableLimit ไม่ควรถูกทับด้วยการเติมวัน)
      const tableLimit = Math.max(spec.tableLimit, store.planTier === tier ? store.tableLimit : 0)
      const now = new Date()
      const { start, end } = computeRenewalPeriod(now, store.planExpiresAt, days)

      await tx.storeSubscription.create({
        data: {
          storeId,
          kind: "CUSTOM",
          tier,
          tableLimit,
          days,
          ratePerDay: spec.ratePerDay.toFixed(2),
          discountPercent: "0.00",
          listPrice: (spec.ratePerDay * days).toFixed(2),
          amount: "0.00",
          periodStart: start,
          periodEnd: end,
          status: "PAID",
          paymentMethod: "FREE",
          requestRef: await uniqueRequestRef(tx),
          paidAt: now,
          confirmedById: adminId,
          createdById: adminId,
          note,
        },
      })
      await tx.store.update({ where: { id: storeId }, data: { planTier: tier, tableLimit, planExpiresAt: end, expiryNoticeLevel: 0 } })
    })

    revalidateAdminBilling(storeId)
    return { ok: true, message: `เติม ${days} วันให้ร้านแล้ว` }
  } catch (error) {
    if (error instanceof AdminBillingAbort) return { ok: false, error: error.reason }
    console.error("[admin-billing] grantCustomDays:", error)
    return { ok: false, error: "เติมวันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ตั้งเพดานโต๊ะพิเศษ (เกิน XL / ดีลเฉพาะ) — บันทึกเป็นแถว CUSTOM 0 วันเพื่อให้ ledger อธิบายได้ว่าใครตั้งเมื่อไหร่ทำไม
export async function setTableLimit(formData: FormData): Promise<ActionResult> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdmin()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = setTableLimitSchema.safeParse({ storeId: formData.get("storeId"), tableLimit: formData.get("tableLimit"), note: formData.get("note") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  const { storeId, tableLimit, note } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { planTier: true } })
      if (!store) throw new AdminBillingAbort("ไม่พบร้านนี้")
      const tableCount = await tx.table.count({ where: { storeId } })
      if (tableCount > tableLimit) throw new AdminBillingAbort(`ร้านมี ${tableCount} โต๊ะอยู่แล้ว ตั้งเพดานต่ำกว่านั้นไม่ได้`)
      const now = new Date()
      await tx.storeSubscription.create({
        data: {
          storeId,
          kind: "CUSTOM",
          tier: store.planTier ?? "S",
          tableLimit,
          days: 0,
          ratePerDay: "0.00",
          discountPercent: "0.00",
          listPrice: "0.00",
          amount: "0.00",
          periodStart: now,
          periodEnd: now,
          status: "PAID",
          paymentMethod: "FREE",
          requestRef: await uniqueRequestRef(tx),
          paidAt: now,
          confirmedById: adminId,
          createdById: adminId,
          note: `ตั้งเพดานโต๊ะ ${tableLimit}: ${note}`,
        },
      })
      await tx.store.update({ where: { id: storeId }, data: { tableLimit } })
    })

    revalidateAdminBilling(storeId)
    return { ok: true, message: `ตั้งเพดานโต๊ะเป็น ${tableLimit} แล้ว` }
  } catch (error) {
    if (error instanceof AdminBillingAbort) return { ok: false, error: error.reason }
    console.error("[admin-billing] setTableLimit:", error)
    return { ok: false, error: "ตั้งเพดานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ออกแพ็กเกจ version ใหม่ — code เดิม: แถวเก่า isActive=false + supersededById · แถว StoreSubscription ที่อ้าง version เก่าไม่เปลี่ยน
export async function publishPlanVersion(formData: FormData): Promise<ActionResult<{ version: number }>> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdmin()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = publishPlanSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    tier: formData.get("tier"),
    tableLimit: formData.get("tableLimit"),
    durationDays: formData.get("durationDays"),
    ratePerDay: formData.get("ratePerDay"),
    price: formData.get("price"),
    sortOrder: formData.get("sortOrder") ?? 0,
  })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  const input = parsed.data
  const listPrice = input.ratePerDay * input.durationDays
  const discountPercent = listPrice > 0 ? Math.max(0, Math.round((1 - input.price / listPrice) * 10000) / 100) : 0

  try {
    const version = await prisma.$transaction(async (tx) => {
      const latest = await tx.subscriptionPlan.findFirst({ where: { code: input.code }, orderBy: { version: "desc" } })
      const nextVersion = (latest?.version ?? 0) + 1
      const created = await tx.subscriptionPlan.create({
        data: {
          code: input.code,
          version: nextVersion,
          name: input.name,
          tier: input.tier,
          tableLimit: input.tableLimit,
          durationDays: input.durationDays,
          ratePerDay: input.ratePerDay.toFixed(2),
          discountPercent: discountPercent.toFixed(2),
          price: input.price.toFixed(2),
          sortOrder: input.sortOrder,
          isActive: true,
          createdById: adminId,
        },
        select: { id: true },
      })
      // ปิดทุก version ก่อนหน้าที่ยัง active (ปกติมีตัวเดียว) แล้วชี้ตัวล่าสุดไปที่ version ใหม่
      await tx.subscriptionPlan.updateMany({ where: { code: input.code, id: { not: created.id } }, data: { isActive: false } })
      if (latest) await tx.subscriptionPlan.update({ where: { id: latest.id }, data: { supersededById: created.id } })
      return nextVersion
    })

    revalidateAdminBilling()
    return { ok: true, message: `ออกแพ็กเกจ ${input.code} version ${version} แล้ว`, data: { version } }
  } catch (error) {
    console.error("[admin-billing] publishPlanVersion:", error)
    return { ok: false, error: "ออกแพ็กเกจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เลิกขายแพ็กเกจ (isActive=false โดยไม่มี version แทน) — แถวยังอยู่ให้อ้างย้อนหลัง
export async function retirePlan(formData: FormData): Promise<ActionResult> {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const parsed = planCodeSchema.safeParse({ code: formData.get("code") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  if (parsed.data.code === "TRIAL") return { ok: false, error: "แพ็กเกจทดลองเลิกขายไม่ได้ — ปิดสิทธิ์ทดลองต้องแก้ที่โค้ด" }

  const result = await prisma.subscriptionPlan.updateMany({ where: { code: parsed.data.code, isActive: true }, data: { isActive: false } })
  if (result.count === 0) return { ok: false, error: "ไม่พบแพ็กเกจที่ยังขายอยู่ในรหัสนี้" }

  revalidateAdminBilling()
  return { ok: true, message: `เลิกขาย ${parsed.data.code} แล้ว` }
}
