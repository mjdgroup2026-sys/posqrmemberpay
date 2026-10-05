import type { Metadata } from "next"
import Link from "next/link"
import {
  IconBell,
  IconBoxes,
  IconBrand,
  IconCalculator,
  IconKitchen,
  IconPos,
  IconQr,
  IconReports,
  IconSupport,
  IconTable,
  IconTherapist,
  IconUsers,
  IconWallet,
} from "@/components/icons"
import { CONTACT_EMAIL } from "@/lib/guide-content"

export const metadata: Metadata = {
  title: "MJD Mobile Order — ระบบสั่งอาหารผ่าน QR และขายหน้าร้าน",
  description:
    "ลูกค้าสแกน QR สั่งอาหารเอง ครัวเห็นออร์เดอร์ทันที จ่ายพร้อมเพย์แล้วปิดบิลอัตโนมัติ รองรับร้านอาหาร ร้านนวด/สปา คลังสินค้า และหลายสาขา",
}

const FEATURES = [
  { Icon: IconQr, title: "ลูกค้าสแกน QR สั่งเอง", text: "ไม่ต้องติดตั้งแอป สั่งเพิ่มได้ตลอด เรียกพนักงาน/เช็กบิลจากมือถือ" },
  { Icon: IconKitchen, title: "หน้าจอครัว (KDS)", text: "ออร์เดอร์เข้าครัวทันที มีเสียงเตือน พิมพ์ทิกเก็ตได้ แยกตามประเภทครัว" },
  { Icon: IconTable, title: "ผังโต๊ะสด", text: "เห็นทุกโต๊ะในจอเดียว รวมโต๊ะ ยกเลิกรายการ ปิดบิลได้ทันที" },
  { Icon: IconWallet, title: "รับเงินพร้อมเพย์", text: "QR เข้าบัญชีร้านโดยตรง ร้านที่ต่อธนาคารปิดบิลให้อัตโนมัติ" },
  { Icon: IconPos, title: "จอขายพนักงาน", text: "กดขายเข้าโต๊ะหรือกลับบ้าน รับเงินสด คำนวณเงินทอน พิมพ์ใบเสร็จ" },
  { Icon: IconCalculator, title: "ปิดยอดประจำวัน", text: "สรุปแยกช่องทาง นับเงินแล้วรู้ทันทีว่าขาด/เกิน ปิดได้หลายรอบต่อวัน" },
  { Icon: IconTherapist, title: "ร้านนวด / สปา", text: "พนักงานนวด ตารางกะ จองคิว กระดานห้องว่าง รายงานรายคน" },
  { Icon: IconBoxes, title: "คลังสินค้า", text: "ใบรับ/เบิก/ปรับยอด ขายสินค้าคู่กับอาหาร เตือนของใกล้หมด" },
  { Icon: IconBell, title: "สมาชิกสะสมแต้ม", text: "ลูกค้าสมัครด้วยเบอร์โทรหลังจ่ายเงิน สะสมแต้มทุกบิล" },
  { Icon: IconReports, title: "รายงาน", text: "ยอดขายแยกอาหาร/นวด/สินค้า ตามช่วงวัน ดาวน์โหลดเป็น Excel ได้" },
  { Icon: IconUsers, title: "พนักงานและสิทธิ์", text: "เชิญพนักงานทางอีเมล กำหนดว่าใครเห็นอะไร กดอะไรได้" },
  { Icon: IconBrand, title: "หลายสาขา", text: "รวมสาขาเป็นแบรนด์ คัดลอกเมนูข้ามสาขา เทียบยอดรายสาขา" },
]

const STEPS = [
  { title: "สมัครและสร้างร้าน", text: "ได้โต๊ะ QR และเมนูตัวอย่างพร้อมลองใช้ทันที" },
  { title: "ใส่เมนูและพิมพ์ QR", text: "เพิ่มเมนู รูป ตัวเลือกเสริม แล้วพิมพ์ QR ไปวางที่โต๊ะ" },
  { title: "เริ่มขาย", text: "ลูกค้าสแกนสั่ง ครัวเห็นทันที ปิดบิลแล้วดูยอดได้เลย" },
]

