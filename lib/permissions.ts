import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { resolveStoreContext, type StoreContext, type StorePlan } from "@/lib/session"
import { isPlanActive } from "@/lib/subscription"
import { PermissionDenied, storeErrorMessage } from "@/lib/store-errors"
import type { StoreRole } from "@/generated/prisma/client"
import type { PermissionAction, ResourceKey } from "@/generated/prisma/client"

export type { PermissionAction, ResourceKey }
export { PermissionDenied }

/// ชั้นสิทธิ์ตามบทบาท (§4) — ครอบหน้าและ action ของ F1–F9 และ MJD Mobile Order (Phase 16)
///
/// ตรวจ **2 ชั้นเสมอ** ตามกติกาใน §4:
///   1. `requirePageAccess(resource)` ที่ต้นทุกหน้า — ไม่ผ่าน → เด้งไป /access-denied
///   2. `requirePermission(resource, action)` ที่ต้นทุก Server Action ที่แตะข้อมูล
///
/// ⚠️ ห้ามพึ่งการซ่อนปุ่มฝั่ง client อย่างเดียว — Server Action ถูกเรียกตรงได้
///    (เหตุผลเดียวกับกติกาข้อ 5 ที่บังคับ `requireUser()` มาตั้งแต่ v1)

/// action ที่ "มีความหมาย" กับแต่ละ resource — ตารางใน §4
/// ใช้ทั้งตอน render matrix (disable ช่องที่ไม่เกี่ยว) และตอน validate ฝั่ง server
export const RESOURCE_ACTIONS: Record<ResourceKey, PermissionAction[]> = {
  DASHBOARD: ["VIEW"],
  PRODUCTS: ["VIEW", "ADD", "EDIT", "DELETE"],
  CATEGORIES: ["VIEW", "ADD", "EDIT", "DELETE"],
  // ledger เป็น append-only จึงไม่มี EDIT/DELETE (กติกาข้อ 3)
  STOCK_IN: ["VIEW", "ADD"],
  STOCK_OUT: ["VIEW", "ADD"],
  // ADD = ทำการขาย/checkout
  POS: ["VIEW", "ADD"],
  // DELETE = สิทธิ์กดปุ่ม void บิล
  POS_HISTORY: ["VIEW", "DELETE"],
  // ADD = สิทธิ์กดปิดยอดประจำวัน
  POS_CLOSING: ["VIEW", "ADD"],
  REPORTS: ["VIEW"],
  // EDIT ครอบการเปลี่ยนบทบาทผู้ใช้อื่น และเป็นสิทธิ์เดียวกับที่ใช้เข้าหน้า /roles
  USERS: ["VIEW", "ADD", "EDIT", "DELETE"],
  // ───── MJD Mobile Order (Phase 16) ─────
  // ADD = เปิด/รวมโต๊ะ · EDIT = ปิดบิล/ยืนยันชำระ/กดเสิร์ฟด้วยมือ/พิมพ์ทิกเก็ตซ้ำ · DELETE = ยกเลิกโต๊ะ/ยกเลิกรายการ
  MO_TABLES: ["VIEW", "ADD", "EDIT", "DELETE"],
  // EDIT = เริ่มทำ/เสร็จ/เสิร์ฟ บน KDS
  MO_KITCHEN: ["VIEW", "EDIT"],
  // EDIT = กดรับทราบ
  MO_NOTIFICATIONS: ["VIEW", "EDIT"],
  MO_MENU: ["VIEW", "ADD", "EDIT", "DELETE"],
  // จัดการโต๊ะ + QR Code: ADD = สร้างโต๊ะ/ออก QR · EDIT = เปลี่ยนชื่อโต๊ะ/พิมพ์ QR ซ้ำ · DELETE = ลบโต๊ะ/ยกเลิก QR
  MO_SETUP: ["VIEW", "ADD", "EDIT", "DELETE"],
  // Phase 17b — จอขายอาหารฝั่งพนักงาน: ADD = กดขาย/ส่งออร์เดอร์เข้าครัว
  MO_POS: ["VIEW", "ADD"],
}

