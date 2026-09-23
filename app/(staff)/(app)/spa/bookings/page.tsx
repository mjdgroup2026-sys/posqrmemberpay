import Link from "next/link"
import { getBookingDay, getStoreSettings } from "@/lib/queries"
import { businessDayKey, parseDayKey } from "@/lib/day"
import { requirePageAccess } from "@/lib/permissions"
import { BookingSchedule } from "@/components/booking-schedule"

export const metadata = { title: "ตารางจอง" }

/// ตารางจองรายวัน (Phase 20b) — เลือกวันผ่าน `?date=YYYY-MM-DD` (จองล่วงหน้าได้ จึงยอมให้เป็นวันอนาคต)
export default async function BookingsPage({ searchParams }: PageProps<"/spa/bookings">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("SPA_BOOKINGS")

  const query = await searchParams
  const requested = typeof query.date === "string" ? query.date : businessDayKey()
  const day = parseDayKey(requested) ?? parseDayKey(businessDayKey())
  const dayKey = day ? businessDayKey(day) : businessDayKey()

  const [settings, data] = await Promise.all([getStoreSettings(storeId), getBookingDay(storeId, dayKey)])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          ตารางจอง
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          ร้านนี้ยังไม่ได้เปิด “ตัวเลือกร้านนวด” — เปิดแล้วจะจองคิวล่วงหน้า ตั้งกะพนักงาน และดูกระดานห้องได้
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
        </div>
      </section>
    )
  }

  return (
    <BookingSchedule
      dayKey={data.dayKey}
      programs={data.programs}
      rooms={data.rooms}
      therapists={data.therapists}
      shifts={data.shifts}
      bookings={data.bookings}
      bufferMinutes={data.bufferMinutes}
      allowed={granted.SPA_BOOKINGS ?? []}
    />
  )
}
