// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { KitchenDisplay } from "@/components/kitchen-display"
import type { KitchenTicket } from "@/lib/queries"

const push = vi.fn()
let params = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => "/mobile-order/kitchen",
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const startCookingItem = vi.fn<(fd: FormData) => Promise<{ ok: boolean; message?: string }>>(async () => ({ ok: true, message: "ok" }))
const cancelOrderItem = vi.fn<(fd: FormData) => Promise<{ ok: boolean; message?: string }>>(async () => ({ ok: true, message: "ok" }))
vi.mock("@/app/actions/orders", () => ({
  startCookingOrder: vi.fn(async () => ({ ok: true })),
  markOrderReady: vi.fn(async () => ({ ok: true })),
  markOrderServed: vi.fn(async () => ({ ok: true })),
  startCookingItem: (fd: FormData) => startCookingItem(fd),
  markItemReady: vi.fn(async () => ({ ok: true })),
  markItemServed: vi.fn(async () => ({ ok: true })),
  cancelOrderItem: (fd: FormData) => cancelOrderItem(fd),
}))
// AutoRefresh ต่อ SSE/ตั้ง interval — ไม่ใช่สิ่งที่เทสนี้วัด
vi.mock("@/components/auto-refresh", () => ({ AutoRefresh: () => null }))

/// KDS รายรายการ (Phase 19) — ปุ่มต่อบรรทัดตามสถานะ · ปุ่มยกเลิกซ่อนตามสิทธิ์ MO_TABLES:DELETE · แท็บ station กรองถูก
function item(id: string, name: string, status: KitchenTicket["items"][number]["status"], station: { id: string; name: string } | null) {
  return {
    id,
    menuItemName: name,
    quantity: 1,
    unitPrice: 50,
    subtotal: 50,
    note: null,
    status,
    options: [],
    cancelReason: status === "CANCELLED" ? "หมด" : null,
    stationId: station?.id ?? null,
    stationName: station?.name ?? null,
    itemType: "FOOD" as const,
    durationMinutes: null,
    therapistId: null,
    therapistLabel: null,
  }
}

const FRIED = { id: "st-fried", name: "ของทอด" }
const DRINK = { id: "st-drink", name: "บาร์น้ำ" }
const stations = [
  { id: FRIED.id, name: FRIED.name, sortOrder: 0, menuCount: 1 },
  { id: DRINK.id, name: DRINK.name, sortOrder: 1, menuCount: 1 },
]

const ticket: KitchenTicket = {
  orderId: "o1",
  orderNumber: 1,
  tableCode: "A1",
  orderType: "DINE_IN",
  submittedAt: new Date(),
  printedAt: null,
  items: [
    item("i1", "ไก่ทอด", "AWAITING_KITCHEN", FRIED),
    item("i2", "ชาเย็น", "AWAITING_KITCHEN", DRINK),
    item("i3", "ข้าวผัด", "COOKING", null),
    item("i4", "ปลาทอด", "CANCELLED", FRIED),
  ],
}

describe("KitchenDisplay — รายรายการ / สิทธิ์ / แท็บครัว (Phase 19)", () => {
  it("แต่ละบรรทัดมีปุ่มของตัวเอง และปุ่ม 'ทั้งใบ' โผล่เมื่อคอลัมน์นั้นมีมากกว่า 1 รายการ", () => {
    params = new URLSearchParams()
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    expect(screen.getByRole("button", { name: "เริ่ม ไก่ทอด" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "เริ่ม ชาเย็น" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "เสร็จ ข้าวผัด" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "เริ่มปรุงทั้งใบ" })).toBeInTheDocument()
    // คอลัมน์กำลังปรุงมีบรรทัดเดียว → ไม่ต้องมีปุ่มทั้งใบ
    expect(screen.queryByRole("button", { name: "ทำเสร็จทั้งใบ" })).toBeNull()
    // รายการที่ถูกยกเลิกขีดฆ่าพร้อมเหตุผล
    expect(screen.getByText(/ปลาทอด — ยกเลิกแล้ว \(หมด\)/)).toBeInTheDocument()
  })

  it("กดปุ่มบรรทัดเดียวส่ง id ของรายการนั้น ไม่ใช่ orderId", () => {
    params = new URLSearchParams()
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    fireEvent.click(screen.getByRole("button", { name: "เริ่ม ชาเย็น" }))
    expect(startCookingItem).toHaveBeenCalledTimes(1)
    const fd = startCookingItem.mock.calls[0][0]
    expect(fd.get("id")).toBe("i2")
  })

  it("ปุ่มยกเลิกแสดงเฉพาะเมื่อมี canCancel และเฉพาะรายการที่ครัวยังไม่รับ", () => {
    params = new URLSearchParams()
    const { unmount } = render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel={false} />)
    expect(screen.queryByRole("button", { name: /^ยกเลิก / })).toBeNull()
    unmount()

    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    expect(screen.getByRole("button", { name: "ยกเลิก ไก่ทอด" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ยกเลิก ข้าวผัด" })).toBeNull() // COOKING แล้ว
  })

  it("ยกเลิกต้องกรอกเหตุผลก่อน แล้วส่ง id+reason ไปที่ cancelOrderItem", async () => {
    params = new URLSearchParams()
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก ไก่ทอด" }))
    const confirm = await screen.findByRole("button", { name: /ยืนยันยกเลิกรายการ/ })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/เหตุผล/), { target: { value: "วัตถุดิบหมด" } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await vi.waitFor(() => expect(cancelOrderItem).toHaveBeenCalledTimes(1))
    const fd = cancelOrderItem.mock.calls[0][0]
    expect(fd.get("id")).toBe("i1")
    expect(fd.get("reason")).toBe("วัตถุดิบหมด")
  })

  it("ไม่มี EDIT → ไม่มีปุ่มเปลี่ยนสถานะเลย แต่ยังเห็นรายการ", () => {
    params = new URLSearchParams()
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit={false} canCancel />)
    expect(screen.queryByRole("button", { name: /^เริ่ม / })).toBeNull()
    expect(screen.queryByRole("button", { name: /^ยกเลิก / })).toBeNull()
    expect(screen.getByText(/ไก่ทอด/)).toBeInTheDocument()
  })

  it("แท็บครัว: ?station=<id> เห็นเฉพาะบรรทัดของครัวนั้น · กดแท็บพาไป URL ที่ตรงกัน", () => {
    params = new URLSearchParams("station=st-drink")
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    expect(screen.getByText(/ชาเย็น/)).toBeInTheDocument()
    expect(screen.queryByText(/ไก่ทอด/)).toBeNull()
    expect(screen.queryByText(/ข้าวผัด/)).toBeNull()

    fireEvent.click(screen.getByRole("tab", { name: "ของทอด" }))
    expect(push).toHaveBeenCalledWith("/mobile-order/kitchen?station=st-fried")
    fireEvent.click(screen.getByRole("tab", { name: /ทุกครัว/ }))
    expect(push).toHaveBeenCalledWith("/mobile-order/kitchen")
  })

  it("แท็บ 'ไม่ระบุครัว' โผล่เมื่อมีบรรทัดที่ไม่ผูก station และกรองได้", () => {
    params = new URLSearchParams("station=none")
    render(<KitchenDisplay tickets={[ticket]} stations={stations} canEdit canCancel />)
    expect(screen.getByRole("tab", { name: "ไม่ระบุครัว" })).toBeInTheDocument()
    expect(screen.getByText(/ข้าวผัด/)).toBeInTheDocument()
    expect(screen.queryByText(/ชาเย็น/)).toBeNull()
  })
})