export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  DASHBOARD: "แดชบอร์ด",
  PRODUCTS: "สินค้า",
  CATEGORIES: "หมวดหมู่",
  STOCK_IN: "รับสินค้าเข้า",
  STOCK_OUT: "เบิกจ่ายสินค้า",
  POS: "ขายหน้าร้าน",
  POS_HISTORY: "ประวัติการขาย",
  POS_CLOSING: "ปิดยอดประจำวัน",
  REPORTS: "รายงาน",
  USERS: "ผู้ใช้งานและสิทธิ์",
  MO_TABLES: "ผังโต๊ะและปิดบิล",
  MO_KITCHEN: "หน้าจอครัว (KDS)",
  MO_NOTIFICATIONS: "การแจ้งเตือน",
  MO_MENU: "จัดการเมนูอาหาร",
  MO_SETUP: "จัดการโต๊ะและ QR Code",
  MO_POS: "ขายอาหารหน้าร้าน",
}

export const ACTION_LABEL: Record<PermissionAction, string> = {
  VIEW: "ดู",
  ADD: "เพิ่ม",
  EDIT: "แก้ไข",
  DELETE: "ลบ",
}

/// คำอธิบายว่า action นั้นหมายถึงอะไรจริง ๆ กับ resource ที่ความหมายไม่ตรงตัว
export const ACTION_HINT: Partial<Record<`${ResourceKey}:${PermissionAction}`, string>> = {
  "POS:ADD": "ทำการขาย/ปิดการขาย",
  "POS_HISTORY:DELETE": "ยกเลิก (void) บิล",
  "POS_CLOSING:ADD": "กดปิดยอดประจำวัน",
  "USERS:EDIT": "แก้ผู้ใช้และจัดการบทบาท/สิทธิ์",
  "MO_TABLES:ADD": "เปิดโต๊ะ/รวมโต๊ะ",
  "MO_TABLES:EDIT": "ปิดบิล ยืนยันชำระเงิน กดเสิร์ฟด้วยมือ",
  "MO_TABLES:DELETE": "ยกเลิกโต๊ะ/ยกเลิกรายการอาหาร",
  "MO_KITCHEN:EDIT": "กดเริ่มทำ/เสร็จ/เสิร์ฟบน KDS",
  "MO_NOTIFICATIONS:EDIT": "กดรับทราบการแจ้งเตือน",
  "MO_SETUP:ADD": "สร้างโต๊ะ/ออก QR Code",
  "MO_SETUP:DELETE": "ลบโต๊ะ/ยกเลิก QR Code",
  "MO_POS:ADD": "กดขายอาหาร/ส่งออร์เดอร์เข้าครัว",
}

export type CurrentUserPermissions = {
  /// ตั้งชื่อ id ให้ตรงกับ session.user.id ของ Better Auth — โค้ดเดิมที่รับ user จาก
  /// requireUser() แล้วใช้ user.id ต่อได้ทันทีโดยไม่ต้องแก้
  id: string
  name: string
  email: string
  /// ร้านที่กำลังทำงานอยู่ (Phase 13) — ทุก query ต้องกรองด้วยค่านี้
  storeId: string
  storeRole: StoreRole
  /// แพ็กเกจของร้าน (Phase 14b) — action ที่ขายใหม่ต้องเช็ก isPlanActive ก่อน (ผ่าน guardAction(..., { selling: true }))
  plan: StorePlan
  roleId: string | null
  roleName: string | null
  /// resource → action ที่ทำได้ · ไม่มีคีย์ = ไม่มีสิทธิ์เลยกับ resource นั้น
  granted: Partial<Record<ResourceKey, PermissionAction[]>>
}

/// OWNER ของร้านได้ทุก action ของทุก resource โดยไม่ต้องมี Role (Phase 13)
function fullGrant(): Partial<Record<ResourceKey, PermissionAction[]>> {
  const granted: Partial<Record<ResourceKey, PermissionAction[]>> = {}
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
    granted[resource as ResourceKey] = [...actions]
  }
  return granted
}

