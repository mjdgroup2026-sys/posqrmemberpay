"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { checkInBooking, finishBookingService, startBookingService } from "@/app/actions/bookings"
import type { BookingRow, RoomBoardRow, TherapistBoardRow } from "@/lib/queries"
import { formatHhMm, minuteOfBusinessDay } from "@/lib/day"
import { BOARD_TONE_CHIP, BOOKING_STATUS_CHIP, BOOKING_STATUS_LABEL, type BoardTone } from "@/lib/booking-status"
import { FULL_ACCESS, type AllowedActions } from "@/lib/types"
import { IconPrinter, IconReceipt, IconRoom, IconTherapist } from "@/components/icons"

/// กระดานห้องนวดแบบการ์ด (2026-10-08 เจ้าของสั่ง "อันเดิมดูธรรมดา มองภาพยาก")
///
/// การ์ดต่อห้อง (หรือต่อพนักงาน) · แถบสีซ้ายตามสถานะ (สีชุด `--q-*` แยกกันชัด ๆ) · แถบความคืบหน้าที่เดินเองทุก 30 วิ ·
/// คิวถัดไปเรียงเวลา · ปุ่มทำงานบนการ์ด (คำสั่งชุดเดียวกับตารางจอง — server ตรวจสิทธิ์/สถานะซ้ำ) · ไทม์ไลน์ย่อทั้งวันใต้การ์ด
/// · สถานะ "ตอนนี้" มาจาก `getSpaBoard()` (ตรงกับตารางจอง) — ที่นี่แค่จัดหน้าตา ไม่ตัดสินสถานะเอง
/// · เวลาไทยคำนวณจาก Date ด้วย lib/day (ไม่พึ่ง TZ ของเครื่อง) · "ตอนนี้" เริ่มจากค่าของ server กัน hydration ไม่ตรง

type View = "rooms" | "therapists"

const VIEW_KEY = "spa-board-view"
const TICK_MS = 30_000
const QUEUE_PREVIEW = 3
const DEFAULT_START = 9 * 60
const DEFAULT_END = 21 * 60

/// ป้าย + โทนของแต่ละสถานะการ์ด — ลำดับนี้คือลำดับ chip กรองบนหัวหน้า
const TONE_LABEL: Record<BoardTone, string> = {
  active: "กำลังนวด",
  late: "เกินเวลา",
  checkin: "รอเริ่มนวด",
  due: "รอลูกค้า",
  billing: "รอปิดบิล",
  booked: "มีคิว",
  free: "ว่าง",
  done: "เสร็จแล้ว",
  off: "ไม่อยู่กะ",
}
const TONE_ORDER: BoardTone[] = ["active", "late", "checkin", "due", "billing", "free", "booked", "off"]

type CardView = {
  key: string
  title: string
  tone: BoardTone
  stateText: string
  /// คิวที่การ์ดโฟกัส — ใช้วาดเวลา/ความคืบหน้า/ปุ่ม · null = ไม่มีคิว (ว่าง หรือ walk-in)
  current: BookingRow | null
  customer: string | null
  detail: string | null
  /// ข้อความรองใต้รายละเอียด (ว่างถึงกี่โมง · บิลค้าง · กะ)
  hint: string | null
  progress: boolean
  overrun: boolean
  upcoming: BookingRow[]
  doneCount: number
  /// ห้องที่ใช้กับปุ่มเช็กอิน/ปิดบิล (มุมมองตามพนักงานเอาจากคิว)
  roomId: string | null
  billSessionId: string | null
  /// ห้องที่มีงานแต่ไม่มีคิวจอง (walk-in) — ลิงก์ไปหน้าห้องแทนปุ่ม
  walkInRoomId: string | null
}

function noopSubscribe(): () => void {
  return () => {}
}

/// มุมมองที่จำไว้ (ค่าช่วยใช้งาน — localStorage อ่านไม่ได้ก็ใช้ค่าเริ่มต้น)
function readStoredView(): View | null {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY)
    return saved === "rooms" || saved === "therapists" ? saved : null
  } catch {
    return null
  }
}

function clock(date: Date | null | undefined): string {
  return date ? formatHhMm(minuteOfBusinessDay(date)) : "—"
}

