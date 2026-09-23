"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveTherapist, deleteTherapist, toggleTherapistActive } from "@/app/actions/therapists"
import { formatDate, formatNumber } from "@/lib/format"
import type { KitchenStationRow, TherapistRow } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconPlus, IconSpinner, IconTherapist, IconTrash } from "@/components/icons"
import { ImagePicker } from "@/components/image-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// จัดการพนักงานนวด (Phase 20a) — ประวัติ + ทักษะ (ประเภทบริการ) + เปิด/ปิดใช้งาน · สิทธิ์ SPA_THERAPISTS
/// กะ/เวลาว่าง/ตารางจอง เป็นของ 20b — หน้านี้โชว์แค่ "กำลังนวดอยู่ตอนนี้" จากออร์เดอร์ที่ค้าง

const EMPTY = {
  code: "",
  name: "",
  nickname: "",
  phone: "",
  gender: "",
  startedAt: "",
  note: "",
  imageUrl: "",
  isActive: true,
  skillIds: [] as string[],
}

const GENDER_LABEL: Record<string, string> = { F: "หญิง", M: "ชาย", OTHER: "อื่น ๆ" }

export function TherapistManager({
  therapists,
  stations,
  allowed = FULL_ACCESS,
}: {
  therapists: TherapistRow[]
  /// ประเภทบริการของร้าน (KitchenStation) — ใช้เป็นตัวเลือกทักษะ
  stations: KitchenStationRow[]
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [removing, setRemoving] = useState<TherapistRow | null>(null)

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

  function startCreate() {
    setEditingId(null)
    // รหัสถัดไปแบบเดา: เลขมากสุด + 1 เติมศูนย์ 3 หลัก — แก้ได้เอง
    const numbers = therapists.map((t) => Number(t.code)).filter((n) => Number.isFinite(n))
    const next = numbers.length ? String(Math.max(...numbers) + 1).padStart(3, "0") : "001"
    setDraft({ ...EMPTY, code: next })
    setFieldErrors({})
    setOpen(true)
  }

  function startEdit(t: TherapistRow) {
    setEditingId(t.id)
    setDraft({
      code: t.code,
      name: t.name,
      nickname: t.nickname ?? "",
      phone: t.phone ?? "",
      gender: t.gender ?? "",
      startedAt: t.startedAt ? t.startedAt.toISOString().slice(0, 10) : "",
      note: t.note ?? "",
      imageUrl: t.imageUrl ?? "",
      isActive: t.isActive,
      skillIds: t.skills.map((s) => s.id),
    })
    setFieldErrors({})
    setOpen(true)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData()
    if (editingId) fd.set("id", editingId)
    fd.set("code", draft.code)
    fd.set("name", draft.name)
    fd.set("nickname", draft.nickname)
    fd.set("phone", draft.phone)
    fd.set("gender", draft.gender)
    fd.set("startedAt", draft.startedAt)
    fd.set("note", draft.note)
    fd.set("imageUrl", draft.imageUrl)
    fd.set("isActive", String(draft.isActive))
    fd.set("skillIds", draft.skillIds.join(","))
    if (await run(() => saveTherapist(fd))) setOpen(false)
  }

  function toggleSkill(id: string) {
    setDraft((d) => ({ ...d, skillIds: d.skillIds.includes(id) ? d.skillIds.filter((s) => s !== id) : [...d.skillIds, id] }))
  }

  function toggleActive(t: TherapistRow) {
    const fd = new FormData()
    fd.set("id", t.id)
    void run(() => toggleTherapistActive(fd))
  }

  async function confirmDelete() {
    if (!removing) return
    const fd = new FormData()
    fd.set("id", removing.id)
    if (await run(() => deleteTherapist(fd))) setRemoving(null)
  }

  const active = therapists.filter((t) => t.isActive)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านนวด</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconTherapist size={22} aria-hidden />
              พนักงานนวด
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ประวัติและทักษะของพนักงานนวด — จอขายจะให้เลือกเฉพาะคนที่เปิดใช้งานและมีทักษะตรงกับโปรแกรม
          </p>
        </div>
        {allowed.includes("ADD") ? (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            <IconPlus size={17} aria-hidden />
            เพิ่มพนักงานนวด
          </button>
        ) : null}
      </div>

      {stations.length === 0 ? (
        <div className="alert-banner info">
          ยังไม่มี “ประเภทบริการ” (เช่น นวดไทย นวดเท้า อโรม่า) — เพิ่มได้ที่การ์ด “ประเภทครัว/บริการ” ในหน้าจัดการเมนู
          แล้วค่อยกลับมาติ๊กทักษะให้พนักงาน ไม่งั้นระบบจะจับคู่พนักงานกับโปรแกรมนวดไม่ได้
        </div>
      ) : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            ทั้งหมด <span className="num">{therapists.length}</span> คน · เปิดใช้งาน <span className="num">{active.length}</span>
          </h2>
        </div>

        {therapists.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีพนักงานนวด — เพิ่มพนักงานก่อน จอขายถึงจะเลือกคนนวดให้โปรแกรมได้
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>รหัส / ชื่อ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ทักษะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ติดต่อ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {therapists.map((t) => (
                  <tr key={t.id} style={{ borderTop: "1px solid var(--line)", opacity: t.isActive ? 1 : 0.6 }}>
                    <td style={{ padding: "12px 24px" }}>
                      <span className="row" style={{ gap: 10 }}>
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.imageUrl} alt="" width={36} height={36} style={{ borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          <span
                            aria-hidden
                            className="num"
                            style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontWeight: 700 }}
                          >
                            {t.code}
                          </span>
                        )}
                        <span>
                          <span className="num" style={{ fontWeight: 700 }}>{t.code}</span> {t.nickname ?? t.name}
                          {t.nickname ? <span className="t-caption"> ({t.name})</span> : null}
                          <br />
                          <span className="t-caption">
                            {t.gender ? `${GENDER_LABEL[t.gender] ?? t.gender} · ` : ""}
                            {t.startedAt ? `เริ่มงาน ${formatDate(t.startedAt)} · ` : ""}
                            ให้บริการแล้ว {formatNumber(t.servedCount)} ครั้ง
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="t-caption" style={{ padding: "12px" }}>
                      {t.skills.length === 0 ? "— (ทำได้ทุกโปรแกรมที่ไม่ระบุประเภท)" : t.skills.map((s) => s.name).join(", ")}
                    </td>
                    <td className="t-caption num" style={{ padding: "12px" }}>
                      {t.phone ?? "—"}
                    </td>
                    <td style={{ padding: "12px" }}>
                      {!t.isActive ? (
                        <span className="chip chip-neutral">
                          <span className="dot" />
                          ปิดใช้งาน
                        </span>
                      ) : t.busyNow ? (
                        <span className="chip chip-warning">
                          <span className="dot" />
                          กำลังนวด
                        </span>
                      ) : (
                        <span className="chip chip-success">
                          <span className="dot" />
                          ว่าง
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        {allowed.includes("EDIT") ? (
                          <>
                            <button type="button" className="btn btn-subtle btn-sm" disabled={pending} onClick={() => toggleActive(t)}>
                              {t.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                            </button>
                            <button type="button" className="btn btn-subtle btn-sm" disabled={pending} onClick={() => startEdit(t)}>
                              แก้ไข
                            </button>
                          </>
                        ) : null}
                        {allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={pending || t.servedCount > 0}
                            title={t.servedCount > 0 ? "มีประวัติให้บริการแล้ว ลบไม่ได้ — ให้ปิดใช้งานแทน" : undefined}
                            onClick={() => setRemoving(t)}
                            aria-label={`ลบพนักงาน ${t.code}`}
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? `แก้ไขพนักงาน ${draft.code}` : "เพิ่มพนักงานนวด"}</DialogTitle>
            <DialogDescription>ทักษะคือประเภทบริการที่พนักงานคนนี้ทำได้ — จอขายจะกรองให้เลือกเฉพาะคนที่ตรงกับโปรแกรม</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="thCode">
                  รหัสพนักงาน <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="thCode"
                  className="input num"
                  required
                  maxLength={12}
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                  placeholder="001"
                />
                {fieldErrors.code ? <span className="field-hint error">{fieldErrors.code}</span> : null}
              </div>
              <div className="field">
                <label className="t-small" htmlFor="thName">
                  ชื่อ-นามสกุล <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input id="thName" className="input" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="thNick">
                  ชื่อเล่น (ที่ลูกค้าเรียก)
                </label>
                <input id="thNick" className="input" maxLength={40} value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} />
              </div>
              <div className="field">
                <label className="t-small" htmlFor="thPhone">
                  เบอร์โทร
                </label>
                <input id="thPhone" className="input num" inputMode="tel" maxLength={20} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                {fieldErrors.phone ? <span className="field-hint error">{fieldErrors.phone}</span> : null}
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="thGender">
                  เพศ
                </label>
                <select id="thGender" className="select" value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}>
                  <option value="">ไม่ระบุ</option>
                  <option value="F">หญิง</option>
                  <option value="M">ชาย</option>
                  <option value="OTHER">อื่น ๆ</option>
                </select>
              </div>
              <div className="field">
                <label className="t-small" htmlFor="thStart">
                  วันเริ่มงาน
                </label>
                <input id="thStart" type="date" className="input num" value={draft.startedAt} onChange={(e) => setDraft({ ...draft, startedAt: e.target.value })} />
                {fieldErrors.startedAt ? <span className="field-hint error">{fieldErrors.startedAt}</span> : null}
              </div>
            </div>

            <div className="field">
              <span className="t-small">ทักษะ / ประเภทบริการที่ทำได้</span>
              {stations.length === 0 ? (
                <span className="field-hint">ยังไม่มีประเภทบริการในร้าน</span>
              ) : (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {stations.map((s) => {
                    const on = draft.skillIds.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`btn btn-sm ${on ? "btn-primary" : "btn-subtle"}`}
                        aria-pressed={on}
                        onClick={() => toggleSkill(s.id)}
                      >
                        {s.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <span className="field-hint">ไม่ติ๊กเลย = เลือกได้เฉพาะโปรแกรมที่ไม่ระบุประเภทบริการ</span>
              {fieldErrors.skillIds ? <span className="field-hint error">{fieldErrors.skillIds}</span> : null}
            </div>

            <ImagePicker
              name="imageUrl"
              label="รูปพนักงาน (ไม่บังคับ)"
              value={draft.imageUrl}
              onChange={(value) => setDraft({ ...draft, imageUrl: value })}
              error={fieldErrors.imageUrl}
            />

            <div className="field">
              <label className="t-small" htmlFor="thNote">
                หมายเหตุ
              </label>
              <input id="thNote" className="input" maxLength={300} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="เช่น ถนัดนวดแรง / วันหยุดประจำ" />
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              <span>เปิดใช้งาน (ขึ้นให้เลือกบนจอขาย/ตารางจอง)</span>
            </label>

            <DialogFooter>
              <button type="button" className="btn btn-subtle" onClick={() => setOpen(false)} disabled={pending}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
                {editingId ? "บันทึก" : "เพิ่มพนักงาน"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ลบพนักงาน {removing?.code}</DialogTitle>
            <DialogDescription>ลบได้เฉพาะคนที่ยังไม่มีประวัติให้บริการ — ถ้ามีแล้วให้ “ปิดใช้งาน” แทน</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="btn btn-subtle" onClick={() => setRemoving(null)} disabled={pending}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-danger-solid" onClick={() => void confirmDelete()} disabled={pending}>
              ยืนยันลบ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
