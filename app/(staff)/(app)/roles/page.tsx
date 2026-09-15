import { listRoles } from "@/lib/queries"
import {
  requirePageAccess,
  hasPermission,
  RESOURCE_ACTIONS,
  RESOURCE_LABEL,
  ACTION_LABEL,
  ACTION_HINT,
} from "@/lib/permissions"
import { RoleManager } from "@/components/role-manager"

export const metadata = { title: "บทบาทและสิทธิ์" }

/// หน้า /roles ใช้สิทธิ์ USERS เดียวกับหน้าผู้ใช้งาน — ไม่มี resource แยกตาม §4
/// ดูได้ด้วย USERS:VIEW · แก้ไขได้ต้องมี USERS:EDIT
export default async function RolesPage() {
  const { storeId } = await requirePageAccess("USERS")
  const canEdit = await hasPermission("USERS", "EDIT")

  const roles = await listRoles(storeId)

  return (
    <RoleManager
      roles={roles}
      // ตาราง/ป้ายกำกับส่งจาก server เพราะ lib/permissions เป็น server-only
      resourceActions={RESOURCE_ACTIONS}
      resourceLabels={RESOURCE_LABEL}
      actionLabels={ACTION_LABEL}
      actionHints={ACTION_HINT as Record<string, string>}
      canEdit={canEdit}
    />
  )
}
