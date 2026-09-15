import Link from "next/link"
import { listKitchenTickets, getStoreSettings } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { KitchenDisplay } from "@/components/kitchen-display"
import { IconKitchen } from "@/components/icons"

export const metadata = { title: "Kitchen Display" }

export default async function KitchenPage() {
  const { storeId } = await requireStorePage()
  const [tickets, settings] = await Promise.all([listKitchenTickets(storeId), getStoreSettings(storeId)])

  // ★ ร้านที่ยังไม่เปิดโหมดจอครัวไม่ควรเห็นกระดาน 3 คอลัมน์ (F18) — ของเดิม render ให้เฉย ๆ
  //   แล้วสองคอลัมน์ขวาว่างตลอดเพราะรายการข้ามจาก "รอครัวรับ" ไป "เสิร์ฟแล้ว" เลย
  //   ผู้ใช้เห็นเป็น "ปุ่มเปลี่ยนสถานะหายไป" โดยไม่มีอะไรอธิบาย
  //   ⚠️ ร้านที่ยังไม่เคยบันทึกหน้าตั้งค่าเลยจะไม่มีแถว StoreSettings → hasKDS = false ด้วย
  if (!settings?.hasKDS) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดโหมดจอครัว
        </span>

        <h1 className="t-h1" style={{ marginTop: 12 }}>
          <IconKitchen size={22} aria-hidden /> หน้าจอครัว (KDS) ปิดอยู่
        </h1>

        <p className="t-body" style={{ marginTop: 10 }}>
          ตอนนี้ร้านตั้งเป็นโหมด <strong>ไม่มีจอครัว</strong> — อาหารที่ลูกค้าสั่งจะข้ามจาก
          &ldquo;รอครัวรับ&rdquo; ไป &ldquo;เสิร์ฟแล้ว&rdquo; ในขั้นเดียว จึงไม่มีสถานะ
          &ldquo;กำลังปรุง&rdquo; และ &ldquo;พร้อมเสิร์ฟ&rdquo; ให้กด
        </p>

        <p className="t-body" style={{ marginTop: 10 }}>
          พนักงานกดสถานะอาหารได้จากหน้ารายละเอียดออร์เดอร์ของแต่ละโต๊ะแทน
        </p>

        <div className="alert-banner info" style={{ marginTop: 14 }}>
          อยากได้กระดาน 3 คอลัมน์พร้อมปุ่ม &ldquo;เริ่มปรุง&rdquo; และ &ldquo;ทำเสร็จแล้ว&rdquo; ให้ไปเปิด
          &ldquo;เปิดหน้าจอครัว (KDS)&rdquo; ที่หน้าตั้งค่าร้าน — สลับได้เฉพาะตอนไม่มีโต๊ะเปิดอยู่
        </div>

        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
          <Link href="/mobile-order/tables" className="btn btn-subtle">
            ไปผังโต๊ะ
          </Link>
        </div>
      </section>
    )
  }

  return <KitchenDisplay tickets={tickets} />
}
