// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { BookingSchedule } from "@/components/booking-schedule"
import type { BookingRow } from "@/lib/queries"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/auto-refresh", () => ({ AutoRefresh: () => null }))
vi.mock("@/app/actions/bookings", () => ({
  saveBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markBookingNoShow: vi.fn(),
  checkInBooking: vi.fn(),
  startBookingService: vi.fn(async () => ({ ok: true })),
  finishBookingService: vi.fn(async () => ({ ok: true })),
}))

afterEach(() => {
  cleanup()
  push.mockClear()
})

/// หน้า "คิวนวด" (2026-10-08 รวมตารางจอง + กระดานห้องนวด) — แท็บ · รายการแบบกระชับ (ปุ่มขั้นถัดไปปุ่มเดียว + เมนู ⋯)
const DAY = "2026-10-08"
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+07:00`)
const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

function booking(id: string, name: string, start: string, status: BookingRow["status"], billOpen = false, createdAt = at("09:00")): BookingRow {
  const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}${start.slice(2)}`
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
    tableCode: "3/1",
    startAt: at(start),
    endAt: at(end),
    startMinute: minute(start),
    endMinute: minute(end),
    status,
    note: null,
    tableSessionId: status === "BOOKED" ? null : "s1",
    billOpen,
    createdAt,
    checkedInAt: status === "BOOKED" ? null : at("13:55"),
  }
}

const bookings = [
  booking("b4", "คุณเช็กอิน", "14:00", "CHECKED_IN", true),
  booking("b1", "คุณจอง", "15:00", "BOOKED"),
  booking("b2", "คุณนวด", "13:00", "IN_SERVICE", true),
  booking("b3", "คุณเสร็จ", "10:00", "DONE", true),
]

function renderQueue(props: Partial<Parameters<typeof BookingSchedule>[0]> = {}) {
  return render(
    <BookingSchedule
      dayKey={DAY}
      todayKey={DAY}
      tab="list"
      board={{ live: true, rooms: [], therapists: [], unassigned: [] }}
      nowMs={at("13:30").getTime()}
      programs={[{ id: "m1", name: "นวดไทย 60", durationMinutes: 60, price: 300, stationId: null }]}
      rooms={[{ id: "r1", code: "3/1", stationId: null }]}
      therapists={[]}
      shifts={[]}
      bookings={bookings}
      bufferMinutes={10}
      nowMinute={minute("13:30")}
      canBill
      {...props}
    />,
  )
}

function rowOf(name: string) {
  const row = screen.getByText(name).closest("tr")
  if (!row) throw new Error(`ไม่พบแถวของ ${name}`)
  return within(row)
}

describe("หน้า คิวนวด — แท็บรายการแบบกระชับ", () => {
  it("แต่ละแถวมีปุ่มขั้นถัดไปปุ่มเดียวตามสถานะ + ปุ่ม ⋯", () => {
    renderQueue()
    expect(rowOf("คุณจอง").getByRole("button", { name: "เช็กอิน" })).toBeInTheDocument()
    expect(rowOf("คุณนวด").getByRole("button", { name: "เสร็จแล้ว" })).toBeInTheDocument()
    expect(rowOf("คุณเสร็จ").getByRole("link", { name: /ปิดบิล/ })).toHaveAttribute(
      "href",
      "/mobile-order/tables/r1/billing?session=s1&back=bookings",
    )
    for (const name of ["คุณจอง", "คุณนวด", "คุณเสร็จ"]) {
      expect(rowOf(name).getByRole("button", { name: `คำสั่งอื่นของ ${name}` })).toBeInTheDocument()
    }
    // ★ ทีละขั้น: เช็กอินแล้วมีแค่ เริ่มนวด — ยังกดเสร็จ/จ่ายไม่ได้ (2026-10-08)
    expect(rowOf("คุณเช็กอิน").getByRole("button", { name: "เริ่มนวด" })).toBeInTheDocument()
    expect(rowOf("คุณเช็กอิน").queryByRole("button", { name: "เสร็จแล้ว" })).toBeNull()
    expect(rowOf("คุณเช็กอิน").queryByRole("link", { name: /ปิดบิล/ })).toBeNull()
    expect(rowOf("คุณนวด").queryByRole("link", { name: /ปิดบิล/ })).toBeNull()
    // ปุ่มที่ใช้ไม่บ่อยไม่วางเรียงในแถวแล้ว
    expect(rowOf("คุณจอง").queryByRole("button", { name: "ยกเลิกคิว" })).toBeNull()
  })

  it("ไม่มีสิทธิ์ = ไม่มีปุ่มขั้นถัดไป (ปิดบิลก็ต้องมีสิทธิ์ MO_TABLES:EDIT)", () => {
    renderQueue({ allowed: ["VIEW"], canBill: false })
    expect(rowOf("คุณจอง").queryByRole("button", { name: "เช็กอิน" })).toBeNull()
    expect(rowOf("คุณนวด").queryByRole("button", { name: "เสร็จแล้ว" })).toBeNull()
    expect(rowOf("คุณเสร็จ").queryByRole("link", { name: /ปิดบิล/ })).toBeNull()
  })

  it("เปลี่ยนแท็บ/วันแล้ว URL พาทั้งวันที่และแท็บไปด้วย", () => {
    renderQueue()
    fireEvent.click(screen.getByRole("tab", { name: /ตารางเวลา/ }))
    expect(push).toHaveBeenLastCalledWith(`/spa/bookings?date=${DAY}&tab=timeline`)
    fireEvent.click(screen.getByRole("button", { name: "วันถัดไป" }))
    expect(push).toHaveBeenLastCalledWith("/spa/bookings?date=2026-10-09&tab=list")
  })

  it("แท็บตอนนี้แสดงการ์ด · แท็บตารางเวลาสลับแถวตามห้องได้", () => {
    renderQueue({
      tab: "now",
      board: {
        live: true,
        rooms: [
          {
            id: "r1",
            code: "3/1",
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
          },
        ],
        therapists: [],
        unassigned: [],
      },
    })
    expect(screen.getByRole("article", { name: /ห้อง 3\/1 ว่าง/ })).toBeInTheDocument()

    cleanup()
    renderQueue({ tab: "timeline" })
    fireEvent.click(screen.getByRole("tab", { name: "ตามห้อง" }))
    expect(screen.getByText("ห้อง 3/1")).toBeInTheDocument()
  })
})

/// แท็บรายการเรียงตามเวลาที่ทำรายการจอง ล่าสุดก่อน + โชว์เวลาทำรายการ (เจ้าของสั่ง 2026-10-08)
describe("หน้า คิวนวด — เรียงตามเวลาทำรายการ", () => {
  it("จองทีหลังขึ้นก่อน (ไม่ใช่ตามเวลานัด) และแต่ละแถวบอกว่าจอง/เช็กอินเมื่อไร", () => {
    renderQueue({
      bookings: [
        booking("old", "คุณจองก่อน", "18:00", "BOOKED", false, at("08:00")),
        booking("new", "คุณจองทีหลัง", "10:00", "CHECKED_IN", false, at("12:30")),
      ],
    })
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows[0].textContent).toContain("คุณจองทีหลัง")
    expect(rows[1].textContent).toContain("คุณจองก่อน")
    expect(rows[0].textContent).toMatch(/จองเมื่อ .*12:30.*เช็กอิน .*13:55/)
    expect(rows[1].textContent).toMatch(/จองเมื่อ .*08:00/)
    expect(rows[1].textContent).not.toContain("เช็กอิน 1")
  })
})
