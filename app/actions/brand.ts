"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
// แบรนด์ครอบหลายร้านโดยตั้งใจ (ดึงสาขาเข้าแบรนด์ / คัดลอกเมนูข้ามสาขา / จ่ายรวมหลายสาขา) — forStore() ล็อกร้านเดียว
// จึงใช้ไม่ได้ · ทุกคำสั่งด้านล่างจึงกรอง storeId ด้วย "รายการสาขาที่พิสูจน์แล้วว่าผู้ใช้เป็นเจ้าของ" (ownedStoreIds / brand.ownerId)
// ก่อนเสมอ — นี่คือขอบเขตของ tenant ในระดับแบรนด์ (กติกาข้อ 5: ที่ค้นข้ามร้านได้มีแค่ที่ระบุใน CLAUDE.md)
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { requireOwner, requireUser, storeErrorMessage, type StoreContext } from "@/lib/session"
import { copyMenu } from "@/lib/menu-copy"
import { batchRequestRef, computeRenewalPeriod, subscriptionRequestRef } from "@/lib/subscription"
import {
  attachStoreToBrandSchema,
  batchIdSchema,
  brandBatchSchema,
  copyMenuSchema,
  createBrandSchema,
  firstIssueMessage,
  renameBrandSchema,
  zodToFieldErrors,
} from "@/lib/validation"
import type { Prisma } from "@/generated/prisma/client"
import type { ActionResult } from "@/lib/types"

/// ร้านหลายสาขา — Brand (Phase 14c)
///
/// Brand เป็นชั้นบาง ๆ ครอบ Store: 1 คนเป็นเจ้าของได้ 1 แบรนด์ (ตัดสินใจตอนเริ่มทำ — ลดคำถาม "แบรนด์ไหน" ทุกฟอร์ม)
/// · เจ้าของแบรนด์ = OWNER ทุกสาขาใต้แบรนด์โดยอัตโนมัติ (lib/store-context.ts) · ข้อมูลขายยังอยู่รายสาขาเสมอ
/// · ใบจ่ายรวม (SubscriptionBatch) = แถว StoreSubscription PENDING รายสาขาผูก batchId เดียว ยืนยัน/ยกเลิกทั้งชุดเท่านั้น

class BrandAbort extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super("BRAND_ABORT")
  }
}

type Tx = Prisma.TransactionClient

function revalidateBrand() {
  revalidatePath("/brand")
  revalidatePath("/brand/billing")
  revalidatePath("/brand/reports")
  revalidatePath("/billing")
  revalidatePath("/admin/stores")
  revalidatePath("/", "layout")
}

/// สาขาที่ผู้ใช้เป็น OWNER "ด้วยแถว StoreMember" (ไม่นับที่ได้จากแบรนด์) — ใช้ตอนดึงร้านเข้าแบรนด์
/// ต้องเป็นเจ้าของตรง ๆ เท่านั้น: สาขาที่ได้ OWNER มาจากแบรนด์อื่นดึงต่อไม่ได้ (ย้าย Store ระหว่างแบรนด์อยู่นอกเฟสนี้)
async function ownedStoreIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.storeMember.findMany({ where: { userId, role: "OWNER" }, select: { storeId: true } })
  return new Set(rows.map((r) => r.storeId))
}

async function brandOf(tx: Tx, userId: string) {
  return tx.brand.findFirst({ where: { ownerId: userId }, select: { id: true, name: true } })
}

