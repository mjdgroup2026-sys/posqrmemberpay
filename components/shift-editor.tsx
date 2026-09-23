"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { copyShifts, deleteShift, saveShift } from "@/app/actions/therapist-shifts"
import type { ShiftRow, TherapistOption } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconCalendar, IconCopy, IconSpinner } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// ตารางกะรายสัปดาห์ของพนักงานนวด (Phase 20b) — แถว = พนักงาน · คอลัมน์ = 7 วันของสัปดาห์
///
/// กะเก็บเป็นแถวรายวัน (ดู schema) ปุ่ม "คัดลอกไปทั้งสัปดาห์" จึงเขียนแถวให้ครบทุกวันจริง ๆ
/// ไม่ใช่รูปแบบประจำที่ต้องตีความตอนอ่าน — ตารางที่เห็นคือสิ่งที่อยู่ในฐานเป๊ะ ๆ

const WEEKDAY_LABEL = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

type CellDraft = { therapistId: string; therapistLabel: string; workDate: string; startTime: string; endTime: string; isOff: boolean; existing: boolean }

export function ShiftEditor({
  weekStart,
  days,
  therapists,
  shifts,
  allowed = FULL_ACCESS,
}: {
  weekStart: string
  /// 7 คีย์วันของสัปดาห์ที่กำลังดู (จันทร์ → อาทิตย์) — server เป็นคนคำนวณให้ ไม่ให้ client ยุ่งกับปฏิทิน
  days: string[]
  therapists: TherapistOption[]
  shifts: ShiftRow[]
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [draft, setDraft] = useState<CellDraft | null>(null)

  const byKey = useMemo(() => {
    const map = new Map<string, ShiftRow>()
    for (const shift of shifts) map.set(`${shift.therapistId}|${shift.workDate}`, shift)
    return map
  }, [shifts])

  const canEdit = allowed.includes("EDIT")

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string; fieldErrors?: FieldErrors }>) {
    setPending(true)
    setFieldErrors({})
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        setFieldErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message ?? "เรียบร้อยแล้ว")
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  function openCell(therapist: TherapistOption, day: string) {
    const shift = byKey.get(`${therapist.id}|${day}`)
    setFieldErrors({})
    setDraft({
      therapistId: therapist.id,
      therapistLabel: therapist.label,
      workDate: day,
      startTime: shift && !shift.isOff ? hhmm(shift.startMinute) : "09:00",
      endTime: shift && !shift.isOff ? hhmm(shift.endMinute) : "20:00",
      isOff: shift?.isOff ?? false,
      existing: shift !== undefined,
    })
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const fd = new FormData()
    fd.set("therapistId", draft.therapistId)
    fd.set("workDate", draft.workDate)
    fd.set("startTime", draft.startTime)
    fd.set("endTime", draft.endTime)
    fd.set("isOff", String(draft.isOff))
    if (await run(() => saveShift(fd))) setDraft(null)
  }

  async function removeCell() {
    if (!draft) return
    const fd = new FormData()
    fd.set("therapistId", draft.therapistId)
    fd.set("workDate", draft.workDate)
    if (await run(() => deleteShift(fd))) setDraft(null)
  }

  function copyDayToWeek(sourceDate: string) {
    const fd = new FormData()
    fd.set("sourceDate", sourceDate)
    fd.set("targetDates", days.filter((day) => day !== sourceDate).join(","))
    void run(() => copyShifts(fd))
  }

  function goToWeek(offset: number) {
    const next = new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + offset * 7 * 86_400_000)
    router.push(`/spa/shifts?week=${next.toISOString().slice(0, 10)}`)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านนวด</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconCalendar size={22} aria-hidden />
              ตารางกะพนักงานนวด
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            กดที่ช่องเพื่อตั้งเวลาเข้า–ออกหรือทำเครื่องหมายวันหยุด — ช่องว่าง (“—”) แปลว่ายังไม่ได้ตั้งกะ
            ซึ่งยังจองคิวได้ตามปกติ แต่กระดานจะขึ้นว่า “ยังไม่ตั้งกะ”
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => goToWeek(-1)} disabled={pending}>
            สัปดาห์ก่อน
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => goToWeek(1)} disabled={pending}>
            สัปดาห์ถัดไป
          </button>
        </div>
      </div>

      {therapists.length === 0 ? (
        <div className="alert-banner info">ยังไม่มีพนักงานนวดที่เปิดใช้งาน — เพิ่มที่หน้าพนักงานนวดก่อน</div>
      ) : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            สัปดาห์ของวันที่ <span className="num">{weekStart}</span>
          </h2>
        </div>

        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 16px", fontWeight: 500 }}>พนักงาน</th>
                {days.map((day, index) => (
                  <th key={day} style={{ padding: "10px 8px", fontWeight: 500 }}>
                    {WEEKDAY_LABEL[index]}
                    <br />
                    <span className="t-caption num">{day.slice(5)}</span>
                    {canEdit ? (
                      <>
                        <br />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => copyDayToWeek(day)}
                          disabled={pending}
                          title="คัดลอกกะของวันนี้ไปทุกวันในสัปดาห์นี้"
                        >
                          <IconCopy size={14} aria-hidden />
                          ทั้งสัปดาห์
                        </button>
                      </>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {therapists.map((therapist) => (
                <tr key={therapist.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 16px" }}>{therapist.label}</td>
                  {days.map((day) => {
                    const shift = byKey.get(`${therapist.id}|${day}`)
                    return (
                      <td key={day} style={{ padding: "8px" }}>
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm"
                          onClick={() => openCell(therapist, day)}
                          disabled={!canEdit || pending}
                          style={{ width: "100%", justifyContent: "center" }}
                        >
                          {!shift ? "—" : shift.isOff ? "หยุด" : <span className="num">{`${hhmm(shift.startMinute)}–${hhmm(shift.endMinute)}`}</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={draft !== null} onOpenChange={(next) => !pending && !next && setDraft(null)}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{draft ? `กะของ ${draft.therapistLabel}` : ""}</DialogTitle>
              <DialogDescription>{draft ? `วันที่ ${draft.workDate}` : ""}</DialogDescription>
            </DialogHeader>

            {draft ? (
              <div className="field-grid">
                <label className="checkbox-row" style={{ gridColumn: "1 / -1" }}>
                  <input
                    type="checkbox"
                    checked={draft.isOff}
                    onChange={(e) => setDraft((d) => (d ? { ...d, isOff: e.target.checked } : d))}
                  />
                  <span>วันหยุดของพนักงานคนนี้ (จองคิวให้ไม่ได้)</span>
                </label>

                <label className="field">
                  <span>เวลาเข้างาน</span>
                  <input
                    type="time"
                    className="input num"
                    value={draft.startTime}
                    onChange={(e) => setDraft((d) => (d ? { ...d, startTime: e.target.value } : d))}
                    disabled={draft.isOff}
                    required
                  />
                  {fieldErrors.startTime ? <span className="field-hint error">{fieldErrors.startTime}</span> : null}
                </label>

                <label className="field">
                  <span>เวลาออกงาน</span>
                  <input
                    type="time"
                    className="input num"
                    value={draft.endTime}
                    onChange={(e) => setDraft((d) => (d ? { ...d, endTime: e.target.value } : d))}
                    disabled={draft.isOff}
                    required
                  />
                  {fieldErrors.endTime ? <span className="field-hint error">{fieldErrors.endTime}</span> : null}
                </label>
              </div>
            ) : null}

            <DialogFooter>
              {draft?.existing ? (
                <button type="button" className="btn btn-ghost" onClick={removeCell} disabled={pending}>
                  ล้างกะวันนี้
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={pending}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
                บันทึก
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
