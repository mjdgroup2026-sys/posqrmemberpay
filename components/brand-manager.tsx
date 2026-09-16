"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { attachStoreToBrand, copyMenuFromStore, createBrand, renameBrand } from "@/app/actions/brand"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconCopy, IconPlus, IconStore } from "@/components/icons"

/// ฟอร์มฝั่งเจ้าของแบรนด์บนหน้า /brand (Phase 14c) — ด่านจริงคือ requireUser()/requireOwner() + brand.ownerId ใน action

function useRun() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  async function run<T>(action: (formData: FormData) => Promise<ActionResult<T>>, formData: FormData, onDone?: () => void) {
    setPending(true)
    setFieldErrors({})
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message)
      onDone?.()
      router.refresh()
      return true
    } catch {
      toast.error("ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, fieldErrors }
}

type StoreOption = { id: string; name: string; slug: string }

/// ยังไม่มีแบรนด์ — ตั้งชื่อ + ติ๊กร้านที่ตัวเองเป็นเจ้าของเพื่อดึงเข้ามาทันที
export function CreateBrandForm({ attachable }: { attachable: StoreOption[] }) {
  const { run, pending, fieldErrors } = useRun()
  return (
    <form
      className="card-ui card-pad"
      onSubmit={(e) => {
        e.preventDefault()
        void run(createBrand, new FormData(e.currentTarget))
      }}
    >
      <h2 className="t-h2">สร้างแบรนด์</h2>
      <p className="t-caption" style={{ marginTop: 4 }}>
        แบรนด์เป็นแค่ชั้นบาง ๆ ครอบหลายสาขา — เมนู โต๊ะ QR รายงาน และแพ็กเกจยังแยกรายสาขาเหมือนเดิม
        คุณจะเป็นเจ้าของทุกสาขาใต้แบรนด์โดยอัตโนมัติ
      </p>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="brand-name">ชื่อแบรนด์</label>
        <input id="brand-name" name="name" className="input" required maxLength={60} placeholder="เช่น ครัวคุณแม่" autoComplete="organization" />
        {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
      </div>
      {attachable.length > 0 ? (
        <fieldset className="field" style={{ marginTop: 10, border: 0, padding: 0 }}>
          <legend className="t-small" style={{ fontWeight: 600 }}>
            ดึงร้านที่คุณเป็นเจ้าของเข้าแบรนด์ทันที
          </legend>
          {attachable.map((s) => (
            <label key={s.id} className="checkbox-row">
              <input type="checkbox" name="storeIds" value={s.id} defaultChecked />
              <span>
                {s.name} <span className="t-caption num">/{s.slug}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginTop: 12 }}>
        <IconPlus size={16} aria-hidden />
        สร้างแบรนด์
      </button>
    </form>
  )
}

export function RenameBrandForm({ name }: { name: string }) {
  const { run, pending, fieldErrors } = useRun()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpen(true)}>
        เปลี่ยนชื่อแบรนด์
      </button>
    )
  }
  return (
    <form
      className="row"
      style={{ gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault()
        void run(renameBrand, new FormData(e.currentTarget), () => setOpen(false))
      }}
    >
      <div className="field" style={{ flex: "1 1 200px" }}>
        <input name="name" className="input" defaultValue={name} required maxLength={60} autoFocus />
        {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
      </div>
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        บันทึก
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setOpen(false)}>
        ยกเลิก
      </button>
    </form>
  )
}

/// ดึงร้านที่ยังไม่อยู่ใต้แบรนด์เข้ามา (ทีละร้าน)
export function AttachStoreForm({ attachable }: { attachable: StoreOption[] }) {
  const { run, pending } = useRun()
  if (attachable.length === 0) {
    return (
      <p className="t-caption">
        ไม่มีร้านอื่นที่คุณเป็นเจ้าของนอกแบรนด์ —{" "}
        <Link href="/onboarding" className="btn btn-ghost btn-sm">
          <IconPlus size={14} aria-hidden />
          สร้างสาขาใหม่
        </Link>
      </p>
    )
  }
  return (
    <form
      className="row"
      style={{ gap: 6, flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault()
        void run(attachStoreToBrand, new FormData(e.currentTarget))
      }}
    >
      <select name="storeId" className="select" required style={{ minWidth: 200 }}>
        {attachable.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} (/{s.slug})
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        <IconStore size={14} aria-hidden />
        ดึงเข้าแบรนด์
      </button>
    </form>
  )
}

/// คัดลอกเมนูจากสาขาอื่นมาลงร้านที่ทำงานอยู่ — สำเนาอิสระ แก้ทีหลังไม่กระทบต้นทาง
export function CopyMenuForm({ activeStoreName, sources }: { activeStoreName: string; sources: StoreOption[] }) {
  const { run, pending } = useRun()
  if (sources.length === 0) return null
  return (
    <form
      className="row"
      style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        if (!confirm(`คัดลอกเมนูมาลง ${activeStoreName}? รายการที่ชื่อซ้ำจะถูกข้าม ไม่ทับของเดิม`)) return
        void run(copyMenuFromStore, fd)
      }}
    >
      <span className="t-small">คัดลอกเมนูจาก</span>
      <select name="sourceStoreId" className="select" required style={{ minWidth: 200 }}>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="t-small">
        → <strong>{activeStoreName}</strong> (ร้านที่ทำงานอยู่)
      </span>
      <button type="submit" className="btn btn-subtle btn-sm" disabled={pending}>
        <IconCopy size={14} aria-hidden />
        คัดลอก
      </button>
    </form>
  )
}