/// สร้างแบรนด์ (ผู้ใช้ที่ล็อกอิน · ยังไม่มีแบรนด์) + ดึงสาขาที่ตัวเองเป็นเจ้าของเข้ามาได้ทันทีในทรานแซคชันเดียว
export async function createBrand(formData: FormData): Promise<ActionResult<{ brandId: string }>> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = createBrandSchema.safeParse({ name: formData.get("name"), storeIds: formData.getAll("storeIds") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { name, storeIds } = parsed.data

  try {
    const brandId = await prisma.$transaction(async (tx) => {
      if (await brandOf(tx, userId)) throw new BrandAbort("คุณมีแบรนด์อยู่แล้ว — 1 บัญชีเป็นเจ้าของได้ 1 แบรนด์")

      const brand = await tx.brand.create({ data: { name, ownerId: userId }, select: { id: true } })
      if (storeIds.length > 0) await attachStores(tx, userId, brand.id, storeIds)
      return brand.id
    })

    revalidateBrand()
    return { ok: true, message: `สร้างแบรนด์ ${name} แล้ว`, data: { brandId } }
  } catch (error) {
    if (error instanceof BrandAbort) return { ok: false, error: error.reason, fieldErrors: error.fieldErrors }
    console.error("[brand] createBrand:", error)
    return { ok: false, error: "สร้างแบรนด์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ดึงสาขาเข้าแบรนด์ — เฉพาะร้านที่ผู้ใช้เป็น OWNER (StoreMember) และยังไม่อยู่ใต้แบรนด์ใด
/// updateMany + where brandId null = ด่านจริง (สองแบรนด์ดึงร้านเดียวกันพร้อมกัน ผ่านได้แค่ 1)
async function attachStores(tx: Tx, userId: string, brandId: string, storeIds: string[]) {
  const owned = await ownedStoreIds(tx, userId)
  for (const storeId of storeIds) {
    if (!owned.has(storeId)) throw new BrandAbort("ดึงได้เฉพาะร้านที่คุณเป็นเจ้าของโดยตรง")
    const moved = await tx.store.updateMany({ where: { id: storeId, brandId: null }, data: { brandId } })
    if (moved.count === 0) throw new BrandAbort("ร้านนี้อยู่ใต้แบรนด์อื่นอยู่แล้ว — ย้ายร้านระหว่างแบรนด์ยังทำไม่ได้ในเวอร์ชันนี้")
  }
}

export async function attachStoreToBrand(formData: FormData): Promise<ActionResult> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = attachStoreToBrandSchema.safeParse({ storeId: formData.get("storeId") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    await prisma.$transaction(async (tx) => {
      const brand = await brandOf(tx, userId)
      if (!brand) throw new BrandAbort("คุณยังไม่มีแบรนด์ — สร้างแบรนด์ก่อน")
      await attachStores(tx, userId, brand.id, [parsed.data.storeId])
    })
    revalidateBrand()
    return { ok: true, message: "ดึงสาขาเข้าแบรนด์แล้ว" }
  } catch (error) {
    if (error instanceof BrandAbort) return { ok: false, error: error.reason }
    console.error("[brand] attachStoreToBrand:", error)
    return { ok: false, error: "ดึงสาขาเข้าแบรนด์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

export async function renameBrand(formData: FormData): Promise<ActionResult> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = renameBrandSchema.safeParse({ name: formData.get("name") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }

  // ownerId ใน where = กันแก้ชื่อแบรนด์ของคนอื่น
  const result = await prisma.brand.updateMany({ where: { ownerId: userId }, data: { name: parsed.data.name } })
  if (result.count === 0) return { ok: false, error: "คุณยังไม่มีแบรนด์" }

  revalidateBrand()
  return { ok: true, message: "เปลี่ยนชื่อแบรนด์แล้ว" }
}

/// คัดลอกเมนูจากสาขาอื่นมาลง "ร้านที่ทำงานอยู่" — ต้องเป็น OWNER ของทั้งสองร้าน (ต้นทางดูจาก memberships ที่
/// loadStoreContext() คำนวณให้ ซึ่งรวมสาขาใต้แบรนด์ที่ตัวเองเป็นเจ้าของแล้ว)
export async function copyMenuFromStore(formData: FormData): Promise<ActionResult<{ copied: number; skipped: number }>> {
  let ctx: StoreContext
  try {
    ctx = await requireOwner()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = copyMenuSchema.safeParse({ sourceStoreId: formData.get("sourceStoreId") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }
  const { sourceStoreId } = parsed.data

  if (sourceStoreId === ctx.storeId) return { ok: false, error: "สาขาต้นทางกับปลายทางเป็นร้านเดียวกัน" }
  const source = ctx.memberships.find((m) => m.storeId === sourceStoreId && m.role === "OWNER")
  if (!source) return { ok: false, error: "คัดลอกได้เฉพาะจากสาขาที่คุณเป็นเจ้าของ" }

  try {
    const result = await prisma.$transaction((tx) => copyMenu(tx, sourceStoreId, ctx.storeId))
    revalidatePath("/mobile-order/menu")
    revalidatePath("/mobile-order/settings")
    revalidateBrand()
    return {
      ok: true,
      message:
        result.skipped > 0
          ? `คัดลอกเมนูจาก ${source.name} แล้ว ${result.copied} รายการ (ข้าม ${result.skipped} รายการที่มีชื่อซ้ำอยู่แล้ว)`
          : `คัดลอกเมนูจาก ${source.name} แล้ว ${result.copied} รายการ`,
      data: result,
    }
  } catch (error) {
    console.error("[brand] copyMenuFromStore:", error)
    return { ok: false, error: "คัดลอกเมนูไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

async function uniqueBatchRef(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = batchRequestRef(randomBytes(8))
    if (!(await tx.subscriptionBatch.findUnique({ where: { requestRef: ref }, select: { id: true } }))) return ref
  }
  throw new BrandAbort("สร้างเลขอ้างอิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
}

async function uniqueRequestRef(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ref = subscriptionRequestRef(randomBytes(8))
    if (!(await tx.storeSubscription.findUnique({ where: { requestRef: ref }, select: { id: true } }))) return ref
  }
  throw new BrandAbort("สร้างเลขอ้างอิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
}

/// ใบจ่ายรวม: เลือก tier/ระยะเวลาให้หลายสาขาในครั้งเดียว → StoreSubscription PENDING แถวละสาขา (ผูก batchId เดียว)
/// + หัวใบ SubscriptionBatch ถือยอดรวม · ทุกสาขาต้องอยู่ใต้แบรนด์ของผู้ใช้ ไม่มีคำขอค้าง และโต๊ะไม่เกินเพดานของแพ็กเกจ
/// สาขาเลือกแพ็กเกจต่างกันได้ในใบเดียวกัน · ไม่มีส่วนลดหลายสาขาในเฟสนี้ · ตัวเลขทุกตัว snapshot ณ ตอนขอ (ledger)
export async function requestBrandBatch(formData: FormData): Promise<ActionResult<{ requestRef: string; amount: number }>> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const items = formData
    .getAll("item")
    .map(String)
    .filter((v) => v.trim() !== "")
    .map((v) => {
      const [storeId = "", planCode = ""] = v.split("|")
      return { storeId, planCode }
    })
  const parsed = brandBatchSchema.safeParse({ items })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const brand = await brandOf(tx, userId)
      if (!brand) throw new BrandAbort("คุณยังไม่มีแบรนด์ — สร้างแบรนด์และดึงสาขาเข้าก่อน")

      // ขอบเขตของใบนี้ = สาขาใต้แบรนด์ของผู้ใช้เท่านั้น
      const stores = await tx.store.findMany({
        where: { brandId: brand.id, id: { in: parsed.data.items.map((i) => i.storeId) } },
        select: { id: true, name: true, status: true, planExpiresAt: true, _count: { select: { tables: true } } },
      })
      const byId = new Map(stores.map((s) => [s.id, s]))

      const plans = await tx.subscriptionPlan.findMany({
        where: { isActive: true, NOT: { code: "TRIAL" }, code: { in: parsed.data.items.map((i) => i.planCode) } },
      })
      const planByCode = new Map(plans.map((p) => [p.code, p]))

      const batchRef = await uniqueBatchRef(tx)
      const batch = await tx.subscriptionBatch.create({
        data: { brandId: brand.id, requestRef: batchRef, amount: "0.00", status: "PENDING", createdById: userId },
        select: { id: true },
      })

      let total = 0
      const now = new Date()
      for (const item of parsed.data.items) {
        const store = byId.get(item.storeId)
        if (!store) throw new BrandAbort("มีสาขาที่ไม่ได้อยู่ใต้แบรนด์ของคุณในรายการ")
        if (store.status === "SUSPENDED") throw new BrandAbort(`สาขา ${store.name} ถูกระงับการใช้งาน — ติดต่อผู้ดูแลก่อน`)
        const plan = planByCode.get(item.planCode)
        if (!plan) throw new BrandAbort(`ไม่พบแพ็กเกจ ${item.planCode} หรือแพ็กเกจถูกยกเลิกไปแล้ว`)

        const pending = await tx.storeSubscription.count({ where: { storeId: store.id, status: "PENDING" } })
        if (pending > 0) throw new BrandAbort(`สาขา ${store.name} มีคำขอที่รอยืนยันอยู่แล้ว — ยกเลิกคำขอเดิมก่อน`)
        if (store._count.tables > plan.tableLimit) {
          throw new BrandAbort(
            `สาขา ${store.name} มี ${store._count.tables} โต๊ะ เกินเพดาน ${plan.tableLimit} ของแพ็กเกจ ${plan.tier} — เลือกแพ็กเกจที่ใหญ่กว่า`,
          )
        }

        const { start, end } = computeRenewalPeriod(now, store.planExpiresAt, plan.durationDays)
        await tx.storeSubscription.create({
          data: {
            storeId: store.id,
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
            batchId: batch.id,
            createdById: userId,
            note: `${plan.name} (${plan.code} v${plan.version}) — ใบจ่ายรวม ${batchRef}`,
          },
        })
        total += Number(plan.price)
      }

      await tx.subscriptionBatch.update({ where: { id: batch.id }, data: { amount: total.toFixed(2) } })
      return { requestRef: batchRef, amount: total }
    })

    revalidateBrand()
    return {
      ok: true,
      message: `สร้างใบจ่ายรวมแล้ว — โอน ${created.amount.toLocaleString("th-TH")} บาท พร้อมระบุ ${created.requestRef} แล้วรอผู้ดูแลยืนยัน`,
      data: created,
    }
  } catch (error) {
    if (error instanceof BrandAbort) return { ok: false, error: error.reason }
    console.error("[brand] requestBrandBatch:", error)
    return { ok: false, error: "สร้างใบจ่ายรวมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เจ้าของแบรนด์ยกเลิกใบจ่ายรวมที่ยังไม่ถูกยืนยัน — ทั้งใบพร้อมกัน (หัวใบ + แถวลูกทุกแถว) ในทรานแซคชันเดียว
/// updateMany where PENDING ที่หัวใบ = ด่านจริง (ผู้ดูแลยืนยันไปพอดี count = 0 → ไม่แตะแถวลูก)
export async function cancelBrandBatch(formData: FormData): Promise<ActionResult> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = batchIdSchema.safeParse({ batchId: formData.get("batchId") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date()
      const head = await tx.subscriptionBatch.updateMany({
        // brand.ownerId ใน where = ใบของแบรนด์ตัวเองเท่านั้น
        where: { id: parsed.data.batchId, status: "PENDING", brand: { ownerId: userId } },
        data: { status: "VOID", voidedAt: now, voidedById: userId, note: "เจ้าของแบรนด์ยกเลิกใบจ่ายรวมเอง" },
      })
      if (head.count === 0) throw new BrandAbort("ไม่พบใบจ่ายรวม หรือใบนี้ถูกยืนยัน/ยกเลิกไปแล้ว")
      await tx.storeSubscription.updateMany({
        where: { batchId: parsed.data.batchId, status: "PENDING" },
        data: { status: "VOID", voidedAt: now, voidedById: userId, note: "เจ้าของแบรนด์ยกเลิกใบจ่ายรวมเอง" },
      })
    })
    revalidateBrand()
    return { ok: true, message: "ยกเลิกใบจ่ายรวมแล้ว" }
  } catch (error) {
    if (error instanceof BrandAbort) return { ok: false, error: error.reason }
    console.error("[brand] cancelBrandBatch:", error)
    return { ok: false, error: "ยกเลิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
