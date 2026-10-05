// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import WelcomePage from "@/app/(staff)/(public)/welcome/page"
import GuidePage from "@/app/(staff)/(public)/guide/page"
import PublicLayout from "@/app/(staff)/(public)/layout"
import ContactPage from "@/app/(staff)/(public)/contact/page"
import AuthLayout from "@/app/(staff)/(auth)/layout"
import { CONTACT_EMAIL, GUIDE_GROUPS } from "@/lib/guide-content"

/// หน้าสาธารณะ /welcome และ /guide (2026-10-02) — เจ้าของสั่งว่า "เรื่องแพ็กเกจไม่ต้องแสดงราคา"
/// ราคาอยู่หลังล็อกอินที่ /billing เท่านั้น เทสนี้กันไม่ให้ใครเผลอเติมราคาลงหน้าที่คนนอกเห็น

// "บาท" ต้องตามหลังตัวเลขเท่านั้น — ไม่งั้นไปชนคำว่า "บทบาท"
const PRICE = /฿|\d[\d,]*\s*บาท|\d+\.\d{2}|ราคา\s*\d/

describe("หน้าสาธารณะไม่โชว์ราคาแพ็กเกจ", () => {
  it("หน้าแนะนำระบบไม่มีตัวเลขราคา แต่มีขนาดแพ็กเกจและอีเมลติดต่อ", () => {
    const { container } = render(<WelcomePage />)
    const text = container.textContent ?? ""
    expect(text).not.toMatch(PRICE)
    expect(text).toContain("ไม่เกิน 120 โต๊ะ")
    expect(text).toContain(CONTACT_EMAIL)
  })

  it("คู่มือไม่มีตัวเลขราคา มีทุกหัวข้อในสารบัญ และภาพมี alt ครบ", () => {
    const { container } = render(<GuidePage />)
    const text = container.textContent ?? ""
    expect(text).not.toMatch(PRICE)
    expect(text).toContain("พิมพ์ใบเสร็จซ้ำ")
    for (const section of GUIDE_GROUPS.flatMap((g) => g.sections)) {
      expect(container.querySelector(`#${section.id}`)).not.toBeNull()
      expect(container.querySelector(`a[href="#${section.id}"]`)).not.toBeNull()
    }
    const images = [...container.querySelectorAll("img")]
    expect(images.length).toBeGreaterThan(30)
    for (const image of images) {
      expect(image.getAttribute("alt")).toBeTruthy()
      expect(image.getAttribute("src")).toMatch(/^\/guide-img\/[a-z-]+\.webp$/)
    }
  })
})

/// คู่มือยังไม่เปิดให้คนนอกเห็น (เจ้าของสั่ง 2026-10-05) — หน้าที่คนไม่ล็อกอินเห็นต้องไม่มีลิงก์ไป /guide
describe("หน้าที่คนนอกเห็นไม่มีลิงก์คู่มือ", () => {
  function guideLinks(container: HTMLElement) {
    return [...container.querySelectorAll("a")].filter((a) => (a.getAttribute("href") ?? "").startsWith("/guide"))
  }

  it("หน้าแนะนำระบบ + หัว/ท้ายของหน้าสาธารณะ", () => {
    const { container } = render(
      <PublicLayout>
        <WelcomePage />
      </PublicLayout>,
    )
    expect(guideLinks(container)).toHaveLength(0)
  })

  it("กรอบหน้าล็อกอิน/สมัคร", () => {
    const { container } = render(<AuthLayout>หน้า</AuthLayout>)
    expect(guideLinks(container)).toHaveLength(0)
  })
})

/// หน้าติดต่อทีมงาน (2026-10-05) — เบอร์/อีเมลถูกต้อง และกดโทร/ส่งอีเมลได้จริง
describe("หน้าติดต่อทีมงาน", () => {
  it("มีเบอร์โทรกับอีเมล พร้อมลิงก์ tel:/mailto:", () => {
    const { container, getByText } = render(<ContactPage />)
    expect(getByText("089-452-9759")).toBeTruthy()
    expect(getByText("mjdgroup2026@gmail.com")).toBeTruthy()
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))
    expect(hrefs).toContain("tel:+66894529759")
    expect(hrefs).toContain("mailto:mjdgroup2026@gmail.com")
    expect(container.textContent ?? "").not.toMatch(PRICE)
  })

  it("หัวหน้าสาธารณะมีลิงก์ติดต่อเรา", () => {
    const { container } = render(<PublicLayout>หน้า</PublicLayout>)
    expect([...container.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/contact")).toBe(true)
  })
})

/// ปุ่ม "ติดต่อทีมงาน" ท้ายหน้าแนะนำระบบต้องพาไปหน้าติดต่อเรา ไม่ใช่เปิดโปรแกรมอีเมล (เจ้าของสั่ง 2026-10-05)
describe("ปุ่มติดต่อทีมงานไปหน้า /contact", () => {
  it("หน้าแนะนำระบบ", () => {
    const { getAllByRole } = render(<WelcomePage />)
    const button = getAllByRole("link").find((a) => a.textContent?.includes("ติดต่อทีมงาน"))
    expect(button?.getAttribute("href")).toBe("/contact")
  })

  it("ท้ายคู่มือ", () => {
    const { getAllByRole } = render(<GuidePage />)
    const links = getAllByRole("link").filter((a) => a.textContent === "ติดต่อทีมงาน")
    expect(links.map((a) => a.getAttribute("href"))).toContain("/contact")
  })
})
