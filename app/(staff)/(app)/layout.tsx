import { redirect } from "next/navigation"
import { getSession, resolveStoreContext } from "@/lib/session"
import { getLowStockCount, getPendingNotificationCount } from "@/lib/queries"
import { getCurrentPermissions, type ResourceKey } from "@/lib/permissions"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // ร้านที่ทำงานอยู่ (Phase 13) — ไม่มีร้าน/ร้านถูกระงับ ยัง render shell ได้ (badge เป็น 0, เมนูว่าง)
  // เพื่อให้หน้า /no-store และ /settings แสดงในกรอบเดียวกัน · ผู้ใช้ที่อยู่หลายร้านไม่ต้องมีหน้าเลือกร้าน —
  // ตกไปใช้ร้านแรกโดยอัตโนมัติแล้วสลับผ่านตัวสลับร้านใน topbar (ไม่มีทางได้ร้านที่ไม่ได้เป็นสมาชิก) · หน้าที่ต้องมีร้าน
  // จะเด้งไป /no-store เองผ่าน requirePageAccess()/requireStorePage()
  const result = await resolveStoreContext()
  if (!result.ok && result.reason === "UNAUTHENTICATED") redirect("/login")
  const context = result.ok ? result.context : null
  const memberships = result.ok ? result.context.memberships : result.memberships

  const [lowStockCount, pendingNotificationCount, permissions] = context
    ? await Promise.all([
        getLowStockCount(context.storeId),
        getPendingNotificationCount(context.storeId),
        getCurrentPermissions(),
      ])
    : [0, 0, null]

  const user = context?.user ?? (await requireUserSummary())

  // เมนูที่ไม่มีสิทธิ์ VIEW ต้องหายไปจาก Sidebar (§4) — อ่านจาก DB ทุกคำขอ ไม่ cache ข้ามคำขอ
  // จึงมีผลทันทีในคำขอถัดไปหลังผู้ดูแลเปลี่ยนบทบาทให้
  const viewableResources = (Object.keys(permissions?.granted ?? {}) as ResourceKey[]).filter((key) =>
    permissions?.granted[key]?.includes("VIEW"),
  )

  return (
    <div className="app-shell">
      <Sidebar
        lowStockCount={lowStockCount}
        pendingNotificationCount={pendingNotificationCount}
        viewableResources={viewableResources}
      />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar
          user={{ name: user.name, email: user.email }}
          lowStockCount={lowStockCount}
          pendingNotificationCount={pendingNotificationCount}
          activeStoreId={context?.storeId ?? null}
          stores={memberships.map((m) => ({ storeId: m.storeId, name: m.name, role: m.role, status: m.status }))}
        />
        <main className="content">{children}</main>
      </div>
    </div>
  )
}

/// ชื่อ/อีเมลสำหรับ topbar เมื่อผู้ใช้ยังไม่มีร้าน — resolveStoreContext() ไม่คืน user ในกรณีนั้น
async function requireUserSummary() {
  const session = await getSession()
  if (!session?.user) redirect("/login")
  return { name: session.user.name, email: session.user.email }
}
