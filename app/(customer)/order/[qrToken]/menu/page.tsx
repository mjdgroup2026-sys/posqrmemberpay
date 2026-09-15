import { resolveCustomerSession, listMenu, getStoreSettings, type CustomerSession } from "@/lib/queries"
import { CustomerShell, CustomerNotice } from "@/components/customer/customer-shell"
import { MenuView } from "@/components/customer/menu-view"

export const metadata = { title: "เมนูอาหาร" }

const NOTICE: Record<Exclude<CustomerSession, { ok: true }>["reason"], { title: string; description: string }> = {
  QR_NOT_FOUND: {
    title: "ไม่พบ QR Code นี้",
    description: "กรุณาแจ้งพนักงานเพื่อขอ QR Code ใหม่",
  },
  QR_INVALIDATED: {
    title: "QR Code นี้ใช้ไม่ได้แล้ว",
    description: "กรุณาแจ้งพนักงานให้เปิดโต๊ะใหม่และพิมพ์ QR ใบใหม่ให้",
  },
  NO_SESSION: {
    title: "โต๊ะนี้ยังไม่ได้เปิด",
    description: "กรุณาสแกน QR Code อีกครั้ง หรือแจ้งพนักงานให้เปิดโต๊ะให้",
  },
  STORE_SUSPENDED: {
    title: "ร้านนี้ปิดรับออเดอร์ชั่วคราว",
    description: "กรุณาสั่งกับพนักงานโดยตรง",
  },
}

export default async function CustomerMenuPage({ params }: PageProps<"/order/[qrToken]/menu">) {
  const { qrToken } = await params
  const session = await resolveCustomerSession(qrToken)

  if (!session.ok) return <CustomerNotice {...NOTICE[session.reason]} />

  const [menu, settings] = await Promise.all([listMenu(session.storeId), getStoreSettings(session.storeId)])

  return (
    <CustomerShell storeName={settings?.storeName ?? "MJD Mobile Order"} tableCode={session.tableCode}>
      {/* ปก/โลโก้ที่ร้านตั้งเองได้จากหน้า /mobile-order/settings (F21)
          ใช้ <img> ธรรมดาเพราะเป็น URL ภายนอกที่ร้านกรอกเอง — next/image ต้องประกาศ
          remotePatterns ล่วงหน้า ซึ่งทำไม่ได้กับโดเมนที่ยังไม่รู้ตอน build */}
      {settings?.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={settings.coverImageUrl}
          alt=""
          style={{
            width: "100%",
            height: 140,
            objectFit: "cover",
            borderRadius: 12,
            marginBottom: 12,
          }}
        />
      ) : null}

      {settings?.logoUrl ? (
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={settings.logoUrl}
            alt={settings.storeName}
            style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 10 }}
          />
          <span style={{ fontWeight: 700 }}>{settings.storeName}</span>
        </div>
      ) : null}

      <MenuView
        qrToken={qrToken}
        featured={menu.featured}
        all={menu.all}
        awaitingBill={session.awaitingBill}
      />
    </CustomerShell>
  )
}
