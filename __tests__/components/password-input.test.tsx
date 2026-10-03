// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PasswordInput } from "@/components/password-input"

afterEach(cleanup)

/// ปุ่มรูปตาสลับแสดง/ซ่อนรหัสผ่าน (2026-10-03)
describe("PasswordInput", () => {
  it("ซ่อนรหัสผ่านไว้ก่อน แล้วกดรูปตาเพื่อแสดง/ซ่อนสลับกัน", () => {
    render(<PasswordInput id="pw" name="password" aria-label="รหัสผ่าน" />)
    const input = screen.getByLabelText("รหัสผ่าน") as HTMLInputElement
    expect(input.type).toBe("password")
    expect(input.className).toBe("input")

    fireEvent.click(screen.getByRole("button", { name: "แสดงรหัสผ่าน" }))
    expect(input.type).toBe("text")

    fireEvent.click(screen.getByRole("button", { name: "ซ่อนรหัสผ่าน" }))
    expect(input.type).toBe("password")
  })

  it("ปุ่มรูปตาไม่ submit ฟอร์ม", () => {
    let submitted = false
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true }}>
        <PasswordInput name="password" />
      </form>,
    )
    fireEvent.click(screen.getByRole("button", { name: "แสดงรหัสผ่าน" }))
    expect(submitted).toBe(false)
  })
})
