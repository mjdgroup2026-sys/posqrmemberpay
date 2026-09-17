"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { IconClose, IconHamburger } from "@/components/icons"

/// เมนูลิ้นชักบนจอเล็ก (≤ 900px) — โครงหลังร้านเดิมเป็น sidebar + content สองคอลัมน์ตายตัว
/// บนมือถือเนื้อหาเหลือแถบแคบ ๆ ตัวหนังสือหักบรรทัดทีละคำ (เจ้าของระบบเจอจริง 2026-09-17 หน้า /no-store)
///
/// สถานะเปิด/ปิดเก็บเป็น `data-nav-open` บน `.app-shell` แล้วให้ CSS ใน globals.css จัดการ —
/// Sidebar กับ Topbar เป็น component คนละตัว การส่ง state ผ่าน attribute บน DOM จึงไม่ต้องมี provider
/// (กติกาธีม: component ที่ใช้ร่วมกันต้องไม่ผูกกับ provider ของกลุ่มใดกลุ่มหนึ่ง)

const OPEN_ATTR = "data-nav-open"

function shell(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app-shell")
}

export function setMobileNavOpen(open: boolean) {
  const el = shell()
  if (!el) return
  if (open) el.setAttribute(OPEN_ATTR, "true")
  else el.removeAttribute(OPEN_ATTR)
}

/// ปุ่ม ☰ ใน topbar — ซ่อนบนจอกว้างด้วย CSS (`.nav-toggle`)
export function MobileNavToggle() {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon nav-toggle nav-toggle-open"
      aria-label="เปิดเมนู"
      onClick={() => setMobileNavOpen(true)}
    >
      <IconHamburger size={20} aria-hidden />
    </button>
  )
}

/// ปุ่ม ✕ หัว sidebar — ซ่อนบนจอกว้างเช่นกัน
export function MobileNavClose() {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon nav-toggle nav-toggle-close"
      aria-label="ปิดเมนู"
      onClick={() => setMobileNavOpen(false)}
    >
      <IconClose size={20} aria-hidden />
    </button>
  )
}

/// ฉากหลังทึบตอนลิ้นชักเปิด (แตะเพื่อปิด) + ปิดลิ้นชักอัตโนมัติเมื่อเปลี่ยนหน้า
export function MobileNavBackdrop() {
  const pathname = usePathname()

  // กดลิงก์ในเมนูแล้วหน้าเปลี่ยน → ลิ้นชักต้องปิดเอง ไม่งั้นบังหน้าใหม่ทั้งจอ
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  return <div className="nav-backdrop" aria-hidden onClick={() => setMobileNavOpen(false)} />
}
