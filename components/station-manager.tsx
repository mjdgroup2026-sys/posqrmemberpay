"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveKitchenStation, deleteKitchenStation } from "@/app/actions/menu"
import { formatNumber } from "@/lib/format"
import type { KitchenStationRow } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconPlus, IconSpinner, IconStation, IconTrash } from "@/components/icons"

/// การ์ด "ประเภทครัว" บนหน้าจัดการเมนู (Phase 19) — เพิ่ม/แก้ชื่อ/ลำดับ/ลบ · สิทธิ์ตาม MO_MENU เหมือนเมนู
/// ลบแล้วเมนูที่ผูกอยู่กลับเป็น "ไม่ระบุครัว" (FK SetNull) จึงไม่บล็อกการลบ แค่เตือนจำนวน
const SUGGESTIONS = ["ของทอด", "ของผัด", "ต้ม/นึ่ง", "บาร์น้ำ", "ของหวาน", "ผลไม้"]

export function StationManager({
  stations,
  allowed = FULL_ACCESS,
}: {
  stations: KitchenStationRow[]
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<{ id: string; name: string; sortOrder: string } | null>(null)

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string; fieldErrors?: FieldErrors }>) {
    setPending(true)
    setFieldErrors({})
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        setFieldErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message ?? "เรียบร้อยแล้ว")
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("name", name)
    formData.set("sortOrder", String(stations.length))
    if (await run(() => saveKitchenStation(formData))) setName("")
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const formData = new FormData()
    formData.set("id", editing.id)
    formData.set("name", editing.name)
    formData.set("sortOrder", editing.sortOrder)
    if (await run(() => saveKitchenStation(formData))) setEditing(null)
  }

  function remove(station: KitchenStationRow) {
    const warning =
      station.menuCount > 0
        ? `ลบประเภทครัว “${station.name}”? เมนู ${formatNumber(station.menuCount)} รายการที่ผูกอยู่จะกลับเป็น “ไม่ระบุครัว”`
        : `ลบประเภทครัว “${station.name}”?`
    if (!window.confirm(warning)) return
    const formData = new FormData()
    formData.set("id", station.id)
    void run(() => deleteKitchenStation(formData))
  }

  const canAdd = allowed.includes("ADD")
  const canEdit = allowed.includes("EDIT")
  const canDelete = allowed.includes("DELETE")

  return (
    <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 className="t-h2">
            <span className="row" style={{ gap: 8 }}>
              <IconStation size={18} aria-hidden />
              ประเภทครัว
            </span>
          </h2>
          <p className="t-caption" style={{ marginTop: 2 }}>
            แยกจอครัวและทิกเก็ตตามส่วนที่ปรุง เช่น ของทอด · ของผัด · บาร์น้ำ — ผูกกับเมนูในฟอร์มแก้ไขเมนู
          </p>
        </div>
        {pending ? <IconSpinner size={18} className="animate-spin" aria-hidden /> : null}
      </div>

      {stations.length === 0 ? (
        <p className="t-body">ยังไม่มีประเภทครัว — ทุกเมนูจะแสดงรวมกันบนจอครัวเหมือนเดิม</p>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stations.map((station) => (
            <li
              key={station.id}
              className="row"
              style={{ justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--surface-2)" }}
            >
              {editing?.id === station.id ? (
                <form onSubmit={saveEdit} className="row" style={{ gap: 6, flex: 1, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 140 }}
                    maxLength={40}
                    required
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    aria-label="ชื่อประเภทครัว"
                    autoFocus
                  />
                  <input
                    className="input num"
                    style={{ width: 80 }}
                    inputMode="numeric"
                    value={editing.sortOrder}
                    onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value.replace(/[^0-9]/g, "") })}
                    aria-label="ลำดับ"
                    title="ลำดับที่แสดง (น้อยไปมาก)"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                    บันทึก
                  </button>
                  <button type="button" className="btn btn-subtle btn-sm" onClick={() => setEditing(null)} disabled={pending}>
                    ยกเลิก
                  </button>
                  {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
                </form>
              ) : (
                <>
                  <span>
                    <span style={{ fontWeight: 600 }}>{station.name}</span>
                    <span className="t-caption"> · เมนู {formatNumber(station.menuCount)} รายการ</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={pending}
                        onClick={() => setEditing({ id: station.id, name: station.name, sortOrder: String(station.sortOrder) })}
                      >
                        แก้ไข
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={pending}
                        onClick={() => remove(station)}
                        aria-label={`ลบประเภทครัว ${station.name}`}
                      >
                        <IconTrash size={15} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd ? (
        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              placeholder="ชื่อประเภทครัวใหม่ เช่น ของทอด"
              maxLength={40}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="ชื่อประเภทครัวใหม่"
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || name.trim() === ""}>
              <IconPlus size={15} aria-hidden />
              เพิ่ม
            </button>
          </div>
          {editing === null && fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="t-caption">ตัวอย่างที่ใช้บ่อย:</span>
            {SUGGESTIONS.filter((s) => !stations.some((st) => st.name === s)).map((s) => (
              <button key={s} type="button" className="btn btn-subtle btn-sm" onClick={() => setName(s)} disabled={pending}>
                {s}
              </button>
            ))}
          </div>
        </form>
      ) : null}
    </section>
  )
}
