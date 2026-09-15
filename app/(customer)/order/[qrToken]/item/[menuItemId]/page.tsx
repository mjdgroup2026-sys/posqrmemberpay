import { resolveCustomerSession, getMenuItem, getStoreSettings } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { ItemForm } from "@/components/customer/item-form"

export const metadata = { title: "รายละเอียดเมนู" }

export default async function CustomerItemPage({
  params,
}: PageProps<"/order/[qrToken]/item/[menuItemId]">) {
  const { qrToken, menuItemId } = await params
  const session = await resolveCustomerSession(qrToken)

  if (!session.ok) {
    return (
      <CustomerNotice
        title="เปิดหน้านี้ไม่ได้"
        description="โต๊ะนี้ยังไม่ได้เปิดใช้งานหรือ QR หมดอายุแล้ว กรุณาสแกนใหม่หรือแจ้งพนักงาน"
      />
    )
  }

  const [item, settings] = await Promise.all([getMenuItem(session.storeId, menuItemId), getStoreSettings(session.storeId)])

  if (!item) {
    return <CustomerNotice title="ไม่พบเมนูนี้" description="เมนูนี้อาจถูกปิดขายไปแล้ว กรุณาเลือกเมนูอื่น" />
  }

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={session.tableCode}
      backHref={`/order/${qrToken}/menu`}
      title={item.name}
    >
      <ItemForm qrToken={qrToken} item={item} />
    </CustomerShell>
  )
}
