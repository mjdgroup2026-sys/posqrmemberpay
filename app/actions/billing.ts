"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { requireOwner, storeErrorMessage, type StoreContext } from "@/lib/session"
import {
  computeRenewalPeriod,
  computeUpgradeAmount,
  normalizePromptPayId,
  remainingDays,
  subscriptionRequestRef,
  TIER_ORDER,
  TIER_SPEC,
  TRIAL_DAYS,
  TRIAL_TIER,
  type PlanTierValue,
} from "@/lib/subscription"
import { hashPromptPayId } from "@/lib/subscription-hash"
import {
  claimTrialSchema,
  firstIssueMessage,
  renewalRequestSchema,
  subscriptionIdSchema,
  upgradeRequestSchema,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// ค่าใช้งานแบบต่ออายุ — ฝั่งร้าน (Phase 14b) · เฉพาะเจ้าของร้าน
///
/// กติกา ledger (แนว StockTransaction): StoreSubscription เป็น append-only · ตัวเลขทุกตัว snapshot ณ ตอนขอ
/// Store.planTier/tableLimit/planExpiresAt เปลี่ยนเฉพาะตอน "ยืนยันจ่าย" (admin-billing.ts) ในทรานแซคชันเดียวกับแถว PAID
/// ยกเว้น TRIAL ที่ฟรีจึง PAID ทันทีที่นี่

class BillingAbort extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super("BILLING_ABORT")
  }
}

function revalidateBilling() {
  revalidatePath("/billing")
  revalidatePath("/admin/stores")
  revalidatePath("/", "layout")
}

/// เลขอ้างอิง SUB-XXXXXX — สุ่มใหม่ถ้าชนกับที่มีอยู่ (โอกาสน้อยมาก แต่ unique บังคับไว้)
async function uniqueRequestRef(tx: StoreTx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = subscriptionRequestRef(randomBytes(8))
    const exists = await tx.storeSubscription.findUnique({ where: { requestRef: ref }, select: { id: true } })
    if (!exists) return ref
  }
  throw new BillingAbort("สร้างเลขอ้างอิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
}

