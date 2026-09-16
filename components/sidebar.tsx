"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconDashboard,
  IconProduct,
  IconStockIn,
  IconStockOut,
  IconReports,
  IconUsers,
  IconSettings,
  IconPos,
  IconReceipt,
  IconCalculator,
  IconCategory,
  IconTable,
  IconBell,
  IconKitchen,
  IconQr,
  IconStore,
  IconLock,
  IconShield,
  IconCard,
  IconMenu,
  IconBrand,
} from "@/components/icons"
import type { ResourceKey } from "@/lib/permissions"

/// resource = ตัวคุมสิทธิ์ VIEW ของเมนูนั้น (§4) · ไม่ระบุ = เมนูที่ทุกคนที่ล็อกอินเห็นได้ (ตั้งค่าโปรไฟล์ตัวเอง)
/// Phase 16: หน้าของ MJD Mobile Order อยู่ในชุด resource แล้ว (MO_*) · ตั้งค่าร้านเป็นของเจ้าของร้าน
type NavItem = {
  href: string
  label: string
  Icon: typeof IconDashboard
  badge?: "lowStock" | "pending"
  resource?: ResourceKey
  /// เมนูของผู้ดูแลแพลตฟอร์ม (Phase 14a) — คนละแกนกับ resource ของร้าน เห็นเฉพาะ User.isPlatformAdmin
  platformAdmin?: true
  /// เมนูของเจ้าของร้าน (Phase 14b) — StoreMember.role = OWNER เท่านั้น
  ownerOnly?: true
}

const GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "ภาพรวม", Icon: IconDashboard, resource: "DASHBOARD" },
      { href: "/pos", label: "ขายหน้าร้าน (POS)", Icon: IconPos, resource: "POS" },
      { href: "/pos/history", label: "ประวัติการขาย", Icon: IconReceipt, resource: "POS_HISTORY" },
      { href: "/pos/closing", label: "ปิดยอดประจำวัน", Icon: IconCalculator, resource: "POS_CLOSING" },
    ],
  },
  {
    title: "MJD Mobile Order",
    items: [
      { href: "/mobile-order/tables", label: "ผังโต๊ะ", Icon: IconTable, resource: "MO_TABLES" },
      { href: "/mobile-order/notifications", label: "การแจ้งเตือน", Icon: IconBell, badge: "pending", resource: "MO_NOTIFICATIONS" },
      { href: "/mobile-order/kitchen", label: "หน้าจอครัว (KDS)", Icon: IconKitchen, resource: "MO_KITCHEN" },
      { href: "/mobile-order/menu", label: "จัดการเมนูอาหาร", Icon: IconMenu, resource: "MO_MENU" },
      { href: "/mobile-order/tables/manage", label: "จัดการโต๊ะ", Icon: IconTable, resource: "MO_SETUP" },
      { href: "/mobile-order/qr-codes", label: "จัดการ QR Code", Icon: IconQr, resource: "MO_SETUP" },
      { href: "/mobile-order/settings", label: "ตั้งค่าร้าน", Icon: IconStore, ownerOnly: true },
    ],
  },
  {
    title: "คลังสินค้า",
    items: [
      { href: "/products", label: "สินค้า", Icon: IconProduct, badge: "lowStock", resource: "PRODUCTS" },
      { href: "/categories", label: "หมวดหมู่สินค้า", Icon: IconCategory, resource: "CATEGORIES" },
      { href: "/stock-in", label: "รับสินค้าเข้า", Icon: IconStockIn, resource: "STOCK_IN" },
      { href: "/stock-out", label: "เบิกจ่ายสินค้า", Icon: IconStockOut, resource: "STOCK_OUT" },
      { href: "/reports", label: "รายงาน", Icon: IconReports, resource: "REPORTS" },
    ],
  },
  {
    items: [
      { href: "/users", label: "ผู้ใช้งาน", Icon: IconUsers, resource: "USERS" },
      { href: "/roles", label: "บทบาทและสิทธิ์", Icon: IconLock, resource: "USERS" },
      { href: "/billing", label: "ค่าใช้งาน", Icon: IconCard, ownerOnly: true },
      { href: "/brand", label: "แบรนด์ / หลายสาขา", Icon: IconBrand, ownerOnly: true },
      { href: "/settings", label: "ตั้งค่า", Icon: IconSettings },
    ],
  },
  {
    title: "แพลตฟอร์ม",
    items: [
      { href: "/admin/stores", label: "ร้านค้าทั้งหมด", Icon: IconShield, platformAdmin: true },
      { href: "/admin/plans", label: "แพ็กเกจค่าใช้งาน", Icon: IconCard, platformAdmin: true },
    ],
  },
]

/// href ที่มีเส้นทางลูก (เช่น /pos กับ /pos/history) ต้องเทียบแบบตรงตัว
/// ไม่งั้นเมนูแม่จะสว่างค้างตอนอยู่หน้าลูก
const EXACT_MATCH = new Set(["/", "/pos", "/admin/stores", "/brand"])

export function Sidebar({
  lowStockCount,
  pendingNotificationCount = 0,
  viewableResources,
  isPlatformAdmin = false,
  isOwner = false,
}: {
  lowStockCount: number
  pendingNotificationCount?: number
  /// resource ที่ผู้ใช้มีสิทธิ์ VIEW — layout คำนวณจาก DB ให้ทุกคำขอ
  viewableResources: ResourceKey[]
  isPlatformAdmin?: boolean
  isOwner?: boolean
}) {
  const pathname = usePathname()

  // เมนูที่ไม่ผูก resource แสดงเสมอ · ที่ผูกไว้ต้องมีสิทธิ์ VIEW ถึงจะเห็น (§4)
  // ซ่อนเมนูเป็นแค่ความสะดวก ด่านจริงคือ requirePageAccess() ที่ตัวหน้า
  const canView = (item: NavItem) => {
    if (item.platformAdmin) return isPlatformAdmin
    if (item.ownerOnly) return isOwner
    return !item.resource || viewableResources.includes(item.resource)
  }

  // กลุ่มที่ไม่เหลือเมนูเลยต้องหายไปทั้งกลุ่ม ไม่ใช่เหลือหัวข้อลอย ๆ
  const visibleGroups = GROUPS.map((group) => ({ group, items: group.items.filter(canView) })).filter(
    ({ items }) => items.length > 0,
  )

  function badgeCount(item: NavItem): number {
    if (item.badge === "lowStock") return lowStockCount
    if (item.badge === "pending") return pendingNotificationCount
    return 0
  }

  return (
    <aside className="sidebar">
      <Link href="/" className="row" style={{ gap: 10, padding: "4px 12px 16px" }}>
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "var(--brand)",
            color: "var(--brand-ink)",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          MJD
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>Mobile Order</span>
          <span className="t-caption">ระบบหลังร้าน</span>
        </span>
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {visibleGroups.map(({ group, items }, index) => (
          <div key={group.title ?? `group-${index}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {group.title ? (
              <span className="t-eyebrow" style={{ padding: "4px 12px" }}>
                {group.title}
              </span>
            ) : null}

            {items.map(({ href, label, Icon, badge }) => {
              const active = EXACT_MATCH.has(href) ? pathname === href : pathname.startsWith(href)
              const count = badgeCount({ href, label, Icon, badge })
              return (
                <Link key={href} href={href} className="nav-item" data-active={active}>
                  <Icon size={18} aria-hidden />
                  <span>{label}</span>
                  {count > 0 ? (
                    <span
                      className={`chip ${badge === "pending" ? "chip-danger" : "chip-danger"} num`}
                      style={{ marginLeft: "auto", height: 22 }}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