/// อ่านสิทธิ์ของผู้ใช้ปัจจุบัน "ในร้านที่ทำงานอยู่" จาก DB — `cache()` ทำให้เรียกกี่ครั้งในคำขอเดียว
/// ก็ยิง query ครั้งเดียว แต่ **ไม่ข้ามคำขอ** ตาม §4 ("เปลี่ยน Role แล้วมีผลทันทีในคำขอถัดไป")
/// คืน null เมื่อยังไม่ล็อกอิน / ไม่ได้อยู่ในร้านใด / ร้านถูกระงับ — ผู้เรียกที่ต้องแยกสาเหตุให้ใช้ resolveStoreContext()
export const getCurrentPermissions = cache(async (): Promise<CurrentUserPermissions | null> => {
  const result = await resolveStoreContext()
  if (!result.ok) return null
  return permissionsFromContext(result.context)
})

async function permissionsFromContext(context: StoreContext): Promise<CurrentUserPermissions> {
  const base = {
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    storeId: context.storeId,
    storeRole: context.role,
    plan: context.plan,
  }

  if (context.role === "OWNER") {
    return { ...base, roleId: null, roleName: "เจ้าของร้าน", granted: fullGrant() }
  }

  if (!context.permissionRoleId) return { ...base, roleId: null, roleName: null, granted: {} }

  // บทบาทเป็นของร้าน — กรอง storeId ด้วยเสมอ กัน roleId ของร้านอื่นหลุดมา
  const role = await prisma.role.findFirst({
    where: { id: context.permissionRoleId, storeId: context.storeId },
    select: { id: true, name: true, permissions: { select: { resource: true, actions: true } } },
  })
  if (!role) return { ...base, roleId: null, roleName: null, granted: {} }

  const granted: Partial<Record<ResourceKey, PermissionAction[]>> = {}
  for (const row of role.permissions) {
    if (row.actions.length > 0) granted[row.resource] = row.actions
  }
  return { ...base, roleId: role.id, roleName: role.name, granted }
}

export async function hasPermission(resource: ResourceKey, action: PermissionAction): Promise<boolean> {
  const permissions = await getCurrentPermissions()
  if (!permissions) return false
  return permissions.granted[resource]?.includes(action) ?? false
}

function denied(resource: ResourceKey, action: PermissionAction): PermissionDenied {
  return new PermissionDenied(resource, action, permissionErrorMessage(resource, action))
}

/// ด่านของ Server Action — โยน `PermissionDenied` เมื่อไม่มีสิทธิ์
/// ผู้เรียกต้องจับแล้วคืน `ActionResult` ภาษาไทย (storeErrorMessage() รู้จัก PermissionDenied แล้ว)
export async function requirePermission(
  resource: ResourceKey,
  action: PermissionAction,
): Promise<CurrentUserPermissions> {
  const permissions = await getCurrentPermissions()
  if (!permissions) throw denied(resource, action)
  if (!permissions.granted[resource]?.includes(action)) throw denied(resource, action)
  return permissions
}

export function permissionErrorMessage(resource: ResourceKey, action: PermissionAction): string {
  return `คุณไม่มีสิทธิ์${ACTION_LABEL[action]}ในหน้า${RESOURCE_LABEL[resource]} กรุณาติดต่อผู้ดูแลระบบ`
}

export type PermissionPair = [ResourceKey, PermissionAction]

/// requireStore() + สิทธิ์ (Phase 16) — ใช้แทน `requireStore()` บรรทัดแรกของ action ฝั่ง Mobile Order โดยไม่ต้องแก้
/// ส่วนที่เหลือ: คืน StoreContext เดิม · โยน Error รหัสของ requireStore() หรือ PermissionDenied ซึ่ง storeErrorMessage()
/// แปลงเป็นไทยให้ทั้งคู่ · `pairs` หลายคู่ = ผ่านคู่ใดคู่หนึ่งก็พอ (เช่น กดเสิร์ฟได้ทั้งจาก KDS และหน้าโต๊ะ)
export async function requireStoreAccess(
  ...pairs: [PermissionPair, ...PermissionPair[]]
): Promise<StoreContext> {
  const result = await resolveStoreContext()
  if (!result.ok) throw new Error(result.reason)
  const permissions = await permissionsFromContext(result.context)
  if (!pairs.some(([resource, action]) => permissions.granted[resource]?.includes(action))) {
    throw denied(pairs[0][0], pairs[0][1])
  }
  return result.context
}

