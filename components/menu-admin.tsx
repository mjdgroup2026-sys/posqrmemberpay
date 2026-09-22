"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveMenuItem, deleteMenuItem, toggleMenuItemActive } from "@/app/actions/menu"
import { formatBaht, formatNumber } from "@/lib/format"
import type { KitchenStationRow, ManagedMenuItem } from "@/lib/queries"
import { UNASSIGNED_STATION_LABEL } from "@/lib/ticket-lines"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconPlus, IconSpinner, IconTrash } from "@/components/icons"
import { ImagePicker } from "@/components/image-picker"
import { isSampleMenuName } from "@/lib/sample-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type GroupDraft = ManagedMenuItem["modifierGroups"][number]

const EMPTY_DRAFT = {
  name: "",
  description: "",
  price: "",
  imageUrl: "",
  isActive: true,
  stationId: "",
  groups: [] as GroupDraft[],
}

/// `stations` = ประเภทครัวของร้าน (Phase 19) — เลือกได้ในฟอร์มเมนู · จัดการตัว station เองอยู่ที่ components/station-manager.tsx
export function MenuAdmin({
  items,
  stations = [],
  allowed = FULL_ACCESS,
}: {
  items: ManagedMenuItem[]
  stations?: KitchenStationRow[]
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [removing, setRemoving] = useState<ManagedMenuItem | null>(null)

  async function run(
    action: () => Promise<{ ok: boolean; message?: string; error?: string; fieldErrors?: FieldErrors }>,
  ) {
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

  function startCreate() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setOpen(true)
  }

  function startEdit(item: ManagedMenuItem) {
    setEditingId(item.id)
    setDraft({
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      imageUrl: item.imageUrl ?? "",
      isActive: item.isActive,
      stationId: item.stationId ?? "",
      groups: item.modifierGroups.map((group) => ({ ...group, options: group.options.map((o) => ({ ...o })) })),
    })
    setFieldErrors({})
    setOpen(true)
  }

  function updateGroup(index: number, patch: Partial<GroupDraft>) {
    setDraft((current) => ({
      ...current,
      groups: current.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    }))
  }

  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<GroupDraft["options"][number]>) {
    setDraft((current) => ({
      ...current,
      groups: current.groups.map((group, i) =>
        i === groupIndex
          ? { ...group, options: group.options.map((o, j) => (j === optionIndex ? { ...o, ...patch } : o)) }
          : group,
      ),
    }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData()
    if (editingId) formData.set("id", editingId)
    formData.set("name", draft.name)
    formData.set("description", draft.description)
    formData.set("price", draft.price)
    formData.set("imageUrl", draft.imageUrl)
    formData.set("isActive", String(draft.isActive))
    formData.set("stationId", draft.stationId)
    formData.set("modifierGroups", JSON.stringify(draft.groups))

    if (await run(() => saveMenuItem(formData))) setOpen(false)
  }

  async function confirmDelete() {
    if (!removing) return
    const formData = new FormData()
    formData.set("id", removing.id)
    if (await run(() => deleteMenuItem(formData))) setRemoving(null)
  }

  function toggle(item: ManagedMenuItem) {
    const formData = new FormData()
    formData.set("id", item.id)
    void run(() => toggleMenuItemActive(formData))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-h1">จัดการเมนูอาหาร</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เมนูที่ลูกค้าเห็นตอนสแกน QR — ปิดใช้งานเพื่อซ่อนชั่วคราวโดยไม่เสียประวัติการขาย
          </p>
        </div>
        {allowed.includes("ADD") ? (
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          <IconPlus size={17} aria-hidden />
          เพิ่มเมนู
        </button>
        ) : null}
      </div>

      {/* เมนูตัวอย่างที่ระบบใส่ให้ตอนสร้างร้าน — บอกให้ชัดว่าไม่ใช่ของร้าน ลบได้เมื่อมีเมนูจริงแล้ว (2026-09-17) */}
      {items.some((item) => isSampleMenuName(item.name)) ? (
        <div className="alert-banner info">
          เมนูที่ขึ้นต้นด้วย “[ตัวอย่าง]” คือเมนูตัวอย่างที่ระบบใส่ให้ตอนสร้างร้านเพื่อให้ลองสั่ง/ดู KDS ได้ทันที —
          ลบทิ้งได้เลยเมื่อเพิ่มเมนูของร้านแล้ว (ปุ่มลบในแต่ละรายการ)
        </div>
      ) : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            ทั้งหมด <span className="num">{items.length}</span> รายการ
          </h2>
        </div>

        {items.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีเมนูในระบบ — เพิ่มเมนูก่อน ลูกค้าถึงจะสั่งอาหารผ่าน QR ได้
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>เมนู</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ราคา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ตัวเลือกเสริม</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid var(--line)", opacity: item.isActive ? 1 : 0.6 }}>
                    <td style={{ padding: "12px 24px" }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      {item.isFeatured ? <span className="t-caption"> · เมนูแนะนำ</span> : null}
                      {stations.length > 0 ? (
                        <span className="t-caption"> · {item.stationName ?? UNASSIGNED_STATION_LABEL}</span>
                      ) : null}
                      {item.description ? (
                        <>
                          <br />
                          <span className="t-caption">{item.description}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      ฿{formatBaht(item.price)}
                    </td>
                    <td className="t-caption" style={{ padding: "12px" }}>
                      {item.modifierGroups.length === 0
                        ? "—"
                        : item.modifierGroups.map((g) => `${g.name} (${g.options.length})`).join(", ")}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span className={`chip ${item.isActive ? "chip-success" : "chip-neutral"}`}>
                        <span className="dot" />
                        {item.isActive ? "เปิดขาย" : "ปิดขาย"}
                      </span>
                      {item.orderedCount > 0 ? (
                        <span className="t-caption"> · สั่งไปแล้ว {formatNumber(item.orderedCount)}</span>
                      ) : null}
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        {allowed.includes("EDIT") ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-subtle btn-sm"
                              disabled={pending}
                              onClick={() => toggle(item)}
                            >
                              {item.isActive ? "ปิดขาย" : "เปิดขาย"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-subtle btn-sm"
                              disabled={pending}
                              onClick={() => startEdit(item)}
                            >
                              แก้ไข
                            </button>
                          </>
                        ) : null}
                        {allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={pending || item.orderedCount > 0}
                            title={item.orderedCount > 0 ? "เคยถูกสั่งแล้ว ลบไม่ได้ — ให้ปิดขายแทน" : undefined}
                            onClick={() => setRemoving(item)}
                          >
                            <IconTrash size={15} aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? `แก้ไขเมนู ${draft.name}` : "เพิ่มเมนูใหม่"}</DialogTitle>
            <DialogDescription>
              ตัวเลือกเสริมคือสิ่งที่ลูกค้าเลือกก่อนใส่ตะกร้า เช่น ระดับความเผ็ด หรือท็อปปิ้งที่คิดเงินเพิ่ม
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="menuName">
                  ชื่อเมนู
                </label>
                <input
                  id="menuName"
                  className="input"
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
              </div>

              <div className="field">
                <label className="t-small" htmlFor="menuPrice">
                  ราคา (บาท)
                </label>
                <input
                  id="menuPrice"
                  className="input num"
                  inputMode="decimal"
                  required
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
                {fieldErrors.price ? <span className="field-hint error">{fieldErrors.price}</span> : null}
              </div>
            </div>

            {/* ประเภทครัว (Phase 19) — ครัวไหนรับผิดชอบเมนูนี้ · KDS แยกแท็บและทิกเก็ตจัดกลุ่มตามค่านี้ */}
            <div className="field">
              <label className="t-small" htmlFor="menuStation">
                ประเภทครัว
              </label>
              <select
                id="menuStation"
                className="select"
                value={draft.stationId}
                onChange={(e) => setDraft({ ...draft, stationId: e.target.value })}
              >
                <option value="">{UNASSIGNED_STATION_LABEL}</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {stations.length === 0
                  ? "ยังไม่มีประเภทครัว — เพิ่มได้ที่การ์ด “ประเภทครัว” ด้านล่างของหน้านี้"
                  : "จอครัวแยกแท็บตามประเภทนี้ และทิกเก็ตจัดกลุ่มรายการให้ครัวแต่ละส่วน"}
              </span>
              {fieldErrors.stationId ? <span className="field-hint error">{fieldErrors.stationId}</span> : null}
            </div>

            <div className="field">
              <label className="t-small" htmlFor="menuDescription">
                คำอธิบาย (ไม่บังคับ)
              </label>
              <input
                id="menuDescription"
                className="input"
                maxLength={300}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <ImagePicker
              name="imageUrl"
              label="รูปเมนู (ไม่บังคับ)"
              value={draft.imageUrl}
              onChange={(value) => setDraft({ ...draft, imageUrl: value })}
              error={fieldErrors.imageUrl}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              <span>
                เปิดขายเมนูนี้
                <br />
                <span className="t-caption">ปิดไว้ = ซ่อนจากเมนูฝั่งลูกค้าโดยไม่เสียประวัติการขาย</span>
              </span>
            </label>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <h3 className="t-h3">ตัวเลือกเสริม</h3>
                <button
                  type="button"
                  className="btn btn-subtle btn-sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      groups: [
                        ...draft.groups,
                        { name: "", selectionType: "SINGLE", required: false, options: [{ name: "", priceDelta: 0 }] },
                      ],
                    })
                  }
                >
                  <IconPlus size={15} aria-hidden />
                  เพิ่มกลุ่ม
                </button>
              </div>

              {draft.groups.length === 0 ? (
                <p className="t-caption">ยังไม่มีตัวเลือกเสริม — เมนูนี้ลูกค้าจะสั่งได้ทันทีโดยไม่ต้องเลือกอะไร</p>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {draft.groups.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}
                  >
                    <div className="field-grid">
                      <div className="field">
                        <label className="t-small">ชื่อกลุ่ม</label>
                        <input
                          className="input"
                          placeholder="เช่น ระดับความเผ็ด"
                          value={group.name}
                          onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label className="t-small">เลือกได้</label>
                        <select
                          className="select"
                          value={group.selectionType}
                          onChange={(e) =>
                            updateGroup(groupIndex, { selectionType: e.target.value as GroupDraft["selectionType"] })
                          }
                        >
                          <option value="SINGLE">เลือกได้ 1 อย่าง</option>
                          <option value="MULTIPLE">เลือกได้หลายอย่าง</option>
                        </select>
                      </div>
                    </div>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={group.required}
                        onChange={(e) => updateGroup(groupIndex, { required: e.target.checked })}
                      />
                      <span className="t-small">บังคับเลือก</span>
                    </label>

                    {group.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="row" style={{ gap: 8 }}>
                        <input
                          className="input"
                          placeholder="ชื่อตัวเลือก"
                          value={option.name}
                          onChange={(e) => updateOption(groupIndex, optionIndex, { name: e.target.value })}
                        />
                        <input
                          className="input num"
                          inputMode="decimal"
                          style={{ maxWidth: 120 }}
                          placeholder="+ บาท"
                          value={String(option.priceDelta)}
                          onChange={(e) =>
                            updateOption(groupIndex, optionIndex, { priceDelta: Number(e.target.value) || 0 })
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            updateGroup(groupIndex, {
                              options: group.options.filter((_, j) => j !== optionIndex),
                            })
                          }
                        >
                          <IconTrash size={15} aria-hidden />
                        </button>
                      </div>
                    ))}

                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        onClick={() =>
                          updateGroup(groupIndex, { options: [...group.options, { name: "", priceDelta: 0 }] })
                        }
                      >
                        เพิ่มตัวเลือก
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() =>
                          setDraft({ ...draft, groups: draft.groups.filter((_, i) => i !== groupIndex) })
                        }
                      >
                        ลบกลุ่มนี้
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                บันทึก
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ลบเมนู {removing?.name}</DialogTitle>
            <DialogDescription>
              ลบได้เฉพาะเมนูที่ยังไม่เคยถูกสั่ง — ถ้าเคยขายไปแล้วให้ใช้ &ldquo;ปิดขาย&rdquo; แทน
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)}>
              ไม่ลบ
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={pending} onClick={confirmDelete}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
              ยืนยันลบ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
