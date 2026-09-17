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

export type OnboardingBrandProps = {
  /// แบรนด์ของผู้ใช้ (Phase 14c) — null = ไม่มี ไม่แสดงตัวเลือก
  brand: { id: string; name: string } | null
  /// ร้านที่ผู้ใช้เป็น OWNER — เป็นต้นทางคัดลอกเมนูได้
  ownedStores: { id: string; name: string }[]
  /// เปิดหน้าด้วย ?brand=1 (มาจากหน้าแบรนด์) → ติ๊ก "อยู่ใต้แบรนด์" ให้ล่วงหน้า
  joinBrandDefault: boolean
  /// ชื่อร้านของผู้ใช้ที่เคยรับสิทธิ์ทดลอง 7 วันไปแล้ว — ว่าง = ยังไม่เคย · ร้านใหม่รับซ้ำด้วยเลขพร้อมเพย์เดิมไม่ได้
  trialUsedAt?: string[]
}

export function OnboardingForm({
  hasExistingStore,
  brand,
  ownedStores,
  joinBrandDefault,
  trialUsedAt = [],
}: { hasExistingStore: boolean } & OnboardingBrandProps) {
  const router = useRouter()
  const [joinBrand, setJoinBrand] = useState(joinBrandDefault && brand !== null)
  // ร้านที่ 2 ขึ้นไปต้องรับรู้ก่อนว่าจะยังขายไม่ได้จนกว่าจะเปิดแพ็กเกจ — กันสร้างเสร็จแล้วงงว่าทำไมเปิดใช้งานไม่ได้
  const trialUsed = trialUsedAt.length > 0
  const [ackNoTrial, setAckNoTrial] = useState(!trialUsed)
  const [copyFrom, setCopyFrom] = useState("")
  // ใส่เมนูตัวอย่าง 3 รายการไหม (2026-09-17) — ค่าเริ่มต้นใส่ · ถูกข้ามอัตโนมัติเมื่อคัดลอกเมนูจากสาขาอื่น
  const [sampleMenu, setSampleMenu] = useState(true)
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
    if (joinBrand && brand) formData.set("joinBrand", "on")
    if (copyFrom) formData.set("copyMenuFromStoreId", copyFrom)
    formData.set("sampleMenu", sampleMenu ? "on" : "off")

    try {
      const result = await createStore(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      // cookie ชี้ร้านใหม่แล้ว — พาไปหน้าค่าใช้งานเพื่อรับสิทธิ์ทดลอง/เลือกแพ็กเกจก่อนเริ่มขาย (Phase 14b)
      router.push("/billing")
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

      {brand ? (
        <label className="checkbox-row">
          <input type="checkbox" checked={joinBrand} onChange={(e) => setJoinBrand(e.target.checked)} />
          <span>
            สร้างเป็นสาขาใต้แบรนด์ <strong>{brand.name}</strong>
            <span className="t-caption" style={{ display: "block" }}>
              รวมรายงานและจ่ายค่าใช้งานใบเดียวกับสาขาอื่นได้ · เมนู/โต๊ะ/QR ยังแยกของสาขานี้เอง
            </span>
          </span>
        </label>
      ) : null}

      {ownedStores.length > 0 ? (
        <div className="field">
          <label className="t-small" htmlFor="copyMenuFromStoreId">
            คัดลอกเมนูจากสาขาไหน
          </label>
          <select id="copyMenuFromStoreId" className="select" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">— ไม่คัดลอก ใช้เมนูตัวอย่าง 3 รายการ —</option>
            {ownedStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="field-hint">ได้สำเนาอิสระ (เมนู + ตัวเลือกเสริม) แก้ราคาที่สาขาใหม่ไม่กระทบต้นทาง</span>
          {fieldErrors.copyMenuFromStoreId ? <span className="field-hint error">{fieldErrors.copyMenuFromStoreId}</span> : null}
        </div>
      ) : null}

      {copyFrom ? null : (
        <label className="checkbox-row">
          <input type="checkbox" checked={sampleMenu} onChange={(e) => setSampleMenu(e.target.checked)} />
          <span>
            ใส่เมนูตัวอย่าง 3 รายการให้ลองใช้
            <span className="t-caption" style={{ display: "block" }}>
              ชื่อเมนูจะขึ้นต้นด้วย “[ตัวอย่าง]” ให้รู้ว่าไม่ใช่เมนูจริง — ลบทิ้งได้ที่ จัดการเมนูอาหาร เมื่อเพิ่มเมนูของร้านแล้ว
            </span>
          </span>
        </label>
      )}

      {trialUsed ? (
        <div className="alert-banner warning" style={{ display: "block" }}>
          <strong>ร้านใหม่นี้จะรับสิทธิ์ทดลองฟรี 7 วันซ้ำไม่ได้</strong> — คุณใช้สิทธิ์ไปแล้วที่ร้าน {trialUsedAt.join(", ")}
          (สิทธิ์ทดลองใช้ได้ครั้งเดียวต่อเลขพร้อมเพย์ ทั่วทั้งระบบ) · สร้างร้านได้ แต่จะ<strong>เปิดโต๊ะ/ขาย/รับออเดอร์ไม่ได้</strong>
          จนกว่าจะเลือกแพ็กเกจที่หน้า ค่าใช้งาน ของร้านนั้น หรือรับทดลองด้วยเลขพร้อมเพย์อื่นที่ยังไม่เคยใช้
          <label className="checkbox-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={ackNoTrial} onChange={(e) => setAckNoTrial(e.target.checked)} />
            <span>เข้าใจแล้ว — ร้านใหม่ต้องเปิดแพ็กเกจก่อนจึงจะขายได้</span>
          </label>
        </div>
      ) : hasExistingStore ? (
        <div className="alert-banner info">
          สิทธิ์ทดลองฟรี 7 วันใช้ได้ครั้งเดียวต่อเลขพร้อมเพย์ — ร้านใหม่รับทดลองได้เฉพาะเลขที่ยังไม่เคยใช้ ไม่งั้นต้องเลือกแพ็กเกจก่อนขาย
        </div>
      ) : null}

      <div className="alert-banner info">
        ระบบจะเตรียมโต๊ะตัวอย่าง 4 โต๊ะพร้อม QR{copyFrom ? " และคัดลอกเมนูจากสาขาที่เลือก" : sampleMenu ? " และเมนูตัวอย่าง 3 รายการ" : ""} ให้ลองกดได้ทันที —
        ลบหรือแก้ทีหลังได้ทั้งหมด
      </div>

      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        {hasExistingStore ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => router.back()}>
            ยกเลิก
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending || !ackNoTrial}>
          <IconStore size={17} aria-hidden />
          {pending ? "กำลังสร้างร้าน…" : hasExistingStore ? "สร้างร้านเพิ่ม" : "สร้างร้านของฉัน"}
        </button>
      </div>
    </form>
  )
}
