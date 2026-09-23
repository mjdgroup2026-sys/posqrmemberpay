import Link from "next/link"
import { getStoreSettings, listKitchenStations, listTherapists } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { TherapistManager } from "@/components/therapist-manager"

export const metadata = { title: "พนักงานนวด" }

/// พนักงานนวด (Phase 20a) — หน้าแรกของกลุ่ม "ร้านนวด" · ใช้ได้เมื่อร้านเปิดตัวเลือกร้านนวดในตั้งค่าร้าน
export default async function TherapistsPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("SPA_THERAPISTS")
  const [settings, therapists, stations] = await Promise.all([
    getStoreSettings(storeId),
    listTherapists(storeId),
    listKitchenStations(storeId),
  ])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          พนักงานนวด
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          ร้านนี้ยังไม่ได้เปิด “ตัวเลือกร้านนวด” — เปิดแล้วจะได้เมนูพนักงานนวด โปรแกรมนวด (เมนูชนิดบริการ) ห้องนวด และตารางจอง
          เพิ่มจากของเดิม โดยเมนูอาหาร/โต๊ะ/ครัวยังใช้ร่วมกันได้ตามปกติ
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
        </div>
      </section>
    )
  }

  return <TherapistManager therapists={therapists} stations={stations} allowed={granted.SPA_THERAPISTS ?? []} />
}
