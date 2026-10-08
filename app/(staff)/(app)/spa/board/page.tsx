import Link from "next/link"
import { getSpaBoard, getStoreSettings } from "@/lib/queries"
import { addDays, businessDayKey, parseDayKey } from "@/lib/day"
import { formatBusinessDate } from "@/lib/format"
import { requirePageAccess } from "@/lib/permissions"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconTherapist } from "@/components/icons"
import { SpaBoard } from "@/components/spa-board"

export const metadata = { title: "กระดานห้องนวด" }

/// กระดานห้องนวด (Phase 20b · เลือกวัน 20h · แบบการ์ด 2026-10-08)
///
/// หน้านี้แค่ดึงข้อมูล — การ์ด/ความคืบหน้า/ไทม์ไลน์อยู่ที่ `components/spa-board.tsx`
/// · สถานะคิดจากสถานะคิวในตารางจอง (`getSpaBoard`) สองหน้าจึงต้องเห็นตรงกันเสมอ
/// · `<AutoRefresh>` (SSE + polling สำรอง) ดึงข้อมูลใหม่เมื่อมีคนเช็กอิน/เริ่มนวด/ปิดบิลจากเครื่องอื่น
/// · `?date=YYYY-MM-DD` เลือกวัน — วันอื่นไม่มีสถานะสด แสดงกะและคิวของวันนั้นแทน
export default async function SpaBoardPage({ searchParams }: PageProps<"/spa/board">) {
  const { storeId, granted } = await requirePageAccess("SPA_BOOKINGS")

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
  // เวลา server ตอน render — นาฬิกาฝั่ง client เริ่มจากค่านี้ (กัน hydration ไม่ตรง)
  const renderedAt = new Date()
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
            {live ? " · สถานะสด อัปเดตเองเมื่อมีคนกดที่เครื่องอื่น" : " · คิวและกะของวันที่เลือก (สถานะสดดูได้เฉพาะวันนี้)"}
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

      <SpaBoard
        dayKey={dayKey}
        live={live}
        nowMs={renderedAt.getTime()}
        rooms={board.rooms}
        therapists={board.therapists}
        unassigned={board.unassigned}
        allowed={granted.SPA_BOOKINGS ?? []}
        // ปุ่มปิดบิล/ชำระเงินบนการ์ด — หน้าปิดบิลต้องมี MO_TABLES:EDIT (ด่านเดิมของหน้านั้นยังตรวจซ้ำ)
        canBill={granted.MO_TABLES?.includes("EDIT") ?? false}
      />
    </>
  )
}
