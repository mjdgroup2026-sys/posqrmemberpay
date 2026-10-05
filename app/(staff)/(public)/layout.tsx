import Link from "next/link"
import { Copyright } from "@/components/copyright"
import { IconMail, IconPhoneCall } from "@/components/icons"
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_PHONE_TEL } from "@/lib/guide-content"

/// หน้าสาธารณะ (2026-10-02) — /welcome (แนะนำระบบ) เปิดได้โดยไม่ต้องล็อกอิน
/// · /guide (คู่มือ) ใช้ layout นี้ด้วยแต่ต้องล็อกอินก่อน (2026-10-05 · proxy.ts) — ห้ามใส่ลิงก์คู่มือในหัว/ท้ายของกลุ่มนี้
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
            <Link href="/contact">ติดต่อเรา</Link>
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
          <span className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <a href={`tel:${CONTACT_PHONE_TEL}`} className="pub-contact">
              <IconPhoneCall size={15} aria-hidden />
              {CONTACT_PHONE}
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`} className="pub-contact">
              <IconMail size={15} aria-hidden />
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}