/// รับสิทธิ์ทดลอง 7 วัน (tier S) — ผูกกับเลขพร้อมเพย์ของร้าน: 1 เลข = ครั้งเดียวตลอดกาล (TrialClaim)
/// ให้เฉพาะร้านที่ "ยังไม่มีแพ็กเกจเลย" (planExpiresAt null) — ร้านที่เคยจ่าย/เคยทดลองแล้วต้องซื้อ
export async function claimTrial(formData: FormData): Promise<ActionResult<{ expiresAt: Date }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = claimTrialSchema.safeParse({ promptPayId: formData.get("promptPayId") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const normalized = normalizePromptPayId(parsed.data.promptPayId)
  if (!normalized) {
    return {
      ok: false,
      error: "รูปแบบเลขพร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์โทร 10 หลัก เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก",
      fieldErrors: { promptPayId: "รูปแบบไม่ถูกต้อง" },
    }
  }

  if (ctx.plan.expiresAt !== null) {
    return { ok: false, error: "ร้านนี้มีแพ็กเกจอยู่แล้ว สิทธิ์ทดลองใช้ได้เฉพาะร้านที่ยังไม่เคยเปิดใช้งาน" }
  }

  const promptPayIdHash = hashPromptPayId(normalized)
  const db = forStore(ctx.storeId)

  try {
    const result = await db.$transaction(async (tx) => {
      const already = await tx.storeSubscription.count({ where: { kind: "TRIAL" } })
      if (already > 0) throw new BillingAbort("ร้านนี้เคยรับสิทธิ์ทดลองไปแล้ว")

      // ★ ด่านจริงคือ unique promptPayIdHash — สองร้านกดพร้อมกันด้วยเลขเดียว ผ่านได้แค่ 1
      // TrialClaim ไม่อยู่ใน STORE_SCOPED_MODELS (ต้องเห็นข้ามร้าน) — tx ปล่อยผ่านและอยู่ในทรานแซคชันเดียวกัน
      try {
        await tx.trialClaim.create({ data: { promptPayIdHash, storeId: ctx.storeId } })
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          throw new BillingAbort("เลขพร้อมเพย์นี้เคยใช้สิทธิ์ทดลองไปแล้ว — เลือกแพ็กเกจเพื่อเปิดใช้งานร้าน", {
            promptPayId: "ใช้สิทธิ์ทดลองไปแล้ว",
          })
        }
        throw error
      }

      const trialPlan = await tx.subscriptionPlan.findFirst({ where: { code: "TRIAL", isActive: true }, select: { id: true } })
      const now = new Date()
      const { start, end } = computeRenewalPeriod(now, null, TRIAL_DAYS)
      const spec = TIER_SPEC[TRIAL_TIER]

      await tx.storeSubscription.create({
        data: {
          storeId: ctx.storeId,
          planId: trialPlan?.id ?? null,
          kind: "TRIAL",
          tier: TRIAL_TIER,
          tableLimit: spec.tableLimit,
          days: TRIAL_DAYS,
          ratePerDay: "0.00",
          discountPercent: "0.00",
          listPrice: (spec.ratePerDay * TRIAL_DAYS).toFixed(2),
          amount: "0.00",
          periodStart: start,
          periodEnd: end,
          status: "PAID",
          paymentMethod: "FREE",
          requestRef: await uniqueRequestRef(tx),
          paidAt: now,
          createdById: ctx.user.id,
          note: "ทดลองใช้ฟรี 7 วัน",
        },
      })
      // ค่า denormalized เปลี่ยนในทรานแซคชันเดียวกับแถว PAID เสมอ
      await tx.store.update({
        where: { id: ctx.storeId },
        data: { planTier: TRIAL_TIER, tableLimit: spec.tableLimit, planExpiresAt: end, expiryNoticeLevel: 0 },
      })
      await tx.storeSettings.update({ where: { storeId: ctx.storeId }, data: { promptPayId: normalized } })
      return end
    })

    revalidateBilling()
    return { ok: true, message: `เปิดใช้งานร้านแล้ว — ทดลองใช้ฟรีถึงวันที่ ${result.toLocaleDateString("th-TH")}`, data: { expiresAt: result } }
  } catch (error) {
    if (error instanceof BillingAbort) return { ok: false, error: error.reason, fieldErrors: error.fieldErrors }
    console.error("[billing] claimTrial:", error)
    return { ok: false, error: "เปิดใช้งานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

async function assertNoPendingRequest(tx: StoreTx) {
  const pending = await tx.storeSubscription.count({ where: { status: "PENDING" } })
  if (pending > 0) throw new BillingAbort("มีคำขอที่รอผู้ดูแลยืนยันอยู่แล้ว — ยกเลิกคำขอเดิมก่อนจึงจะขอใหม่ได้")
}

/// ขอต่ออายุด้วยแพ็กเกจมาตรฐาน → แถว PENDING + เลขอ้างอิงให้โอน · ผู้ดูแลยืนยันแล้วค่อยมีผล (stack ต่อท้าย)
/// ดาวน์เกรดได้เฉพาะเมื่อโต๊ะที่มีอยู่ ≤ เพดานใหม่ — ตรวจทั้งตอนขอ (บอกทันที) และตอนยืนยัน (กันเพิ่มโต๊ะระหว่างรอ)
export async function requestRenewal(formData: FormData): Promise<ActionResult<{ requestRef: string; amount: number }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = renewalRequestSchema.safeParse({ planCode: formData.get("planCode") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const db = forStore(ctx.storeId)

  try {
    const created = await db.$transaction(async (tx) => {
      await assertNoPendingRequest(tx)

      const plan = await tx.subscriptionPlan.findFirst({ where: { code: parsed.data.planCode, isActive: true, NOT: { code: "TRIAL" } } })
      if (!plan) throw new BillingAbort("ไม่พบแพ็กเกจนี้ หรือแพ็กเกจถูกยกเลิกไปแล้ว กรุณาเลือกใหม่")

      const tableCount = await tx.table.count()
      if (tableCount > plan.tableLimit) {
        throw new BillingAbort(
          `แพ็กเกจ ${plan.tier} รองรับ ${plan.tableLimit} โต๊ะ แต่ร้านมี ${tableCount} โต๊ะ — ต้องลบ ${tableCount - plan.tableLimit} โต๊ะก่อน หรือเลือกแพ็กเกจที่ใหญ่กว่า`,
        )
      }

      // ช่วงเวลาชั่วคราว ณ ตอนขอ — คำนวณจริงอีกครั้งตอนยืนยัน (stack จากวันหมดอายุ ณ เวลานั้น)
      const { start, end } = computeRenewalPeriod(new Date(), ctx.plan.expiresAt, plan.durationDays)
      return tx.storeSubscription.create({
        data: {
          storeId: ctx.storeId,
          planId: plan.id,
          kind: "RENEWAL",
          tier: plan.tier,
          tableLimit: plan.tableLimit,
          days: plan.durationDays,
          ratePerDay: plan.ratePerDay,
          discountPercent: plan.discountPercent,
          listPrice: plan.ratePerDay.mul(plan.durationDays).toFixed(2),
          amount: plan.price,
          periodStart: start,
          periodEnd: end,
          status: "PENDING",
          paymentMethod: "PROMPTPAY",
          requestRef: await uniqueRequestRef(tx),
          createdById: ctx.user.id,
          note: `${plan.name} (${plan.code} v${plan.version})`,
        },
        select: { requestRef: true, amount: true },
      })
    })

    revalidateBilling()
    return {
      ok: true,
      message: `สร้างคำขอแล้ว — โอน ${Number(created.amount).toLocaleString("th-TH")} บาท พร้อมระบุ ${created.requestRef} แล้วรอผู้ดูแลยืนยัน`,
      data: { requestRef: created.requestRef, amount: Number(created.amount) },
    }
  } catch (error) {
    if (error instanceof BillingAbort) return { ok: false, error: error.reason }
    console.error("[billing] requestRenewal:", error)
    return { ok: false, error: "สร้างคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// อัปเกรด tier กลางทาง — จ่ายส่วนต่าง (เรตใหม่ − เรตเดิม) × วันที่เหลือ ไม่มีส่วนลด ปัดขึ้น · ไม่ยืดวันหมดอายุ
export async function requestUpgrade(formData: FormData): Promise<ActionResult<{ requestRef: string; amount: number }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = upgradeRequestSchema.safeParse({ tier: formData.get("tier") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const target = parsed.data.tier as PlanTierValue

  const now = new Date()
  const daysLeft = remainingDays(now, ctx.plan.expiresAt)
  if (!ctx.plan.tier || daysLeft <= 0) {
    return { ok: false, error: "ต้องมีแพ็กเกจที่ยังไม่หมดอายุก่อนจึงอัปเกรดได้ — เลือกต่ออายุแทน" }
  }
  if (TIER_ORDER.indexOf(target) <= TIER_ORDER.indexOf(ctx.plan.tier)) {
    return { ok: false, error: "อัปเกรดได้เฉพาะระดับที่สูงกว่าปัจจุบัน — ลดระดับทำได้ตอนต่ออายุรอบถัดไป" }
  }

  const fromRate = TIER_SPEC[ctx.plan.tier].ratePerDay
  const toSpec = TIER_SPEC[target]
  const amount = computeUpgradeAmount(fromRate, toSpec.ratePerDay, daysLeft)
  const db = forStore(ctx.storeId)

  try {
    const created = await db.$transaction(async (tx) => {
      await assertNoPendingRequest(tx)
      return tx.storeSubscription.create({
        data: {
          storeId: ctx.storeId,
          planId: null,
          kind: "UPGRADE",
          tier: target,
          tableLimit: toSpec.tableLimit,
          days: daysLeft,
          ratePerDay: (toSpec.ratePerDay - fromRate).toFixed(2),
          discountPercent: "0.00",
          listPrice: amount.toFixed(2),
          amount: amount.toFixed(2),
          periodStart: now,
          periodEnd: ctx.plan.expiresAt ?? now,
          status: "PENDING",
          paymentMethod: "PROMPTPAY",
          requestRef: await uniqueRequestRef(tx),
          createdById: ctx.user.id,
          note: `อัปเกรด ${ctx.plan.tier} → ${target} สำหรับ ${daysLeft} วันที่เหลือ`,
        },
        select: { requestRef: true },
      })
    })

    revalidateBilling()
    return {
      ok: true,
      message: `สร้างคำขออัปเกรดแล้ว — โอน ${amount.toLocaleString("th-TH")} บาท พร้อมระบุ ${created.requestRef}`,
      data: { requestRef: created.requestRef, amount },
    }
  } catch (error) {
    if (error instanceof BillingAbort) return { ok: false, error: error.reason }
    console.error("[billing] requestUpgrade:", error)
    return { ok: false, error: "สร้างคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ร้านยกเลิกคำขอที่ยังไม่ถูกยืนยัน — updateMany where PENDING (ถ้าผู้ดูแลยืนยันไปพอดี count = 0 ไม่ทับ)
export async function cancelPendingRequest(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = subscriptionIdSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  // แถวในใบจ่ายรวมของแบรนด์ (Phase 14c) ยกเลิกรายสาขาไม่ได้ — ต้องยกเลิกทั้งใบที่ /brand/billing
  const result = await forStore(ctx.storeId).storeSubscription.updateMany({
    where: { id: parsed.data.id, status: "PENDING", batchId: null },
    data: { status: "VOID", voidedAt: new Date(), voidedById: ctx.user.id, note: "ร้านยกเลิกคำขอเอง" },
  })
  if (result.count === 0) {
    return { ok: false, error: "ไม่พบคำขอ หรือคำขอนี้ถูกยืนยัน/ยกเลิกไปแล้ว (คำขอในใบจ่ายรวมของแบรนด์ต้องยกเลิกทั้งใบที่หน้าแบรนด์)" }
  }

  revalidateBilling()
  return { ok: true, message: "ยกเลิกคำขอแล้ว" }
}
