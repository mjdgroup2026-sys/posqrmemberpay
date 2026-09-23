"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateStoreSettings, setFeaturedMenu } from "@/app/actions/settings"
import { formatBaht, formatNumber } from "@/lib/format"
import { MAX_FEATURED_MENU } from "@/lib/validation"
import type { FeaturableMenuItem } from "@/lib/queries"
import type { FieldErrors } from "@/lib/types"
import { IconSpinner, IconStore } from "@/components/icons"
import { ImagePicker } from "@/components/image-picker"

export type StoreSettingsValues = {
  storeName: string
  themeColor: string
  logoUrl: string | null
  coverImageUrl: string | null
  serviceChargePercent: number
  hasKDS: boolean
  /// จอครัว (Phase 19)
  kitchenAlertSound: boolean
  kitchenAutoPrint: boolean
  /// ตัวเลือกร้านนวด (Phase 20)
  spaEnabled: boolean
  /// พักระหว่างคิวนวด (นาที) — StoreSettings.bookingBufferMinutes
  bookingBufferMinutes: number
  crmEnabled: boolean
  /// โหมดเริ่มต้นของจอขายอาหาร (2026-09-17)
  posDefaultMode: "TABLE" | "TAKEAWAY"
}

export function StoreSettingsForm({
  settings,
  menu,
  openSessionCount,
}: {
  settings: StoreSettingsValues
  menu: FeaturableMenuItem[]
  openSessionCount: number
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [themeColor, setThemeColor] = useState(settings.themeColor)
  // รูปคุมด้วย state เพราะ ImagePicker อัปโหลดแล้วเปลี่ยนค่าเองก่อนกดบันทึก (Phase 17a)
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl ?? "")
  const [coverImageUrl, setCoverImageUrl] = useState(settings.coverImageUrl ?? "")
  const [hasKDS, setHasKDS] = useState(settings.hasKDS)
  const [kitchenAlertSound, setKitchenAlertSound] = useState(settings.kitchenAlertSound)
  const [kitchenAutoPrint, setKitchenAutoPrint] = useState(settings.kitchenAutoPrint)
  const [spaEnabled, setSpaEnabled] = useState(settings.spaEnabled)
  const [crmEnabled, setCrmEnabled] = useState(settings.crmEnabled)
  const [posDefaultMode, setPosDefaultMode] = useState<"TABLE" | "TAKEAWAY">(settings.posDefaultMode)

  const [featured, setFeatured] = useState<string[]>(
    menu.filter((m) => m.isFeatured).map((m) => m.id),
  )
  const [savingFeatured, setSavingFeatured] = useState(false)

  const kdsLocked = openSessionCount > 0

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData(event.currentTarget)
    formData.set("themeColor", themeColor)
    formData.set("hasKDS", String(hasKDS))
    formData.set("kitchenAlertSound", String(kitchenAlertSound))
    formData.set("kitchenAutoPrint", String(kitchenAutoPrint))
    formData.set("spaEnabled", String(spaEnabled))
    formData.set("posDefaultMode", posDefaultMode)
    formData.set("crmEnabled", String(crmEnabled))

    try {
      const result = await updateStoreSettings(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  function toggleFeatured(id: string) {
    setFeatured((current) => {
      if (current.includes(id)) return current.filter((v) => v !== id)
      if (current.length >= MAX_FEATURED_MENU) {
        toast.error(`ปักหมุดได้สูงสุด ${MAX_FEATURED_MENU} รายการ — ถอดรายการอื่นออกก่อน`)
        return current
      }
      return [...current, id]
    })
  }

  function move(id: string, delta: number) {
    setFeatured((current) => {
      const index = current.indexOf(id)
      const next = index + delta
      if (index === -1 || next < 0 || next >= current.length) return current
      const copy = [...current]
      ;[copy[index], copy[next]] = [copy[next] as string, copy[index] as string]
      return copy
    })
  }

  async function saveFeatured() {
    setSavingFeatured(true)
    const formData = new FormData()
    formData.set("menuItemIds", featured.join(","))
    try {
      const result = await setFeaturedMenu(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("บันทึกเมนูแนะนำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setSavingFeatured(false)
    }
  }

  const byId = new Map(menu.map((m) => [m.id, m]))

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="t-h1">ตั้งค่าร้าน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ชื่อร้าน โลโก้ สีธีม และเมนูแนะนำที่ลูกค้าเห็นตอนสแกน QR — แก้ที่นี่ได้เลย ไม่ต้องแก้โค้ด
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20, alignItems: "start" }}>
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 14 }}>
            แบรนด์และธีม
          </h2>

          <form onSubmit={saveSettings} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label className="t-small" htmlFor="storeName">
                ชื่อร้าน
              </label>
              <input
                id="storeName"
                name="storeName"
                className="input"
                required
                maxLength={80}
                defaultValue={settings.storeName}
              />
              {fieldErrors.storeName ? <span className="field-hint error">{fieldErrors.storeName}</span> : null}
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
              <span className="field-hint">
                มีผลกับหน้า /order/* เท่านั้น — หน้าหลังร้านใช้สีของระบบเสมอ
              </span>
              {fieldErrors.themeColor ? <span className="field-hint error">{fieldErrors.themeColor}</span> : null}
            </div>

            <ImagePicker
              name="logoUrl"
              label="โลโก้ร้าน (ไม่บังคับ)"
              value={logoUrl}
              onChange={setLogoUrl}
              error={fieldErrors.logoUrl}
            />

            <ImagePicker
              name="coverImageUrl"
              label="ภาพปกหน้าเมนู (ไม่บังคับ)"
              value={coverImageUrl}
              onChange={setCoverImageUrl}
              error={fieldErrors.coverImageUrl}
            />

            <div className="field">
              <label className="t-small" htmlFor="serviceChargePercent">
                ค่าบริการ (%)
              </label>
              <input
                id="serviceChargePercent"
                name="serviceChargePercent"
                className="input num"
                inputMode="decimal"
                defaultValue={settings.serviceChargePercent}
              />
              <span className="field-hint">บวกเข้ายอดบิลของ MJD Mobile Order ตอนปิดบิล · 0 = ไม่คิดค่าบริการ</span>
              {fieldErrors.serviceChargePercent ? (
                <span className="field-hint error">{fieldErrors.serviceChargePercent}</span>
              ) : null}
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={hasKDS}
                disabled={kdsLocked}
                onChange={(e) => setHasKDS(e.target.checked)}
              />
              <span>
                เปิดหน้าจอครัว (KDS)
                <br />
                <span className="t-caption">
                  {kdsLocked
                    ? `สลับไม่ได้ตอนนี้ — ยังมีโต๊ะเปิดอยู่ ${formatNumber(openSessionCount)} โต๊ะ`
                    : "ปิดไว้ = จัดการสถานะอาหารจากหน้ารายละเอียดโต๊ะแทน"}
                </span>
              </span>
            </label>

            {hasKDS ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 26 }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={kitchenAlertSound}
                    onChange={(e) => setKitchenAlertSound(e.target.checked)}
                  />
                  <span>
                    เสียงเตือนเมื่อมีออร์เดอร์ใหม่บนจอครัว
                    <br />
                    <span className="t-caption">
                      ข้อความเตือนขึ้นเสมอ · เสียงต้องกด “เปิดเสียงเตือน” บนจอครัวครั้งแรกของแต่ละเครื่อง (ข้อจำกัดของเบราว์เซอร์)
                    </span>
                  </span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={kitchenAutoPrint}
                    onChange={(e) => setKitchenAutoPrint(e.target.checked)}
                  />
                  <span>
                    เปิดกล่องพิมพ์ทิกเก็ตอัตโนมัติเมื่อออร์เดอร์เข้า (พิมพ์ผ่านเบราว์เซอร์/PDF)
                    <br />
                    <span className="t-caption">
                      ทำงานบนจอครัวที่เปิดค้างไว้ · ยังต้องกด “พิมพ์” ในกล่องของเบราว์เซอร์ 1 ครั้งต่อใบ เว้นแต่รัน Chrome ด้วย
                      --kiosk-printing · ร้านที่ต่อเครื่องพิมพ์ครัว (KITCHEN_PRINTER_HOST) พิมพ์เองอยู่แล้ว ไม่ต้องเปิด
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="field">
              <span className="t-small">โหมดเริ่มต้นของจอขายอาหาร</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`btn btn-sm ${posDefaultMode === "TABLE" ? "btn-primary" : "btn-subtle"}`}
                  onClick={() => setPosDefaultMode("TABLE")}
                >
                  ขายเข้าโต๊ะ
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${posDefaultMode === "TAKEAWAY" ? "btn-primary" : "btn-subtle"}`}
                  onClick={() => setPosDefaultMode("TAKEAWAY")}
                >
                  กลับบ้าน (รับเงินตอนสั่ง)
                </button>
              </div>
              <span className="field-hint">
                หน้า “ขายอาหาร” จะเปิดในโหมดนี้ทุกครั้ง — สลับได้ในหน้านั้นเหมือนเดิม · เข้าจากปุ่ม “สั่งเพิ่ม” ของโต๊ะยังเป็นโหมดโต๊ะเสมอ
              </span>
            </div>

            {/* ตัวเลือกร้านนวด (Phase 20) — เพิ่มจากของเดิม ไม่ใช่โหมดสลับ: เมนูอาหาร/โต๊ะ/ครัวยังใช้ร่วมกันได้ */}
            <label className="checkbox-row">
              <input type="checkbox" checked={spaEnabled} onChange={(e) => setSpaEnabled(e.target.checked)} />
              <span>
                เปิดตัวเลือกร้านนวด / สปา
                <br />
                <span className="t-caption">
                  เพิ่มเมนู “พนักงานนวด” · เมนูสร้างเป็น “โปรแกรมนวด” (มีระยะเวลา ต้องเลือกพนักงาน) · โต๊ะสร้างเป็น “ห้องนวด” ได้ ·
                  ของเดิมทั้งหมดยังอยู่และใช้ร่วมกันได้ (เช่น สั่งน้ำเข้าห้องนวด) — ปิดแล้วข้อมูลไม่หาย แค่ซ่อนเมนู
                </span>
              </span>
            </label>

            {/* พักระหว่างคิว (2026-09-23) — เดิมตั้งไว้ 10 นาทีโดยไม่มีที่ให้เปลี่ยน เจ้าของร้านจองต่อคิวที่ 17:31 ไม่ได้แล้วงงว่าทำไม */}
            {spaEnabled ? (
              <div className="field" style={{ maxWidth: 320 }}>
                <label className="t-small" htmlFor="bookingBufferMinutes">
                  พักระหว่างคิวนวด (นาที)
                </label>
                <input
                  id="bookingBufferMinutes"
                  name="bookingBufferMinutes"
                  type="number"
                  min={0}
                  max={120}
                  step={1}
                  className="input num"
                  defaultValue={settings.bookingBufferMinutes}
                />
                {fieldErrors.bookingBufferMinutes ? (
                  <span className="field-hint error">{fieldErrors.bookingBufferMinutes}</span>
                ) : (
                  <span className="field-hint">
                    เวลาเว้นว่างก่อนเริ่มคิวถัดไปของพนักงาน/ห้องเดียวกัน เช่น 10 = คิวจบ 17:30 เริ่มคิวถัดไปได้ตั้งแต่ 17:40 · ใส่ 0 = ต่อคิวได้ทันที
                  </span>
                )}
              </div>
            ) : null}

            <label className="checkbox-row">
              <input type="checkbox" checked={crmEnabled} onChange={(e) => setCrmEnabled(e.target.checked)} />
              <span>
                เปิดระบบสมาชิกสะสมแต้ม
                <br />
                <span className="t-caption">ลูกค้าสมัครด้วยเบอร์โทรบนหน้าชำระเงินสำเร็จ</span>
              </span>
            </label>

            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconStore size={17} aria-hidden />}
              บันทึกการตั้งค่า
            </button>
          </form>
        </section>

        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 4 }}>
            เมนูแนะนำ
          </h2>
          <p className="t-caption" style={{ marginBottom: 14 }}>
            ปักหมุดได้สูงสุด {MAX_FEATURED_MENU} รายการ — ลำดับด้านล่างคือลำดับที่ลูกค้าเห็น
          </p>

          {featured.length === 0 ? (
            <p className="t-body" style={{ marginBottom: 14 }}>ยังไม่ได้ปักหมุดเมนูใด</p>
          ) : (
            <ol style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {featured.map((id, index) => {
                const item = byId.get(id)
                return (
                  <li
                    key={id}
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                    }}
                  >
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="chip chip-brand num">{index + 1}</span>
                      <span style={{ fontWeight: 500 }}>{item?.name ?? "(ไม่พบเมนู)"}</span>
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={index === 0}
                        onClick={() => move(id, -1)}
                        aria-label="เลื่อนขึ้น"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={index === featured.length - 1}
                        onClick={() => move(id, 1)}
                        aria-label="เลื่อนลง"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => toggleFeatured(id)}
                      >
                        ถอด
                      </button>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          <div className="datatable-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
            <ul style={{ display: "flex", flexDirection: "column" }}>
              {menu.map((item) => (
                <li
                  key={item.id}
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderTop: "1px solid var(--line)",
                    opacity: item.isActive ? 1 : 0.55,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{item.name}</span>{" "}
                    <span className="t-caption num">฿{formatBaht(item.price)}</span>
                    {item.isActive ? null : <span className="t-caption"> · ปิดใช้งานอยู่</span>}
                  </span>
                  <button
                    type="button"
                    className={featured.includes(item.id) ? "btn btn-primary btn-sm" : "btn btn-subtle btn-sm"}
                    onClick={() => toggleFeatured(item.id)}
                  >
                    {featured.includes(item.id) ? "ปักหมุดแล้ว" : "ปักหมุด"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 14 }}
            disabled={savingFeatured}
            onClick={saveFeatured}
          >
            {savingFeatured ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
            บันทึกเมนูแนะนำ
          </button>
        </section>
      </div>
    </>
  )
}
