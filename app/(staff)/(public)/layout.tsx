import Link from "next/link"
import { Copyright } from "@/components/copyright"
import { IconMail } from "@/components/icons"
import { CONTACT_EMAIL } from "@/lib/guide-content"

/// หน้าสาธารณะ (2026-10-02) — /welcome (แนะนำระบบ) และ /guide (คู่มือ) เปิดได้โดยไม่ต้องล็อกอิน
/// ใช้ root layout ของ (staff) ร่วมกัน (ฟอนต์/ธีมเดียวกับหลังร้าน) ไม่สร้าง root layout ที่สาม
/// ⚠️ ห้ามโชว์ราคาแพ็กเกจในกลุ่มนี้ — ดู lib/guide-content.ts
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pub-shell">
      <header className="pub-header">
        <div className="pub-wrap pub-header-row">
          <Link href="/welcome" className="pub-logo">
            <span className="pub-logo-mark" aria-hidden>
              MJD
            </span>
            <span>Mobile Order</span>
          </Link>
          <nav className="pub-nav">
            <Link href="/guide">คู่มือ</Link>
            <Link href="/login" className="btn btn-ghost btn-sm">
              เข้าสู่ระบบ
            </Link>
            <Link href="/register" className="btn btn-primary btn-sm">
              ทดลองใช้ฟรี
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="pub-footer">
        <div className="pub-wrap pub-footer-row">
          <Copyright />
          <a href={`mailto:${CONTACT_EMAIL}`} className="pub-contact">
            <IconMail size={15} aria-hidden />
            {CONTACT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  )
}
