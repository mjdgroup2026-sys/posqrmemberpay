"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cancelBooking, checkInBooking, markBookingNoShow, saveBooking } from "@/app/actions/bookings"
import type { BookingProgram, BookingRoom, BookingRow, ShiftRow, TherapistOption } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconCalendar, IconPlus, IconSpinner } from "@/components/icons"
import { AutoRefresh } from "@/components/auto-refresh"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// ตารางจองรายวันของร้านนวด (Phase 20b) — แถว = พนักงานนวด · แนวนอน = เวลา
///
/// ทุกค่าที่เกี่ยวกับ "เวลาไทย" ถูกคำนวณมาจาก server แล้ว (startMinute/endMinute ใน BookingRow และ ShiftRow)
/// client จึงไม่แตะ timezone เลย — เครื่องพนักงานที่ตั้งเขตเวลาผิดก็ยังเห็นตารางตรงกับของจริง
/// · ด่านจริงของ "ว่างไหม" อยู่ที่ server (lib/booking.ts) — ที่นี่แค่ช่วยไม่ให้กดจองคิวที่ชนแน่ ๆ

const DEFAULT_START = 9 * 60
const DEFAULT_END = 21 * 60
/// ความกว้างของ 1 ชั่วโมงบนตาราง (px) — เลื่อนแนวนอนได้เมื่อร้านเปิดยาว
const HOUR_WIDTH = 96

const STATUS_LABEL: Record<BookingRow["status"], string> = {
  BOOKED: "จองไว้",
  CHECKED_IN: "เช็กอินแล้ว",
  IN_SERVICE: "กำลังนวด",
  DONE: "เสร็จแล้ว",
  CANCELLED: "ยกเลิก",
  NO_SHOW: "ไม่มาตามนัด",
}

const STATUS_CHIP: Record<BookingRow["status"], string> = {
  BOOKED: "chip-info",
  CHECKED_IN: "chip-brand",
  IN_SERVICE: "chip-warning",
  DONE: "chip-success",
  CANCELLED: "chip-neutral",
  NO_SHOW: "chip-danger",
}

const LIVE_STATUS: BookingRow["status"][] = ["BOOKED", "CHECKED_IN", "IN_SERVICE"]

