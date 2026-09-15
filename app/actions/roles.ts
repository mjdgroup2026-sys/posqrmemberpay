"use server"

import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { guardAction, RESOURCE_ACTIONS } from "@/lib/permissions"
import { roleSchema, assignRoleSchema, idSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"
import type { PermissionAction, ResourceKey } from "@/generated/prisma/client"

/// จัดการบทบาทและสิทธิ์ (§4) — ทุก action ใช้สิทธิ์ `USERS:EDIT` ตัวเดียวกัน
/// ไม่มี resource แยกสำหรับหน้า /roles ตามที่สเปกกำหนด

const SYSTEM_ROLE_ERROR = "บทบาทของระบบ แก้ชื่อหรือลบไม่ได้"

class RoleAbort extends Error {
  constructor(readonly reason: string) {
    super("ROLE_ABORT")
  }
}

function revalidateRolePages() {
  revalidatePath("/roles")
  revalidatePath("/users")
  // สิทธิ์เปลี่ยนแล้วเมนูใน Sidebar ต้องเปลี่ยนตามในคำขอถัดไป
  revalidatePath("/", "layout")
}

/// กรอง action ที่ไม่มีความหมายกับ resource นั้นทิ้งเสมอ (§4 ตาราง Action)
/// UI disable ช่องพวกนี้อยู่แล้ว แต่ห้ามเชื่อ client — ยิงตรงมาก็ต้องถูกตัดทิ้ง
function sanitize(resource: ResourceKey, actions: PermissionAction[]): PermissionAction[] {
  const allowed = RESOURCE_ACTIONS[resource]
  const unique = [...new Set(actions)]
  return allowed.filter((action) => unique.includes(action))
}

function parsePermissions(raw: FormDataEntryValue | null): { resource: ResourceKey; actions: PermissionAction[] }[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RoleAbort("ข้อมูลสิทธิ์ไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่")
  }
  if (!Array.isArray(parsed)) throw new RoleAbort("ข้อมูลสิทธิ์ไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่")

  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as { resource?: unknown; actions?: unknown }
    if (typeof record.resource !== "string" || !(record.resource in RESOURCE_ACTIONS)) return []
    const resource = record.resource as ResourceKey
    const actions = Array.isArray(record.actions) ? (record.actions as PermissionAction[]) : []
    return [{ resource, actions: sanitize(resource, actions) }]
  })
}

async function writePermissions(
  tx: StoreTx,
  roleId: string,
  rows: { resource: ResourceKey; actions: PermissionAction[] }[],
) {
  // เขียนทับทั้งชุดทุกครั้ง — resource ที่ไม่ได้ส่งมาถือว่าไม่มีสิทธิ์เลย
  await tx.rolePermission.deleteMany({ where: { roleId } })
  if (rows.length === 0) return
  await tx.rolePermission.createMany({
    data: rows.map((row) => ({ roleId, resource: row.resource, actions: row.actions })),
  })
}

export async function createRole(formData: FormData): Promise<ActionResult> {
  const guard = await guardAction("USERS", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  try {
    const rows = parsePermissions(formData.get("permissions"))
    await db.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { storeId, name: parsed.data.name, description: parsed.data.description },
        select: { id: true },
      })
      await writePermissions(tx, role.id, rows)
    })
  } catch (error) {
    if (error instanceof RoleAbort) return { ok: false, error: error.reason }
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "มีบทบาทชื่อนี้อยู่แล้ว" }
    return { ok: false, error: "สร้างบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateRolePages()
  return { ok: true, message: `สร้างบทบาท ${parsed.data.name} เรียบร้อยแล้ว` }
}

