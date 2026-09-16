"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { switchActiveStore } from "@/app/actions/store-members"
import Link from "next/link"
import { IconPlus, IconStore } from "@/components/icons"

export type StoreOption = {
  storeId: string
  name: string
  role: "OWNER" | "STAFF"
  status: "ACTIVE" | "SUSPENDED"
  /// Phase 14c — สาขาใต้แบรนด์ถูกจัดกลุ่มเป็น <optgroup> ตามชื่อแบรนด์
  brandId: string | null
  brandName: string | null
}

type Props = {
  activeStoreId: string
  stores: StoreOption[]
}

/// ตัวสลับร้านใน topbar (Phase 13) — โผล่เป็น dropdown เฉพาะเมื่ออยู่มากกว่า 1 ร้าน
/// อยู่ร้านเดียวแสดงแค่ชื่อร้าน ไม่ให้มีปุ่มที่กดแล้วไม่มีอะไรให้เลือก
/// Phase 14a: มีทางไป /onboarding สร้างร้านเพิ่มเสมอ (ผู้ใช้เป็น OWNER ได้หลายร้าน = หลายสาขา)
/// Phase 14c: จัดกลุ่มตามแบรนด์ — สาขาใต้แบรนด์เดียวกันอยู่ใน optgroup เดียว ร้านเดี่ยวอยู่นอกกลุ่ม

const NEW_STORE_VALUE = "__new__"

function renderOption(store: StoreOption) {
  return (
    <option key={store.storeId} value={store.storeId} disabled={store.status === "SUSPENDED"}>
      {store.name}
      {store.role === "OWNER" ? " · เจ้าของ" : ""}
      {store.status === "SUSPENDED" ? " (ถูกระงับ)" : ""}
    </option>
  )
}

/// ร้านเดี่ยว (ไม่มีแบรนด์) รวมเป็นกลุ่มแรก ตามด้วยแต่ละแบรนด์ตามลำดับที่พบ
function groupByBrand(stores: StoreOption[]): { brandId: string | null; brandName: string | null; stores: StoreOption[] }[] {
  const groups: { brandId: string | null; brandName: string | null; stores: StoreOption[] }[] = []
  for (const store of stores) {
    let group = groups.find((g) => g.brandId === store.brandId)
    if (!group) {
      group = { brandId: store.brandId, brandName: store.brandName, stores: [] }
      groups.push(group)
    }
    group.stores.push(store)
  }
  return groups.sort((a, b) => Number(a.brandId !== null) - Number(b.brandId !== null))
}

export function StoreSwitcher({ activeStoreId, stores }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const active = stores.find((s) => s.storeId === activeStoreId)

  if (stores.length <= 1) {
    return (
      <span className="row" style={{ gap: 8, fontWeight: 600 }}>
        <IconStore size={16} aria-hidden />
        {active?.name ?? "ร้านของฉัน"}
        <Link href="/onboarding" className="btn btn-ghost btn-sm btn-icon" title="สร้างร้าน/สาขาเพิ่ม">
          <IconPlus size={14} aria-hidden />
          <span className="sr-only">สร้างร้านใหม่</span>
        </Link>
      </span>
    )
  }

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const storeId = event.target.value
    if (storeId === NEW_STORE_VALUE) {
      // คืนค่า select กลับก่อน ไม่ให้ค้างที่ตัวเลือก "สร้างร้านใหม่" ถ้าผู้ใช้กด back
      event.target.value = activeStoreId
      router.push("/onboarding")
      return
    }
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
        {groupByBrand(stores).map((group) =>
          group.brandId ? (
            <optgroup key={group.brandId} label={group.brandName ?? "แบรนด์"}>
              {group.stores.map(renderOption)}
            </optgroup>
          ) : (
            group.stores.map(renderOption)
          ),
        )}
        <option value={NEW_STORE_VALUE}>＋ สร้างร้านใหม่…</option>
      </select>
    </label>
  )
}