function minutesBetween(from: number, to: number): number {
  return Math.round((to - from) / 60_000)
}

function queueOf(rows: BookingRow[], current: BookingRow | null): BookingRow[] {
  return rows.filter((row) => row.id !== current?.id && (row.status === "BOOKED" || row.status === "CHECKED_IN"))
}

function roomCard(room: RoomBoardRow, live: boolean): CardView {
  const current = room.current
  const base = {
    key: room.id,
    title: `ห้อง ${room.code}`,
    current,
    upcoming: queueOf(room.bookings, current),
    doneCount: room.bookings.filter((row) => row.status === "DONE").length,
    roomId: room.id,
    billSessionId: room.billSessionId,
    walkInRoomId: null as string | null,
    progress: false,
    overrun: room.overrun,
  }
  if (!live) {
    const count = room.bookings.length
    return { ...base, tone: count > 0 ? "booked" : "free", stateText: count > 0 ? `${count} คิว` : "ไม่มีคิว", customer: null, detail: null, hint: null }
  }
  const who = [room.therapistLabel, current?.menuItemName].filter(Boolean).join(" · ") || null
  switch (room.state) {
    case "IN_SERVICE":
      return {
        ...base,
        tone: room.overrun ? "late" : "active",
        stateText: room.overrun ? "เกินเวลา" : "กำลังนวด",
        customer: room.customerName,
        detail: who,
        hint: current ? null : "ลูกค้า walk-in — ไม่มีเวลาจบที่จองไว้",
        progress: current !== null,
        walkInRoomId: current ? null : room.id,
      }
    case "WAITING":
      return { ...base, tone: "checkin", stateText: "รอเริ่มนวด", customer: room.customerName, detail: who, hint: null }
    case "AWAITING_GUEST":
      return { ...base, tone: "due", stateText: "ถึงเวลา รอลูกค้า", customer: room.customerName, detail: who, hint: null }
    case "OCCUPIED":
      return {
        ...base,
        tone: room.staleSince ? "late" : "billing",
        stateText: room.staleSince ? "บิลค้าง" : room.awaitingPayment ? "รอปิดบิล" : "มีบิลเปิดอยู่",
        customer: room.customerName ?? "ลูกค้า walk-in",
        detail: room.therapistLabel,
        hint: room.staleSince ? `เปิดค้างตั้งแต่ ${room.staleSince.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })} — ปิดหรือยกเลิกบิล` : null,
        walkInRoomId: room.billSessionId ? null : room.id,
      }
    default:
      return {
        ...base,
        tone: "free",
        stateText: "ว่าง",
        customer: null,
        detail: null,
        hint: room.nextBookingAt ? `ว่างถึง ${clock(room.nextBookingAt)} น.` : "ว่างทั้งวัน",
      }
  }
}

function therapistCard(t: TherapistBoardRow, live: boolean): CardView {
  const current = t.current
  const shift = t.shiftStartMinute !== null && t.shiftEndMinute !== null ? `กะ ${formatHhMm(t.shiftStartMinute)}–${formatHhMm(t.shiftEndMinute)} น.` : null
  const base = {
    key: t.id,
    title: t.label,
    current,
    upcoming: queueOf(t.bookings, current),
    doneCount: t.bookings.filter((row) => row.status === "DONE").length,
    roomId: current?.tableId ?? null,
    billSessionId: current?.billOpen ? current.tableSessionId : null,
    walkInRoomId: null as string | null,
    progress: false,
    overrun: t.overrun,
  }
  const where = [t.programName, t.roomCode ? `ห้อง ${t.roomCode}` : null].filter(Boolean).join(" · ") || null
  if (t.state === "BUSY") {
    return {
      ...base,
      tone: t.overrun ? "late" : "active",
      stateText: t.overrun ? "เกินเวลา" : "กำลังนวด",
      customer: t.customerName,
      detail: where,
      hint: t.walkIn ? "ลูกค้า walk-in" : null,
      progress: current !== null && !t.walkIn,
    }
  }
  if (t.state === "WAITING") {
    return { ...base, tone: "checkin", stateText: "รอเริ่มนวด", customer: t.customerName, detail: where, hint: null }
  }
  const offText: Partial<Record<TherapistBoardRow["state"], string>> = {
    OFF: "หยุด",
    NO_SHIFT: "ยังไม่ตั้งกะ",
    BEFORE_SHIFT: "ยังไม่เข้ากะ",
    AFTER_SHIFT: "เลิกกะแล้ว",
  }
  if (offText[t.state]) {
    return { ...base, tone: "off", stateText: offText[t.state] ?? "", customer: null, detail: null, hint: shift }
  }
  if (!live) {
    return { ...base, tone: "booked", stateText: `${t.bookings.length} คิว`, customer: null, detail: null, hint: shift }
  }
  return {
    ...base,
    tone: "free",
    stateText: "ว่าง",
    customer: null,
    detail: null,
    hint: [t.nextBookingAt ? `ว่างถึง ${clock(t.nextBookingAt)} น.` : null, shift].filter(Boolean).join(" · ") || null,
  }
}

