import Link from "next/link"
import { getStoreSettings, listTherapistOptions, listTherapistShifts } from "@/lib/queries"
import { addDays, businessDayKey, parseDayKey, weekStartKey } from "@/lib/day"
import { requirePageAccess } from "@/lib/permissions"
import { ShiftEditor } from "@/components/shift-editor"

export const metadata = { title: "ตารางกะพนักงานนวด" }

/// ตารางกะรายสัปดาห์ (Phase 20b) — เลือกสัปดาห์ผ่าน `?week=YYYY-MM-DD` (วันไหนก็ได้ในสัปดาห์นั้น)
/// กะเป็นข้อมูลของพนักงาน จึงคุมด้วยสิทธิ์ `SPA_THERAPISTS` ชุดเดียวกับประวัติพนักงาน
export default async function ShiftsPage({ searchParams }: PageProps<"/spa/shifts">) {
  const { storeId, granted } = await requirePageAccess("SPA_THERAPISTS")

  const query = await searchParams
  const requested = typeof query.week === "string" ? query.week : businessDayKey()
  const anchor = parseDayKey(requested) ?? parseDayKey(businessDayKey())
  const weekStart = weekStartKey(anchor ? businessDayKey(anchor) : businessDayKey())
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))

  const [settings, therapists, shifts] = await Promise.all([
    getStoreSettings(storeId),
    listTherapistOptions(storeId),
    listTherapistShifts(storeId, weekStart, 7),
  ])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          ตารางกะพนักงานนวด
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          เปิด “ตัวเลือกร้านนวด” ในตั้งค่าร้านก่อน จึงจะตั้งกะและจองคิวได้
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
    <ShiftEditor
      weekStart={weekStart}
      days={days}
      therapists={therapists}
      shifts={shifts}
      allowed={granted.SPA_THERAPISTS ?? []}
    />
  )
}
