import Link from "next/link"
import { getKitchenTicket } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { KitchenTicket } from "@/components/kitchen-ticket"

export const metadata = { title: "ทิกเก็ตครัว" }

/// หน้าทิกเก็ตแบบเดี่ยว — อยู่นอก route group `(app)` โดยตั้งใจ จึงไม่มี sidebar/topbar มาปนตอนพิมพ์
/// (proxy.ts กันไม่ให้คนไม่ได้ล็อกอินเข้าถึงอยู่แล้ว แต่เช็ค session ซ้ำที่นี่ตามกติกาข้อ 5)
export default async function KitchenTicketPage({
  params,
  searchParams,
}: PageProps<"/tickets/[orderId]">) {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("MO_KITCHEN", "MO_TABLES")

  const { orderId } = await params
  const query = await searchParams
  const ticket = await getKitchenTicket(storeId, orderId)

  if (!ticket) {
    return (
      <main style={{ padding: 24, display: "grid", placeItems: "center", minHeight: "100dvh" }}>
        <div className="card-ui card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
          <h1 className="t-h2">ไม่พบออร์เดอร์นี้</h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            ออร์เดอร์อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง
          </p>
          <Link href="/mobile-order/kitchen" className="btn btn-primary" style={{ marginTop: 16 }}>
            กลับไปหน้าครัว
          </Link>
        </div>
      </main>
    )
  }

  return <KitchenTicket ticket={ticket} auto={query.auto === "1"} />
}
