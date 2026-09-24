"use client"

import { useRouter } from "next/navigation"
import { IconCalendar } from "@/components/icons"

/// แถบตัวกรองรายงานพนักงานนวด (20f — เจ้าของสั่ง 2026-09-24)
///
/// ช่วงวันที่ · พนักงานนวด · ประเภทบริการ — เปลี่ยนแล้วพาไป `/spa/reports?from=&to=&therapist=&type=`
/// ให้ Server Component คำนวณใหม่ (ค่าอยู่ใน URL จึงกดย้อนกลับ/ส่งลิงก์ต่อได้) · ด่านจริงของวันที่คือ `resolveDayRange` ฝั่ง server
export function SpaReportFilter({
  from,
  to,
  today,
  therapistId,
  stationId,
  therapists,
  stations,
}: {
  from: string
  to: string
  today: string
  therapistId: string
  stationId: string
  therapists: { id: string; label: string; isActive: boolean }[]
  stations: { id: string; name: string }[]
}) {
  const router = useRouter()

  function go(next: Partial<{ from: string; to: string; therapist: string; type: string }>) {
    const values = { from, to, therapist: therapistId, type: stationId, ...next }
    const params = new URLSearchParams()
    params.set("from", values.from)
    params.set("to", values.to)
    if (values.therapist) params.set("therapist", values.therapist)
    if (values.type) params.set("type", values.type)
    router.push(`/spa/reports?${params.toString()}`)
  }

  const filtered = therapistId !== "" || stationId !== ""

  return (
    <div className="card-ui card-pad" style={{ marginBottom: 18 }}>
      <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 160 }}>
          <label className="t-small" htmlFor="spa-from">
            <span className="row" style={{ gap: 6 }}>
              <IconCalendar size={15} aria-hidden />
              ตั้งแต่วันที่
            </span>
          </label>
          <input
            id="spa-from"
            type="date"
            className="input num"
            value={from}
            max={to}
            onChange={(e) => e.target.value && go({ from: e.target.value })}
          />
        </div>
        <div className="field" style={{ minWidth: 160 }}>
          <label className="t-small" htmlFor="spa-to">
            ถึงวันที่
          </label>
          <input
            id="spa-to"
            type="date"
            className="input num"
            value={to}
            min={from}
            max={today}
            onChange={(e) => e.target.value && go({ to: e.target.value })}
          />
        </div>
        <div className="field" style={{ minWidth: 190 }}>
          <label className="t-small" htmlFor="spa-therapist">
            พนักงานนวด
          </label>
          <select id="spa-therapist" className="select" value={therapistId} onChange={(e) => go({ therapist: e.target.value })}>
            <option value="">ทุกคน</option>
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.isActive ? "" : " (ปิดใช้งาน)"}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 190 }}>
          <label className="t-small" htmlFor="spa-type">
            ประเภทบริการ
          </label>
          <select id="spa-type" className="select" value={stationId} onChange={(e) => go({ type: e.target.value })}>
            <option value="">ทุกประเภท</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => go({ therapist: "", type: "" })} disabled={!filtered}>
            ล้างตัวกรอง
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push("/spa/reports")}>
            30 วันล่าสุด
          </button>
        </div>
      </div>
    </div>
  )
}
