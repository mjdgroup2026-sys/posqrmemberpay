"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setStoreModules } from "@/app/actions/admin"
import { MODULE_HINT, MODULE_LABEL, STORE_MODULES, type StoreModule } from "@/lib/modules"
import { IconSpinner } from "@/components/icons"

/// การ์ดเปิด/ปิดโมดูลของร้าน (2026-09-30) — ผู้ดูแลแพลตฟอร์มเท่านั้น · ด่านจริงคือ requirePlatformAdmin() ใน action
/// ติ๊ก = เปิดใช้ · ขายอาหาร/QR เป็นแกนหลักจึงไม่อยู่ในรายการ (ปิดไม่ได้)
export function AdminStoreModules({ storeId, disabled }: { storeId: string; disabled: StoreModule[] }) {
  const router = useRouter()
  const [off, setOff] = useState<StoreModule[]>(disabled)
  const [pending, setPending] = useState(false)
  const dirty = off.length !== disabled.length || off.some((m) => !disabled.includes(m))

  function toggle(storeModule: StoreModule, enabled: boolean) {
    setOff((current) => (enabled ? current.filter((m) => m !== storeModule) : [...current, storeModule]))
  }

  async function save() {
    setPending(true)
    const formData = new FormData()
    formData.set("storeId", storeId)
    formData.set("disabled", JSON.stringify(off))
    try {
      const result = await setStoreModules(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label className="checkbox-row">
        <input type="checkbox" checked disabled />
        <span>
          ขายอาหาร / QR (แกนหลัก)
          <br />
          <span className="t-caption">ขายอาหาร · ผังโต๊ะ · ครัว · เมนู · โต๊ะ/QR · ประวัติขาย · ปิดยอด · ผู้ใช้ — ได้ทุกร้าน ปิดไม่ได้</span>
        </span>
      </label>
      {STORE_MODULES.map((storeModule) => (
        <label key={storeModule} className="checkbox-row">
          <input
            type="checkbox"
            checked={!off.includes(storeModule)}
            onChange={(e) => toggle(storeModule, e.target.checked)}
            disabled={pending}
          />
          <span>
            {MODULE_LABEL[storeModule]}
            <br />
            <span className="t-caption">{MODULE_HINT[storeModule]}</span>
          </span>
        </label>
      ))}
      <p className="t-caption">
        ปิดโมดูลแล้วเมนู/หน้า/ปุ่มของโมดูลนั้นหายไปทั้งร้าน รวมถึงเจ้าของร้าน · ข้อมูลเดิมไม่ถูกลบ เปิดกลับแล้วกลับมาเหมือนเดิม
      </p>
      <div>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !dirty}>
          {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
          บันทึกโมดูล
        </button>
      </div>
    </div>
  )
}
