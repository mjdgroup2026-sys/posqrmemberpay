"use client"

import { useState } from "react"
import Link from "next/link"
import { formatBaht, formatNumber } from "@/lib/format"
import type { MenuItemCard } from "@/lib/queries"
import { cartCount } from "@/lib/cart-storage"
import { useCart } from "@/lib/use-cart"

/// เมนูฝั่งลูกค้า — กลุ่ม "เมนูแนะนำ" (สูงสุด 6) แยกออกมาก่อนเมนูทั้งหมดตาม F14
export function MenuView({
  qrToken,
  featured,
  all,
  awaitingBill,
}: {
  qrToken: string
  featured: MenuItemCard[]
  all: MenuItemCard[]
  awaitingBill: boolean
}) {
  const lines = useCart(qrToken)
  const [search, setSearch] = useState("")

  const keyword = search.trim().toLowerCase()
  const visible = keyword ? all.filter((m) => m.name.toLowerCase().includes(keyword)) : all
  const count = cartCount(lines)

  function card(item: MenuItemCard, compact = false) {
    return (
      <Link
        key={item.id}
        href={`/order/${qrToken}/item/${item.id}`}
        className="card-ui"
        style={{
          padding: 12,
          display: "flex",
          gap: 12,
          alignItems: compact ? "flex-start" : "center",
          flexDirection: compact ? "column" : "row",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, lineHeight: 1.35 }}>{item.name}</p>
          {item.description ? (
            <p className="t-caption" style={{ marginTop: 2 }}>
              {item.description}
            </p>
          ) : null}
          <p className="num" style={{ marginTop: 6, fontWeight: 700, color: "var(--brand-strong)" }}>
            ฿{formatBaht(item.price)}
            {item.itemType === "SERVICE" && item.durationMinutes ? (
              <span className="t-caption" style={{ fontWeight: 400, marginLeft: 6 }}>· {item.durationMinutes} นาที</span>
            ) : null}
          </p>
        </div>
        <span className="btn btn-subtle btn-sm">เลือก</span>
      </Link>
    )
  }

  return (
    <>
      {awaitingBill ? (
        <div className="alert-banner warning" style={{ marginBottom: 14 }}>
          โต๊ะนี้แจ้งเช็กบิลแล้ว — สั่งอาหารเพิ่มไม่ได้ กรุณาแจ้งพนักงานหากต้องการสั่งต่อ
        </div>
      ) : null}

      <input
        className="input"
        placeholder="ค้นหาเมนู"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {!keyword && featured.length > 0 ? (
        <section style={{ marginBottom: 22 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2 className="t-h3">เมนูแนะนำ</h2>
            <span className="t-caption num">{formatNumber(featured.length)} รายการยอดนิยม</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
            {featured.map((item) => card(item, true))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="t-h3" style={{ marginBottom: 10 }}>
          {keyword ? "ผลการค้นหา" : "เมนูทั้งหมด"}
        </h2>
        {visible.length === 0 ? (
          <div className="card-ui card-pad">
            <p className="t-body">ไม่พบเมนูที่ค้นหา</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map((item) => card(item))}
          </div>
        )}
      </section>

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          padding: "12px 16px",
        }}
      >
        <div
          style={{ maxWidth: 480, margin: "0 auto", display: "flex", gap: 10 }}
        >
          <Link href={`/order/${qrToken}/status`} className="btn btn-subtle" style={{ flex: 1 }}>
            สถานะออร์เดอร์
          </Link>
          <Link
            href={`/order/${qrToken}/cart`}
            className="btn btn-primary"
            style={{ flex: 1.4 }}
            aria-disabled={count === 0}
          >
            ตะกร้า {count > 0 ? <span className="num">({formatNumber(count)})</span> : null}
          </Link>
        </div>
      </div>
    </>
  )
}