export type ActionGuard =
  | { ok: true; user: CurrentUserPermissions }
  | { ok: false; error: string }

/// ด่านสำเร็จรูปสำหรับ Server Action — รวม "ต้องล็อกอิน" กับ "ต้องมีสิทธิ์" ไว้ในบรรทัดเดียว
/// แล้วคืนข้อความภาษาไทยที่ต่างกันตามสาเหตุ (ยังไม่ล็อกอิน vs ล็อกอินแล้วแต่สิทธิ์ไม่ถึง)
///
///   const guard = await guardAction("PRODUCTS", "ADD")
///   if (!guard.ok) return { ok: false, error: guard.error }
export async function guardAction(
  resource: ResourceKey,
  action: PermissionAction,
  options: { selling?: boolean } = {},
): Promise<ActionGuard> {
  const permissions = await getCurrentPermissions()
  if (!permissions) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" }
  if (!permissions.granted[resource]?.includes(action)) {
    return { ok: false, error: permissionErrorMessage(resource, action) }
  }
  // selling (Phase 14b) — action ที่สร้างการขายใหม่ต้องมีแพ็กเกจที่ยังไม่หมดอายุ (แนวเดียวกับ requireSellingStore)
  if (options.selling && !isPlanActive(new Date(), permissions.plan.expiresAt)) {
    return { ok: false, error: storeErrorMessage(new Error("STORE_EXPIRED")) }
  }
  return { ok: true, user: permissions }
}

/// ด่านของหน้า — เรียกเป็นบรรทัดแรกของทุก page ที่คุมสิทธิ์
/// ไม่ผ่าน → เด้งไป /access-denied (ไม่ใช่ 404 เพื่อให้ผู้ใช้รู้ว่าหน้ามีอยู่แต่สิทธิ์ไม่ถึง)
/// ระบุหลาย resource = มี VIEW ตัวใดตัวหนึ่งก็เข้าได้ (เช่น ทิกเก็ตครัวเปิดได้ทั้งจาก KDS และหน้าโต๊ะ)
export async function requirePageAccess(resource: ResourceKey, ...alternatives: ResourceKey[]): Promise<CurrentUserPermissions> {
  const result = await resolveStoreContext()
  if (!result.ok) redirectForMissingStore(result.reason)
  const permissions = await permissionsFromContext(result.context)
  if (![resource, ...alternatives].some((r) => permissions.granted[r]?.includes("VIEW"))) {
    redirect(`/access-denied?resource=${resource}`)
  }
  return permissions
}

/// หน้าที่ต้อง "อยู่ในร้าน" แต่ไม่ได้อยู่ใน matrix สิทธิ์ (MJD Mobile Order F11–F22) — เรียกที่ต้นหน้า
/// ได้ storeId กลับไปใช้กับ query · ไม่มีร้าน/ร้านถูกระงับ → เด้งไปหน้าอธิบาย ไม่ใช่ error 500
export async function requireStorePage(): Promise<StoreContext> {
  const result = await resolveStoreContext()
  if (!result.ok) redirectForMissingStore(result.reason)
  return result.context
}

/// ยังไม่ล็อกอิน → /login · ล็อกอินแล้วแต่ไม่มีร้าน หรือร้านถูกระงับ → /no-store พร้อมเหตุผล
export function redirectForMissingStore(reason: "UNAUTHENTICATED" | "NO_STORE" | "STORE_SUSPENDED"): never {
  if (reason === "UNAUTHENTICATED") redirect("/login")
  redirect(`/no-store?reason=${reason}`)
}
