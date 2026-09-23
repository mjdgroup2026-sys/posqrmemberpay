"use client"

import type { ComponentType } from "react"
import { formatNumber } from "@/lib/format"

export type SegmentTab<K extends string> = {
  key: K
  label: string
  count?: number
  Icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>
}

/// แท็บแยกกลุ่มบนหน้าเดียวกัน (2026-09-23 — ร้านสปา: อาหาร / นวดสปา · โต๊ะ / ห้อง)
///
/// หน้าตาเดียวกับแท็บประเภทครัวบน KDS (`btn` + `role="tab"`) — ใช้ร่วมกันที่หน้าจัดการเมนู หน้าขาย และผังโต๊ะ
export function SegmentTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: SegmentTab<K>[]
  value: K
  onChange: (key: K) => void
  /// aria-label ของกลุ่มแท็บ
  label: string
}) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="tablist" aria-label={label}>
      {tabs.map(({ key, label: tabLabel, count, Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={`btn btn-sm ${value === key ? "btn-primary" : "btn-subtle"}`}
          onClick={() => onChange(key)}
        >
          {Icon ? <Icon size={15} aria-hidden /> : null}
          {tabLabel}
          {count === undefined ? null : <span className="num">{formatNumber(count)}</span>}
        </button>
      ))}
    </div>
  )
}
