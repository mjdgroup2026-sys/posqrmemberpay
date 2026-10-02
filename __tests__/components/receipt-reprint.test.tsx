// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SaleHistory } from "@/components/sale-history"
import type { SaleListItem } from "@/lib/queries"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/app/actions/sales", () => ({ voidSale: vi.fn() }))

/// พิมพ์ใบเสร็จซ้ำจาก /pos/history (2026-10-02) — ใบที่พิมพ์ซ้ำต้องมีป้าย "สำเนา" เสมอ
/// บิลที่ยกเลิกแล้วต้องบอกบนใบ · บิล Mobile Order แยกค่าบริการให้ยอดบวกกันลงตัว

function sale(patch: Partial<SaleListItem> = {}): SaleListItem {
  return {
    id: "s1",
    saleNumber: "INV-000123",
    status: "COMPLETED",
    subtotal: 110,
    discount: 0,
    total: 110,
    paymentMethod: "CASH",
    amountReceived: 200,
    changeDue: 90,
    note: null,
    createdAt: new Date("2026-10-01T05:00:00.000Z"),
    cashierName: "แคชเชียร์",
    channel: "MOBILE_ORDER",
    tableCode: "A1",
    voidedAt: null,
    voidReason: null,
    voidedByName: null,
    canVoid: false,
    items: [{ id: "i1", name: "ข้าวผัด", sku: "", unit: "", quantity: 2, unitPrice: 50, subtotal: 100 }],
    ...patch,
  }
}

function openReprint(s: SaleListItem) {
  render(<SaleHistory sales={[s]} from="" to="" status="" search="" storeName="ร้านทดสอบ" />)
  fireEvent.click(screen.getByRole("button", { name: "รายละเอียด" }))
  fireEvent.click(screen.getByRole("button", { name: /พิมพ์ใบเสร็จซ้ำ/ }))
}

describe("พิมพ์ใบเสร็จซ้ำ", () => {
  it("ใบที่พิมพ์ซ้ำมีป้ายสำเนา ชื่อร้าน และเลขบิลเดิม", () => {
    openReprint(sale())
    expect(screen.getByText(/\*\*\* สำเนา \*\*\*/)).toBeTruthy()
    expect(screen.getByText(/พิมพ์ซ้ำเมื่อ/)).toBeTruthy()
    expect(screen.getByText("ร้านทดสอบ")).toBeTruthy()
    expect(screen.getAllByText("INV-000123").length).toBeGreaterThan(0)
    expect(screen.queryByText(/ยกเลิกแล้ว \*\*\*/)).toBeNull()
  })

  it("บิล Mobile Order แยกบรรทัดค่าบริการ ยอดรวมเป็นยอดรายการ", () => {
    openReprint(sale())
    expect(screen.getByText("ค่าบริการ").nextSibling?.textContent).toBe("฿10.00")
    expect(screen.getByText("ยอดรวม").nextSibling?.textContent).toBe("฿100.00")
  })

  it("บิลที่ยกเลิกแล้วขึ้นป้ายยกเลิกบนใบ", () => {
    openReprint(sale({ status: "VOIDED", voidedAt: new Date(), voidReason: "ทดสอบ" }))
    expect(screen.getByText("*** บิลนี้ยกเลิกแล้ว ***")).toBeTruthy()
  })

  it("กดกลับแล้วกลับมาที่ตารางประวัติ", () => {
    openReprint(sale())
    fireEvent.click(screen.getByRole("button", { name: /กลับ/ }))
    expect(screen.getByText("ประวัติการขาย")).toBeTruthy()
    expect(screen.queryByText(/\*\*\* สำเนา \*\*\*/)).toBeNull()
  })
})
