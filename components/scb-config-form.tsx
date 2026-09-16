"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { clearScbCredentials, getScbTestStatus, startScbConnectionTest, updateScbCredentials } from "@/app/actions/scb-config"
import type { ScbConfigView } from "@/lib/queries"
import type { FieldErrors } from "@/lib/types"
import { formatDateTime } from "@/lib/format"
import { IconBan, IconCheck, IconCopy, IconQr, IconSpinner } from "@/components/icons"

/// SCB Open API ของร้าน (Phase 15c) บนหน้าตั้งค่าร้าน — เฉพาะเจ้าของร้าน (ด่านจริงคือ requireOwner() ใน action)
/// ลำดับ: กรอก credential → คัดลอก URL callback ไปลงทะเบียนในพอร์ทัล SCB → ทดสอบจ่าย 1 บาท → ผ่านแล้วค่อยเลือกโหมด SCB

type Props = {
  config: ScbConfigView
  /// origin ของเว็บ (https://…) — ประกอบ URL callback ให้คัดลอก
  baseUrl: string
  /// PAYMENT_CONFIG_KEY ตั้งแล้ว — ไม่ตั้ง = ฟอร์มปิด
  secretBoxReady: boolean
}

const TEST_TIMEOUT_MS = 2 * 60 * 1000

