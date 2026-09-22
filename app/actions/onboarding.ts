"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
// สร้างร้านใหม่ = ยังไม่มี storeId ให้ forStore() — จุดเดียวในไฟล์นี้ที่ใช้ prisma ตรง
// eslint-disable-next-line no-restricted-imports
import { prisma } from "@/lib/prisma"
import { ACTIVE_STORE_COOKIE, requireUser, storeErrorMessage } from "@/lib/session"
import { provisionStore } from "@/lib/store-provision"
import { loadStoreContext } from "@/lib/store-context"
import { copyMenu } from "@/lib/menu-copy"
import { SAMPLE_MENU_PREFIX } from "@/lib/sample-menu"
import { listTrialOnlyStores } from "@/lib/plan-queries"
import { createStoreSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

/// Onboarding (Phase 14a) — ผู้ใช้ที่ล็อกอินแล้วสร้างร้านของตัวเองและเป็น OWNER ทันที
///
/// ใช้ requireUser() ไม่ใช่ requireStore() เพราะคนที่มาถึงหน้านี้ "ยังไม่มีร้าน" · ผู้ใช้ที่มีร้านอยู่แล้ว
/// ก็สร้างเพิ่มได้ (เป็น OWNER หลายร้าน) · Phase 14c: ถ้ามีแบรนด์ เลือกสร้างเป็นสาขาใต้แบรนด์ได้ทันที
/// และเลือก "คัดลอกเมนูจากสาขาไหน" แทนเมนูตัวอย่าง (ต้องเป็น OWNER ของสาขาต้นทาง)

/// ข้อมูลตัวอย่างชุดเล็กให้กดเล่นได้ทันทีหลังสร้างร้าน — ร้านลบ/แก้ได้เองทีหลัง
const SAMPLE_TABLE_CODES = ["T1", "T2", "T3", "T4"] as const
const SAMPLE_MENU = [
  // ชื่อขึ้นต้น "[ตัวอย่าง]" ให้เห็นชัดทุกที่ที่ชื่อเมนูโผล่ (จัดการเมนู/จอขาย/หน้าลูกค้า) — เจ้าของร้านใหม่เคยงงว่า
  // เมนูมาจากไหน (2026-09-17) · SAMPLE_MENU_PREFIX ใช้ตรวจว่าร้านยังมีเมนูตัวอย่างค้างอยู่ไหม
  { name: `${SAMPLE_MENU_PREFIX} ข้าวผัดกะเพราไก่ไข่ดาว`, description: "เมนูตัวอย่าง — แก้ชื่อ/ราคา หรือลบทิ้งได้ที่ จัดการเมนูอาหาร", price: "65.00", station: "ของผัด" },
  { name: `${SAMPLE_MENU_PREFIX} ผัดไทยกุ้งสด`, description: "เมนูตัวอย่าง", price: "80.00", station: "ของผัด" },
  { name: `${SAMPLE_MENU_PREFIX} ชาไทยเย็น`, description: "เมนูตัวอย่าง", price: "35.00", station: "บาร์น้ำ" },
] as const

function qrToken() {
  return randomBytes(24).toString("base64url")
}

export async function createStore(formData: FormData): Promise<ActionResult<{ storeId: string; slug: string }>> {
  let userId: string
  try {
    userId = (await requireUser()).id
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const parsed = createStoreSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    themeColor: formData.get("themeColor"),
    joinBrand: formData.get("joinBrand"),
    copyMenuFromStoreId: formData.get("copyMenuFromStoreId"),
    sampleMenu: formData.get("sampleMenu"),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { name, slug, themeColor, joinBrand, copyMenuFromStoreId, sampleMenu } = parsed.data

  // Phase 14c — แบรนด์ของผู้ใช้ (1 คน = 1 แบรนด์) และสาขาต้นทางที่คัดลอกเมนูได้ (ต้องเป็น OWNER)
  let brandId: string | null = null
  if (joinBrand) {
    const brand = await prisma.brand.findFirst({ where: { ownerId: userId }, select: { id: true } })
    if (!brand) return { ok: false, error: "คุณยังไม่มีแบรนด์ — สร้างแบรนด์ที่หน้า แบรนด์ ก่อน หรือสร้างร้านโดยไม่ผูกแบรนด์" }
    brandId = brand.id
  }
  // ★ ห้ามสร้างร้านเพิ่มระหว่างร้านเดิมยังทดลองใช้อยู่ (กติกาเจ้าของระบบ 2026-09-17) — ด่านจริงอยู่ที่นี่
  //   หน้า /onboarding ซ่อนฟอร์มให้ด้วย แต่ action ถูกเรียกตรงได้ (กติกาข้อ 5)
  {
    const access = await loadStoreContext(prisma, userId, null)
    const memberships = access.ok ? access.context.memberships : access.memberships
    const owned = memberships.filter((m) => m.role === "OWNER")
    const trialOnly = await listTrialOnlyStores(owned.map((m) => m.storeId))
    if (trialOnly.length > 0) {
      const names = owned.filter((m) => trialOnly.includes(m.storeId)).map((m) => m.name).join(", ")
      return {
        ok: false,
        error: `สร้างร้าน/สาขาเพิ่มไม่ได้ในช่วงทดลองใช้งาน — ร้าน ${names} ยังอยู่ในช่วงทดลอง 7 วัน กรุณาเลือกแพ็กเกจและชำระเงินให้ร้านนั้นก่อน`,
      }
    }
  }

  if (copyMenuFromStoreId) {
    const access = await loadStoreContext(prisma, userId, null)
    const memberships = access.ok ? access.context.memberships : access.memberships
    const source = memberships.find((m) => m.storeId === copyMenuFromStoreId && m.role === "OWNER")
    if (!source) {
      return { ok: false, error: "คัดลอกเมนูได้เฉพาะจากสาขาที่คุณเป็นเจ้าของ", fieldErrors: { copyMenuFromStoreId: "ไม่ใช่สาขาของคุณ" } }
    }
  }

  // เช็คก่อนเพื่อให้ข้อความชัด — ด่านจริงคือ unique ของ store.slug ในทรานแซคชันด้านล่าง
  if (await prisma.store.findUnique({ where: { slug }, select: { id: true } })) {
    return { ok: false, error: "รหัสร้าน (slug) นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น", fieldErrors: { slug: "รหัสร้านนี้ถูกใช้แล้ว" } }
  }

  let storeId: string
  try {
    storeId = await prisma.$transaction(async (tx) => {
      // provisionStore() เป็น upsert ตาม slug — เช็คซ้ำในทรานแซคชันกันสองคนสร้าง slug เดียวกันพร้อมกัน
      // แล้วคนที่สองไปได้ร้านของคนแรก (upsert ไม่ล้ม) → ต้อง create ตรงให้ unique ล้มเอง
      const created = await tx.store.create({ data: { slug, name, brandId }, select: { id: true } })
      await provisionStore(tx, { id: created.id, slug, name, themeColor, ownerUserId: userId })

      for (const code of SAMPLE_TABLE_CODES) {
        const table = await tx.table.create({ data: { storeId: created.id, code }, select: { id: true } })
        await tx.qRCode.create({ data: { storeId: created.id, tableId: table.id, type: "STATIC", token: qrToken() } })
      }

      // คัดลอกเมนูจากสาขาต้นทาง (Phase 14c) — ไม่ใส่เมนูตัวอย่างซ้ำ
      if (copyMenuFromStoreId) {
        await copyMenu(tx, copyMenuFromStoreId, created.id)
        return created.id
      }

      // เจ้าของเลือกไม่ใส่เมนูตัวอย่าง → เริ่มจากเมนูว่าง (โต๊ะ/QR ตัวอย่างยังใส่ให้ ไม่งั้นทดลองสั่งไม่ได้เลย)
      if (!sampleMenu) return created.id

      // ประเภทครัวตัวอย่าง (Phase 19) — ให้เห็นแท็บบน KDS และหัวกลุ่มบนทิกเก็ตตั้งแต่ออร์เดอร์แรก · ชื่อไม่มี prefix
      // เพราะเป็นประเภททั่วไปที่ร้านใช้ต่อได้จริง (ลบได้ เมนูแค่กลับเป็น "ไม่ระบุครัว")
      const stationIdByName = new Map<string, string>()
      for (const [index, stationName] of [...new Set(SAMPLE_MENU.map((m) => m.station))].entries()) {
        const station = await tx.kitchenStation.create({
          data: { storeId: created.id, name: stationName, sortOrder: index },
          select: { id: true },
        })
        stationIdByName.set(stationName, station.id)
      }

      let order = 0
      for (const item of SAMPLE_MENU) {
        order += 1
        await tx.menuItem.create({
          data: {
            storeId: created.id,
            name: item.name,
            description: item.description,
            price: item.price,
            isFeatured: true,
            featuredSortOrder: order,
            stationId: stationIdByName.get(item.station) ?? null,
          },
        })
      }

      return created.id
    })
  } catch (error) {
    // unique ของ slug ล้ม = มีคนสร้างพร้อมกันพอดี
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : ""
    if (code === "P2002") {
      return { ok: false, error: "รหัสร้าน (slug) นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น", fieldErrors: { slug: "รหัสร้านนี้ถูกใช้แล้ว" } }
    }
    console.error("[onboarding] สร้างร้านไม่สำเร็จ:", error)
    return { ok: false, error: "สร้างร้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  // พาไปทำงานกับร้านใหม่ทันที — ค่านี้ถูกตรวจกับ StoreMember ซ้ำทุกคำขอโดย requireStore()
  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/", "layout")
  return { ok: true, message: `สร้างร้าน ${name} เรียบร้อยแล้ว`, data: { storeId, slug } }
}
