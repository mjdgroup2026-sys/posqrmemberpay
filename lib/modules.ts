import type { ResourceKey, StoreModule } from "@/generated/prisma/client"

/// โมดูลต่อร้าน (2026-09-30) — **ที่เดียวที่กำหนดว่า resource ไหนอยู่โมดูลไหน**
///
/// ผู้ดูแลแพลตฟอร์มปิดโมดูลรายร้านได้ (`Store.disabledModules`) · ร้านเปลี่ยนเองไม่ได้
/// ด่านจริงอยู่ 2 ที่ที่อ่านตารางนี้:
///   - `permissionsFromContext()` ใน lib/permissions.ts — ตัด resource ของโมดูลที่ปิดออกจาก granted **แม้เป็น OWNER**
///     เมนู/หน้า/action/ปุ่มที่ซ่อนตามสิทธิ์จึงหายเองทั้งหมด
///   - `getStoreSettings()` ใน lib/queries.ts — สวิตช์สปา/สมาชิกมีผลเป็นปิดเมื่อโมดูลปิด (ค่าที่ร้านตั้งไว้ยังเก็บอยู่)
/// ของที่ไม่ใช่ resource (แท็บสินค้าบนจอขาย · ป้ายสินค้าใกล้หมด · รายงานสต็อก) เช็คด้วย `hasModule()` ตรงจุดนั้น
///
/// เพิ่ม ResourceKey ใหม่ → TypeScript บังคับให้ประกาศที่ RESOURCE_MODULE (Record ครบทุกคีย์)

export type { StoreModule }

export const STORE_MODULES: readonly StoreModule[] = ["SPA", "INVENTORY", "CRM", "REPORTS"]

export const MODULE_LABEL: Record<StoreModule, string> = {
  SPA: "ร้านนวด/สปา",
  INVENTORY: "คลังสินค้า + ขายสินค้า",
  CRM: "สมาชิกสะสมแต้ม",
  REPORTS: "รายงาน",
}

export const MODULE_HINT: Record<StoreModule, string> = {
  SPA: "พนักงานนวด · ตารางกะ · คิวนวด (จอง/สถานะห้อง) · รายงานพนักงานนวด · รายการนวดในเมนู",
  INVENTORY: "สินค้า · หมวดหมู่ · ใบรับ/เบิก/ปรับ · ขายสินค้าจากจอขายอาหาร · รายงานสต็อก · เตือนสินค้าใกล้หมด",
  CRM: "ลูกค้าสมัครสมาชิกด้วยเบอร์โทรหลังจ่ายเงิน · สะสมแต้ม",
  REPORTS: "หน้ารายงานยอดขาย · สรุปทั้งร้านท้ายหน้าปิดยอด",
}

/// null = แกนหลัก (ขายอาหาร/QR · ประวัติขาย · ปิดยอด · ผู้ใช้) ปิดไม่ได้
export const RESOURCE_MODULE: Record<ResourceKey, StoreModule | null> = {
  DASHBOARD: null,
  POS_HISTORY: null,
  POS_CLOSING: null,
  USERS: null,
  MO_TABLES: null,
  MO_KITCHEN: null,
  MO_NOTIFICATIONS: null,
  MO_MENU: null,
  MO_SETUP: null,
  MO_POS: null,
  SPA_THERAPISTS: "SPA",
  SPA_BOOKINGS: "SPA",
  PRODUCTS: "INVENTORY",
  CATEGORIES: "INVENTORY",
  STOCK_IN: "INVENTORY",
  STOCK_OUT: "INVENTORY",
  STOCK_ADJUST: "INVENTORY",
  // POS หน้าร้านเดิม (ปิดเมนูแล้ว redirect ไปจอขายอาหาร) ขายสินค้าจากคลัง
  POS: "INVENTORY",
  REPORTS: "REPORTS",
}

export function hasModule(disabled: readonly StoreModule[], storeModule: StoreModule): boolean {
  return !disabled.includes(storeModule)
}

export function isResourceEnabled(disabled: readonly StoreModule[], resource: ResourceKey): boolean {
  const owner = RESOURCE_MODULE[resource]
  return owner === null || hasModule(disabled, owner)
}