const TIERS = [
  { tier: "S", tables: 12 },
  { tier: "M", tables: 30 },
  { tier: "L", tables: 60 },
  { tier: "XL", tables: 120 },
]

export default function WelcomePage() {
  return (
    <>
      <section className="pub-hero">
        <div className="pub-wrap pub-hero-grid">
          <div>
            <p className="t-eyebrow">ระบบร้านอาหาร · ร้านนวด · หน้าร้าน</p>
            <h1 className="pub-hero-title">ลูกค้าสแกน QR สั่งเอง ครัวเห็นทันที ปิดบิลง่ายในจอเดียว</h1>
            <p className="t-body pub-hero-lead">
              MJD Mobile Order รวมการสั่งอาหาร หน้าจอครัว ผังโต๊ะ รับเงินพร้อมเพย์ ปิดยอด และรายงานไว้ในระบบเดียว ใช้ผ่านเบราว์เซอร์
              ไม่ต้องติดตั้งโปรแกรม
            </p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 22 }}>
              <Link href="/register" className="btn btn-primary btn-lg">
                เริ่มทดลองใช้ฟรี 7 วัน
              </Link>
            </div>
            <p className="t-small" style={{ marginTop: 12 }}>
              มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
            </p>
          </div>
          <div className="pub-hero-shots" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pub-hero-desktop" src="/guide-img/table-map.webp" alt="" width={1280} height={806} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pub-hero-phone" src="/guide-img/customer-menu.webp" alt="" width={540} height={1169} />
          </div>
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <h2 className="t-h1 pub-section-title">ทำอะไรได้บ้าง</h2>
          <div className="pub-feature-grid">
            {FEATURES.map(({ Icon, title, text }) => (
              <div key={title} className="card-ui card-pad pub-feature">
                <span className="pub-feature-icon">
                  <Icon size={20} aria-hidden />
                </span>
                <h3 className="t-h3">{title}</h3>
                <p className="t-small">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section pub-section-alt">
        <div className="pub-wrap">
          <h2 className="t-h1 pub-section-title">เริ่มใช้ได้ใน 3 ขั้นตอน</h2>
          <ol className="pub-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="card-ui card-pad">
                <span className="pub-step-no num">{i + 1}</span>
                <h3 className="t-h3">{step.title}</h3>
                <p className="t-small">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-wrap">
          <h2 className="t-h1 pub-section-title">แพ็กเกจ</h2>
          <p className="t-body pub-section-lead">
            คิดค่าใช้งานเป็นรายวันตามขนาดร้าน เลือกระยะเวลาได้ตั้งแต่ 7 วันถึง 1 ปี ต่ออายุล่วงหน้าได้ วันที่เหลือไม่หาย
            และอัปเกรดขนาดกลางทางได้
          </p>
          <div className="pub-tier-grid">
            {TIERS.map((t) => (
              <div key={t.tier} className="card-ui card-pad pub-tier">
                <p className="pub-tier-name">{t.tier}</p>
                <p className="t-body">
                  ไม่เกิน <span className="num">{t.tables}</span> โต๊ะ
                </p>
              </div>
            ))}
          </div>
          <div className="alert-banner info" style={{ marginTop: 16 }}>
            ทดลองใช้ฟรี 7 วันครบทุกฟีเจอร์ · สอบถามรายละเอียดแพ็กเกจได้ที่ {CONTACT_EMAIL}
          </div>
        </div>
      </section>

      <section className="pub-section pub-section-alt">
        <div className="pub-wrap pub-cta">
          <h2 className="t-h1">พร้อมลองใช้แล้วหรือยัง</h2>
          <p className="t-body">สมัครด้วยอีเมล สร้างร้าน แล้วลองสแกน QR สั่งอาหารได้ภายในไม่กี่นาที</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 18 }}>
            <Link href="/register" className="btn btn-primary btn-lg">
              เริ่มทดลองใช้ฟรี
            </Link>
            {/* ไปหน้าติดต่อเรา (2026-10-05) — มีทั้งเบอร์โทรและอีเมล ไม่ใช่เปิดโปรแกรมอีเมลอย่างเดียว */}
            <Link href="/contact" className="btn btn-ghost btn-lg">
              <IconSupport size={17} aria-hidden />
              ติดต่อทีมงาน
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
