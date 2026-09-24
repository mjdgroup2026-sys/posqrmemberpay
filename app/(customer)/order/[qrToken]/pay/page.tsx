import { redirect } from "next/navigation"
import { getCustomerPaymentStatus, getStoreSettings } from "@/lib/queries"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { PayView } from "@/components/customer/pay-view"

export const metadata = { title: "ชำระเงิน" }

export default async function PayPage({ params }: PageProps<"/order/[qrToken]/pay"> ) {
  const { qrToken } = await params
  const [status, store] = await Promise.all([getCustomerPaymentStatus(qrToken), findStoreByQrToken(qrToken)])
  const settings = store ? await getStoreSettings(store.storeId) : null

  // ปิดบิลไปแล้ว (webhook หรือพนักงานกดยืนยัน) — พาไปหน้าสำเร็จแทนหน้าเลือกวิธีจ่ายที่ไม่มีความหมายแล้ว
  if (status.state === "PAID") redirect(`/order/${qrToken}/pay/success`)

  if (status.state === "UNKNOWN") {
    return (
      <CustomerNotice
        title="ชำระเงินไม่ได้ตอนนี้"
        description="โต๊ะนี้ยังไม่ได้เปิดใช้งานหรือปิดบิลไปแล้ว กรุณาสแกน QR ใหม่หรือแจ้งพนักงาน"
      />
    )
  }

  if (status.total <= 0) {
    return (
      <CustomerNotice
        title="ยังไม่มีรายการที่ต้องชำระ"
        description="สั่งอาหารก่อนแล้วค่อยกลับมาชำระเงินได้เลย"
      />
    )
  }

  // ห้องสปาที่มีลูกค้าหลายคน = หลายบิล (20e) — QR ของห้องไม่รู้ว่าคนสแกนเป็นใคร จึงไม่ให้จ่ายเองเลย
  // (ไม่งั้นจะจ่ายเข้าบิลล่าสุดซึ่งอาจเป็นของคนอื่น) · startCustomerPayment/submitPaymentSlip ปฏิเสธซ้ำฝั่ง server
  if (status.sharedRoom) {
    return (
      <CustomerNotice
        title="กรุณาชำระเงินกับพนักงาน"
        description="ห้องนี้มีลูกค้าหลายคน แต่ละคนชำระแยกบิล — แจ้งพนักงานเพื่อชำระบิลของคุณ"
      />
    )
  }

  // วิธีรับเงินเป็นของร้านนี้ (Phase 15a) — ไม่ใช่ env กลางที่ทุกร้านใช้ร่วมกันอีกแล้ว
  const payment = await getStorePaymentProfile(status.storeId)

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={status.tableCode}
      backHref={`/order/${qrToken}/check-bill`}
      title="ชำระเงิน"
    >
      <PayView
        qrToken={qrToken}
        bill={{
          itemsTotal: status.itemsTotal,
          servicePercent: status.servicePercent,
          serviceCharge: status.serviceCharge,
          total: status.total,
        }}
        promptPayReady={payment.qrAvailable}
      />
    </CustomerShell>
  )
}
