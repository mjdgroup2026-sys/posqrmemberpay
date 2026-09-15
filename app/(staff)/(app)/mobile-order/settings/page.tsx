import { redirect } from "next/navigation"
import { getStoreSettings, listMenuForSettings, getOpenSessionCount } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { StoreSettingsForm } from "@/components/store-settings-form"

export const metadata = { title: "ตั้งค่าร้าน" }

export default async function StoreSettingsPage() {
  const { storeId, role } = await requireStorePage()
  // ตั้งค่าร้านเป็นของเจ้าของร้านเท่านั้น (Phase 13) — action updateStoreSettings ก็กันด้วย requireOwner()
  if (role !== "OWNER") redirect("/access-denied?resource=STORE_SETTINGS")
  const [settings, menu, openSessionCount] = await Promise.all([
    getStoreSettings(storeId),
    listMenuForSettings(storeId),
    getOpenSessionCount(storeId),
  ])

  return (
    <StoreSettingsForm
      settings={{
        storeName: settings?.storeName ?? "MJD Mobile Order",
        // ค่าตั้งต้นเป็นสีแบรนด์ฝั่งลูกค้าตาม design system — ร้านเปลี่ยนทับได้เอง
        themeColor: settings?.themeColor ?? "#E8571F",
        logoUrl: settings?.logoUrl ?? null,
        coverImageUrl: settings?.coverImageUrl ?? null,
        serviceChargePercent: settings?.serviceChargePercent ?? 0,
        hasKDS: settings?.hasKDS ?? false,
        crmEnabled: settings?.crmEnabled ?? false,
      }}
      menu={menu}
      openSessionCount={openSessionCount}
    />
  )
}
