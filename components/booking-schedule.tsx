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
/// คิวที่วาดบนไทม์ไลน์ — คิวที่เสร็จแล้วยังโชว์แบบจาง ให้เห็นว่าวันนั้นใครทำไปแล้วบ้าง (20e) · ยกเลิก/ไม่มาไม่วาด
const TIMELINE_STATUS: BookingRow["status"][] = [...LIVE_STATUS, "DONE"]

/// สีแท่งคิวบนไทม์ไลน์ (20e) — คู่กับ STATUS_CHIP ด้านบน สีเดียวกันทั้งแท่งและ chip
const STATUS_BAR: Partial<Record<BookingRow["status"], string>> = {
  BOOKED: "is-booked",
  CHECKED_IN: "is-checked-in",
  IN_SERVICE: "is-in-service",
  DONE: "is-done",
}

/// ความละเอียดของช่องจองบนไทม์ไลน์ — ครึ่งชั่วโมง ตรงกับขีดจางที่วาดไว้ (20e)
const SLOT_MINUTES = 30

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
  nowMinute = null,
  allowed = FULL_ACCESS,
}: {
  dayKey: string
  programs: BookingProgram[]
  rooms: BookingRoom[]
  therapists: TherapistOption[]
  shifts: ShiftRow[]
  bookings: BookingRow[]
  bufferMinutes: number
  /// นาทีปัจจุบันตามเวลาไทย เฉพาะเมื่อดูตารางของวันนี้ (null = วันอื่น ไม่วาดเส้น "ตอนนี้")
  nowMinute?: number | null
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
  const onTimeline = useMemo(() => bookings.filter((b) => TIMELINE_STATUS.includes(b.status)), [bookings])

  // ขอบเขตเวลาบนตาราง — ครอบทั้งกะและคิวที่มีจริง เผื่อคิวที่จองไว้นอกกะ (จากตอนที่ยังไม่ได้ตั้งกะ)
  const range = useMemo(() => {
    const starts = [DEFAULT_START, ...shifts.filter((s) => !s.isOff).map((s) => s.startMinute), ...onTimeline.map((b) => b.startMinute)]
    const ends = [DEFAULT_END, ...shifts.filter((s) => !s.isOff).map((s) => s.endMinute), ...onTimeline.map((b) => b.endMinute)]
    const start = Math.floor(Math.min(...starts) / 60) * 60
    const end = Math.ceil(Math.max(...ends) / 60) * 60
    return { start, end, width: ((end - start) / 60) * HOUR_WIDTH }
  }, [shifts, onTimeline])

  /// ช่องจองทุกครึ่งชั่วโมง (ไม่รวมขอบขวาสุด) — ใช้ทั้งปุ่มจองและขีดแนวตั้ง
  const slots = useMemo(() => {
    const list: number[] = []
    for (let minute = range.start; minute < range.end; minute += SLOT_MINUTES) list.push(minute)
    return list
  }, [range])

  const xOf = (minute: number) => ((minute - range.start) / 60) * HOUR_WIDTH
  const nowX = nowMinute !== null && nowMinute >= range.start && nowMinute <= range.end ? xOf(nowMinute) : null

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
        // ไม่มีกะ / วันหยุด = จองไม่ได้แน่นอน (2026-09-24) — ปิดตัวเลือกไว้เลย ไม่ต้องรอ server ปฏิเสธ
        const noShift = shift === undefined
        const dayOff = shift?.isOff === true
        const offDuty =
          startMinute !== null &&
          duration > 0 &&
          shift !== undefined &&
          !shift.isOff &&
          (startMinute < shift.startMinute || startMinute + duration > shift.endMinute)
        return { ...t, clash, offDuty, noShift, dayOff }
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

  /// ข้อความเมื่อเอาเมาส์วางบนแท่งคิว (20f) — ครบในกล่องเดียว รวมเวลาสิ้นสุด
  function bookingHint(booking: BookingRow): string {
    return [
      `${booking.customerName} · ${booking.menuItemName}`,
      `${hhmm(booking.startMinute)}–${hhmm(booking.endMinute)} น. (${booking.durationMinutes} นาที)`,
      `${booking.therapistLabel}${booking.tableCode ? ` · ห้อง ${booking.tableCode}` : " · ยังไม่เลือกห้อง"}`,
      `สถานะ: ${STATUS_LABEL[booking.status]}`,
    ].join("\n")
  }

  /// ข้อความเมื่อเอาเมาส์วางบนช่องว่าง (20f) — จองได้กี่โมง และว่างต่อเนื่องถึงกี่โมง
  /// ว่างถึง = คิวถัดไปของคนนี้ลบพักระหว่างคิว หรือหมดกะ แล้วแต่อะไรถึงก่อน · คำนวณแบบเดียวกับที่ server ตรวจ (ช่วยดูเท่านั้น)
  function slotHint(therapistId: string, minute: number): string {
    const shift = shiftByTherapist.get(therapistId)
    if (!shift) return "ยังไม่ลงกะ — จองไม่ได้"
    if (shift.isOff) return "วันหยุด — จองไม่ได้"
    if (minute < shift.startMinute || minute >= shift.endMinute) {
      return `นอกเวลากะ (${hhmm(shift.startMinute)}–${hhmm(shift.endMinute)} น.)`
    }
    const mine = live.filter((b) => b.therapistId === therapistId)
    const blocking = mine.find((b) => b.startMinute - bufferMinutes < minute + 1 && b.endMinute + bufferMinutes > minute)
    if (blocking) {
      return `ไม่ว่าง — มีคิว ${hhmm(blocking.startMinute)}–${hhmm(blocking.endMinute)} น. (${blocking.customerName})`
    }
    const next = mine.filter((b) => b.startMinute > minute).sort((a, b) => a.startMinute - b.startMinute)[0]
    const freeUntil = Math.min(shift.endMinute, next ? next.startMinute - bufferMinutes : shift.endMinute)
    const reason = next && next.startMinute - bufferMinutes < shift.endMinute ? `คิวถัดไป ${hhmm(next.startMinute)} น.` : "หมดกะ"
    return `จองได้ ${hhmm(minute)} น.\nว่างถึง ${hhmm(freeUntil)} น. (${freeUntil - minute} นาที · ${reason})`
  }

  /// กดช่องว่างบนไทม์ไลน์ — แถวที่ไม่มีกะ/หยุด บอกเหตุผลพร้อมทางไปตั้งกะ แทนการเปิดฟอร์มที่ยังไงก็บันทึกไม่ผ่าน
  function startCreateAt(therapist: TherapistOption, startMinute: number) {
    const shift = shiftByTherapist.get(therapist.id)
    if (!shift || shift.isOff) {
      toast.error(shift ? `${therapist.label} หยุดวันที่ ${dayKey}` : `${therapist.label} ยังไม่ได้ลงกะวันที่ ${dayKey}`, {
        description: "ตั้งกะก่อนจึงจะจองคิวได้",
        action: { label: "ไปตารางกะ", onClick: () => router.push("/spa/shifts") },
      })
      return
    }
    startCreate(therapist.id, startMinute)
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

        {/* คำอธิบายสี — ดูสถานะคิวได้จากสีโดยไม่ต้องกดเข้าไป (20e) */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap", padding: "0 24px 12px" }}>
          {(Object.keys(STATUS_BAR) as BookingRow["status"][]).map((status) => (
            <span key={status} className="booking-legend t-caption">
              <span className={`swatch booking-bar ${STATUS_BAR[status]}`} aria-hidden />
              {STATUS_LABEL[status]}
            </span>
          ))}
          {nowMinute !== null ? (
            <span className="booking-legend t-caption">
              <span className="swatch" style={{ borderLeftColor: "var(--danger)" }} aria-hidden />
              เวลาปัจจุบัน
            </span>
          ) : null}
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: range.width + 160 }}>
            {/* แถบเวลา */}
            <div className="row" style={{ gap: 0, borderBottom: "1px solid var(--line)" }}>
              <div style={{ width: 160, flex: "none", padding: "8px 12px" }} className="t-caption">
                พนักงาน
              </div>
              <div style={{ position: "relative", height: 36, width: range.width }}>
                {/* ขีดเต็มชั่วโมง (ตัวเลขเข้ม) + ขีดครึ่งชั่วโมง (เส้นประ ":30" จาง) — 20e */}
                {slots.map((minute) =>
                  minute % 60 === 0 ? (
                    <span key={minute}>
                      <span className="timeline-tick" style={{ left: xOf(minute), top: 20 }} aria-hidden />
                      <span
                        className="t-caption num"
                        style={{ position: "absolute", left: xOf(minute) + 4, top: 4, fontWeight: 600, color: "var(--ink-2)" }}
                      >
                        {hhmm(minute)}
                      </span>
                    </span>
                  ) : (
                    <span key={minute}>
                      <span className="timeline-tick is-half" style={{ left: xOf(minute), top: 24 }} aria-hidden />
                      <span className="t-caption num" style={{ position: "absolute", left: xOf(minute) + 3, top: 6, opacity: 0.6 }}>
                        :30
                      </span>
                    </span>
                  ),
                )}
                {nowX !== null ? <span className="timeline-now" style={{ left: nowX }} aria-hidden /> : null}
              </div>
            </div>

            {therapists.map((therapist) => {
              const shift = shiftByTherapist.get(therapist.id)
              const rows = onTimeline.filter((b) => b.therapistId === therapist.id)
              // ไม่มีกะ/หยุด = จองไม่ได้ (2026-09-24) — ทำแถวจางให้เห็นก่อนกด
              const unavailable = !shift || shift.isOff
              return (
                <div
                  key={therapist.id}
                  className="row"
                  style={{ gap: 0, borderTop: "1px solid var(--line)", alignItems: "stretch", background: unavailable ? "var(--surface-2)" : undefined }}
                >
                  <div style={{ width: 160, flex: "none", padding: "10px 12px" }}>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {therapist.code}
                    </span>{" "}
                    {therapist.label.replace(`${therapist.code} `, "")}
                    <br />
                    {shift && !shift.isOff ? (
                      <span className="t-caption num">{`${hhmm(shift.startMinute)}–${hhmm(shift.endMinute)}`}</span>
                    ) : (
                      <span className="t-caption" style={{ color: "var(--danger)", fontWeight: 600 }}>
                        {shift ? "หยุด · จองไม่ได้" : "ยังไม่ลงกะ · จองไม่ได้"}
                      </span>
                    )}
                  </div>

                  <div style={{ position: "relative", width: range.width, minHeight: 56 }}>
                    {/* พื้นหลังกะ — ช่วงที่อยู่เวรจะสว่างกว่านอกเวลา */}
                    {shift && !shift.isOff ? (
                      <div
                        aria-hidden
                        style={{
                          position: "absolute",
                          left: xOf(shift.startMinute),
                          width: ((shift.endMinute - shift.startMinute) / 60) * HOUR_WIDTH,
                          top: 0,
                          bottom: 0,
                          background: "var(--surface-2)",
                        }}
                      />
                    ) : null}

                    {/* ขีดชั่วโมง/ครึ่งชั่วโมงลากลงทุกแถว (20e) */}
                    {slots.map((minute) => (
                      <span key={minute} className={`timeline-tick${minute % 60 === 0 ? "" : " is-half"}`} style={{ left: xOf(minute) }} aria-hidden />
                    ))}
                    {nowX !== null ? <span className="timeline-now" style={{ left: nowX }} aria-hidden /> : null}

                    {/* ปุ่มจองทุกครึ่งชั่วโมง — กดแล้วเปิดฟอร์มพร้อมเวลานั้น */}
                    {allowed.includes("ADD") && programs.length > 0
                      ? slots.map((minute) => (
                          <button
                            key={minute}
                            type="button"
                            className="btn btn-ghost"
                            title={slotHint(therapist.id, minute)}
                            onClick={() => startCreateAt(therapist, minute)}
                            style={{
                              position: "absolute",
                              left: xOf(minute),
                              width: (SLOT_MINUTES / 60) * HOUR_WIDTH,
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
                        className={`booking-bar ${STATUS_BAR[booking.status] ?? ""}`}
                        // เอาเมาส์วางแล้วเห็นครบ รวมเวลาสิ้นสุด (20f — เจ้าของสั่ง)
                        title={bookingHint(booking)}
                        onClick={() => {
                          setDetail(booking)
                          setCheckInRoom(booking.tableId ?? "")
                        }}
                        style={{
                          position: "absolute",
                          left: xOf(booking.startMinute),
                          width: Math.max(((booking.endMinute - booking.startMinute) / 60) * HOUR_WIDTH, 52),
                          top: 6,
                          bottom: 6,
                          overflow: "hidden",
                          textAlign: "left",
                          padding: "3px 8px",
                          zIndex: 1,
                        }}
                      >
                        <span style={{ display: "block", lineHeight: 1.25, whiteSpace: "nowrap" }}>
                          <span className="num" style={{ fontWeight: 600 }}>
                            {hhmm(booking.startMinute)}
                          </span>
                          <span className="t-caption"> · {STATUS_LABEL[booking.status]}</span>
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
                {fieldErrors.startTime ? (
                  <span className="field-hint error">{fieldErrors.startTime}</span>
                ) : bufferMinutes > 0 ? (
                  // บอกตรงที่กรอกเวลาเลย — เจ้าของร้านเคยลองต่อคิวที่ 17:31 แล้วไม่ผ่านโดยไม่รู้ว่ามีพัก (2026-09-23)
                  <span className="field-hint">
                    กรอกได้ทุกนาที · ต้องเว้นพักระหว่างคิว {bufferMinutes} นาที (ตั้งค่าได้ที่ตั้งค่าร้าน)
                  </span>
                ) : null}
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
                    <option key={t.id} value={t.id} disabled={t.noShift || t.dayOff}>
                      {t.label}
                      {t.noShift ? " (ยังไม่ลงกะ)" : t.dayOff ? " (หยุด)" : t.clash ? " (คิวชน)" : t.offDuty ? " (นอกกะ)" : ""}
                    </option>
                  ))}
                </select>
                {fieldErrors.therapistId ? (
                  <span className="field-hint error">{fieldErrors.therapistId}</span>
                ) : therapistChoices.length > 0 && therapistChoices.every((t) => t.noShift || t.dayOff) ? (
                  <span className="field-hint error">วันนี้ยังไม่มีพนักงานที่ลงกะ — ตั้งกะที่หน้า “ตารางกะ” ก่อน</span>
                ) : null}
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
