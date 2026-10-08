import Link from "next/link"
import { getSpaBoard, getStoreSettings } from "@/lib/queries"
import { addDays, businessDayKey, formatHhMm, minuteOfBusinessDay, parseDayKey } from "@/lib/day"
import { formatBusinessDate } from "@/lib/format"
import { requirePageAccess } from "@/lib/permissions"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconRoom, IconTherapist } from "@/components/icons"
import type { BookingRow, RoomBoardRow, TherapistBoardRow } from "@/lib/queries"

export const metadata = { title: "กระดานห้องนวด" }

/// กระดานสด "ใครว่าง / ห้องไหนใช้อยู่" (Phase 20b · เลือกวันได้ 2026-10-08)
///
/// เป็น server component ล้วน — ทุกค่าคำนวณสดจากฐาน แล้ว `<AutoRefresh>` (SSE + polling สำรอง) ดึงใหม่ให้เอง
/// · สถานะคิดจากสถานะคิวในตารางจองเป็นหลัก (`getSpaBoard`) สองหน้าจึงต้องเห็นตรงกันเสมอ
/// · `?date=YYYY-MM-DD` เลือกวัน — วันอื่นไม่มีสถานะสด แสดงกะและคิวของวันนั้นแทน
const THERAPIST_STATE: Record<TherapistBoardRow["state"], { text: string; chip: string }> = {
  BUSY: { text: "กำลังนวด", chip: "chip-warning" },
  WAITING: { text: "เช็กอินแล้ว รอเริ่มนวด", chip: "chip-brand" },
  FREE: { text: "ว่าง", chip: "chip-success" },
  ON_SHIFT: { text: "มีกะ", chip: "chip-info" },
  NO_SHIFT: { text: "ยังไม่ตั้งกะ", chip: "chip-neutral" },
  OFF: { text: "หยุด", chip: "chip-neutral" },
  BEFORE_SHIFT: { text: "ยังไม่เข้ากะ", chip: "chip-info" },
  AFTER_SHIFT: { text: "เลิกกะแล้ว", chip: "chip-neutral" },
}

const ROOM_STATE: Record<RoomBoardRow["state"], { text: string; chip: string }> = {
  IN_SERVICE: { text: "กำลังนวด", chip: "chip-warning" },
  WAITING: { text: "เช็กอินแล้ว รอเริ่มนวด", chip: "chip-brand" },
  OCCUPIED: { text: "มีบิลเปิดอยู่", chip: "chip-warning" },
  AWAITING_GUEST: { text: "ถึงเวลาแล้ว รอลูกค้า", chip: "chip-info" },
  FREE: { text: "ว่าง", chip: "chip-success" },
}

/// สถานะคิวสั้น ๆ ในรายการคิวของวัน — คำเดียวกับตารางจอง
const BOOKING_STATUS: Record<BookingRow["status"], string> = {
  BOOKED: "จองไว้",
  CHECKED_IN: "เช็กอินแล้ว",
  IN_SERVICE: "กำลังนวด",
  DONE: "เสร็จแล้ว",
  CANCELLED: "ยกเลิก",
  NO_SHOW: "ไม่มาตามนัด",
}

function clock(date: Date | null): string {
  return date ? formatHhMm(minuteOfBusinessDay(date)) : "—"
}

function bookingLine(row: BookingRow, show: "customer" | "room"): string {
  const who = show === "customer" ? `${row.customerName}${row.tableCode ? ` · ห้อง ${row.tableCode}` : ""}` : `${row.customerName} · ${row.therapistLabel}`
  return `${clock(row.startAt)}–${clock(row.endAt)} ${who} (${BOOKING_STATUS[row.status]})`
}

function therapistDetail(t: TherapistBoardRow): string {
  if (t.state === "BUSY" || t.state === "WAITING") {
    const parts = [
      t.walkIn ? "walk-in" : null,
      t.customerName,
      t.programName,
      t.roomCode ? `ห้อง ${t.roomCode}` : null,
      t.busyUntil ? `ถึง ${clock(t.busyUntil)} น.` : null,
    ]
    return parts.filter(Boolean).join(" · ")
  }
  return t.shiftStartMinute !== null && t.shiftEndMinute !== null
    ? `กะ ${formatHhMm(t.shiftStartMinute)}–${formatHhMm(t.shiftEndMinute)} น.`
    : t.state === "OFF"
      ? "วันหยุด"
      : "ยังไม่ได้ตั้งกะ"
}

