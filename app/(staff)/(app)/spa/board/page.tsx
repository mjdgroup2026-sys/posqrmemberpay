import Link from "next/link"
import { getSpaBoard, getStoreSettings } from "@/lib/queries"
import { formatHhMm, minuteOfBusinessDay } from "@/lib/day"
import { requirePageAccess } from "@/lib/permissions"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconRoom, IconTherapist } from "@/components/icons"
import type { TherapistBoardRow } from "@/lib/queries"

export const metadata = { title: "กระดานห้องนวด" }

/// กระดานสด "ใครว่าง / ห้องไหนใช้อยู่" (Phase 20b)
///
/// เป็น server component ล้วน — ทุกค่าคำนวณสดจากฐาน แล้ว `<AutoRefresh>` (SSE + polling สำรอง) ดึงใหม่ให้เอง
/// จึงไม่มี state ฝั่ง client ให้ค้างไม่ตรงกับของจริง
const STATE_LABEL: Record<TherapistBoardRow["state"], { text: string; chip: string }> = {
  BUSY: { text: "กำลังนวด", chip: "chip-warning" },
  FREE: { text: "ว่าง", chip: "chip-success" },
  NO_SHIFT: { text: "ยังไม่ตั้งกะ", chip: "chip-neutral" },
  OFF: { text: "หยุดวันนี้", chip: "chip-neutral" },
  BEFORE_SHIFT: { text: "ยังไม่เข้ากะ", chip: "chip-info" },
  AFTER_SHIFT: { text: "เลิกกะแล้ว", chip: "chip-neutral" },
}

function clock(date: Date | null): string {
  return date ? formatHhMm(minuteOfBusinessDay(date)) : "—"
}

export default async function SpaBoardPage() {
  const { storeId } = await requirePageAccess("SPA_BOOKINGS")
  const [settings, board] = await Promise.all([getStoreSettings(storeId), getSpaBoard(storeId)])

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

  const free = board.therapists.filter((t) => t.state === "FREE").length
  const busy = board.therapists.filter((t) => t.state === "BUSY").length

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
            สถานะสดของวันนี้ — ว่าง <strong className="num">{free}</strong> คน · กำลังนวด{" "}
            <strong className="num">{busy}</strong> คน
          </p>
        </div>
        <Link href="/spa/bookings" className="btn btn-primary">
          ไปตารางจอง
        </Link>
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
                  <span className={`chip ${STATE_LABEL[therapist.state].chip}`}>
                    <span className="dot" />
                    {STATE_LABEL[therapist.state].text}
                  </span>
                </span>
                <span className="t-caption" style={{ display: "block", marginTop: 8 }}>
                  {therapist.state === "BUSY"
                    ? `${therapist.programName ?? "บริการ"}${therapist.roomCode ? ` · ห้อง ${therapist.roomCode}` : ""}${
                        therapist.busyUntil ? ` · ถึง ${clock(therapist.busyUntil)} น.` : ""
                      }`
                    : therapist.shiftStartMinute !== null && therapist.shiftEndMinute !== null
                      ? `กะ ${formatHhMm(therapist.shiftStartMinute)}–${formatHhMm(therapist.shiftEndMinute)} น.`
                      : "ยังไม่ได้ตั้งกะของวันนี้"}
                </span>
                <span className="t-caption" style={{ display: "block", marginTop: 4 }}>
                  {therapist.nextBookingAt
                    ? `คิวถัดไป ${clock(therapist.nextBookingAt)} น. · ${therapist.nextBookingCustomer ?? ""}`
                    : "ไม่มีคิวที่จองไว้อีกวันนี้"}
                </span>
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
            {board.rooms.map((room) => (
              <div key={room.id} className="stat-tile">
                <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <strong>ห้อง {room.code}</strong>
                  <span className={`chip ${room.currentCustomer ? "chip-warning" : "chip-success"}`}>
                    <span className="dot" />
                    {room.currentCustomer ? "ใช้งานอยู่" : "ว่าง"}
                  </span>
                </span>
                <span className="t-caption" style={{ display: "block", marginTop: 8 }}>
                  {room.currentCustomer
                    ? `${room.currentCustomer} · ${room.currentTherapistLabel ?? ""} · ถึง ${clock(room.currentUntil)} น.`
                    : "ไม่มีคิวที่ใช้ห้องนี้อยู่"}
                </span>
                <span className="t-caption" style={{ display: "block", marginTop: 4 }}>
                  {room.nextBookingAt ? `คิวถัดไป ${clock(room.nextBookingAt)} น.` : "ไม่มีคิวถัดไป"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