export async function updateRole(formData: FormData): Promise<ActionResult> {
  const guard = await guardAction("USERS", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = roleSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const id = parsed.data.id
  if (!id) return { ok: false, error: "ไม่พบบทบาทที่ต้องการแก้ไข" }

  try {
    const rows = parsePermissions(formData.get("permissions"))
    await db.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { isSystem: true, name: true } })
      if (!role) throw new RoleAbort("ไม่พบบทบาทที่ต้องการแก้ไข")

      // ★ บทบาทระบบแก้ชื่อไม่ได้ แต่ยังปรับสิทธิ์ได้ — กันไม่ให้ใครลดสิทธิ์ตัวเองจนระบบไม่มีคนดูแล
      //   ต้องเหลือสิทธิ์ USERS:EDIT ไว้เสมอ ไม่งั้นจะไม่มีใครกลับมาแก้สิทธิ์ได้อีก
      if (role.isSystem) {
        if (parsed.data.name !== role.name) throw new RoleAbort(SYSTEM_ROLE_ERROR)
        const users = rows.find((r) => r.resource === "USERS")
        if (!users?.actions.includes("EDIT")) {
          throw new RoleAbort("บทบาทของระบบต้องมีสิทธิ์แก้ไขผู้ใช้เสมอ ไม่งั้นจะไม่มีใครจัดการสิทธิ์ได้อีก")
        }
      }

      await tx.role.update({
        where: { id },
        data: { name: parsed.data.name, description: parsed.data.description },
      })
      await writePermissions(tx, id, rows)
    })
  } catch (error) {
    if (error instanceof RoleAbort) return { ok: false, error: error.reason }
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "มีบทบาทชื่อนี้อยู่แล้ว" }
    return { ok: false, error: "บันทึกบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateRolePages()
  return { ok: true, message: `บันทึกบทบาท ${parsed.data.name} เรียบร้อยแล้ว` }
}

export async function deleteRole(formData: FormData): Promise<ActionResult> {
  const guard = await guardAction("USERS", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    await db.$transaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id: parsed.data.id },
        select: { isSystem: true, name: true, _count: { select: { members: true } } },
      })
      if (!role) throw new RoleAbort("ไม่พบบทบาทที่ต้องการลบ")
      if (role.isSystem) throw new RoleAbort(SYSTEM_ROLE_ERROR)
      if (role._count.members > 0) {
        throw new RoleAbort(
          `ลบไม่ได้ — ยังมีพนักงาน ${role._count.members} คนใช้บทบาทนี้อยู่ กรุณาย้ายไปบทบาทอื่นก่อน`,
        )
      }
      await tx.role.delete({ where: { id: parsed.data.id } })
    })
  } catch (error) {
    if (error instanceof RoleAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "ลบบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateRolePages()
  return { ok: true, message: "ลบบทบาทเรียบร้อยแล้ว" }
}

/// กำหนดบทบาท (matrix สิทธิ์) ให้พนักงานในร้าน — ส่ง roleId ว่างเพื่อถอดออก (จะเข้าได้เฉพาะ /settings)
/// Phase 13: เขียนที่ StoreMember ของร้านนี้ ไม่ใช่ตาราง user · OWNER ไม่ใช้ค่านี้ (ได้เต็มเสมอ)
/// จึงไม่ต้องมีกติกา "ห้ามถอดผู้ดูแลระบบคนสุดท้าย" อีก — คนที่กำหนดสิทธิ์ได้เสมอคือ OWNER
/// ซึ่งถูกกันไว้ว่าต้องมีอย่างน้อย 1 คนที่ app/actions/store-members.ts
export async function assignUserRole(formData: FormData): Promise<ActionResult> {
  const guard = await guardAction("USERS", "EDIT")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)

  const parsed = assignRoleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId") ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const { userId, roleId } = parsed.data

  try {
    await db.$transaction(async (tx) => {
      // StoreMember ถูกกรอง storeId โดย forStore() — userId ของร้านอื่นจึงได้ "ไม่พบ" ไม่ใช่แก้ข้ามร้าน
      const target = await tx.storeMember.findFirst({ where: { userId }, select: { id: true } })
      if (!target) throw new RoleAbort("ไม่พบพนักงานคนนี้ในร้าน")

      if (roleId) {
        const role = await tx.role.findUnique({ where: { id: roleId }, select: { id: true } })
        if (!role) throw new RoleAbort("ไม่พบบทบาทที่เลือก")
      }

      await tx.storeMember.update({ where: { id: target.id }, data: { roleId: roleId ?? null } })
    })
  } catch (error) {
    if (error instanceof RoleAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "กำหนดบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }

  revalidateRolePages()
  return { ok: true, message: roleId ? "กำหนดบทบาทเรียบร้อยแล้ว" : "ถอดบทบาทออกแล้ว" }
}
