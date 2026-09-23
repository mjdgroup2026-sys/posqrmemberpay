import { redirect } from "next/navigation"
import {
  getPaymentConfig,
  getScbConfig,
  getStoreSettings,
  listMenuForSettings,
  getOpenSessionCount,
} from "@/lib/queries"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { isSlipVerificationConfigured } from "@/lib/slip-provider"
import { isSecretBoxConfigured } from "@/lib/secret-box"
import { publicBaseUrl } from "@/lib/urls"
import { ScbConfigForm } from "@/components/scb-config-form"
import { requireStorePage } from "@/lib/permissions"
import { StoreSettingsForm } from "@/components/store-settings-form"
import { PaymentConfigForm } from "@/components/payment-config-form"

export const metadata = { title: "ตั้งค่าร้าน" }

export default async function StoreSettingsPage() {
  const { storeId, role } = await requireStorePage()
  // ตั้งค่าร้านเป็นของเจ้าของร้านเท่านั้น (Phase 13) — action updateStoreSettings ก็กันด้วย requireOwner()
  if (role !== "OWNER") redirect("/access-denied?resource=STORE_SETTINGS")
  const [settings, menu, openSessionCount, paymentConfig, paymentProfile, scbConfig] = await Promise.all([
    getStoreSettings(storeId),
    listMenuForSettings(storeId),
    getOpenSessionCount(storeId),
    getPaymentConfig(storeId),
    getStorePaymentProfile(storeId),
    getScbConfig(storeId),
  ])

  return (
    <>
      <StoreSettingsForm
        settings={{
          storeName: settings?.storeName ?? "MJD Mobile Order",
          // ค่าตั้งต้นเป็นสีแบรนด์ฝั่งลูกค้าตาม design system — ร้านเปลี่ยนทับได้เอง
          themeColor: settings?.themeColor ?? "#E8571F",
          logoUrl: settings?.logoUrl ?? null,
          coverImageUrl: settings?.coverImageUrl ?? null,
          serviceChargePercent: settings?.serviceChargePercent ?? 0,
          hasKDS: settings?.hasKDS ?? false,
          kitchenAlertSound: settings?.kitchenAlertSound ?? true,
          kitchenAutoPrint: settings?.kitchenAutoPrint ?? false,
          spaEnabled: settings?.spaEnabled ?? false,
          bookingBufferMinutes: settings?.bookingBufferMinutes ?? 10,
          crmEnabled: settings?.crmEnabled ?? false,
          posDefaultMode: settings?.posDefaultMode ?? "TABLE",
        }}
        menu={menu}
        openSessionCount={openSessionCount}
      />
      {/* การรับเงินจากลูกค้า (Phase 15a) — แยกจากฟอร์มแบรนด์/ธีมเพราะเป็นข้อมูลการเงิน action คนละตัว */}
      <PaymentConfigForm
        config={paymentConfig}
        scbAutoSettle={paymentProfile.autoSettle}
        slipReady={isSlipVerificationConfigured()}
        scbOwnVerified={scbConfig.activeSource === "store"}
      />
      {/* SCB Biller ของร้าน (Phase 15c) — credential เข้ารหัส + ทดสอบด้วยเงินจริง 1 บาทก่อนเปิดใช้ */}
      <ScbConfigForm config={scbConfig} baseUrl={publicBaseUrl()} secretBoxReady={isSecretBoxConfigured()} />
    </>
  )
}
