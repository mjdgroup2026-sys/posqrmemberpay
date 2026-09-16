import type { PlanTier, PrismaClient, StoreRole, StoreStatus } from "@/generated/prisma/client"

/// ตรรกะ "ผู้ใช้คนนี้ทำงานกับร้านไหน ในบทบาทอะไร" (Phase 13 + 14c) — แยกจาก lib/session.ts เพราะไม่แตะ
/// server-only/next/headers จึงให้ทั้ง production (lib/session.ts) และ mock ของเทส (__tests__/helpers/session-mock.ts)
/// เรียกตัวเดียวกัน · เดิม mock ลอกตรรกะไว้อีกชุด พอ Phase 14c เพิ่มกติกา "เจ้าของ Brand = OWNER ทุกสาขา"
/// จะต้องแก้สองที่ให้ตรงกันตลอดไป — รวมไว้ที่นี่ที่เดียวแทน

export type StoreMembershipSummary = {
  storeId: string
  slug: string
  name: string
  status: StoreStatus
  role: StoreRole
  /// แบรนด์ที่สาขานี้อยู่ใต้ (Phase 14c) — ไว้ให้ตัวสลับร้านจัดกลุ่ม
  brandId: string | null
  brandName: string | null
  /// true = ได้สิทธิ์ OWNER จากการเป็นเจ้าของ Brand โดยไม่มีแถว StoreMember
  viaBrand: boolean
}

/// แพ็กเกจของร้าน (Phase 14b) — ค่า denormalized บน Store อ่านมาพร้อมกันในคำขอเดียว
export type StorePlan = {
  tier: PlanTier | null
  tableLimit: number
  /// null = ยังไม่มีแพ็กเกจ (ร้านใหม่ที่ยังไม่รับสิทธิ์ทดลอง/จ่าย) → ขายไม่ได้
  expiresAt: Date | null
}

export type StoreContext = {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean }
  storeId: string
  store: { id: string; slug: string; name: string; status: StoreStatus }
  plan: StorePlan
  role: StoreRole
  /// บทบาท matrix สิทธิ์ F1–F9 ในร้านนี้ (null = ยังไม่กำหนด) — OWNER ไม่ใช้ค่านี้
  permissionRoleId: string | null
  /// แบรนด์ของร้านที่ทำงานอยู่ (Phase 14c) — null = ร้านสาขาเดียว · isOwner = ผู้ใช้คนนี้เป็นเจ้าของแบรนด์
  brand: { id: string; name: string; isOwner: boolean } | null
  /// ร้านทั้งหมดที่ผู้ใช้เข้าได้ (StoreMember + สาขาใต้แบรนด์ที่ตัวเองเป็นเจ้าของ) — ไว้ให้ตัวสลับร้านใน topbar
  memberships: StoreMembershipSummary[]
}

export type StoreContextResult =
  | { ok: true; context: StoreContext }
  | { ok: false; reason: "UNAUTHENTICATED" | "NO_STORE" | "STORE_SUSPENDED"; memberships: StoreMembershipSummary[] }

const STORE_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  planTier: true,
  tableLimit: true,
  planExpiresAt: true,
  brand: { select: { id: true, name: true, ownerId: true } },
} as const

/// อ่าน "ผู้ใช้ + ร้านที่ทำงานอยู่ + บทบาทในร้านนั้น" จาก DB · `wantedStoreId` มาจาก cookie ซึ่งเชื่อไม่ได้ —
/// ชี้ร้านที่เข้าไม่ได้ → ตกไปใช้ร้านแรก (ไม่ใช่ error เพื่อไม่ให้ค้างหน้าเปล่า)
///
/// Phase 14c: เจ้าของ Brand เป็น OWNER ของทุกสาขาใต้ Brand โดยอัตโนมัติ แม้ไม่มีแถว StoreMember —
/// และถ้ามีแถว StoreMember เป็น STAFF อยู่ก็ยังได้ OWNER (ความเป็นเจ้าของแบรนด์ชนะ)
export async function loadStoreContext(
  db: PrismaClient,
  userId: string | null,
  wantedStoreId: string | null | undefined,
): Promise<StoreContextResult> {
  if (!userId) return { ok: false, reason: "UNAUTHENTICATED", memberships: [] }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isPlatformAdmin: true,
      storeMemberships: {
        orderBy: { createdAt: "asc" },
        select: { storeId: true, role: true, roleId: true, store: { select: STORE_SELECT } },
      },
      ownedBrands: {
        orderBy: { createdAt: "asc" },
        select: { id: true, stores: { orderBy: { createdAt: "asc" }, select: STORE_SELECT } },
      },
    },
  })
  if (!user) return { ok: false, reason: "UNAUTHENTICATED", memberships: [] }

  type StoreRow = (typeof user.storeMemberships)[number]["store"]
  type Access = { store: StoreRow; role: StoreRole; roleId: string | null; viaBrand: boolean }

  const access: Access[] = user.storeMemberships.map((m) => {
    const ownsBrand = m.store.brand?.ownerId === user.id
    return { store: m.store, role: ownsBrand ? "OWNER" : m.role, roleId: m.roleId, viaBrand: ownsBrand && m.role !== "OWNER" }
  })
  const seen = new Set(access.map((a) => a.store.id))
  for (const brand of user.ownedBrands) {
    for (const store of brand.stores) {
      if (seen.has(store.id)) continue
      seen.add(store.id)
      access.push({ store, role: "OWNER", roleId: null, viaBrand: true })
    }
  }

  const memberships: StoreMembershipSummary[] = access.map((a) => ({
    storeId: a.store.id,
    slug: a.store.slug,
    name: a.store.name,
    status: a.store.status,
    role: a.role,
    brandId: a.store.brand?.id ?? null,
    brandName: a.store.brand?.name ?? null,
    viaBrand: a.viaBrand,
  }))
  if (access.length === 0) return { ok: false, reason: "NO_STORE", memberships }

  const chosen = access.find((a) => a.store.id === wantedStoreId) ?? access[0]
  if (chosen.store.status === "SUSPENDED") return { ok: false, reason: "STORE_SUSPENDED", memberships }

  const store = chosen.store
  return {
    ok: true,
    context: {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      storeId: store.id,
      store: { id: store.id, slug: store.slug, name: store.name, status: store.status },
      plan: { tier: store.planTier, tableLimit: store.tableLimit, expiresAt: store.planExpiresAt },
      role: chosen.role,
      permissionRoleId: chosen.role === "OWNER" ? null : chosen.roleId,
      brand: store.brand ? { id: store.brand.id, name: store.brand.name, isOwner: store.brand.ownerId === user.id } : null,
      memberships,
    },
  }
}