export function SpaBoard({
  dayKey,
  live,
  nowMs,
  rooms,
  therapists,
  unassigned,
  allowed = FULL_ACCESS,
  canBill = false,
}: {
  dayKey: string
  live: boolean
  /// เวลา server ตอน render — ใช้เป็นค่าตั้งต้นของนาฬิกาฝั่ง client
  nowMs: number
  rooms: RoomBoardRow[]
  therapists: TherapistBoardRow[]
  unassigned: BookingRow[]
  allowed?: AllowedActions
  canBill?: boolean
}) {
  const router = useRouter()
  // นาฬิกา: ค่าจาก server ตอน render (refresh แล้วได้ค่าใหม่) หรือค่าจาก interval แล้วแต่อันไหนใหม่กว่า
  const [clientNow, setClientNow] = useState(nowMs)
  const now = Math.max(nowMs, clientNow)
  // มุมมองที่จำไว้ต่อเครื่อง — อ่านผ่าน useSyncExternalStore (server = null) ไม่ให้ hydration ไม่ตรง
  const storedView = useSyncExternalStore(noopSubscribe, readStoredView, () => null)
  const [chosenView, setChosenView] = useState<View | null>(null)
  const view: View = chosenView ?? storedView ?? "rooms"
  const [filter, setFilter] = useState<BoardTone | null>(null)
  const [pending, setPending] = useState(false)

  // นาฬิกาเดินเอง — แถบความคืบหน้า/เหลือกี่นาทีขยับโดยไม่ต้องรีเฟรชหน้า
  useEffect(() => {
    const timer = window.setInterval(() => setClientNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  function changeView(next: View) {
    setChosenView(next)
    setFilter(null)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {}
  }

  const cards = useMemo(
    () => (view === "rooms" ? rooms.map((room) => roomCard(room, live)) : therapists.map((t) => therapistCard(t, live))),
    [view, rooms, therapists, live],
  )
  const counts = useMemo(() => {
    const map = new Map<BoardTone, number>()
    for (const card of cards) map.set(card.tone, (map.get(card.tone) ?? 0) + 1)
    return map
  }, [cards])
  const visible = filter ? cards.filter((card) => card.tone === filter) : cards

  async function run(label: string, action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setPending(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? `${label}ไม่สำเร็จ`)
        return
      }
      toast.success(result.message ?? "เรียบร้อยแล้ว")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ — ลองกด F5 แล้วทำใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }
  const form = (entries: Record<string, string>) => {
    const fd = new FormData()
    for (const [key, value] of Object.entries(entries)) fd.set(key, value)
    return fd
  }

  function actions(card: CardView) {
    const booking = card.current
    const buttons: React.ReactNode[] = []
    if (live && booking?.status === "BOOKED" && card.roomId && allowed.includes("ADD")) {
      const roomId = card.roomId
      buttons.push(
        <button key="in" type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run("เช็กอิน", () => checkInBooking(form({ id: booking.id, tableId: roomId })))}>
          เช็กอิน
        </button>,
      )
    }
    if (booking?.status === "CHECKED_IN" && allowed.includes("EDIT")) {
      buttons.push(
        <button key="start" type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run("เริ่มนวด", () => startBookingService(form({ id: booking.id })))}>
          เริ่มนวด
        </button>,
      )
    }
    if ((booking?.status === "IN_SERVICE" || booking?.status === "CHECKED_IN") && allowed.includes("EDIT")) {
      buttons.push(
        <button
          key="done"
          type="button"
          className={`btn btn-sm ${booking.status === "IN_SERVICE" ? "btn-primary" : "btn-ghost"}`}
          disabled={pending}
          onClick={() => run("ปิดคิว", () => finishBookingService(form({ id: booking.id })))}
        >
          เสร็จแล้ว
        </button>,
      )
    }
    const billRoom = card.roomId ?? booking?.tableId ?? null
    if (canBill && card.billSessionId && billRoom) {
      buttons.push(
        <Link
          key="bill"
          href={`/mobile-order/tables/${billRoom}/billing?session=${card.billSessionId}&back=board`}
          className={`btn btn-sm ${card.tone === "billing" ? "btn-primary" : "btn-subtle"}`}
        >
          <IconReceipt size={14} aria-hidden />
          ปิดบิล / ชำระเงิน
        </Link>,
      )
    }
    if (booking && ["CHECKED_IN", "IN_SERVICE", "DONE"].includes(booking.status)) {
      buttons.push(
        <button key="ticket" type="button" className="btn btn-ghost btn-sm" onClick={() => window.open(`/tickets/booking/${booking.id}?auto=1`, "_blank")}>
          <IconPrinter size={14} aria-hidden />
          ทิกเก็ต
        </button>,
      )
    }
    if (card.walkInRoomId) {
      buttons.push(
        <Link key="room" href={`/mobile-order/tables/${card.walkInRoomId}`} className="btn btn-subtle btn-sm">
          ดูห้อง
        </Link>,
      )
    }
    return buttons.length > 0 ? <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{buttons}</div> : null
  }

  function timing(card: CardView) {
    const booking = card.current
    if (!booking || !live) return null
    const start = booking.startAt.getTime()
    const end = booking.endAt.getTime()
    if (card.progress) {
      const pct = Math.min(100, Math.max(0, ((now - start) / Math.max(end - start, 1)) * 100))
      const left = minutesBetween(now, end)
      return (
        <>
          <div className="row t-caption num" style={{ justifyContent: "space-between" }}>
            <span>{clock(booking.startAt)}</span>
            <strong style={{ color: card.overrun ? "var(--danger)" : "var(--ink)" }}>
              {left >= 0 ? `เหลือ ${left} นาที` : `เกิน ${-left} นาที`}
            </strong>
            <span>{clock(booking.endAt)}</span>
          </div>
          <div className="board-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </>
      )
    }
    if (booking.status === "CHECKED_IN" || booking.status === "BOOKED") {
      const late = minutesBetween(start, now)
      return (
        <p className="t-caption num">
          นัด {clock(booking.startAt)}–{clock(booking.endAt)} น.
          {late > 0 ? <strong style={{ color: "var(--danger)" }}> · เลยนัดมา {late} นาที</strong> : ` · อีก ${-late} นาที`}
        </p>
      )
    }
    return <p className="t-caption num">{clock(booking.startAt)}–{clock(booking.endAt)} น.</p>
  }

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between", marginBottom: 16 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="กรองตามสถานะ">
          {TONE_ORDER.filter((tone) => counts.get(tone)).map((tone) => (
            <button
              key={tone}
              type="button"
              className={`chip board-filter ${BOARD_TONE_CHIP[tone]}`}
              aria-pressed={filter === tone}
              onClick={() => setFilter(filter === tone ? null : tone)}
            >
              <span className="dot" />
              {TONE_LABEL[tone]} <strong className="num">{counts.get(tone)}</strong>
            </button>
          ))}
          {filter ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(null)}>
              ดูทั้งหมด
            </button>
          ) : null}
        </div>
        <div className="row" style={{ gap: 6 }} role="group" aria-label="มุมมอง">
          <button type="button" className={`btn btn-sm ${view === "rooms" ? "btn-primary" : "btn-subtle"}`} onClick={() => changeView("rooms")}>
            <IconRoom size={15} aria-hidden />
            ตามห้อง
          </button>
          <button type="button" className={`btn btn-sm ${view === "therapists" ? "btn-primary" : "btn-subtle"}`} onClick={() => changeView("therapists")}>
            <IconTherapist size={15} aria-hidden />
            ตามพนักงาน
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <section className="card-ui card-pad">
          <p className="t-body">
            {view === "rooms"
              ? "ยังไม่มีห้องนวด — เพิ่มได้ที่หน้าจัดการโต๊ะ โดยเลือกชนิดเป็น “ห้องนวด”"
              : "ยังไม่มีพนักงานนวดที่เปิดใช้งาน"}
          </p>
        </section>
      ) : (
        <div className="board-grid">
          {visible.map((card) => (
            <article key={card.key} className={`board-card tone-${card.tone}`} aria-label={`${card.title} ${card.stateText}`}>
              <header className="board-card-head">
                <span className="board-card-title">{card.title}</span>
                <span className={`chip ${BOARD_TONE_CHIP[card.tone]}`}>
                  <span className="dot" />
                  {card.stateText}
                </span>
              </header>
              <div className="board-card-body">
                {card.customer ? <span className="board-card-customer">{card.customer}</span> : null}
                {card.detail ? <span className="t-small">{card.detail}</span> : null}
                {timing(card)}
                {card.hint ? <span className="t-caption">{card.hint}</span> : null}
                {live ? actions(card) : null}
              </div>
              <div className="board-queue">
                <span className="t-eyebrow">
                  {live ? "คิวถัดไป" : "คิวของวันนี้"}
                  {card.doneCount > 0 ? <span className="t-caption"> · เสร็จแล้ว {card.doneCount} คิว</span> : null}
                </span>
                {(live ? card.upcoming : view === "rooms" ? rooms.find((r) => r.id === card.key)?.bookings ?? [] : therapists.find((t) => t.id === card.key)?.bookings ?? [])
                  .slice(0, QUEUE_PREVIEW)
                  .map((row) => {
                    const overdue = live && row.status === "BOOKED" && row.startAt.getTime() <= now
                    return (
                      <div key={row.id} className="board-queue-row">
                        <span className="num" style={{ fontWeight: 600 }}>
                          {formatHhMm(row.startMinute)}
                        </span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.customerName} · {view === "rooms" ? row.therapistLabel : row.tableCode ? `ห้อง ${row.tableCode}` : "ยังไม่ระบุห้อง"}
                        </span>
                        <span className={`chip ${overdue ? "chip-q-late" : BOOKING_STATUS_CHIP[row.status]}`}>
                          <span className="dot" />
                          {overdue ? "เลยเวลา" : BOOKING_STATUS_LABEL[row.status]}
                        </span>
                      </div>
                    )
                  })}
                {(() => {
                  const list = live ? card.upcoming : (view === "rooms" ? rooms.find((r) => r.id === card.key)?.bookings : therapists.find((t) => t.id === card.key)?.bookings) ?? []
                  if (list.length === 0) return <span className="t-caption">ไม่มีคิว</span>
                  if (list.length > QUEUE_PREVIEW) {
                    return (
                      <Link href={`/spa/bookings?date=${dayKey}`} className="t-caption">
                        + อีก {list.length - QUEUE_PREVIEW} คิว — ดูในตารางจอง
                      </Link>
                    )
                  }
                  return null
                })()}
              </div>
            </article>
          ))}
        </div>
      )}

      {unassigned.length > 0 ? (
        <section className="card-ui" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <h2 className="t-h2">คิวที่ยังไม่ระบุห้อง</h2>
            <span className="t-caption">เลือกห้องตอนเช็กอินที่ตารางจอง</span>
          </div>
          <div style={{ padding: "0 24px 16px", display: "grid", gap: 6 }}>
            {unassigned.map((row) => (
              <div key={row.id} className="board-queue-row">
                <span className="num" style={{ fontWeight: 600 }}>
                  {formatHhMm(row.startMinute)}
                </span>
                <span>
                  {row.customerName} · {row.therapistLabel} · {row.menuItemName}
                </span>
                <span className={`chip ${BOOKING_STATUS_CHIP[row.status]}`}>
                  <span className="dot" />
                  {BOOKING_STATUS_LABEL[row.status]}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <BoardTimeline
        dayKey={dayKey}
        live={live}
        now={now}
        rows={
          view === "rooms"
            ? rooms.map((room) => ({ key: room.id, label: `ห้อง ${room.code}`, bookings: room.bookings }))
            : therapists.map((t) => ({ key: t.id, label: t.label, bookings: t.bookings }))
        }
      />
    </>
  )
}

const BAR_TONE: Record<BookingRow["status"], BoardTone> = {
  BOOKED: "booked",
  CHECKED_IN: "checkin",
  IN_SERVICE: "active",
  DONE: "done",
  CANCELLED: "off",
  NO_SHOW: "late",
}

/// ไทม์ไลน์ย่อทั้งวัน — แถวละห้อง/พนักงาน · ตำแหน่งเป็น % ของช่วงเวลา จึงยืดตามความกว้างจอ (มือถือเลื่อนแนวนอน)
function BoardTimeline({
  dayKey,
  live,
  now,
  rows,
}: {
  dayKey: string
  live: boolean
  now: number
  rows: { key: string; label: string; bookings: BookingRow[] }[]
}) {
  const all = rows.flatMap((row) => row.bookings)
  const start = Math.floor(Math.min(DEFAULT_START, ...all.map((b) => b.startMinute)) / 60) * 60
  const end = Math.ceil(Math.max(DEFAULT_END, ...all.map((b) => b.endMinute)) / 60) * 60
  const span = end - start
  const pct = (minute: number) => `${((minute - start) / span) * 100}%`
  const hours: number[] = []
  for (let minute = start; minute <= end; minute += 60) hours.push(minute)
  const nowMinute = live ? minuteOfBusinessDay(new Date(now)) : null

  if (rows.length === 0) return null
  return (
    <section className="card-ui" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h2 className="t-h2">ภาพรวมทั้งวัน</h2>
        <span className="row t-caption" style={{ gap: 10, flexWrap: "wrap" }}>
          {(["BOOKED", "CHECKED_IN", "IN_SERVICE", "DONE"] as const).map((status) => (
            <span key={status} className={`chip ${BOOKING_STATUS_CHIP[status]}`}>
              <span className="dot" />
              {BOOKING_STATUS_LABEL[status]}
            </span>
          ))}
        </span>
      </div>
      <div style={{ overflowX: "auto", padding: "0 16px 16px" }}>
        <div style={{ minWidth: 640 }}>
          <div className="board-timeline-row" style={{ borderTop: "none", minHeight: 24 }}>
            <span />
            <div className="board-timeline-track">
              {hours.map((minute) => (
                <span key={minute} className="t-caption num" style={{ position: "absolute", left: pct(minute), transform: "translateX(-50%)" }}>
                  {formatHhMm(minute).slice(0, 2)}
                </span>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.key} className="board-timeline-row">
              <span className="t-small" style={{ padding: "10px 8px 0 0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.label}
              </span>
              <div className="board-timeline-track">
                {hours.map((minute) => (
                  <span key={minute} className="timeline-tick" style={{ left: pct(minute) }} aria-hidden />
                ))}
                {nowMinute !== null && nowMinute >= start && nowMinute <= end ? (
                  <span className="timeline-now" style={{ left: pct(nowMinute) }} aria-hidden />
                ) : null}
                {row.bookings.map((b) => {
                  const overdue = live && b.status === "BOOKED" && b.startAt.getTime() <= now
                  return (
                    <Link
                      key={b.id}
                      href={`/spa/bookings?date=${dayKey}`}
                      className={`board-timeline-bar tone-${overdue ? "late" : BAR_TONE[b.status]}`}
                      style={{ left: pct(b.startMinute), width: `calc(${pct(b.endMinute)} - ${pct(b.startMinute)})` }}
                      title={`${b.customerName} · ${b.menuItemName}\n${formatHhMm(b.startMinute)}–${formatHhMm(b.endMinute)} น. · ${BOOKING_STATUS_LABEL[b.status]}`}
                    >
                      {b.customerName}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
