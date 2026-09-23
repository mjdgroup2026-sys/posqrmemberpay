"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { authErrorMessage } from "@/lib/auth-errors"
import { IconBell, IconLogout, IconSettings, IconUser, IconWarning } from "@/components/icons"
import { StoreSwitcher, type StoreOption } from "@/components/store-switcher"
import { MobileNavToggle } from "@/components/mobile-nav"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Props = {
  user: { name: string; email: string }
  lowStockCount: number
  pendingNotificationCount?: number
  /// ร้านที่ทำงานอยู่ (Phase 13) — null เมื่อผู้ใช้ยังไม่ได้อยู่ในร้านใด
  activeStoreId?: string | null
  stores?: StoreOption[]
}

export function Topbar({ user, lowStockCount, pendingNotificationCount = 0, activeStoreId = null, stores = [] }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    setBusy(true)
    // ★ Better Auth client ไม่ throw เมื่อเซิร์ฟเวอร์ตอบ error — คืน `{ error }` แทน
    //   เดิมเช็คแค่ try/catch จึงขึ้น "ออกจากระบบแล้ว" ทั้งที่ cookie ยังอยู่ (เช่น 403 INVALID_ORIGIN / 429)
    //   แล้วถูกพาไป /login ซึ่งเด้งกลับหน้าแรกเพราะยังล็อกอินอยู่ = ผู้ใช้เห็นว่า "กดออกจากระบบไม่ได้"
    //   try/catch ยังต้องมีสำหรับเน็ตหลุด (fetch throw) ไม่งั้น busy ค้างและปุ่มถูก disable ถาวร
    let failure: string | null = null
    try {
      const { error } = await authClient.signOut()
      if (error) failure = authErrorMessage(error, "sign-out")
    } catch {
      failure = authErrorMessage(null, "sign-out")
    }
    if (failure) {
      toast.error(failure)
      setBusy(false)
      return
    }

    toast.success("ออกจากระบบแล้ว")
    // refresh ก่อน push — ทิ้ง RSC payload ที่ถูก render ตอน "ยังล็อกอินอยู่" ออกจาก
    // client router cache ก่อน ไม่งั้นมีจังหวะที่หน้าเดิมถูกเสิร์ฟจากแคชต่อ
    // แล้วดูเหมือนออกจากระบบไม่สำเร็จทั้งที่ cookie ถูกล้างไปแล้ว
    router.refresh()
    router.push("/login")
    setBusy(false)
  }

  return (
    <header className="topbar">
      {/* แถวหลัก: ☰ + ตัวสลับร้าน · ป้ายแจ้งเตือนแยกกลุ่มไว้ให้ CSS จัดลงแถวสองบนจอเล็กได้ (2026-09-17) */}
      <div className="row topbar-main" style={{ gap: 10, minWidth: 0 }}>
        <MobileNavToggle />
        {activeStoreId ? <StoreSwitcher activeStoreId={activeStoreId} stores={stores} /> : null}
      </div>
      <div className="row topbar-chips" style={{ gap: 10 }}>
        {pendingNotificationCount > 0 ? (
          <Link href="/mobile-order/notifications" className="chip chip-danger">
            <IconBell size={14} aria-hidden />
            ลูกค้าเรียก <span className="num">{pendingNotificationCount}</span> โต๊ะ
          </Link>
        ) : null}
        {lowStockCount > 0 ? (
          <Link href="/products?filter=low" className="chip chip-warning">
            <IconWarning size={14} aria-hidden />
            สินค้าใกล้หมด <span className="num">{lowStockCount}</span> รายการ
          </Link>
        ) : (
          // ป้าย "ปกติ" ไม่มีอะไรให้กด — ซ่อนบนจอเล็กเพื่อให้ตัวสลับร้านกับปุ่มเมนูมีที่พอ
          <span className="chip chip-success hide-mobile">
            <span className="dot" />
            สต็อกอยู่ในเกณฑ์ปกติ
          </span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<button type="button" className="btn btn-ghost" disabled={busy} />}
        >
          <IconUser size={18} aria-hidden />
          <span className="hide-mobile">{user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* ★ Label ของ base-ui ต้องอยู่ใน Group เสมอ — เดิมวางลอย ๆ แล้วเปิดเมนูไม่ได้เลย
              ("MenuGroupContext is missing") ผู้ใช้จึงหาปุ่มออกจากระบบไม่เจอ */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span style={{ display: "block", fontWeight: 600 }}>{user.name}</span>
              <span className="t-caption">{user.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/settings" />}>
            <IconSettings size={16} aria-hidden /> ตั้งค่าโปรไฟล์
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} variant="destructive">
            <IconLogout size={16} aria-hidden /> ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
