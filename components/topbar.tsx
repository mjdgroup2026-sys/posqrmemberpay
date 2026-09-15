"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { IconBell, IconLogout, IconSettings, IconUser, IconWarning } from "@/components/icons"
import { StoreSwitcher, type StoreOption } from "@/components/store-switcher"
import {
  DropdownMenu,
  DropdownMenuContent,
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
    try {
      await authClient.signOut()
    } catch {
      // ★ ไม่มี try/catch มาก่อน — พอ signOut ล้ม ฟังก์ชันก็ throw ทิ้งไว้เฉย ๆ
      //   busy ค้างเป็น true ตลอด ปุ่มเมนูผู้ใช้เลยถูก disable ถาวรจนกว่าจะรีเฟรชหน้า
      //   ผู้ใช้เห็นเป็น "กดออกจากระบบไม่ได้" โดยไม่มีข้อความบอกอะไรเลย
      toast.error("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
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
      <div className="row" style={{ gap: 10 }}>
        {activeStoreId ? <StoreSwitcher activeStoreId={activeStoreId} stores={stores} /> : null}
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
          <span className="chip chip-success">
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
          <span>{user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span style={{ display: "block", fontWeight: 600 }}>{user.name}</span>
            <span className="t-caption">{user.email}</span>
          </DropdownMenuLabel>
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
