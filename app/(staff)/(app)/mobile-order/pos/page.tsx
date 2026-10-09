import { formatBusinessDate } from "@/lib/format"
import { spaAwareMetadata } from "@/lib/spa-title"
import { getSalesLock, getStoreSettings, listMenu, listPosProducts, listTablesForPos } from "@/lib/queries"
import { SalesLockBanner } from "@/components/sales-lock-banner"
import { requirePageAccess } from "@/lib/permissions"
import { MenuPos } from "@/components/menu-pos"

export function generateMetadata() {
  return spaAwareMetadata("ขายอาหาร (หน้าร้าน)", "ขายอาหาร/ร้านสปา")
}

export default async function MobileOrderPosPage({ searchParams }: PageProps<"/mobile-order/pos">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้ (Phase 17b)
  const { storeId, granted, id: userId } = await requirePageAccess("MO_POS")

  const [menu, tables, params, settings, products, salesLock] = await Promise.all([
    listMenu(storeId),
    listTablesForPos(storeId),
    searchParams,
    getStoreSettings(storeId),
    // Phase 21b — สินค้าในสต็อกเฉพาะหมวดที่เปิดขายที่หน้าขายอาหาร (ว่าง = ไม่มีแท็บสินค้า)
    listPosProducts(storeId),
    // ปิดยอดแล้ว = ขายไม่ได้เลยจนกว่าจะเปิดรอบขายใหม่ (2026-10-09 เจ้าของสั่ง) — ซ่อนจอขายทั้งหน้า · ด่านจริงอยู่ที่ action
    getSalesLock(storeId, userId),
  ])
  // โมดูลคลังที่ผู้ดูแลแพลตฟอร์มปิดไว้ (2026-09-30) = ไม่มีแท็บสินค้า · ด่านจริงอยู่ที่ buildProductLines
  const sellableProducts = settings?.modules.inventory ? products : []
  // ?table=<id> มาจากปุ่ม "สั่งเพิ่ม" บนหน้าโต๊ะ (F13) — เลือกโต๊ะนั้นให้เลย · id แปลก ๆ ถูกกรองด้วยรายชื่อโต๊ะของร้านนี้
  const wanted = typeof params.table === "string" ? params.table : ""
  const initialTableId = tables.some((t) => t.id === wanted) ? wanted : undefined
  // ?session= = บิลของลูกค้าคนไหนในห้องสปา (ปุ่ม "สั่งเพิ่ม" ของบิลนั้น) — ต้องเป็นบิลที่เปิดอยู่ของห้องที่เลือกเท่านั้น
  const wantedSession = typeof params.session === "string" ? params.session : ""
  const initialSessionId = tables.find((t) => t.id === initialTableId)?.bills.some((b) => b.sessionId === wantedSession)
    ? wantedSession
    : undefined

  if (salesLock.locked) {
    return <SalesLockBanner block roundNo={salesLock.roundNo} canResume={granted.POS_CLOSING?.includes("ADD") ?? false} />
  }

  return (
    <MenuPos
      menu={menu}
      products={sellableProducts}
      tables={tables}
      allowed={granted.MO_POS ?? []}
      initialTableId={initialTableId}
      defaultMode={settings?.posDefaultMode ?? "TABLE"}
      dateLabel={formatBusinessDate(new Date())}
      spaEnabled={settings?.spaEnabled ?? false}
      initialSessionId={initialSessionId}
      storeName={settings?.storeName}
    />
  )
}
