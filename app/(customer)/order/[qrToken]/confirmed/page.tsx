import Link from "next/link"
import { resolveCustomerSession, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"

export const metadata = { title: "ยืนยันออร์เดอร์แล้ว" }

export default async function CustomerConfirmedPage({
  params,
  searchParams,
}: PageProps<"/order/[qrToken]/confirmed">) {
  const { qrToken } = await params
  const query = await searchParams
  const orderNumber = typeof query.order === "string" ? query.order : ""

  const session = await resolveCustomerSession(qrToken)
  if (!session.ok) {
    return (
      <CustomerNotice
        title="เปิดหน้านี้ไม่ได้"
        description="โต๊ะนี้ยังไม่ได้เปิดใช้งานหรือ QR หมดอายุแล้ว กรุณาสแกนใหม่หรือแจ้งพนักงาน"
      />
    )
  }

  const settings = await getStoreSettings(session.storeId)

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={session.tableCode}
      title="ส่งออร์เดอร์แล้ว"
    >
      <section className="card-ui card-pad" style={{ textAlign: "center" }}>
        <p className="t-eyebrow">ออร์เดอร์เข้าครัวแล้ว</p>
        <h1 className="t-h1" style={{ marginTop: 8 }}>
          ขอบคุณค่ะ
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          {orderNumber ? `ออร์เดอร์ที่ ${orderNumber} ` : ""}
          ถูกส่งเข้าครัวเรียบร้อยแล้ว ติดตามสถานะได้ที่หน้าถัดไป
        </p>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        <Link href={`/order/${qrToken}/status`} className="btn btn-primary btn-lg btn-block">
          ดูสถานะออร์เดอร์
        </Link>
        <Link href={`/order/${qrToken}/menu`} className="btn btn-subtle btn-block">
          สั่งเพิ่ม
        </Link>
      </div>
    </CustomerShell>
  )
}
