import { listMenuForManage } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { MenuAdmin } from "@/components/menu-admin"

export const metadata = { title: "จัดการเมนูอาหาร" }

export default async function ManageMenuPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_MENU")
  const items = await listMenuForManage(storeId)
  return <MenuAdmin items={items} allowed={granted.MO_MENU ?? []} />
}
