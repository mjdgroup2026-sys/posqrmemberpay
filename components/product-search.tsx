"use client"

import { useState } from "react"
import { formatNumber } from "@/lib/format"
import { IconSearch } from "@/components/icons"

/// ช่องค้นหาสินค้าของฟอร์มเอกสารคลัง (Phase 21) — ใช้ร่วมกันทั้งใบรับ (`receipt-form.tsx`) และใบเบิก/ใบปรับ (`stock-doc-form.tsx`)
/// · พิมพ์ชื่อ/SKU เพื่อเลือก · สแกนบาร์โค้ด (SKU) แล้วกด Enter = เพิ่มทันทีถ้าตรงตัวหรือเหลือตัวเลือกเดียว

export type StockDocProduct = {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
  category: string
}

export function ProductSearch({
  products,
  excluded,
  onPick,
}: {
  products: StockDocProduct[]
  /// สินค้าที่อยู่ในเอกสารแล้ว — ไม่โชว์ซ้ำ
  excluded: Set<string>
  onPick: (productId: string) => void
}) {
  const [search, setSearch] = useState("")
  const term = search.trim().toLowerCase()
  const matches = term
    ? products.filter((p) => !excluded.has(p.id) && (p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))).slice(0, 8)
    : []

  function pick(productId: string) {
    onPick(productId)
    setSearch("")
  }

  function onEnter() {
    const exact = products.find((p) => p.sku.toLowerCase() === term && !excluded.has(p.id))
    const chosen = exact ?? (matches.length === 1 ? matches[0] : null)
    if (chosen) pick(chosen.id)
  }

  return (
    <div style={{ position: "relative", minWidth: 280, flex: "0 1 360px" }}>
      <div className="row" style={{ gap: 8 }}>
        <IconSearch size={16} aria-hidden style={{ color: "var(--ink-3)" }} />
        <input
          className="input"
          aria-label="ค้นหาสินค้าด้วยชื่อหรือ SKU"
          placeholder="ค้นหาชื่อ / สแกนบาร์โค้ด (SKU) แล้วกด Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onEnter()
            }
          }}
        />
      </div>
      {matches.length > 0 ? (
        <ul
          role="listbox"
          className="card-ui"
          style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "calc(100% + 4px)", maxHeight: 280, overflowY: "auto" }}
        >
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="row"
                onClick={() => pick(p.id)}
                style={{ width: "100%", justifyContent: "space-between", padding: "10px 14px", textAlign: "left", gap: 12 }}
              >
                <span>
                  <span style={{ fontWeight: 500 }}>{p.name}</span> <span className="t-caption num">({p.sku})</span>
                </span>
                <span className="t-caption num">
                  คงเหลือ {formatNumber(p.quantity)} {p.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
