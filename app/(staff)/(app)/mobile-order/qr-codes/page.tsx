import QRCode from "qrcode"
import { listQrCodes } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { publicBaseUrl } from "@/lib/urls"
import { QrManager, type QrCard } from "@/components/qr-manager"

export const metadata = { title: "จัดการ QR Code" }

export default async function QrCodesPage() {
  const { storeId } = await requireStorePage()
  const rows = await listQrCodes(storeId)
  const base = publicBaseUrl()

  const cards: QrCard[] = await Promise.all(
    rows.map(async (row) => {
      const url = row.token ? `${base}/order/${row.token}` : null
      return {
        tableId: row.tableId,
        tableCode: row.tableCode,
        qrId: row.qrId,
        token: row.token,
        type: row.type,
        issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
        invalidatedCount: row.invalidatedCount,
        url,
        // สร้างภาพเป็น data URL ฝั่ง server — หน้าเว็บจึงไม่ต้องโหลดไลบรารี QR ลงเบราว์เซอร์
        imageDataUrl: url
          ? await QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: "M" })
          : null,
      }
    }),
  )

  return <QrManager cards={cards} />
}
