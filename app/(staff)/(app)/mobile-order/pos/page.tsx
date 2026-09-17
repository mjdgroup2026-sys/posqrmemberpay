import { listMenu, listTablesForPos } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { MenuPos } from "@/components/menu-pos"

export const metadata = { title: "ขายอาหาร (หน้าร้าน)" }

export default async function MobileOrderPosPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้ (Phase 17b)
  const { storeId, granted } = await requirePageAccess("MO_POS")

  const [menu, tables] = await Promise.all([listMenu(storeId), listTablesForPos(storeId)])

  return <MenuPos menu={menu} tables={tables} allowed={granted.MO_POS ?? []} />
}
