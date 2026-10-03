// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { BillingView } from "@/lib/queries"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/components/use-realtime", () => ({ useRealtime: vi.fn() }))
vi.mock("@/app/actions/payments", () => ({
  confirmMobilePayment: vi.fn(),
  getStaffBillStatus: vi.fn(),
  prepareStaffPromptPay: vi.fn(),
}))

const { BillingForm } = await import("@/components/billing-form")

afterEach(cleanup)

const bill: BillingView = {
  tableId: "t1",
  tableCode: "A1",
  sessionId: "s1",
  sessionStatus: "OPEN",
  openedAt: new Date("2026-10-03T10:00:00Z"),
  mergedTableCodes: [],
  customerLabel: null,
  bills: [],
  storeName: "ร้านทดสอบ",
  lines: [{ id: "l1", name: "ผัดไทย", quantity: 1, unitPrice: 75, subtotal: 75, options: [] }],
  itemsTotal: 75,
  servicePercent: 0,
  serviceCharge: 0,
  total: 75,
}

/// เงินทอนต้องเห็นชัด (เจ้าของแจ้ง 2026-10-03: บิล 75 รับ 80 แล้วไม่เห็นว่าต้องทอน)
describe("หน้าปิดบิลโต๊ะ — เงินทอน", () => {
  function payCash(amount: string) {
    render(<BillingForm bill={bill} />)
    fireEvent.click(screen.getByRole("button", { name: "เงินสด" }))
    fireEvent.change(screen.getByLabelText("รับเงินมา (บาท)"), { target: { value: amount } })
  }

  it("รับเกินยอด → แถบเตือน 'ต้องทอนเงินลูกค้า' พร้อมยอดทอน", () => {
    payCash("80")
    const banner = screen.getByRole("status")
    expect(banner.textContent).toContain("ต้องทอนเงินลูกค้า")
    expect(banner.textContent).toContain("5.00")
  })

  it("รับไม่พอ → แถบแดงบอกยอดที่ขาด", () => {
    payCash("70")
    expect(screen.getByRole("alert").textContent).toContain("ขาดอีก ฿5.00")
  })

  it("รับพอดี → ไม่มีเงินทอน", () => {
    payCash("75")
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByText("รับพอดี ไม่มีเงินทอน")).toBeTruthy()
  })
})
