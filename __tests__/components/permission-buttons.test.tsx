// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MenuAdmin } from "@/components/menu-admin"
import { TableAdmin } from "@/components/table-admin"
import { NotificationBoard } from "@/components/notification-board"
import { KitchenDisplay } from "@/components/kitchen-display"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/app/actions/menu", () => ({ saveMenuItem: vi.fn(), deleteMenuItem: vi.fn(), toggleMenuItemActive: vi.fn() }))
vi.mock("@/app/actions/tables", () => ({ createTable: vi.fn(), createTablesBulk: vi.fn(), renameTable: vi.fn(), deleteTable: vi.fn() }))
vi.mock("@/app/actions/notifications", () => ({ acknowledgeNotification: vi.fn(), acknowledgeAllNotifications: vi.fn() }))
vi.mock("@/app/actions/orders", () => ({
  startCookingOrder: vi.fn(),
  markOrderReady: vi.fn(),
  markOrderServed: vi.fn(),
  startCookingItem: vi.fn(),
  markItemReady: vi.fn(),
  markItemServed: vi.fn(),
  cancelOrderItem: vi.fn(),
}))

/// §4 ข้อ "ไม่มีสิทธิ์ Add/Edit/Delete → ปุ่มที่เกี่ยวข้องถูกซ่อน" (Phase 16) — ด่านจริงคือ server แต่ UI ต้องไม่โชว์ปุ่มที่กดแล้วโดนปฏิเสธ
/// ค่าเริ่มต้น (ไม่ส่ง allowed) = เต็ม เพื่อให้ component เดิมและเทสเดิมไม่เปลี่ยนพฤติกรรม

const menuItem = {
  id: "m1",
  name: "ข้าวผัด",
  description: null,
  price: 60,
  imageUrl: null,
  isActive: true,
  isFeatured: false,
  orderedCount: 0,
  modifierGroups: [],
}

describe("ซ่อนปุ่มตามสิทธิ์ (Phase 16)", () => {
  it("MenuAdmin: VIEW อย่างเดียว → ไม่มีปุ่มเพิ่ม/แก้ไข/ปิดขาย/ลบ · ค่าเริ่มต้นโชว์ครบ", () => {
    const { unmount } = render(<MenuAdmin items={[menuItem as never]} allowed={["VIEW"]} />)
    expect(screen.queryByRole("button", { name: /เพิ่มเมนู/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /แก้ไข/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /ปิดขาย/ })).toBeNull()
    expect(screen.getByText("ข้าวผัด")).toBeInTheDocument()
    unmount()

    render(<MenuAdmin items={[menuItem as never]} />)
    expect(screen.getByRole("button", { name: /เพิ่มเมนู/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /แก้ไข/ })).toBeInTheDocument()
  })

  it("TableAdmin: ไม่มี ADD → ฟอร์มเพิ่มโต๊ะหาย · มี ADD แต่ไม่มี EDIT/DELETE → เห็นฟอร์มแต่ไม่มีปุ่มแก้/ลบ", () => {
    const table = { id: "t1", code: "A1", status: "EMPTY", sessionCount: 0, hasQr: false, createdAt: new Date() }
    const { unmount } = render(<TableAdmin tables={[table as never]} allowed={["VIEW"]} />)
    expect(screen.queryByRole("button", { name: /เพิ่มโต๊ะ/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /แก้รหัส/ })).toBeNull()
    unmount()

    render(<TableAdmin tables={[table as never]} allowed={["VIEW", "ADD"]} />)
    expect(screen.getByRole("button", { name: /เพิ่มโต๊ะ/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /แก้รหัส/ })).toBeNull()
  })

  it("NotificationBoard: ไม่มี EDIT → ไม่มีปุ่มรับทราบ แต่การ์ดยังแสดง", () => {
    const card = {
      id: "n1",
      type: "CALL_STAFF",
      status: "PENDING",
      reason: null,
      createdAt: new Date(),
      acknowledgedAt: null,
      acknowledgedByName: null,
      tableId: "t1",
      tableCode: "A1",
      sessionId: "s1",
      openedAt: new Date(),
    }
    render(<NotificationBoard notifications={[card as never]} canAcknowledge={false} />)
    expect(screen.queryByRole("button", { name: /รับทราบ/ })).toBeNull()
    expect(screen.getByText(/รอพนักงานที่มีสิทธิ์/)).toBeInTheDocument()
  })

  it("KitchenDisplay: ไม่มี EDIT → ไม่มีปุ่มเริ่มทำ", () => {
    const ticket = {
      orderId: "o1",
      orderNumber: 1,
      tableCode: "A1",
      submittedAt: new Date(),
      printedAt: null,
      items: [{ id: "i1", menuItemName: "ข้าวผัด", quantity: 1, unitPrice: 60, subtotal: 60, note: null, status: "AWAITING_KITCHEN", options: [], cancelReason: null }],
    }
    render(<KitchenDisplay tickets={[ticket as never]} stations={[]} canEdit={false} />)
    expect(screen.queryByRole("button", { name: /เริ่ม/ })).toBeNull()
    expect(screen.getByText(/ข้าวผัด/)).toBeInTheDocument()
  })
})
