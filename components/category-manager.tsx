"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createCategory, updateCategory, deleteCategory } from "@/app/actions/categories"
import { formatDate, formatNumber } from "@/lib/format"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconEdit, IconPlus, IconSpinner, IconTrash } from "@/components/icons"
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

export type CategoryRow = {
  id: string
  name: string
  createdAt: Date
  productCount: number
}

export function CategoryManager({ categories, allowed = FULL_ACCESS }: { categories: CategoryRow[]; allowed?: AllowedActions }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [deleting, setDeleting] = useState<CategoryRow | null>(null)
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData(event.currentTarget)

    try {
      const result = editing ? await updateCategory(formData) : await createCategory(formData)

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.error)
        return
      }

      toast.success(result.message)
      setCreating(false)
      setEditing(null)
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
      const result = await deleteCategory(formData)
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

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">คลังสินค้า</p>
          <h1 className="t-h1">หมวดหมู่สินค้า</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            หมวดหมู่เป็นข้อมูลหลักที่ฟอร์มสินค้าเลือกใช้ — ลบไม่ได้ถ้ายังมีสินค้าผูกอยู่
          </p>
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
            <IconPlus size={17} aria-hidden /> เพิ่มหมวดหมู่
          </button>
        ) : null}
      </div>

      <section className="card-ui">
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>ชื่อหมวดหมู่</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>สินค้าที่ผูกอยู่</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สร้างเมื่อ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 28, textAlign: "center" }} className="t-body">
                    ยังไม่มีหมวดหมู่ — กด “เพิ่มหมวดหมู่” เพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "12px 24px", fontWeight: 500 }}>{c.name}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(c.productCount)}
                    </td>
                    <td className="t-caption num" style={{ padding: "12px" }}>
                      {formatDate(c.createdAt)}
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        {allowed.includes("EDIT") ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            aria-label={`แก้ไข ${c.name}`}
                            onClick={() => {
                              setFieldErrors({})
                              setEditing(c)
                            }}
                          >
                            <IconEdit size={16} aria-hidden />
                          </button>
                        ) : null}
                        {allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            aria-label={`ลบ ${c.name}`}
                            disabled={c.productCount > 0}
                            title={c.productCount > 0 ? "ลบไม่ได้ — ยังมีสินค้าผูกอยู่" : undefined}
                            onClick={() => setDeleting(c)}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่ใหม่"}</DialogTitle>
            <DialogDescription>ชื่อหมวดหมู่ต้องไม่ซ้ำกับที่มีอยู่ในระบบ</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

            <div className="field">
              <label className="t-small" htmlFor="name">
                ชื่อหมวดหมู่ <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="name"
                name="name"
                className="input"
                required
                autoFocus
                defaultValue={editing?.name ?? ""}
                placeholder="เช่น เครื่องเขียน"
              />
              {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
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
                {editing ? "บันทึกการแก้ไข" : "เพิ่มหมวดหมู่"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบหมวดหมู่</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบหมวดหมู่ “{deleting?.name}” ใช่หรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={pending}>
              ลบหมวดหมู่
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
