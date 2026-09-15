import { resolveCustomerSession, getCustomerOrderView, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { StatusView } from "@/components/customer/status-view"

export const metadata = { title: "สถานะออร์เดอร์" }

export default async function CustomerStatusPage({ params }: PageProps<"/order/[qrToken]/status">) {
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
    return <CustomerNotice title="ไม่พบออร์เดอร์" description="กรุณาสแกน QR Code อีกครั้ง" />
  }

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={session.tableCode}
      backHref={`/order/${qrToken}/menu`}
      title="ติดตามออร์เดอร์"
    >
      <StatusView qrToken={qrToken} initial={view} />
    </CustomerShell>
  )
}
