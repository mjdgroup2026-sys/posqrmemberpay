import { redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { getPlatformPromptPay, platformPromptPayQr } from "@/lib/platform-settings"
import { formatDateTime } from "@/lib/format"
import { PlatformPromptPayForm } from "@/components/platform-promptpay-form"
import { IconShield } from "@/components/icons"

export const metadata = { title: "ตั้งค่าแพลตฟอร์ม" }

/// ยอดของ QR ทดสอบ — สแกนจ่าย 1 บาทดูว่าเงินเข้าบัญชีถูกคนก่อนเปิดให้ร้านจ่ายจริง
const TEST_AMOUNT = 1

/// ตั้งค่าแพลตฟอร์ม (2026-10-05) — พร้อมเพย์ที่ร้านโอนค่าใช้งานเข้า (หน้า /billing และ /brand/billing)
export default async function AdminSettingsPage() {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fsettings" : "/access-denied?resource=PLATFORM")
  }

  const platform = await getPlatformPromptPay()
  const testQr = await platformPromptPayQr(TEST_AMOUNT, platform, 220)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">แพลตฟอร์ม</p>
          <h1 className="t-h1">
            <IconShield size={22} aria-hidden /> ตั้งค่าแพลตฟอร์ม
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            พร้อมเพย์ที่ร้านโอนค่าใช้งานเข้า — หน้าค่าใช้งานของทุกร้านสร้าง QR ตามยอดคำขอจากเลขนี้ (คนละบัญชีกับพร้อมเพย์รับเงินลูกค้าของร้าน)
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 12 }}>
            พร้อมเพย์รับค่าใช้งาน
          </h2>
          <PlatformPromptPayForm
            promptPayId={platform?.source === "db" ? platform.promptPayId : ""}
            promptPayName={platform?.source === "db" ? (platform.promptPayName ?? "") : ""}
          />
          {platform?.source === "db" && platform.updatedAt ? (
            <p className="t-caption" style={{ marginTop: 12 }}>
              แก้ล่าสุด {formatDateTime(platform.updatedAt)}
              {platform.updatedByName ? ` โดย ${platform.updatedByName}` : ""}
            </p>
          ) : null}
        </section>

        <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <h2 className="t-h2">QR ทดสอบ {TEST_AMOUNT} บาท</h2>
          {platform && testQr ? (
            <>
              {/* data URL ที่ render ฝั่ง server — ไม่ใช่ URL ภายนอก */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={testQr} alt={`QR พร้อมเพย์ทดสอบ ${TEST_AMOUNT} บาท`} width={220} height={220} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
              <p className="t-body">
                <span className="num">{platform.promptPayId}</span>
                {platform.promptPayName ? ` · ${platform.promptPayName}` : ""}
              </p>
              <p className="t-caption">สแกนจ่ายแล้วตรวจว่าชื่อผู้รับในแอปธนาคารถูกต้อง และเงินเข้าบัญชีจริง</p>
              {platform.source === "env" ? (
                <span className="alert-banner info">ตอนนี้ใช้เลขจากเซิร์ฟเวอร์ (.env) — บันทึกเลขในฟอร์มเพื่อแทนที่</span>
              ) : null}
            </>
          ) : (
            <span className="alert-banner warning">ยังไม่ได้ตั้งเลขพร้อมเพย์ — ร้านจะยังไม่เห็น QR ในหน้าค่าใช้งาน</span>
          )}
        </section>
      </div>
    </>
  )
}
