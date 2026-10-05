// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { MenuItemCard } from "@/lib/queries"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/app/actions/staff-order", () => ({
  buildStorePromptPayQr: vi.fn(),
  createStaffTableOrder: vi.fn(),
  createTakeawaySale: vi.fn(),
}))

const { MenuPos } = await import("@/components/menu-pos")

afterEach(cleanup)

const padThai: MenuItemCard = {
  id: "m1",
  name: "ผัดไทย",
  description: null,
  price: 75,
  imageUrl: null,
  isFeatured: false,
  stationId: null,
  stationName: null,
  itemType: "FOOD",
  durationMinutes: null,
  modifierGroups: [],
}

/// หน้าต่างรับเงินกลับบ้าน — เปิดมาแล้ว cursor อยู่ที่ช่อง "รับเงินมา" พิมพ์จำนวนเงินได้ทันที (เจ้าของขอ 2026-10-05)
describe("จอขาย — โฟกัสช่องรับเงิน", () => {
  it("กดรับเงินแล้ว cursor อยู่ที่ช่องรับเงินมา", async () => {
    render(<MenuPos menu={{ featured: [], all: [padThai] }} tables={[]} defaultMode="TAKEAWAY" />)
    fireEvent.click(screen.getByRole("button", { name: /ผัดไทย/ }))
    fireEvent.click(screen.getByRole("button", { name: /รับเงินและส่งเข้าครัว/ }))
    await waitFor(() => expect(document.activeElement?.id).toBe("posReceived"))
  })
})
