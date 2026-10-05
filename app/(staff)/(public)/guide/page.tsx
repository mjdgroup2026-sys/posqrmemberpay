import type { Metadata } from "next"
import Link from "next/link"
import { CONTACT_EMAIL, GUIDE_FAQ, GUIDE_GROUPS, type GuideImage } from "@/lib/guide-content"

export const metadata: Metadata = {
  title: "คู่มือการใช้งาน — MJD Mobile Order",
  description: "วิธีใช้ MJD Mobile Order ตั้งแต่สร้างร้าน ตั้งค่าเมนู/โต๊ะ ลูกค้าสั่งผ่าน QR ปิดบิล ปิดยอด ร้านนวด คลังสินค้า และรายงาน",
}

function Shot({ image }: { image: GuideImage }) {
  return (
    <figure className={image.phone ? "guide-shot phone" : "guide-shot"}>
      {/* ภาพนิ่งใน public/ — ไม่ต้องผ่าน next/image (ย่อ+แปลง webp ไว้แล้วตอนถ่าย) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} alt={image.alt} width={image.width ?? 1280} height={image.height ?? 806} loading="lazy" />
      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
    </figure>
  )
}

function TocLinks() {
  return (
    <nav>
      {GUIDE_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="guide-toc-group">{group.title}</p>
          <ul>
            {group.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="guide-toc-group">
        <a href="#faq">คำถามที่พบบ่อย</a>
      </p>
    </nav>
  )
}

export default function GuidePage() {
  return (
    <div className="pub-wrap guide-layout">
      <aside className="guide-toc" aria-label="สารบัญ">
        {/* จอใหญ่: สารบัญติดข้างตลอด · มือถือ: พับไว้ให้กดเปิด จะได้ไม่ดันเนื้อหาลงไปไกล */}
        <div className="guide-toc-desktop">
          <p className="t-eyebrow" style={{ marginBottom: 8 }}>
            สารบัญ
          </p>
          <TocLinks />
        </div>
        <details className="guide-toc-mobile card-ui card-pad">
          <summary>สารบัญ</summary>
          <TocLinks />
        </details>
      </aside>

      <article className="guide-body">
        <header style={{ marginBottom: 28 }}>
          <p className="t-eyebrow">MJD Mobile Order</p>
          <h1 className="t-h1">คู่มือการใช้งาน</h1>
          <p className="t-body" style={{ marginTop: 6 }}>
            ใช้ได้ทั้งเจ้าของร้านและพนักงาน · ยังไม่มีบัญชี <Link href="/register">ทดลองใช้ฟรี 7 วัน</Link> · ติดต่อทีมงาน{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </header>

        {GUIDE_GROUPS.map((group) => (
          <section key={group.title} className="guide-group">
            <h2 className="guide-group-title">{group.title}</h2>
            {group.sections.map((s) => (
              <section key={s.id} id={s.id} className="guide-section card-ui card-pad">
                <h3 className="t-h2">{s.title}</h3>
                {s.audience ? (
                  <span className="chip chip-neutral" style={{ marginTop: 6 }}>
                    <span className="dot" />
                    {s.audience}
                  </span>
                ) : null}
                <p className="t-body" style={{ marginTop: 10 }}>
                  {s.intro}
                </p>
                {s.steps ? (
                  <ol className="guide-steps">
                    {s.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
                {s.tips?.map((tip) => (
                  <div key={tip} className="alert-banner info" style={{ marginTop: 12 }}>
                    {tip}
                  </div>
                ))}
                {s.images ? (
                  <div className={s.images.every((i) => i.phone) ? "guide-phones" : "guide-shots"}>
                    {s.images.map((image) => (
                      <Shot key={image.src} image={image} />
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </section>
        ))}

        <section id="faq" className="guide-group">
          <h2 className="guide-group-title">คำถามที่พบบ่อย</h2>
          <div className="card-ui">
            {GUIDE_FAQ.map((item) => (
              <details key={item.q} className="guide-faq">
                <summary>{item.q}</summary>
                <p className="t-body">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="t-body" style={{ marginTop: 16 }}>
            ไม่พบคำตอบที่ต้องการ <Link href="/contact">ติดต่อทีมงาน</Link> ทางโทรศัพท์หรืออีเมล
          </p>
        </section>
      </article>
    </div>
  )
}
