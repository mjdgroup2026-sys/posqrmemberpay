// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { SpaBoard } from "@/components/spa-board"
import type { BookingRow, RoomBoardRow, TherapistBoardRow } from "@/lib/queries"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const finishBookingService = vi.fn(async (fd: FormData) => ({ ok: Boolean(fd.get("id")), message: "ok" }))
vi.mock("@/app/actions/bookings", () => ({
  checkInBooking: vi.fn(async () => ({ ok: true })),
  startBookingService: vi.fn(async () => ({ ok: true })),
  finishBookingService: (fd: FormData) => finishBookingService(fd),
}))

afterEach(cleanup)

/// กระดานห้องนวดแบบการ์ด (2026-10-08) — สีตามสถานะ · เวลาเหลือ/เกิน · คิวถัดไป · ปุ่มตามสิทธิ์
const NOW = new Date("2026-10-08T06:30:00.000Z") // 13:30 เวลาไทย
const at = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00+07:00`)
const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

function booking(id: string, name: string, start: string, end: string, status: BookingRow["status"], tableCode = "3/1"): BookingRow {
  return {
    id,
    customerName: name,
    customerPhone: null,
    menuItemId: "m1",
    menuItemName: "นวดไทย 60",
    durationMinutes: 60,
    therapistId: "t1",
    therapistLabel: "001 นิด",
    tableId: "r1",
    tableCode,
    startAt: at(start),
    endAt: at(end),
    startMinute: minute(start),
    endMinute: minute(end),
    status,
    note: null,
    tableSessionId: status === "BOOKED" ? null : "s1",
    billOpen: status !== "BOOKED",
  }
}

function room(id: string, code: string, patch: Partial<RoomBoardRow>): RoomBoardRow {
  return {
    id,
    code,
    state: "FREE",
    customerName: null,
    therapistLabel: null,
    until: null,
    overrun: false,
    awaitingPayment: false,
    staleSince: null,
    nextBookingAt: null,
    nextBookingCustomer: null,
    bookings: [],
    current: null,
    billSessionId: null,
    ...patch,
  }
}

const active = booking("b1", "สมหญิง", "13:00", "14:00", "IN_SERVICE")
const late = booking("b2", "คุณเกิน", "12:00", "13:00", "IN_SERVICE", "3/2")
const next = [booking("b3", "คุณซี", "14:10", "15:10", "BOOKED"), booking("b4", "คุณดี", "15:30", "16:30", "BOOKED"), booking("b5", "คุณอี", "17:00", "18:00", "BOOKED"), booking("b6", "คุณเอฟ", "18:30", "19:30", "BOOKED")]

const rooms: RoomBoardRow[] = [
  room("r1", "3/1", { state: "IN_SERVICE", customerName: "สมหญิง", therapistLabel: "001 นิด", until: active.endAt, current: active, billSessionId: "s1", bookings: [active, ...next] }),
  room("r2", "3/2", { state: "IN_SERVICE", customerName: "คุณเกิน", therapistLabel: "001 นิด", until: late.endAt, overrun: true, current: late, billSessionId: "s2", bookings: [late] }),
  room("r3", "3/3", { state: "FREE", nextBookingAt: at("15:00") }),
]
const therapists: TherapistBoardRow[] = []

function renderBoard(extra: Partial<Parameters<typeof SpaBoard>[0]> = {}) {
  return render(
    <SpaBoard dayKey="2026-10-08" live nowMs={NOW.getTime()} rooms={rooms} therapists={therapists} unassigned={[]} canBill {...extra} />,
  )
}

describe("SpaBoard — กระดานห้องนวดแบบการ์ด", () => {
  it("แต่ละการ์ดได้สีตามสถานะของตัวเอง (กำลังนวด / เกินเวลา / ว่าง แยกคนละโทน)", () => {
    renderBoard()
    expect(screen.getByRole("article", { name: /ห้อง 3\/1 กำลังนวด/ })).toHaveClass("tone-active")
    expect(screen.getByRole("article", { name: /ห้อง 3\/2 เกินเวลา/ })).toHaveClass("tone-late")
    expect(screen.getByRole("article", { name: /ห้อง 3\/3 ว่าง/ })).toHaveClass("tone-free")
  })

  it("แถบความคืบหน้าบอกเวลาเหลือ / เกิน · ห้องว่างบอกว่าว่างถึงกี่โมง", () => {
    renderBoard()
    const busy = screen.getByRole("article", { name: /ห้อง 3\/1/ })
    expect(within(busy).getByText("เหลือ 30 นาที")).toBeInTheDocument()
    expect(within(busy).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50")
    expect(within(screen.getByRole("article", { name: /ห้อง 3\/2/ })).getByText("เกิน 30 นาที")).toBeInTheDocument()
    expect(within(screen.getByRole("article", { name: /ห้อง 3\/3/ })).getByText("ว่างถึง 15:00 น.")).toBeInTheDocument()
  })

  it("คิวถัดไปโชว์ 3 คิวแรก ที่เหลือเป็นลิงก์ \"+ อีก n คิว\"", () => {
    renderBoard()
    const busy = screen.getByRole("article", { name: /ห้อง 3\/1/ })
    expect(within(busy).getByText(/คุณซี/)).toBeInTheDocument()
    expect(within(busy).getByText(/คุณอี/)).toBeInTheDocument()
    expect(within(busy).queryByText(/คุณเอฟ/)).toBeNull()
    expect(within(busy).getByText(/\+ อีก 1 คิว/)).toBeInTheDocument()
  })

  it("ปุ่มบนการ์ด: เสร็จแล้ว + ปิดบิล · ไม่มีสิทธิ์แก้/ปิดบิล = ไม่มีปุ่ม", () => {
    renderBoard()
    const busy = screen.getByRole("article", { name: /ห้อง 3\/1/ })
    fireEvent.click(within(busy).getByRole("button", { name: "เสร็จแล้ว" }))
    expect(finishBookingService).toHaveBeenCalled()
    expect(within(busy).getByRole("link", { name: /ปิดบิล/ })).toHaveAttribute("href", "/mobile-order/tables/r1/billing?session=s1&back=board")

    cleanup()
    renderBoard({ allowed: ["VIEW"], canBill: false })
    const viewOnly = screen.getByRole("article", { name: /ห้อง 3\/1/ })
    expect(within(viewOnly).queryByRole("button", { name: "เสร็จแล้ว" })).toBeNull()
    expect(within(viewOnly).queryByRole("link", { name: /ปิดบิล/ })).toBeNull()
  })

  it("กด chip สถานะแล้วกรองการ์ดเหลือเฉพาะสถานะนั้น", () => {
    renderBoard()
    fireEvent.click(screen.getByRole("button", { name: /เกินเวลา/ }))
    expect(screen.getAllByRole("article")).toHaveLength(1)
    expect(screen.getByRole("article", { name: /ห้อง 3\/2/ })).toBeInTheDocument()
  })
})
