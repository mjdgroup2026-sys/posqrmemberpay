import { resolveCustomerSession, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { CallStaffForm } from "@/components/customer/call-staff-form"

export const metadata = { title: "เรียกพนักงาน" }

export default async function CallStaffPage({ params }: PageProps<"/order/[qrToken]/call-staff">) {
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
      backHref={`/order/${qrToken}/status`}
      title="เรียกพนักงาน"
    >
      <CallStaffForm qrToken={qrToken} />
    </CustomerShell>
  )
}