export function ScbConfigForm({ config, baseUrl, secretBoxReady }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [testQr, setTestQr] = useState<{ qrDataUrl: string; ref1: string; startedAt: number } | null>(null)
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(config.verifiedAt)
  const webhookUrl = config.webhookToken ? `${baseUrl}/api/payments/webhook/scb/store/${config.webhookToken}` : null

  // โพลระหว่างรอ callback ของ QR ทดสอบ — ผ่านแล้ว refresh ให้ตัวเลือกโหมด SCB เปิด
  useEffect(() => {
    if (!testQr) return
    const timer = setInterval(async () => {
      if (Date.now() - testQr.startedAt > TEST_TIMEOUT_MS) {
        setTestQr(null)
        toast.error("ยังไม่ได้รับ callback ใน 2 นาที — ตรวจว่า URL callback ในพอร์ทัล SCB ตรงกับด้านล่าง และ ref3 prefix ตรงกัน")
        return
      }
      const status = await getScbTestStatus()
      if (status.ok && status.data?.verifiedAt) {
        setVerifiedAt(new Date(status.data.verifiedAt))
        setTestQr(null)
        toast.success("ทดสอบผ่าน — ธนาคารส่ง callback เข้ามาแล้ว เลือกโหมด SCB ได้ที่ด้านบน")
        router.refresh()
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [testQr, router])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})
    try {
      const result = await updateScbCredentials(new FormData(event.currentTarget))
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function startTest() {
    setPending(true)
    try {
      const result = await startScbConnectionTest()
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "ออก QR ไม่สำเร็จ" : result.error)
        return
      }
      toast.success(result.message)
      setTestQr({ ...result.data, startedAt: Date.now() })
    } finally {
      setPending(false)
    }
  }

  async function clear() {
    if (!confirm("ถอด credential SCB ของร้านออก? ถ้าอยู่โหมด SCB จะกลับเป็นพร้อมเพย์ตรงทันที")) return
    setPending(true)
    try {
      const result = await clearScbCredentials()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setVerifiedAt(null)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success("คัดลอก URL callback แล้ว")
    } catch {
      toast.error("คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง")
    }
  }

  return (
    <section className="card-ui card-pad">
      <h2 className="t-h2" style={{ marginBottom: 4 }}>
        <IconQr size={18} aria-hidden /> SCB Biller ของร้าน (ปิดบิลอัตโนมัติ)
      </h2>
      <p className="t-caption" style={{ marginBottom: 14 }}>
        สำหรับร้านที่มี Biller ID ของตัวเองกับ SCB — ธนาคารออก QR ให้ลูกค้าและยืนยันเงินเข้ากลับมาเอง ไม่ต้องรอพนักงานหรือสลิป ·
        credential ถูกเข้ารหัสก่อนเก็บ และจะเปิดใช้ได้ต่อเมื่อผ่านการทดสอบด้านล่างแล้วเท่านั้น
        {config.activeSource === "env" ? " · ตอนนี้ร้านนี้ใช้ SCB ของแพลตฟอร์มอยู่ (ผู้ดูแลตั้งให้) — กรอกของร้านเองเพื่อย้าย" : ""}
      </p>

      {!secretBoxReady ? (
        <div className="alert-banner warning">ระบบยังไม่ได้ตั้งกุญแจเข้ารหัส (PAYMENT_CONFIG_KEY) — ติดต่อผู้ดูแลแพลตฟอร์มก่อนกรอก credential</div>
      ) : null}
      {config.configured && !config.decryptable ? (
        <div className="alert-banner danger" style={{ marginBottom: 10 }}>
          credential ที่เก็บไว้ถอดรหัสไม่ได้ (กุญแจของระบบเปลี่ยน) — กรุณากรอก API key/secret ใหม่แล้วทดสอบอีกครั้ง
        </div>
      ) : null}

      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field-grid">
          <div className="field">
            <label className="t-small" htmlFor="scb-env">
              สภาพแวดล้อม
            </label>
            <select id="scb-env" name="environment" className="select" defaultValue={config.environment ?? "production"} disabled={!secretBoxReady}>
              <option value="production">Production (เงินจริง)</option>
              <option value="sandbox">Sandbox (ทดสอบ — ไม่ส่ง callback)</option>
            </select>
          </div>
          <div className="field">
            <label className="t-small" htmlFor="scb-biller">
              Biller ID
            </label>
            <input id="scb-biller" name="billerId" className="input num" defaultValue={config.billerId ?? ""} required inputMode="numeric" disabled={!secretBoxReady} />
            {fieldErrors.billerId ? <span className="field-hint error">{fieldErrors.billerId}</span> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="scb-prefix">
              ref3 prefix
            </label>
            <input id="scb-prefix" name="ref3Prefix" className="input num" defaultValue={config.ref3Prefix ?? ""} required maxLength={8} disabled={!secretBoxReady} />
            <span className="field-hint">ตามที่ SCB กำหนดให้ — ต้องตรงกับที่ลงทะเบียนคู่กับ URL callback ไม่งั้นธนาคารจะไม่ส่ง callback เลย</span>
            {fieldErrors.ref3Prefix ? <span className="field-hint error">{fieldErrors.ref3Prefix}</span> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="scb-key">
              API key {config.apiKeyTail ? <span className="t-caption num">(บันทึกไว้ {config.apiKeyTail} — เว้นว่างเพื่อคงเดิม)</span> : null}
            </label>
            <input id="scb-key" name="apiKey" className="input num" autoComplete="off" placeholder={config.apiKeyTail ? "••••••••" : ""} disabled={!secretBoxReady} />
            {fieldErrors.apiKey ? <span className="field-hint error">{fieldErrors.apiKey}</span> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="scb-secret">
              API secret {config.configured ? <span className="t-caption">(เว้นว่างเพื่อคงเดิม)</span> : null}
            </label>
            <input id="scb-secret" name="apiSecret" type="password" className="input num" autoComplete="new-password" placeholder={config.configured ? "••••••••" : ""} disabled={!secretBoxReady} />
            {fieldErrors.apiSecret ? <span className="field-hint error">{fieldErrors.apiSecret}</span> : null}
          </div>
        </div>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {config.configured ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => void clear()}>
              <IconBan size={14} aria-hidden />
              ถอด SCB ออก
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending || !secretBoxReady}>
            {pending ? "กำลังบันทึก…" : "บันทึก credential"}
          </button>
        </div>
      </form>

      {webhookUrl ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <span className="t-small" style={{ fontWeight: 600 }}>
              URL callback ของร้าน — ลงทะเบียนในพอร์ทัล SCB (Payment confirmation) คู่กับ Biller ID + ref3 prefix ข้างบน
            </span>
            <div className="row" style={{ gap: 6 }}>
              <input className="input num" readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => void copyWebhook()}>
                <IconCopy size={14} aria-hidden />
                คัดลอก
              </button>
            </div>
            <span className="field-hint">ต้องเป็น https:// เท่านั้น — ธนาคารไม่ตาม redirect · ลงทะเบียนผิดคู่ = callback เงียบสนิทโดยไม่มี error</span>
          </div>

          <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {verifiedAt ? (
              <span className="chip chip-success">
                <span className="dot" />
                ทดสอบผ่านเมื่อ {formatDateTime(verifiedAt)}
              </span>
            ) : (
              <span className="chip chip-warning">
                <span className="dot" />
                ยังไม่ผ่านการทดสอบ — เปิดโหมด SCB ไม่ได้
              </span>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || !config.decryptable || testQr !== null} onClick={() => void startTest()}>
              <IconCheck size={14} aria-hidden />
              {verifiedAt ? "ทดสอบอีกครั้ง (1 บาท)" : "ทดสอบการเชื่อมต่อ (จ่าย 1 บาท)"}
            </button>
          </div>

          {testQr ? (
            <div className="card-ui card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
              {/* data URL จาก server — ไม่ใช่ URL ภายนอก */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={testQr.qrDataUrl} alt="QR ทดสอบ 1 บาท" width={280} height={280} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
              <p className="row t-small" style={{ justifyContent: "center", gap: 8, marginTop: 8 }}>
                <IconSpinner size={16} className="animate-spin" aria-hidden />
                สแกนจ่าย 1 บาทด้วยแอปธนาคารของคุณ แล้วรอ callback (ไม่เกิน 2 นาที) · อ้างอิง <span className="num">{testQr.ref1}</span>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
