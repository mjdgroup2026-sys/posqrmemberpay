"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { inviteMember, revokeInvite } from "@/app/actions/store-members"
import type { PendingInvite } from "@/lib/queries"
import type { FieldErrors } from "@/lib/types"
import { formatDateTime } from "@/lib/format"
import { IconBan, IconCopy, IconSend } from "@/components/icons"

/// เชิญพนักงานทางอีเมล + รายการคำเชิญที่รอตอบรับ (Phase 14a) — เฉพาะเจ้าของร้าน
/// action ฝั่ง server เป็นด่านจริง (requireOwner) — ฟอร์มนี้แค่ไม่ให้งง
export function InviteManager({ invites }: { invites: PendingInvite[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setPending(true)
    setFieldErrors({})
    setLastInviteUrl(null)
    try {
      const result = await inviteMember(new FormData(form))
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      if (result.data?.inviteUrl) setLastInviteUrl(result.data.inviteUrl)
      form.reset()
      router.refresh()
    } catch {
      toast.error("ส่งคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  async function revoke(id: string) {
    setPending(true)
    const formData = new FormData()
    formData.set("id", id)
    try {
      const result = await revokeInvite(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("ยกเลิกคำเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("คัดลอกลิงก์แล้ว")
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง")
    }
  }

  return (
    <section className="card-ui">
      <div className="panel-head">
        <h2 className="t-h2">เชิญพนักงานเข้าร้าน</h2>
      </div>
      <div className="card-pad" style={{ paddingTop: 0 }}>
        <form onSubmit={submit} className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label className="t-small" htmlFor="invite-email">
              อีเมลพนักงาน
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              className="input"
              required
              placeholder="staff@example.com"
              autoComplete="off"
            />
            {fieldErrors.email ? <span className="field-hint error">{fieldErrors.email}</span> : null}
          </div>
          <div className="field" style={{ flex: "0 0 160px" }}>
            <label className="t-small" htmlFor="invite-role">
              บทบาทในร้าน
            </label>
            <select id="invite-role" name="role" className="select" defaultValue="STAFF">
              <option value="STAFF">พนักงาน</option>
              <option value="OWNER">เจ้าของร้าน</option>
            </select>
          </div>
          <div className="field" style={{ flex: "0 0 auto", paddingTop: 22 }}>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              <IconSend size={16} aria-hidden />
              ส่งคำเชิญ
            </button>
          </div>
        </form>
        <p className="field-hint" style={{ marginTop: 6 }}>
          ผู้รับจะได้อีเมลพร้อมลิงก์ตอบรับ (ใช้ได้ 7 วัน) ต้องสมัคร/เข้าสู่ระบบด้วยอีเมลเดียวกันจึงจะเข้าร่วมได้
        </p>

        {lastInviteUrl ? (
          <div className="alert-banner info" style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>ลิงก์คำเชิญ (ส่งให้พนักงานเองได้):</span>
              <code className="num" style={{ wordBreak: "break-all" }}>{lastInviteUrl}</code>
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => void copyUrl(lastInviteUrl)}>
                <IconCopy size={14} aria-hidden />
                คัดลอก
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {invites.length > 0 ? (
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>รอตอบรับ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>บทบาท</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>เชิญโดย</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>หมดอายุ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 24px", fontWeight: 500 }}>{invite.email}</td>
                  <td style={{ padding: "12px" }}>
                    <span className={`chip ${invite.role === "OWNER" ? "chip-brand" : "chip-neutral"}`}>
                      <span className="dot" />
                      {invite.role === "OWNER" ? "เจ้าของร้าน" : "พนักงาน"}
                    </span>
                  </td>
                  <td style={{ padding: "12px" }}>{invite.invitedByName}</td>
                  <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>
                    {formatDateTime(invite.expiresAt)}
                  </td>
                  <td style={{ padding: "12px 24px", textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={pending}
                      onClick={() => void revoke(invite.id)}
                    >
                      <IconBan size={14} aria-hidden />
                      ยกเลิก
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
