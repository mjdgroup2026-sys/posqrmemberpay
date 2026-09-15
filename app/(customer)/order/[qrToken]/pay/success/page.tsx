import Link from "next/link"
import { redirect } from "next/navigation"
import { getCustomerPaymentStatus, getStoreSettings } from "@/lib/queries"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { formatBaht, formatDateTime } from "@/lib/format"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { MemberJoin } from "@/components/customer/member-join"

export const metadata = { title: "ชำระเงินสำเร็จ" }

export default async function PaySuccessPage({ params }: PageProps<"/order/[qrToken]/pay/success">) {
  const { qrToken } = await params
  const [status, store] = await Promise.all([getCustomerPaymentStatus(qrToken), findStoreByQrToken(qrToken)])
  const settings = store ? await getStoreSettings(store.storeId) : null

  if (status.state === "UNPAID") redirect(`/order/${qrToken}/pay`)

  if (status.state === "UNKNOWN") {
    return (
      <CustomerNotice
        title="ไม่พบบิลของโต๊ะนี้"
        description="ถ้าเพิ่งชำระเงินไป กรุณาขอใบเสร็จจากพนักงานที่เคาน์เตอร์"
      />
    )
  }

  return (
    <CustomerShell
      storeName={settings?.storeName ?? "MJD Mobile Order"}
      tableCode={status.tableCode}
      title="ชำระเงินสำเร็จ"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section className="card-ui card-pad" style={{ textAlign: "center" }}>
          <p style={{ fontSize: "2.5rem", lineHeight: 1 }} aria-hidden>
            ✓
          </p>
          <h2 className="t-h2" style={{ marginTop: 8 }}>
            ขอบคุณที่ใช้บริการ
          </h2>
          <p className="t-body" style={{ marginTop: 6 }}>
            ชำระเงินเรียบร้อยแล้ว โต๊ะนี้ถูกปิดบิลให้อัตโนมัติ
          </p>

          <div
            style={{
              borderTop: "1px solid var(--line)",
              marginTop: 14,
              paddingTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span className="row" style={{ justifyContent: "space-between" }}>
              <span className="t-small">เลขที่บิล</span>
              <span className="num">{status.saleNumber}</span>
            </span>
            <span className="row" style={{ justifyContent: "space-between" }}>
              <span className="t-small">เวลา</span>
              <span className="num">{formatDateTime(status.paidAt)}</span>
            </span>
            <span className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
              <span className="t-small">ยอดชำระ</span>
              <span className="num">฿{formatBaht(status.total)}</span>
            </span>
          </div>
        </section>

        {/* สมัครสมาชิก + รับแต้มทันทีจากบิลนี้ (F22) — โผล่เฉพาะร้านที่เปิด CRM ไว้ */}
        {settings?.crmEnabled ? <MemberJoin qrToken={qrToken} saleTotal={status.total} /> : null}

        <Link href={`/order/${qrToken}/status`} className="btn btn-subtle btn-block">
          ดูรายการที่สั่งไป
        </Link>
      </div>
    </CustomerShell>
  )
}
