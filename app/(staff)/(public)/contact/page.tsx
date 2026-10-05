import type { Metadata } from "next"
import { IconMail, IconPhoneCall, IconSupport } from "@/components/icons"
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_PHONE_TEL } from "@/lib/guide-content"

export const metadata: Metadata = {
  title: "ติดต่อทีมงาน — MJD Mobile Order",
  description: "ติดต่อทีมงาน MJD Mobile Order ทางโทรศัพท์หรืออีเมล",
}

/// หน้าติดต่อทีมงาน (2026-10-05) — เปิดได้โดยไม่ต้องล็อกอิน (คนที่สนใจระบบต้องติดต่อได้ก่อนสมัคร)
/// เบอร์/อีเมลอยู่ที่ lib/guide-content.ts ที่เดียว
export default function ContactPage() {
  return (
    <>
      <section className="pub-hero">
        <div className="pub-wrap contact-hero">
          <span className="contact-hero-icon" aria-hidden>
            <IconSupport size={30} />
          </span>
          <p className="t-eyebrow">Contact us</p>
          <h1 className="pub-hero-title">ติดต่อทีมงาน</h1>
          <p className="t-body pub-hero-lead">สอบถามการใช้งาน แจ้งปัญหา หรืออยากให้ช่วยตั้งค่าร้าน ทักมาได้เลย ทีมงานยินดีช่วย</p>
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap contact-grid">
          <article className="card-ui card-pad contact-card">
            <span className="contact-icon" aria-hidden>
              <IconPhoneCall size={26} />
            </span>
            <p className="t-small">โทรศัพท์</p>
            <a href={`tel:${CONTACT_PHONE_TEL}`} className="contact-value num">
              {CONTACT_PHONE}
            </a>
            <div className="contact-actions">
              <a href={`tel:${CONTACT_PHONE_TEL}`} className="btn btn-primary">
                <IconPhoneCall size={16} aria-hidden /> โทรเลย
              </a>
            </div>
          </article>

          <article className="card-ui card-pad contact-card">
            <span className="contact-icon" aria-hidden>
              <IconMail size={26} />
            </span>
            <p className="t-small">อีเมล</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="contact-value">
              {CONTACT_EMAIL}
            </a>
            <div className="contact-actions">
              <a href={`mailto:${CONTACT_EMAIL}`} className="btn btn-primary">
                <IconMail size={16} aria-hidden /> ส่งอีเมล
              </a>
            </div>
          </article>
        </div>
      </section>
    </>
  )
}
