// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MenuAdmin } from "@/components/menu-admin"
import { TableOverview } from "@/components/table-overview"
import type { ManagedMenuItem, TableCard } from "@/lib/queries"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/app/actions/menu", () => ({ saveMenuItem: vi.fn(), deleteMenuItem: vi.fn(), toggleMenuItemActive: vi.fn() }))
vi.mock("@/app/actions/tables", () => ({
  openTableSession: vi.fn(),
  mergeTables: vi.fn(),
  unmergeTables: vi.fn(),
  cancelTableSession: vi.fn(),
}))
vi.mock("@/app/actions/notifications", () => ({ acknowledgeNotification: vi.fn() }))
// AutoRefresh ต่อ SSE/ตั้ง interval — ไม่ใช่สิ่งที่เทสนี้วัด
vi.mock("@/components/auto-refresh", () => ({ AutoRefresh: () => null }))

function menu(id: string, name: string, itemType: "FOOD" | "SERVICE"): ManagedMenuItem {
  return {
    id,
    name,
    description: null,
    price: 100,
    imageUrl: null,
    isActive: true,
    isFeatured: false,
    stationId: null,
    stationName: null,
    itemType,
    durationMinutes: itemType === "SERVICE" ? 60 : null,
    orderedCount: 0,
    modifierGroups: [],
  }
}

function table(id: string, code: string, kind: "TABLE" | "ROOM"): TableCard {
  return {
    id,
    code,
    status: "EMPTY",
    sessionId: null,
    openedAt: null,
    total: 0,
    itemCount: 0,
    primaryTableId: null,
    primaryTableCode: null,
    mergedTableCodes: [],
    pendingNotification: null,
    kind,
    stationName: null,
  }
}

const items = [menu("m1", "ข้าวผัด", "FOOD"), menu("m2", "นวดไทย 60", "SERVICE")]
const tables = [table("t1", "A1", "TABLE"), table("r1", "3/1", "ROOM")]

/// ร้านสปา (2026-09-23 เจ้าของสั่ง): ชื่อหน้า "…/ร้านสปา" + แท็บแยกอาหาร/นวดสปา · โต๊ะ/ห้อง — ร้านอาหารล้วนต้องเหมือนเดิม
describe("แท็บแยกอาหาร/สปา", () => {
  it("MenuAdmin ร้านสปา: ชื่อหน้าใหม่ · แท็บอาหารเห็นแค่อาหาร · แท็บนวดสปาเห็นแค่โปรแกรมนวด", () => {
    render(<MenuAdmin items={items} spaEnabled />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("จัดการเมนูอาหาร/ร้านสปา")

    const table = screen.getByRole("table")
    expect(within(table).getByText("ข้าวผัด")).toBeInTheDocument()
    expect(within(table).queryByText("นวดไทย 60")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: /รายการนวดสปา/ }))
    expect(within(screen.getByRole("table")).getByText("นวดไทย 60")).toBeInTheDocument()
    expect(within(screen.getByRole("table")).queryByText("ข้าวผัด")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /เพิ่มรายการนวดสปา/ })).toBeInTheDocument()
  })

  it("MenuAdmin ร้านอาหารล้วน: ไม่มีแท็บ เห็นทุกรายการ ชื่อหน้าเดิม", () => {
    render(<MenuAdmin items={items} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^จัดการเมนูอาหาร$/)
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    expect(screen.getByText("ข้าวผัด")).toBeInTheDocument()
    expect(screen.getByText("นวดไทย 60")).toBeInTheDocument()
  })

  it("TableOverview ร้านสปา: ชื่อหน้าใหม่ · แท็บโต๊ะอาหาร/ห้องสปา แยกกัน", () => {
    render(<TableOverview tables={tables} spaEnabled />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ผังโต๊ะอาหาร/ห้องสปา")
    expect(screen.getByText(/A1/)).toBeInTheDocument()
    expect(screen.queryByText(/3\/1/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: /ห้องสปา/ }))
    expect(screen.getByText(/3\/1/)).toBeInTheDocument()
    expect(screen.queryByText(/A1/)).not.toBeInTheDocument()
  })

  it("TableOverview ร้านอาหารล้วน: ไม่มีแท็บ ชื่อหน้าเดิม", () => {
    render(<TableOverview tables={[table("t1", "A1", "TABLE")]} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^ผังโต๊ะ$/)
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })
})
