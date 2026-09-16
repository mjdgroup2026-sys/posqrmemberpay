"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updatePaymentConfig } from "@/app/actions/payment-config"
import type { PaymentConfigView } from "@/lib/queries"
import type { FieldErrors } from "@/lib/types"
import { formatDateTime } from "@/lib/format"
import { IconWallet } from "@/components/icons"

/// การรับเงินของร้าน (Phase 15a) บนหน้า ตั้งค่าร้าน — เฉพาะเจ้าของร้าน (ด่านจริงคือ requireOwner() ใน action)
/// เจ้าของเลือกได้แค่ "พร้อมเพย์ตรง" · ตรวจสลิป (15b) และ SCB (ผู้ดูแลตั้ง) แสดงไว้ให้รู้ว่ามีแต่กดไม่ได้

type Props = {
  config: PaymentConfigView
  /// ร้านนี้ถูกผู้ดูแลตั้งเป็น SCB_BILLER — ระบบปิดบิลเองจาก callback ของธนาคาร
  scbAutoSettle: boolean
  /// แพลตฟอร์มตั้งผู้ให้บริการตรวจสลิปแล้ว (Phase 15b) — เจ้าของเลือกโหมด ก+ ได้
  slipReady: boolean
}

const MODE_LABEL = {
  PROMPTPAY_DIRECT: "พร้อมเพย์ตรง — ลูกค้าสแกน QR ของร้าน พนักงานกดยืนยัน",
  PROMPTPAY_SLIP: "พร้อมเพย์ตรง + ลูกค้าแนบสลิปแล้วระบบตรวจ/ปิดบิลเอง",
  SCB_BILLER: "รับผ่าน SCB Biller — ธนาคารยืนยันแล้วปิดบิลเอง (ผู้ดูแลระบบเป็นผู้เปิด)",
} as const

export function PaymentConfigForm({ config, scbAutoSettle, slipReady }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const lockedToScb = config.paymentMode === "SCB_BILLER"

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})
    try {
      const fd = new FormData(event.currentTarget)
      // โหมด SCB เปลี่ยนเองไม่ได้ — ส่งค่าเดิมกลับไปให้ action ตรวจเหมือนเดิม
      if (lockedToScb) fd.set("paymentMode", "SCB_BILLER")
      const result = await updatePaymentConfig(fd)
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

  return (
    <section className="card-ui card-pad">
      <h2 className="t-h2" style={{ marginBottom: 4 }}>
        <IconWallet size={18} aria-hidden /> การรับเงินจากลูกค้า
      </h2>
      <p className="t-caption" style={{ marginBottom: 14 }}>
        เงินเข้าบัญชีของร้านโดยตรงทุกโหมด ไม่ผ่านตัวกลาง · เลขพร้อมเพย์นี้ใช้ออก QR ให้ลูกค้าหน้าชำระเงิน และเป็นตัวผูกสิทธิ์ทดลองใช้
        {config.updatedAt ? ` · แก้ล่าสุด ${formatDateTime(config.updatedAt)}` : ""}
      </p>

      {scbAutoSettle ? (
        <div className="alert-banner info" style={{ marginBottom: 12 }}>
          ร้านนี้รับเงินผ่าน SCB Biller — ระบบปิดบิลเองเมื่อธนาคารยืนยัน · เลขพร้อมเพย์ด้านล่างใช้เป็นทางสำรองเมื่อธนาคารขัดข้อง
        </div>
      ) : null}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="t-small" style={{ fontWeight: 600, marginBottom: 6 }}>
            วิธีรับเงิน
          </legend>
          {(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((mode) => {
            const disabled = (mode === "PROMPTPAY_SLIP" && !slipReady) || mode === "SCB_BILLER" || lockedToScb
            return (
              <label key={mode} className="checkbox-row" style={{ opacity: disabled && config.paymentMode !== mode ? 0.6 : 1 }}>
                <input type="radio" name="paymentMode" value={mode} defaultChecked={config.paymentMode === mode} disabled={disabled} />
                <span>
                  {MODE_LABEL[mode]}
                  {mode === "PROMPTPAY_SLIP" && !slipReady ? " (ยังไม่เปิดให้ใช้)" : ""}
                </span>
              </label>
            )
          })}
          {fieldErrors.paymentMode ? <span className="field-hint error">{fieldErrors.paymentMode}</span> : null}
        </fieldset>

        <div className="field-grid">
          <div className="field">
            <label className="t-small" htmlFor="promptPayId">
              เลขพร้อมเพย์ของร้าน
            </label>
            <input
              id="promptPayId"
              name="promptPayId"
              className="input num"
              defaultValue={config.promptPayId ?? ""}
              placeholder="0812345678"
              inputMode="numeric"
              autoComplete="off"
            />
            <span className="field-hint">เบอร์โทร 10 หลัก · เลขบัตรประชาชน 13 หลัก · e-Wallet 15 หลัก</span>
            {fieldErrors.promptPayId ? <span className="field-hint error">{fieldErrors.promptPayId}</span> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="accountName">
              ชื่อบัญชี (ไม่บังคับ)
            </label>
            <input id="accountName" name="accountName" className="input" defaultValue={config.accountName ?? ""} maxLength={100} />
            <span className="field-hint">ข้อมูลประกอบ — ระบบเทียบผู้รับสลิปด้วยเลขพร้อมเพย์/เลขบัญชี</span>
            {fieldErrors.accountName ? <span className="field-hint error">{fieldErrors.accountName}</span> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="bankAccountNumber">
              เลขบัญชีธนาคาร (ไม่บังคับ)
            </label>
            <input
              id="bankAccountNumber"
              name="bankAccountNumber"
              className="input num"
              defaultValue={config.bankAccountNumber ?? ""}
              inputMode="numeric"
              maxLength={20}
              autoComplete="off"
            />
            {fieldErrors.bankAccountNumber ? <span className="field-hint error">{fieldErrors.bankAccountNumber}</span> : null}
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกการรับเงิน"}
          </button>
        </div>
      </form>
    </section>
  )
}
