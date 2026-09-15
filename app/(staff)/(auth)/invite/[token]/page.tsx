import Link from "next/link"
import { lookupInvite } from "@/lib/queries"
import { getSession } from "@/lib/session"
import { formatDateTime } from "@/lib/format"
import { AcceptInviteButton } from "@/components/accept-invite-button"
import { IconStore } from "@/components/icons"

export const metadata = { title: "คำเชิญเข้าร่วมร้าน" }

/// ปลายทางของลิงก์ในอีเมลเชิญ (Phase 14a) — public: ผู้รับยังไม่มีบัญชีก็เปิดได้
/// ไม่ล็อกอิน → พาไปสมัคร/เข้าสู่ระบบแล้วกลับมาหน้านี้ · ล็อกอินแล้ว → ปุ่มตอบรับ (action ตรวจอีเมลซ้ำ)
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params
  const [invite, session] = await Promise.all([lookupInvite(token), getSession()])

  if (!invite.ok) {
    const copy: Record<typeof invite.reason, { title: string; body: string }> = {
      NOT_FOUND: { title: "ไม่พบคำเชิญนี้", body: "ลิงก์อาจไม่ถูกต้องหรือถูกตัดตอนคัดลอก กรุณาขอให้เจ้าของร้านส่งคำเชิญใหม่" },
      EXPIRED: { title: "คำเชิญหมดอายุแล้ว", body: "ลิงก์เชิญใช้ได้ 7 วัน กรุณาขอให้เจ้าของร้านส่งคำเชิญใหม่" },
      REVOKED: { title: "คำเชิญถูกยกเลิก", body: "เจ้าของร้านยกเลิกคำเชิญนี้แล้ว ถ้าคิดว่าผิดพลาดกรุณาติดต่อเจ้าของร้าน" },
      ACCEPTED: { title: "คำเชิญนี้ถูกใช้ไปแล้ว", body: "ถ้าคุณเป็นคนตอบรับ เข้าสู่ระบบแล้วสลับไปร้านนั้นได้เลย" },
      STORE_SUSPENDED: { title: "ร้านถูกระงับการใช้งาน", body: "ยังเข้าร่วมร้านนี้ไม่ได้จนกว่าผู้ดูแลระบบจะปลดระงับ" },
    }
    const { title, body } = copy[invite.reason]
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          คำเชิญใช้ไม่ได้
        </span>
        <h1 className="t-h2">{title}</h1>
        <p className="t-body">{body}</p>
        <Link href={session?.user ? "/" : "/login"} className="btn btn-primary btn-block">
          {session?.user ? "ไปหน้าแรก" : "เข้าสู่ระบบ"}
        </Link>
      </div>
    )
  }

  const returnTo = `/invite/${token}`
  const roleLabel = invite.role === "OWNER" ? "เจ้าของร้าน" : "พนักงาน"
  const sessionEmail = session?.user?.email?.toLowerCase() ?? null
  const emailMismatch = sessionEmail !== null && sessionEmail !== invite.email

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className="t-eyebrow">คำเชิญเข้าร่วมร้าน</p>
        <h1 className="t-h2" style={{ marginTop: 4 }}>
          <IconStore size={20} aria-hidden /> {invite.storeName}
        </h1>
        <p className="t-caption" style={{ marginTop: 6 }}>
          {invite.inviterName} เชิญ <span className="num">{invite.email}</span> เข้าร่วมในบทบาท{roleLabel} · ใช้ได้ถึง{" "}
          <span className="num">{formatDateTime(invite.expiresAt)}</span>
        </p>
      </div>

      {!session?.user ? (
        <>
          <div className="alert-banner info">ต้องมีบัญชีที่ใช้อีเมล {invite.email} ก่อน — สมัครใหม่หรือเข้าสู่ระบบแล้วกลับมาหน้านี้</div>
          <Link
            href={`/register?email=${encodeURIComponent(invite.email)}&callbackUrl=${encodeURIComponent(returnTo)}`}
            className="btn btn-primary btn-block"
          >
            สมัครด้วยอีเมลนี้
          </Link>
          <Link href={`/login?callbackUrl=${encodeURIComponent(returnTo)}`} className="btn btn-subtle btn-block">
            มีบัญชีแล้ว — เข้าสู่ระบบ
          </Link>
        </>
      ) : emailMismatch ? (
        <>
          <div className="alert-banner warning">
            คุณล็อกอินด้วย <span className="num">{sessionEmail}</span> แต่คำเชิญนี้ส่งถึง <span className="num">{invite.email}</span> —
            ออกจากระบบแล้วเข้าด้วยบัญชีที่ถูกเชิญ
          </div>
          <Link href={`/login?callbackUrl=${encodeURIComponent(returnTo)}`} className="btn btn-subtle btn-block">
            เปลี่ยนบัญชี
          </Link>
        </>
      ) : (
        <AcceptInviteButton token={token} storeName={invite.storeName} />
      )}
    </div>
  )
}
