import { listMenu, listTablesForPos } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { MenuPos } from "@/components/menu-pos"

export const metadata = { title: "ขายอาหาร (หน้าร้าน)" }

export default async function MobileOrderPosPage({ searchParams }: PageProps<"/mobile-order/pos">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้ (Phase 17b)
  const { storeId, granted } = await requirePageAccess("MO_POS")

  const [menu, tables, params] = await Promise.all([listMenu(storeId), listTablesForPos(storeId), searchParams])
  // ?table=<id> มาจากปุ่ม "สั่งเพิ่ม" บนหน้าโต๊ะ (F13) — เลือกโต๊ะนั้นให้เลย · id แปลก ๆ ถูกกรองด้วยรายชื่อโต๊ะของร้านนี้
  const wanted = typeof params.table === "string" ? params.table : ""
  const initialTableId = tables.some((t) => t.id === wanted) ? wanted : undefined

  return <MenuPos menu={menu} tables={tables} allowed={granted.MO_POS ?? []} initialTableId={initialTableId} />
}
