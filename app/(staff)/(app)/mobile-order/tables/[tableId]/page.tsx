import Link from "next/link"
import { getStoreSettings, getTableDetail, listTherapistOptions } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { TableDetail } from "@/components/table-detail"

export const metadata = { title: "รายละเอียดออร์เดอร์" }

export default async function TableDetailPage({ params, searchParams }: PageProps<"/mobile-order/tables/[tableId]">) {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_TABLES")
  const { tableId } = await params
  // ?session= เลือกบิลของลูกค้าคนไหนในห้องสปาที่มีหลายบิล (2026-09-23) — id ถูกตรวจว่าเป็นบิลเปิดของห้องนี้ใน query
  const { session } = await searchParams
  const sessionId = typeof session === "string" && session ? session : undefined
  const [detail, settings] = await Promise.all([getTableDetail(storeId, tableId, sessionId), getStoreSettings(storeId)])
  // ร้านนวด (Phase 20): ตัวเลือกพนักงานนวดสำหรับมอบหมายบนบรรทัดโปรแกรมนวด
  const therapists = settings?.spaEnabled ? await listTherapistOptions(storeId) : []

  if (!detail) {
    return (
      <section className="card-ui card-pad">
        <h1 className="t-h2">ไม่พบโต๊ะที่เปิดอยู่</h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          โต๊ะนี้อาจถูกปิดบิลหรือยกเลิกไปแล้ว
        </p>
        <Link href="/mobile-order/tables" className="btn btn-primary" style={{ marginTop: 16 }}>
          กลับไปผังโต๊ะ
        </Link>
      </section>
    )
  }

  return (
    <TableDetail
      detail={detail}
      allowed={granted.MO_TABLES ?? []}
      canAcknowledge={granted.MO_NOTIFICATIONS?.includes("EDIT") ?? false}
      canKitchen={granted.MO_KITCHEN?.includes("EDIT") ?? false}
      canOrderMore={granted.MO_POS?.includes("ADD") ?? false}
      therapists={therapists}
    />
  )
}
