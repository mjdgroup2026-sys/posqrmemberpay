"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { createProduct, updateProduct, deleteProduct } from "@/app/actions/products"
import { formatBaht, formatNumber } from "@/lib/format"
import type { ProductListItem } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconEdit, IconPlus, IconSearch, IconSpinner, IconTrash } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type CategoryOption = { id: string; name: string }

type Props = {
  products: ProductListItem[]
  categories: CategoryOption[]
  search: string
  category: string
  onlyLow: boolean
  /// สิทธิ์ของผู้ใช้บน PRODUCTS (§4) — ซ่อนปุ่มที่ทำไม่ได้ · ด่านจริงอยู่ที่ action
  allowed?: AllowedActions
}

export function ProductManager({ products, categories, search, category, onlyLow, allowed = FULL_ACCESS }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isNavigating, startNavigation] = useTransition()

  const [editing, setEditing] = useState<ProductListItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ProductListItem | null>(null)
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  function updateQuery(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== "all") params.set(key, value)
    else params.delete(key)
    startNavigation(() => router.push(`/products?${params.toString()}`))
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData(event.currentTarget)

    try {
      const result = editing ? await updateProduct(formData) : await createProduct(formData)

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.error)
        return
      }

      toast.success(result.message)
      setEditing(null)
      setCreating(false)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setPending(true)
    const formData = new FormData()
    formData.set("id", deleting.id)

    try {
      const result = await deleteProduct(formData)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
      setDeleting(null)
    }
  }

  const dialogOpen = creating || editing !== null
  const current = editing

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">คลังสินค้า</p>
          <h1 className="t-h1">สินค้า</h1>
        </div>
        {allowed.includes("ADD") ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFieldErrors({})
              setCreating(true)
            }}
          >
            <IconPlus size={17} aria-hidden /> เพิ่มสินค้า
          </button>
        ) : null}
      </div>

      <section className="card-ui">
        <div className="panel-head" style={{ flexWrap: "wrap" }}>
          <form
            className="row"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault()
              updateQuery("q", String(new FormData(e.currentTarget).get("q") ?? ""))
            }}
          >
            <div style={{ position: "relative" }}>
              <IconSearch
                size={16}
                aria-hidden
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--ink-3)",
                }}
              />
              <input
                name="q"
                defaultValue={search}
                className="input"
                placeholder="ค้นหาชื่อสินค้าหรือ SKU"
                style={{ paddingLeft: 34, width: 260 }}
              />
            </div>
            <button type="submit" className="btn btn-subtle">
              ค้นหา
            </button>
          </form>

          <div className="row" style={{ gap: 10 }}>
            <select
              className="select"
              style={{ width: 180 }}
              value={category || "all"}
              onChange={(e) => updateQuery("category", e.target.value)}
            >
              <option value="all">ทุกหมวดหมู่</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={onlyLow ? "btn btn-primary btn-sm" : "btn btn-subtle btn-sm"}
              onClick={() => updateQuery("filter", onlyLow ? "" : "low")}
            >
              เฉพาะใกล้หมด
            </button>
          </div>
        </div>

        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>SKU</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>ชื่อสินค้า</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>หมวดหมู่</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>คงเหลือ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>จุดสั่งซื้อ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ราคา</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody style={{ opacity: isNavigating ? 0.55 : 1, transition: "opacity .15s" }}>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 28, textAlign: "center" }} className="t-body">
                    ไม่พบสินค้าตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="num t-caption" style={{ padding: "12px 24px" }}>
                      {p.sku}
                    </td>
                    <td style={{ padding: "12px", fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: "12px" }}>
                      <span className="chip chip-neutral">{p.category}</span>
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      <span className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                        {formatNumber(p.quantity)} {p.unit}
                        {p.isLow ? (
                          <span className={`chip ${p.quantity === 0 ? "chip-danger" : "chip-warning"}`}>
                            <span className="dot" />
                            {p.quantity === 0 ? "หมด" : "ใกล้หมด"}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(p.reorderPoint)}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      ฿{formatBaht(p.price)}
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        {allowed.includes("EDIT") ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            aria-label={`แก้ไข ${p.name}`}
                            onClick={() => {
                              setFieldErrors({})
                              setEditing(p)
                            }}
                          >
                            <IconEdit size={16} aria-hidden />
                          </button>
                        ) : null}
                        {allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            aria-label={`ลบ ${p.name}`}
                            onClick={() => setDeleting(p)}
                          >
                            <IconTrash size={16} aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{current ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</DialogTitle>
            <DialogDescription>
              {current
                ? "ยอดคงเหลือแก้ที่นี่ไม่ได้ — ต้องทำผ่านหน้ารับเข้า/เบิกจ่ายเท่านั้น"
                : "เว้น SKU ว่างไว้ ระบบจะสร้างรหัสให้อัตโนมัติ (SKU-1001, SKU-1002, …)"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {current ? <input type="hidden" name="id" value={current.id} /> : null}

            <div className="field">
              <label className="t-small" htmlFor="name">
                ชื่อสินค้า <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input id="name" name="name" className="input" required defaultValue={current?.name ?? ""} />
              {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="sku">
                  SKU
                </label>
                <input
                  id="sku"
                  name="sku"
                  className="input num"
                  defaultValue={current?.sku ?? ""}
                  placeholder="สร้างอัตโนมัติ"
                />
                {fieldErrors.sku ? <span className="field-hint error">{fieldErrors.sku}</span> : null}
              </div>

              <div className="field">
                <label className="t-small" htmlFor="categoryId">
                  หมวดหมู่ <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <select
                  id="categoryId"
                  name="categoryId"
                  className="select"
                  required
                  defaultValue={current?.categoryId ?? ""}
                >
                  <option value="" disabled>
                    เลือกหมวดหมู่
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {categories.length === 0 ? (
                  <span className="field-hint">ยังไม่มีหมวดหมู่ในระบบ — เพิ่มได้ที่หน้า “หมวดหมู่สินค้า”</span>
                ) : null}
                {fieldErrors.categoryId ? (
                  <span className="field-hint error">{fieldErrors.categoryId}</span>
                ) : null}
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="unit">
                  หน่วยนับ <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="unit"
                  name="unit"
                  className="input"
                  required
                  placeholder="ชิ้น / กล่อง"
                  defaultValue={current?.unit ?? ""}
                />
                {fieldErrors.unit ? <span className="field-hint error">{fieldErrors.unit}</span> : null}
              </div>

              <div className="field">
                <label className="t-small" htmlFor="price">
                  ราคาต่อหน่วย (บาท) <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input num"
                  required
                  defaultValue={current?.price ?? ""}
                />
                {fieldErrors.price ? <span className="field-hint error">{fieldErrors.price}</span> : null}
              </div>

              <div className="field">
                <label className="t-small" htmlFor="reorderPoint">
                  จุดสั่งซื้อ <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  id="reorderPoint"
                  name="reorderPoint"
                  type="number"
                  min={0}
                  step={1}
                  className="input num"
                  required
                  defaultValue={current?.reorderPoint ?? 0}
                />
                {fieldErrors.reorderPoint ? (
                  <span className="field-hint error">{fieldErrors.reorderPoint}</span>
                ) : null}
              </div>
            </div>

            <DialogFooter>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false)
                  setEditing(null)
                }}
              >
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                {current ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบสินค้า</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบ “{deleting?.name}” ({deleting?.sku}) ใช่หรือไม่? ประวัติการเคลื่อนไหวของสินค้านี้จะถูกลบตามไปด้วย
              และกู้คืนไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={pending}>
              ลบสินค้า
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