function hhmm(minute: number): string {
  const safe = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`
}

const EMPTY_DRAFT = {
  id: "",
  customerName: "",
  customerPhone: "",
  menuItemId: "",
  therapistId: "",
  tableId: "",
  startTime: "10:00",
  note: "",
}

export function BookingSchedule({
  dayKey,
  programs,
  rooms,
  therapists,
  shifts,
  bookings,
  bufferMinutes,
  allowed = FULL_ACCESS,
}: {
  dayKey: string
  programs: BookingProgram[]
  rooms: BookingRoom[]
  therapists: TherapistOption[]
  shifts: ShiftRow[]
  bookings: BookingRow[]
  bufferMinutes: number
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [detail, setDetail] = useState<BookingRow | null>(null)
  const [checkInRoom, setCheckInRoom] = useState("")

  const shiftByTherapist = useMemo(() => new Map(shifts.map((s) => [s.therapistId, s])), [shifts])
  const live = useMemo(() => bookings.filter((b) => LIVE_STATUS.includes(b.status)), [bookings])

  // ขอบเขตเวลาบนตาราง — ครอบทั้งกะและคิวที่มีจริง เผื่อคิวที่จองไว้นอกกะ (จากตอนที่ยังไม่ได้ตั้งกะ)
  const range = useMemo(() => {
    const starts = [DEFAULT_START, ...shifts.filter((s) => !s.isOff).map((s) => s.startMinute), ...live.map((b) => b.startMinute)]
    const ends = [DEFAULT_END, ...shifts.filter((s) => !s.isOff).map((s) => s.endMinute), ...live.map((b) => b.endMinute)]
    const start = Math.floor(Math.min(...starts) / 60) * 60
    const end = Math.ceil(Math.max(...ends) / 60) * 60
    return { start, end, width: ((end - start) / 60) * HOUR_WIDTH }
  }, [shifts, live])

  const hours = useMemo(() => {
    const list: number[] = []
    for (let minute = range.start; minute <= range.end; minute += 60) list.push(minute)
    return list
  }, [range])

  const selectedProgram = programs.find((p) => p.id === draft.menuItemId) ?? null

  /// พนักงานที่เลือกได้สำหรับโปรแกรม + เวลาในฟอร์ม — กรองทักษะ แล้วติดป้ายคนที่คิวชนอยู่แล้ว
  const therapistChoices = useMemo(() => {
    const startMinute = toMinute(draft.startTime)
    const duration = selectedProgram?.durationMinutes ?? 0
    return therapists
      .filter((t) => !selectedProgram?.stationId || t.skillIds.includes(selectedProgram.stationId))
      .map((t) => {
        const shift = shiftByTherapist.get(t.id)
        const clash =
          startMinute !== null &&
          duration > 0 &&
          live.some(
            (b) =>
              b.therapistId === t.id &&
              b.id !== draft.id &&
              b.startMinute < startMinute + duration + bufferMinutes &&
              b.endMinute + bufferMinutes > startMinute,
          )
        const offDuty =
          startMinute !== null &&
          duration > 0 &&
          shift !== undefined &&
          (shift.isOff || startMinute < shift.startMinute || startMinute + duration > shift.endMinute)
        return { ...t, clash, offDuty }
      })
  }, [therapists, selectedProgram, draft.startTime, draft.id, live, shiftByTherapist, bufferMinutes])

  const roomChoices = useMemo(
    () => rooms.filter((r) => !selectedProgram?.stationId || !r.stationId || r.stationId === selectedProgram.stationId),
    [rooms, selectedProgram],
  )

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

  function startCreate(therapistId?: string, startMinute?: number) {
    setDraft({
      ...EMPTY_DRAFT,
      therapistId: therapistId ?? "",
      menuItemId: programs[0]?.id ?? "",
      startTime: startMinute === undefined ? EMPTY_DRAFT.startTime : hhmm(startMinute),
    })
    setFieldErrors({})
    setFormOpen(true)
  }

  function startEdit(booking: BookingRow) {
    setDraft({
      id: booking.id,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone ?? "",
      menuItemId: booking.menuItemId,
      therapistId: booking.therapistId,
      tableId: booking.tableId ?? "",
      startTime: hhmm(booking.startMinute),
      note: booking.note ?? "",
    })
    setDetail(null)
    setFieldErrors({})
    setFormOpen(true)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData()
    if (draft.id) fd.set("id", draft.id)
    fd.set("customerName", draft.customerName)
    fd.set("customerPhone", draft.customerPhone)
    fd.set("menuItemId", draft.menuItemId)
    fd.set("therapistId", draft.therapistId)
    fd.set("tableId", draft.tableId)
    fd.set("bookingDate", dayKey)
    fd.set("startTime", draft.startTime)
    fd.set("note", draft.note)
    if (await run(() => saveBooking(fd))) setFormOpen(false)
  }

  async function submitCheckIn() {
    if (!detail) return
    const fd = new FormData()
    fd.set("id", detail.id)
    fd.set("tableId", checkInRoom || detail.tableId || "")
    if (await run(() => checkInBooking(fd))) setDetail(null)
  }

  async function close(booking: BookingRow, mode: "CANCELLED" | "NO_SHOW") {
    const fd = new FormData()
    fd.set("id", booking.id)
    const done = await run(() => (mode === "CANCELLED" ? cancelBooking(fd) : markBookingNoShow(fd)))
    if (done) setDetail(null)
  }

  function goToDay(next: string) {
    router.push(`/spa/bookings?date=${next}`)
  }

  return (
    <>
      {/* คิวเปลี่ยนจากหลายเครื่อง (เช็กอินหน้าเคาน์เตอร์ · เริ่มนวดหน้าห้อง) — SSE ก่อน polling สำรอง */}
      <AutoRefresh seconds={30} />

      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านนวด</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconCalendar size={22} aria-hidden />
              ตารางจอง
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            คิวของวันที่เลือก — กดที่ช่องว่างของพนักงานเพื่อจองเวลานั้น หรือกดที่คิวเพื่อเช็กอิน/แก้ไข
            {bufferMinutes > 0 ? ` · เว้นช่วงพักระหว่างคิว ${bufferMinutes} นาที` : null}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <input
            type="date"
            className="input"
            value={dayKey}
            onChange={(e) => e.target.value && goToDay(e.target.value)}
            style={{ width: 170 }}
            aria-label="วันที่ของตารางจอง"
          />
          {allowed.includes("ADD") ? (
            <button type="button" className="btn btn-primary" onClick={() => startCreate()} disabled={programs.length === 0}>
              <IconPlus size={17} aria-hidden />
              จองคิว
            </button>
          ) : null}
        </div>
      </div>

      {programs.length === 0 ? (
        <div className="alert-banner info">
          ยังไม่มีโปรแกรมนวดที่ตั้งระยะเวลาไว้ — เพิ่มเมนูชนิด “โปรแกรมนวด” พร้อมระยะเวลา (นาที) ที่หน้าจัดการเมนูก่อน จึงจะจองคิวได้
        </div>
      ) : null}
      {therapists.length === 0 ? (
        <div className="alert-banner info">ยังไม่มีพนักงานนวดที่เปิดใช้งาน — เพิ่มที่หน้าพนักงานนวดก่อน</div>
      ) : null}

      <section className="card-ui" style={{ overflow: "hidden" }}>
        <div className="panel-head">
          <h2 className="t-h2">
            คิววันนี้ <span className="num">{live.length}</span> รายการ
          </h2>
          <span className="t-caption">เลื่อนตารางไปทางขวาเพื่อดูเวลาถัดไป</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: range.width + 160 }}>
            {/* แถบเวลา */}
            <div className="row" style={{ gap: 0, borderBottom: "1px solid var(--line)" }}>
              <div style={{ width: 160, flex: "none", padding: "8px 12px" }} className="t-caption">
                พนักงาน
              </div>
              <div style={{ position: "relative", height: 32, width: range.width }}>
                {hours.map((minute) => (
                  <span
                    key={minute}
                    className="t-caption num"
                    style={{ position: "absolute", left: ((minute - range.start) / 60) * HOUR_WIDTH, top: 8 }}
                  >
                    {hhmm(minute)}
                  </span>
                ))}
              </div>
            </div>

            {therapists.map((therapist) => {
              const shift = shiftByTherapist.get(therapist.id)
              const rows = live.filter((b) => b.therapistId === therapist.id)
              return (
                <div key={therapist.id} className="row" style={{ gap: 0, borderTop: "1px solid var(--line)", alignItems: "stretch" }}>
                  <div style={{ width: 160, flex: "none", padding: "10px 12px" }}>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {therapist.code}
                    </span>{" "}
                    {therapist.label.replace(`${therapist.code} `, "")}
                    <br />
                    <span className="t-caption">
                      {shift ? (shift.isOff ? "หยุด" : `${hhmm(shift.startMinute)}–${hhmm(shift.endMinute)}`) : "ยังไม่ตั้งกะ"}
                    </span>
                  </div>

                  <div style={{ position: "relative", width: range.width, minHeight: 56 }}>
                    {/* พื้นหลังกะ — ช่วงที่อยู่เวรจะสว่างกว่านอกเวลา */}
                    {shift && !shift.isOff ? (
                      <div
                        aria-hidden
                        style={{
                          position: "absolute",
                          left: ((shift.startMinute - range.start) / 60) * HOUR_WIDTH,
                          width: ((shift.endMinute - shift.startMinute) / 60) * HOUR_WIDTH,
                          top: 0,
                          bottom: 0,
                          background: "var(--surface-2)",
                        }}
                      />
                    ) : null}

                    {/* ปุ่มจองตามช่วงชั่วโมง — กดแล้วเปิดฟอร์มพร้อมเวลานั้น */}
                    {allowed.includes("ADD") && programs.length > 0
                      ? hours.slice(0, -1).map((minute) => (
                          <button
                            key={minute}
                            type="button"
                            className="btn btn-ghost"
                            title={`จองคิว ${hhmm(minute)} น.`}
                            onClick={() => startCreate(therapist.id, minute)}
                            style={{
                              position: "absolute",
                              left: ((minute - range.start) / 60) * HOUR_WIDTH,
                              width: HOUR_WIDTH,
                              top: 0,
                              bottom: 0,
                              borderRadius: 0,
                              opacity: 0,
                              padding: 0,
                              minWidth: 0,
                            }}
                          >
                            <span className="sr-only">{`จองคิวเวลา ${hhmm(minute)} น. ให้ ${therapist.label}`}</span>
                          </button>
                        ))
                      : null}

                    {rows.map((booking) => (
                      <button
                        key={booking.id}
                        type="button"
                        className="btn btn-subtle"
                        onClick={() => {
                          setDetail(booking)
                          setCheckInRoom(booking.tableId ?? "")
                        }}
                        style={{
                          position: "absolute",
                          left: ((booking.startMinute - range.start) / 60) * HOUR_WIDTH,
                          width: Math.max(((booking.endMinute - booking.startMinute) / 60) * HOUR_WIDTH, 52),
                          top: 6,
                          bottom: 6,
                          justifyContent: "flex-start",
                          overflow: "hidden",
                          textAlign: "left",
                          padding: "4px 8px",
                        }}
                      >
                        <span style={{ display: "block", lineHeight: 1.25 }}>
                          <span className="t-caption num">{hhmm(booking.startMinute)}</span>
                          <br />
                          {booking.customerName}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="card-ui" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2 className="t-h2">รายการทั้งหมดของวันนี้</h2>
        </div>
        {bookings.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>ยังไม่มีคิวของวันนี้</p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>เวลา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ลูกค้า</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>โปรแกรม</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>พนักงาน / ห้อง</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="num" style={{ padding: "12px 24px" }}>
                      {hhmm(booking.startMinute)}–{hhmm(booking.endMinute)}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setDetail(booking)
                          setCheckInRoom(booking.tableId ?? "")
                        }}
                      >
                        {booking.customerName}
                      </button>
                      {booking.customerPhone ? <span className="t-caption num"> · {booking.customerPhone}</span> : null}
                    </td>
                    <td style={{ padding: "12px" }}>
                      {booking.menuItemName} <span className="t-caption num">({booking.durationMinutes} นาที)</span>
                    </td>
                    <td className="t-caption" style={{ padding: "12px" }}>
                      {booking.therapistLabel}
                      {booking.tableCode ? ` · ห้อง ${booking.tableCode}` : " · ยังไม่เลือกห้อง"}
                    </td>
                    <td style={{ padding: "12px 24px" }}>
                      <span className={`chip ${STATUS_CHIP[booking.status]}`}>
                        <span className="dot" />
                        {STATUS_LABEL[booking.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ฟอร์มจอง / แก้ไข */}
      <Dialog open={formOpen} onOpenChange={(next) => !pending && setFormOpen(next)}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{draft.id ? "แก้ไขการจอง" : "จองคิวใหม่"}</DialogTitle>
              <DialogDescription>
                วันที่ {dayKey} — ระบบจะปฏิเสธถ้าคิวชนกับของเดิมของพนักงานหรือห้องเดียวกัน
              </DialogDescription>
            </DialogHeader>

            <div className="field-grid">
              <label className="field">
                <span>ชื่อลูกค้า</span>
                <input
                  className="input"
                  value={draft.customerName}
                  onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))}
                  required
                  maxLength={80}
                />
                {fieldErrors.customerName ? <span className="field-hint error">{fieldErrors.customerName}</span> : null}
              </label>

              <label className="field">
                <span>เบอร์โทร (ไม่บังคับ)</span>
                <input
                  className="input num"
                  value={draft.customerPhone}
                  onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
                  maxLength={20}
                  inputMode="tel"
                />
                {fieldErrors.customerPhone ? <span className="field-hint error">{fieldErrors.customerPhone}</span> : null}
              </label>

              <label className="field">
                <span>โปรแกรมนวด</span>
                <select
                  className="select"
                  value={draft.menuItemId}
                  onChange={(e) => setDraft((d) => ({ ...d, menuItemId: e.target.value, therapistId: "", tableId: "" }))}
                  required
                >
                  <option value="">— เลือกโปรแกรม —</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name} ({program.durationMinutes} นาที)
                    </option>
                  ))}
                </select>
                {fieldErrors.menuItemId ? <span className="field-hint error">{fieldErrors.menuItemId}</span> : null}
              </label>

              <label className="field">
                <span>เวลาเริ่ม</span>
                <input
                  type="time"
                  className="input num"
                  value={draft.startTime}
                  onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
                  required
                />
                {fieldErrors.startTime ? <span className="field-hint error">{fieldErrors.startTime}</span> : null}
              </label>

              <label className="field">
                <span>พนักงานนวด</span>
                <select
                  className="select"
                  value={draft.therapistId}
                  onChange={(e) => setDraft((d) => ({ ...d, therapistId: e.target.value }))}
                  required
                >
                  <option value="">— เลือกพนักงาน —</option>
                  {therapistChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {t.clash ? " (คิวชน)" : t.offDuty ? " (นอกกะ)" : ""}
                    </option>
                  ))}
                </select>
                {fieldErrors.therapistId ? <span className="field-hint error">{fieldErrors.therapistId}</span> : null}
              </label>

              <label className="field">
                <span>ห้องนวด (เลือกทีหลังตอนเช็กอินได้)</span>
                <select className="select" value={draft.tableId} onChange={(e) => setDraft((d) => ({ ...d, tableId: e.target.value }))}>
                  <option value="">— ยังไม่ระบุห้อง —</option>
                  {roomChoices.map((room) => (
                    <option key={room.id} value={room.id}>
                      ห้อง {room.code}
                    </option>
                  ))}
                </select>
                {fieldErrors.tableId ? <span className="field-hint error">{fieldErrors.tableId}</span> : null}
              </label>

              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>หมายเหตุ</span>
                <input
                  className="input"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  maxLength={300}
                  placeholder="เช่น ขอผู้หญิง / แพ้น้ำมันบางชนิด"
                />
              </label>
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)} disabled={pending}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
                บันทึกการจอง
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* รายละเอียดคิว + เช็กอิน */}
      <Dialog open={detail !== null} onOpenChange={(next) => !pending && !next && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail ? `${detail.customerName} · ${hhmm(detail.startMinute)}–${hhmm(detail.endMinute)} น.` : ""}</DialogTitle>
            <DialogDescription>
              {detail ? `${detail.menuItemName} (${detail.durationMinutes} นาที) · ${detail.therapistLabel}` : ""}
            </DialogDescription>
          </DialogHeader>

          {detail ? (
            <div className="field-grid">
              {detail.note ? (
                <p className="t-body" style={{ gridColumn: "1 / -1" }}>
                  หมายเหตุ: {detail.note}
                </p>
              ) : null}

              {detail.status === "BOOKED" ? (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>ห้องที่จะเข้า</span>
                  <select className="select" value={checkInRoom} onChange={(e) => setCheckInRoom(e.target.value)}>
                    <option value="">— เลือกห้อง —</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        ห้อง {room.code}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">เช็กอินแล้วระบบจะเปิดห้องและส่งรายการบริการเข้าบิลให้อัตโนมัติ</span>
                </label>
              ) : (
                <p className="t-body" style={{ gridColumn: "1 / -1" }}>
                  สถานะปัจจุบัน: {STATUS_LABEL[detail.status]}
                  {detail.tableCode ? ` · ห้อง ${detail.tableCode}` : ""}
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            {detail && detail.status === "BOOKED" && allowed.includes("EDIT") ? (
              <button type="button" className="btn btn-ghost" onClick={() => startEdit(detail)} disabled={pending}>
                แก้ไข
              </button>
            ) : null}
            {detail && LIVE_STATUS.includes(detail.status) && allowed.includes("DELETE") ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => close(detail, "NO_SHOW")} disabled={pending}>
                  ไม่มาตามนัด
                </button>
                <button type="button" className="btn btn-danger" onClick={() => close(detail, "CANCELLED")} disabled={pending}>
                  ยกเลิกคิว
                </button>
              </>
            ) : null}
            {detail && detail.status === "BOOKED" && allowed.includes("ADD") ? (
              <button type="button" className="btn btn-primary" onClick={submitCheckIn} disabled={pending || !checkInRoom}>
                {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
                เช็กอิน
              </button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function toMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}
