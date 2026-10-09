import Link from "next/link"
import { getBookingDay, getSalesLock, getSpaBoard, getStoreSettings } from "@/lib/queries"
import { businessDayKey, minuteOfBusinessDay, parseDayKey } from "@/lib/day"
import { requirePageAccess } from "@/lib/permissions"
import { BookingSchedule, type QueueTab } from "@/components/booking-schedule"
import { SalesLockBanner } from "@/components/sales-lock-banner"

export const metadata = { title: "คิวนวด" }

const TABS: QueueTab[] = ["now", "timeline", "list"]

/// คิวนวด (Phase 20b · รวมตารางจอง + กระดานห้องนวดเป็นหน้าเดียว 2026-10-08 เจ้าของสั่ง)
///
/// `?date=YYYY-MM-DD` เลือกวัน (จองล่วงหน้าได้ จึงยอมให้เป็นวันอนาคต) · `?tab=now|timeline|list`
/// ไม่ระบุแท็บ: วันนี้เปิด "ตอนนี้" (การ์ด) · วันอื่นเปิด "ตารางเวลา" · `/spa/board` เดิมพามาแท็บ "ตอนนี้"
export default async function BookingsPage({ searchParams }: PageProps<"/spa/bookings">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted, id: userId } = await requirePageAccess("SPA_BOOKINGS")

  const query = await searchParams
  const todayKey = businessDayKey()
  const requested = typeof query.date === "string" ? query.date : todayKey
  const day = parseDayKey(requested) ?? parseDayKey(todayKey)
  const dayKey = day ? businessDayKey(day) : todayKey
  const tab: QueueTab = TABS.includes(query.tab as QueueTab) ? (query.tab as QueueTab) : dayKey === todayKey ? "now" : "timeline"

  const [settings, data, board, salesLock] = await Promise.all([
    getStoreSettings(storeId),
    getBookingDay(storeId, dayKey),
    getSpaBoard(storeId, { dayKey }),
    // ปิดยอดแล้ว = เช็กอินไม่ได้จนกว่าจะเปิดรอบขายใหม่ (2026-10-09) · จองล่วงหน้ายังได้
    getSalesLock(storeId, userId),
  ])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          คิวนวด
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          ร้านนี้ยังไม่ได้เปิด “ตัวเลือกร้านนวด” — เปิดแล้วจะจองคิวล่วงหน้า ตั้งกะพนักงาน และดูสถานะห้องได้
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
        </div>
      </section>
    )
  }

  // เวลา server ตอน render — เส้น "ตอนนี้" บนไทม์ไลน์ + นาฬิกาของการ์ด (client ไม่แตะ timezone)
  const renderedAt = new Date()

  return (
    <>
    {salesLock.locked ? (
      <SalesLockBanner roundNo={salesLock.roundNo} canResume={granted.POS_CLOSING?.includes("ADD") ?? false} />
    ) : null}
    <BookingSchedule
      dayKey={data.dayKey}
      todayKey={todayKey}
      tab={tab}
      board={{ live: board.live, rooms: board.rooms, therapists: board.therapists, unassigned: board.unassigned }}
      nowMs={renderedAt.getTime()}
      programs={data.programs}
      rooms={data.rooms}
      therapists={data.therapists}
      shifts={data.shifts}
      bookings={data.bookings}
      bufferMinutes={data.bufferMinutes}
      nowMinute={data.dayKey === todayKey ? minuteOfBusinessDay(renderedAt) : null}
      allowed={granted.SPA_BOOKINGS ?? []}
      // ปุ่มปิดบิล/ชำระเงินบนคิว — หน้าปิดบิลต้องมี MO_TABLES:EDIT (ด่านเดิมของหน้านั้นยังตรวจซ้ำ)
      canBill={granted.MO_TABLES?.includes("EDIT") ?? false}
    />
    </>
  )
}
