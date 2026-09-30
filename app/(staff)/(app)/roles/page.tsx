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
import { isResourceEnabled } from "@/lib/modules"
import type { ResourceKey } from "@/generated/prisma/client"

export const metadata = { title: "บทบาทและสิทธิ์" }

/// หน้า /roles ใช้สิทธิ์ USERS เดียวกับหน้าผู้ใช้งาน — ไม่มี resource แยกตาม §4
/// ดูได้ด้วย USERS:VIEW · แก้ไขได้ต้องมี USERS:EDIT
export default async function RolesPage() {
  const { storeId, disabledModules } = await requirePageAccess("USERS")
  const canEdit = await hasPermission("USERS", "EDIT")

  const roles = await listRoles(storeId)

  return (
    <RoleManager
      roles={roles}
      // ตาราง/ป้ายกำกับส่งจาก server เพราะ lib/permissions เป็น server-only
      // resource ของโมดูลที่ผู้ดูแลแพลตฟอร์มปิดไว้ไม่มีแถวให้ติ๊ก (2026-09-30) — updateRole คงสิทธิ์เดิมของแถวเหล่านี้ไว้
      resourceActions={Object.fromEntries(
        Object.entries(RESOURCE_ACTIONS).filter(([resource]) => isResourceEnabled(disabledModules, resource as ResourceKey)),
      )}
      resourceLabels={RESOURCE_LABEL}
      actionLabels={ACTION_LABEL}
      actionHints={ACTION_HINT as Record<string, string>}
      canEdit={canEdit}
    />
  )
}
