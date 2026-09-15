"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStore } from "@/app/actions/onboarding"
import type { FieldErrors } from "@/lib/types"
import { IconStore } from "@/components/icons"

/// ฟอร์มสร้างร้าน (Phase 14a) — slug เดาจากชื่อให้อัตโนมัติจนกว่าผู้ใช้จะแก้เอง
/// สีธีมเริ่มต้นเป็นสีแบรนด์ฝั่งลูกค้าตาม design system (ค่าเดียวกับ provisionStore)

const DEFAULT_THEME = "#E8571F"

/// ชื่อไทยแปลงเป็น slug ไม่ได้ (ไม่มีอักษรละติน) → ได้ค่าว่าง แล้วผู้ใช้ต้องกรอกเอง
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
}

export function OnboardingForm({ hasExistingStore }: { hasExistingStore: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME)

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData()
    formData.set("name", name)
    formData.set("slug", slug)
    formData.set("themeColor", themeColor)

    try {
      const result = await createStore(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      // cookie ชี้ร้านใหม่แล้ว — โหลด layout ใหม่ให้ sidebar/topbar เห็นร้าน
      router.push("/")
      router.refresh()
    } catch {
      toast.error("สร้างร้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      <div className="field">
        <label className="t-small" htmlFor="name">
          ชื่อร้าน
        </label>
        <input
          id="name"
          className="input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          required
          minLength={2}
          maxLength={60}
          placeholder="เช่น ครัวคุณแม่ สาขาลาดพร้าว"
          autoFocus
        />
        <span className="field-hint">ลูกค้าเห็นชื่อนี้ตอนสแกน QR — แก้ทีหลังได้ที่ ตั้งค่าร้าน</span>
        {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
      </div>

      <div className="field">
        <label className="t-small" htmlFor="slug">
          รหัสร้าน (slug)
        </label>
        <input
          id="slug"
          className="input num"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(e.target.value.toLowerCase())
          }}
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9-]{3,30}"
          placeholder="เช่น mom-kitchen-ladprao"
          autoComplete="off"
        />
        <span className="field-hint">ตัวพิมพ์เล็ก a–z ตัวเลข และ - เท่านั้น ยาว 3–30 ตัว · ใช้ในรายงานและสคริปต์ เปลี่ยนภายหลังไม่ได้</span>
        {fieldErrors.slug ? <span className="field-hint error">{fieldErrors.slug}</span> : null}
      </div>

      <div className="field">
        <label className="t-small" htmlFor="themeColor">
          สีแบรนด์ (เฉพาะหน้าฝั่งลูกค้า)
        </label>
        <div className="row" style={{ gap: 10 }}>
          <input
            id="themeColor"
            type="color"
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value)}
            style={{ width: 52, height: 40, padding: 2, border: "1px solid var(--line)", borderRadius: 8 }}
          />
          <input
            className="input num"
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value)}
            maxLength={7}
            aria-label="รหัสสี hex"
          />
        </div>
        {fieldErrors.themeColor ? <span className="field-hint error">{fieldErrors.themeColor}</span> : null}
      </div>

      <div className="alert-banner info">
        ระบบจะเตรียมโต๊ะตัวอย่าง 4 โต๊ะพร้อม QR และเมนูตัวอย่าง 3 รายการให้ลองกดได้ทันที — ลบหรือแก้ทีหลังได้ทั้งหมด
      </div>

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        {hasExistingStore ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => router.back()}>
            ยกเลิก
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <IconStore size={17} aria-hidden />
          {pending ? "กำลังสร้างร้าน…" : hasExistingStore ? "สร้างร้านเพิ่ม" : "สร้างร้านของฉัน"}
        </button>
      </div>
    </form>
  )
}
