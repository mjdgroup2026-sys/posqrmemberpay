import Link from "next/link"
import { getBookingTicket } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { BookingTicket } from "@/components/booking-ticket"

export const metadata = { title: "ทิกเก็ตจัดห้อง" }

/// ทิกเก็ตจัดห้อง/จัดคนนวดของคิวที่เช็กอินแล้ว (2026-10-08) — อยู่นอก `(app)` เหมือนทิกเก็ตครัว จึงไม่มี sidebar ปนตอนพิมพ์
export default async function BookingTicketPage({ params, searchParams }: PageProps<"/tickets/booking/[bookingId]">) {
  // ด่านชั้นที่ 1 ของ §4 — ทิกเก็ตเป็นส่วนหนึ่งของตารางจอง
  const { storeId } = await requirePageAccess("SPA_BOOKINGS")

  const { bookingId } = await params
  const query = await searchParams
  const ticket = await getBookingTicket(storeId, bookingId)

  if (!ticket) {
    return (
      <main style={{ padding: 24, display: "grid", placeItems: "center", minHeight: "100dvh" }}>
        <div className="card-ui card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
          <h1 className="t-h2">พิมพ์ทิกเก็ตไม่ได้</h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            ไม่พบคิวนี้ หรือคิวยังไม่ได้เช็กอิน — ทิกเก็ตจัดห้องพิมพ์ได้หลังเช็กอินแล้วเท่านั้น
          </p>
          <Link href="/spa/bookings?tab=list" className="btn btn-primary" style={{ marginTop: 16 }}>
            กลับไปคิวนวด
          </Link>
        </div>
      </main>
    )
  }

  return <BookingTicket ticket={ticket} auto={query.auto === "1"} />
}
