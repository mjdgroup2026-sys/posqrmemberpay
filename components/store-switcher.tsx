"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { switchActiveStore } from "@/app/actions/store-members"
import { IconStore } from "@/components/icons"

export type StoreOption = { storeId: string; name: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" }

type Props = {
  activeStoreId: string
  stores: StoreOption[]
}

/// ตัวสลับร้านใน topbar (Phase 13) — โผล่เป็น dropdown เฉพาะเมื่ออยู่มากกว่า 1 ร้าน
/// อยู่ร้านเดียวแสดงแค่ชื่อร้าน ไม่ให้มีปุ่มที่กดแล้วไม่มีอะไรให้เลือก
export function StoreSwitcher({ activeStoreId, stores }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const active = stores.find((s) => s.storeId === activeStoreId)

  if (stores.length <= 1) {
    return (
      <span className="row" style={{ gap: 6, fontWeight: 600 }}>
        <IconStore size={16} aria-hidden />
        {active?.name ?? "ร้านของฉัน"}
      </span>
    )
  }

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const storeId = event.target.value
    if (storeId === activeStoreId) return
    setBusy(true)
    const formData = new FormData()
    formData.set("storeId", storeId)
    const result = await switchActiveStore(formData)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(result.message)
    // ทุกหน้าใต้ shell อ่านร้านจาก cookie — refresh ให้ RSC render ใหม่ทั้งต้นไม้ แล้วกลับหน้าแรก
    // เพราะหน้าปัจจุบันอาจอ้าง id ของร้านเดิม (เช่น /mobile-order/tables/[tableId])
    router.push("/")
    router.refresh()
  }

  return (
    <label className="row" style={{ gap: 6 }}>
      <IconStore size={16} aria-hidden />
      <span className="sr-only">ร้านที่ทำงานอยู่</span>
      <select
        id="active-store"
        className="select"
        value={activeStoreId}
        onChange={handleChange}
        disabled={busy}
        style={{ minWidth: 160 }}
      >
        {stores.map((store) => (
          <option key={store.storeId} value={store.storeId} disabled={store.status === "SUSPENDED"}>
            {store.name}
            {store.role === "OWNER" ? " · เจ้าของ" : ""}
            {store.status === "SUSPENDED" ? " (ถูกระงับ)" : ""}
          </option>
        ))}
      </select>
    </label>
  )
}
