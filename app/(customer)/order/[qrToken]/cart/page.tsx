import { resolveCustomerSession, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { CartView } from "@/components/customer/cart-view"

export const metadata = { title: "ตะกร้า" }

export default async function CustomerCartPage({ params }: PageProps<"/order/[qrToken]/cart">) {
  const { qrToken } = await params
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
      backHref={`/order/${qrToken}/menu`}
      title="ตะกร้าของคุณ"
    >
      <CartView qrToken={qrToken} awaitingBill={session.awaitingBill} />
    </CustomerShell>
  )
}
