import { listTablesForManage } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { TableAdmin } from "@/components/table-admin"

export const metadata = { title: "จัดการโต๊ะ" }

export default async function ManageTablesPage() {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_SETUP")
  const tables = await listTablesForManage(storeId)
  return <TableAdmin tables={tables} allowed={granted.MO_SETUP ?? []} />
}
