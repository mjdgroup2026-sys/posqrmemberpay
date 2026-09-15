import { resolveCustomerSession, getCustomerOrderView, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { CheckBillView } from "@/components/customer/check-bill-view"

export const metadata = { title: "เช็กบิล" }

export default async function CheckBillPage({ params }: PageProps<"/order/[qrToken]/check-bill">) {
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

  const [view, settings] = await Promise.all([
    getCustomerOrderView(session.storeId, session.sessionId),
    getStoreSettings(session.storeId),
  ])

  if (!view) {
    return <CustomerNotice title="ไม่พบบิลของโต๊ะนี้" description="กรุณาสแกน QR Code อีกครั้ง" />
  }

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={session.tableCode}
      backHref={`/order/${qrToken}/status`}
      title="เช็กบิล"
    >
      <CheckBillView qrToken={qrToken} view={view} />
    </CustomerShell>
  )
}