function roomDetail(room: RoomBoardRow): string {
  switch (room.state) {
    case "IN_SERVICE":
    case "WAITING":
      return `${room.customerName ?? ""} · ${room.therapistLabel ?? ""} · ถึง ${clock(room.until)} น.`
    case "AWAITING_GUEST":
      return `คิว ${room.customerName ?? ""} ${clock(room.nextBookingAt)} น. ยังไม่เช็กอิน`
    case "OCCUPIED":
      return [
        room.customerName ?? "ลูกค้า walk-in",
        room.awaitingPayment ? "นวดเสร็จแล้ว รอปิดบิล" : null,
        room.staleSince ? `บิลค้างตั้งแต่ ${formatBusinessDate(room.staleSince)} — ปิดหรือยกเลิกบิลที่หน้าโต๊ะ` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    default:
      return "ไม่มีลูกค้าในห้องนี้"
  }
}

export default async function SpaBoardPage({ searchParams }: PageProps<"/spa/board">) {
  const { storeId } = await requirePageAccess("SPA_BOOKINGS")

  const query = await searchParams
  const today = businessDayKey()
  const requested = typeof query.date === "string" && parseDayKey(query.date) ? query.date : today
  const [settings, board] = await Promise.all([getStoreSettings(storeId), getSpaBoard(storeId, { dayKey: requested })])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          กระดานห้องนวด
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          เปิด “ตัวเลือกร้านนวด” ในตั้งค่าร้านก่อน จึงจะเห็นกระดานพนักงาน/ห้องได้
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
        </div>
      </section>
    )
  }

  const { live, dayKey } = board
  const free = board.therapists.filter((t) => t.state === "FREE").length
  const busy = board.therapists.filter((t) => t.state === "BUSY").length
  const waiting = board.therapists.filter((t) => t.state === "WAITING").length
  const dayLabel = formatBusinessDate(new Date(`${dayKey}T12:00:00+07:00`))

  return (
    <>
      <AutoRefresh seconds={20} />

      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านนวด</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconTherapist size={22} aria-hidden />
              กระดานห้องนวด
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            <strong>{dayLabel}</strong>
            {live ? (
              <>
                {" "}
                · สถานะสด — ว่าง <strong className="num">{free}</strong> คน · กำลังนวด <strong className="num">{busy}</strong> คน
                {waiting > 0 ? (
                  <>
                    {" "}
                    · รอเริ่มนวด <strong className="num">{waiting}</strong> คน
                  </>
                ) : null}
              </>
            ) : (
              <> · คิวและกะของวันที่เลือก (สถานะสดดูได้เฉพาะวันนี้)</>
            )}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link href={`/spa/board?date=${addDays(dayKey, -1)}`} className="btn btn-ghost" aria-label="วันก่อนหน้า">
            ‹ วันก่อน
          </Link>
          {dayKey !== today ? (
            <Link href="/spa/board" className="btn btn-subtle">
              วันนี้
            </Link>
          ) : null}
          <Link href={`/spa/board?date=${addDays(dayKey, 1)}`} className="btn btn-ghost" aria-label="วันถัดไป">
            วันถัดไป ›
          </Link>
          {/* GET form — เปลี่ยนวันได้โดยไม่ต้องมี client component */}
          <form action="/spa/board" className="row" style={{ gap: 6 }}>
            <input type="date" name="date" className="input" defaultValue={dayKey} style={{ width: 160 }} aria-label="วันที่ของกระดาน" />
            <button type="submit" className="btn btn-ghost">
              ดู
            </button>
          </form>
          <Link href={`/spa/bookings?date=${dayKey}`} className="btn btn-primary">
            ไปตารางจอง
          </Link>
        </div>
      </div>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">พนักงานนวด</h2>
        </div>
        {board.therapists.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>ยังไม่มีพนักงานนวดที่เปิดใช้งาน</p>
        ) : (
          <div className="field-grid" style={{ padding: 16 }}>
            {board.therapists.map((therapist) => (
              <div key={therapist.id} className="stat-tile">
                <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <strong>{therapist.label}</strong>
                  <span className={`chip ${THERAPIST_STATE[therapist.state].chip}`}>
                    <span className="dot" />
                    {THERAPIST_STATE[therapist.state].text}
                  </span>
                </span>
                <span className="t-caption" style={{ display: "block", marginTop: 8 }}>
                  {therapistDetail(therapist)}
                </span>
                {therapist.overrun ? (
                  <span className="chip chip-danger" style={{ marginTop: 6 }}>
                    <span className="dot" />
                    เกินเวลาที่จองไว้ — กด “เสร็จแล้ว” ที่ตารางจองเมื่อนวดเสร็จ
                  </span>
                ) : null}
                {live ? (
                  <span className="t-caption" style={{ display: "block", marginTop: 4 }}>
                    {therapist.nextBookingAt
                      ? `คิวถัดไป ${clock(therapist.nextBookingAt)} น. · ${therapist.nextBookingCustomer ?? ""}${
                          therapist.nextBookingOverdue ? " (เลยเวลา ยังไม่เช็กอิน)" : ""
                        }`
                      : "ไม่มีคิวที่รออยู่อีกวันนี้"}
                  </span>
                ) : (
                  <BookingList rows={therapist.bookings} show="customer" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-ui" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2 className="t-h2">
            <span className="row" style={{ gap: 8 }}>
              <IconRoom size={18} aria-hidden />
              ห้องนวด
            </span>
          </h2>
        </div>
        {board.rooms.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีห้องนวด — เพิ่มได้ที่หน้าจัดการโต๊ะ โดยเลือกชนิดเป็น “ห้องนวด”
          </p>
        ) : (
          <div className="field-grid" style={{ padding: 16 }}>
            {board.rooms.map((room) => {
              const state = live ? ROOM_STATE[room.state] : { text: `${room.bookings.length} คิว`, chip: "chip-info" }
              return (
                <div key={room.id} className="stat-tile">
                  <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <strong>ห้อง {room.code}</strong>
                    <span className={`chip ${state.chip}`}>
                      <span className="dot" />
                      {state.text}
                    </span>
                  </span>
                  {live ? (
                    <>
                      <span className="t-caption" style={{ display: "block", marginTop: 8 }}>
                        {roomDetail(room)}
                      </span>
                      {room.overrun ? (
                        <span className="chip chip-danger" style={{ marginTop: 6 }}>
                          <span className="dot" />
                          เกินเวลาที่จองไว้
                        </span>
                      ) : null}
                      <span className="t-caption" style={{ display: "block", marginTop: 4 }}>
                        {room.nextBookingAt && room.state !== "AWAITING_GUEST"
                          ? `คิวถัดไป ${clock(room.nextBookingAt)} น. · ${room.nextBookingCustomer ?? ""}`
                          : room.state === "AWAITING_GUEST"
                            ? ""
                            : "ไม่มีคิวถัดไป"}
                      </span>
                    </>
                  ) : (
                    <BookingList rows={room.bookings} show="room" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {board.unassigned.length > 0 ? (
        <section className="card-ui" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2 className="t-h2">คิวที่ยังไม่ระบุห้อง</h2>
            <span className="t-caption">เลือกห้องตอนเช็กอินที่ตารางจอง</span>
          </div>
          <div style={{ padding: "0 24px 16px" }}>
            <BookingList rows={board.unassigned} show="room" />
          </div>
        </section>
      ) : null}
    </>
  )
}

function BookingList({ rows, show }: { rows: BookingRow[]; show: "customer" | "room" }) {
  if (rows.length === 0) {
    return (
      <span className="t-caption" style={{ display: "block", marginTop: 8 }}>
        ไม่มีคิวในวันนี้
      </span>
    )
  }
  return (
    <ul style={{ marginTop: 8, display: "grid", gap: 4 }}>
      {rows.map((row) => (
        <li key={row.id} className="t-caption num">
          {bookingLine(row, show)}
        </li>
      ))}
    </ul>
  )
}
