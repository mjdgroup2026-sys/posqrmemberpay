"use client"

import { useRouter } from "next/navigation"
import { IconCalendar } from "@/components/icons"

/// ตัวเลือกช่วงวันของรายงาน (Phase 20c) — เปลี่ยนแล้วพาไป `<basePath>?from=&to=`
/// ให้ Server Component คำนวณใหม่ · `max` กันเลือกอนาคตในเบราว์เซอร์ (ด่านจริงคือ `resolveDayRange` ฝั่ง server)
export function DayRangePicker({
  basePath,
  from,
  to,
  today,
}: {
  basePath: string
  from: string
  to: string
  today: string
}) {
  const router = useRouter()

  function go(next: { from?: string; to?: string }) {
    const params = new URLSearchParams({ from: next.from ?? from, to: next.to ?? to })
    router.push(`${basePath}?${params.toString()}`)
  }

  return (
    <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div className="field" style={{ minWidth: 165 }}>
        <label className="t-small" htmlFor="range-from">
          <span className="row" style={{ gap: 6 }}>
            <IconCalendar size={15} aria-hidden />
            ตั้งแต่วันที่
          </span>
        </label>
        <input
          id="range-from"
          type="date"
          className="input num"
          value={from}
          max={to}
          onChange={(e) => e.target.value && go({ from: e.target.value })}
        />
      </div>
      <div className="field" style={{ minWidth: 165 }}>
        <label className="t-small" htmlFor="range-to">
          ถึงวันที่
        </label>
        <input
          id="range-to"
          type="date"
          className="input num"
          value={to}
          max={today}
          onChange={(e) => e.target.value && go({ to: e.target.value })}
        />
      </div>
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => router.push(basePath)}>
        วันนี้
      </button>
    </div>
  )
}
