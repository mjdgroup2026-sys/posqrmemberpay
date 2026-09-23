// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const signOut = vi.fn()
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: () => signOut() } }))
// ไม่ใช่สิ่งที่เทสนี้วัด — ตัดออกเพื่อไม่ต้องจำลอง server action / ลิ้นชักมือถือ
vi.mock("@/components/store-switcher", () => ({ StoreSwitcher: () => null }))
vi.mock("@/components/mobile-nav", () => ({ MobileNavToggle: () => null }))

const { Topbar } = await import("@/components/topbar")

async function clickSignOut() {
  render(<Topbar user={{ name: "ทดสอบ", email: "t@example.com" }} lowStockCount={0} />)
  fireEvent.click(screen.getByRole("button", { name: /ทดสอบ/ }))
  fireEvent.click(await screen.findByText("ออกจากระบบ"))
}

/// ออกจากระบบ — Better Auth client คืน `{ error }` แทนการ throw
/// เดิมเช็คแค่ try/catch จึงขึ้น "ออกจากระบบแล้ว" ทั้งที่ cookie ยังอยู่ แล้วถูกพาไป /login ที่เด้งกลับหน้าแรก
describe("Topbar — ออกจากระบบ", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("เซิร์ฟเวอร์ตอบ error → แจ้ง error และไม่พาไป /login", async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 403, code: "INVALID_ORIGIN", message: "Invalid origin" } })
    await clickSignOut()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain("ที่อยู่เว็บ")
    expect(toast.success).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it("เน็ตหลุด (fetch throw) → แจ้ง error ปุ่มไม่ค้าง", async () => {
    signOut.mockRejectedValue(new TypeError("Failed to fetch"))
    await clickSignOut()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /ทดสอบ/ })).not.toBeDisabled()
  })

  it("สำเร็จ → แจ้งสำเร็จแล้วไป /login", async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null })
    await clickSignOut()

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"))
    expect(toast.success).toHaveBeenCalledWith("ออกจากระบบแล้ว")
    expect(toast.error).not.toHaveBeenCalled()
  })
})
