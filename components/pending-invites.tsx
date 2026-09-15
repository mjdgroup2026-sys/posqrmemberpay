import { listPendingInvitesForEmail } from "@/lib/store-resolve"
import { formatDateTime } from "@/lib/format"
import { AcceptInviteButton } from "@/components/accept-invite-button"

/// คำเชิญเข้าร้านที่ค้างอยู่ของอีเมลผู้ใช้ที่ล็อกอิน (Phase 14a) — แสดงบน /no-store และ /onboarding
/// จำเป็นเพราะคนที่สมัครผ่านลิงก์เชิญต้องผ่านการยืนยันอีเมลก่อน ลิงก์เดิมจึงมักหายไปกลางทาง
export async function PendingInvites({ email }: { email: string }) {
  const invites = await listPendingInvitesForEmail(email)
  if (invites.length === 0) return null

  return (
    <section className="card-ui card-pad" style={{ maxWidth: 560 }}>
      <span className="chip chip-info">
        <span className="dot" />
        คำเชิญเข้าร้าน
      </span>
      <h2 className="t-h2" style={{ marginTop: 10 }}>
        มีร้านเชิญคุณเข้าร่วม <span className="num">{invites.length}</span> ร้าน
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {invites.map((invite) => (
          <li key={invite.id} className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{invite.storeName}</div>
              <div className="t-caption">
                {invite.inviterName} เชิญเป็น{invite.role === "OWNER" ? "เจ้าของร้าน" : "พนักงาน"} · ใช้ได้ถึง{" "}
                <span className="num">{formatDateTime(invite.expiresAt)}</span>
              </div>
            </div>
            <AcceptInviteButton inviteId={invite.id} storeName={invite.storeName} compact />
          </li>
        ))}
      </ul>
    </section>
  )
}
