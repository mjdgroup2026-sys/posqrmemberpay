import { listKitchenStations, listMenuForManage } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { MenuAdmin } from "@/components/menu-admin"
import { StationManager } from "@/components/station-manager"

export const metadata = { title: "จัดการเมนูอาหาร" }

export default async function ManageMenuPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_MENU")
  const [items, stations] = await Promise.all([listMenuForManage(storeId), listKitchenStations(storeId)])
  const allowed = granted.MO_MENU ?? []
  return (
    <>
      <MenuAdmin items={items} stations={stations} allowed={allowed} />
      {/* ประเภทครัว (Phase 19) — อยู่ใต้ตารางเมนู ใช้สิทธิ์ MO_MENU ชุดเดียวกัน */}
      <div style={{ marginTop: 16 }}>
        <StationManager stations={stations} allowed={allowed} />
      </div>
    </>
  )
}
