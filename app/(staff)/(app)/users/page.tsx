import Link from "next/link"
import { listUsers, listRoleOptions, listPendingInvites } from "@/lib/queries"
import { formatDateTime } from "@/lib/format"
import { requirePageAccess, hasPermission } from "@/lib/permissions"
import { UserRolePicker } from "@/components/user-role-picker"
import { StoreMemberControls } from "@/components/store-member-controls"
import { InviteManager } from "@/components/invite-manager"
import { IconLock } from "@/components/icons"

export const metadata = { title: "ผู้ใช้งาน" }

export default async function UsersPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const permissions = await requirePageAccess("USERS")
  const { storeId } = permissions
  const canEdit = await hasPermission("USERS", "EDIT")
  // ปุ่มเลื่อน/ถอดสมาชิกร้านเป็นของเจ้าของร้านเท่านั้น (Phase 13) — คนละสิทธิ์กับ USERS:EDIT
  const isOwner = permissions.storeRole === "OWNER"

  const [users, roles, invites] = await Promise.all([
    listUsers(storeId),
    listRoleOptions(storeId),
    // คำเชิญค้างเป็นของเจ้าของร้าน — STAFF ไม่ต้องเห็น
    isOwner ? listPendingInvites(storeId) : Promise.resolve([]),
  ])
  const unassigned = users.filter((u) => u.storeRole === "STAFF" && u.roleId === null).length

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ระบบ</p>
          <h1 className="t-h1">พนักงานในร้าน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            รายชื่อพนักงานของร้านนี้และบทบาทที่สังกัด — เปลี่ยนบทบาทแล้วมีผลทันทีในคำขอถัดไป
          </p>
        </div>
        {canEdit ? (
          <Link href="/roles" className="btn btn-subtle">
            <IconLock size={17} aria-hidden />
            จัดการบทบาทและสิทธิ์
          </Link>
        ) : null}
      </div>

      {unassigned > 0 ? (
        <div className="alert-banner warning">
          มีพนักงาน <span className="num">{unassigned}</span> คนที่ยังไม่ได้กำหนดบทบาท —
          เข้าได้เฉพาะหน้าตั้งค่าโปรไฟล์จนกว่าจะกำหนดให้
        </div>
      ) : null}

      {canEdit ? null : (
        <div className="alert-banner info">คุณมีสิทธิ์ดูอย่างเดียว — เปลี่ยนบทบาทของผู้ใช้ไม่ได้</div>
      )}

      {isOwner ? <InviteManager invites={invites} /> : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            ทั้งหมด <span className="num">{users.length}</span> คน
          </h2>
        </div>
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>ชื่อ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>อีเมล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, minWidth: 200 }}>บทบาท</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>เข้าร้านเมื่อ</th>
                {isOwner ? <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 24px", fontWeight: 500 }}>
                    {u.name}
                    {u.emailVerified ? null : <span className="t-caption"> · ยังไม่ยืนยันอีเมล</span>}
                  </td>
                  <td style={{ padding: "12px" }}>{u.email}</td>
                  <td style={{ padding: "12px" }}>
                    {u.storeRole === "OWNER" ? (
                      <span className="chip chip-brand">
                        <span className="dot" />
                        เจ้าของร้าน · สิทธิ์เต็ม
                      </span>
                    ) : canEdit ? (
                      <UserRolePicker userId={u.id} currentRoleId={u.roleId} roles={roles} />
                    ) : u.role ? (
                      <span className="chip chip-brand">
                        <span className="dot" />
                        {u.role.name}
                      </span>
                    ) : (
                      <span className="chip chip-neutral">
                        <span className="dot" />
                        ยังไม่กำหนดบทบาท
                      </span>
                    )}
                  </td>
                  <td className="num t-caption" style={{ padding: "12px 24px", textAlign: "right" }}>
                    {formatDateTime(u.joinedAt)}
                  </td>
                  {isOwner ? (
                    <td style={{ padding: "12px 24px" }}>
                      <StoreMemberControls userId={u.id} storeRole={u.storeRole} isSelf={u.id === permissions.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
