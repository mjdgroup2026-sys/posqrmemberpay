"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStaffTableOrder, createTakeawaySale } from "@/app/actions/staff-order"
import { formatBaht } from "@/lib/format"
import type { MenuItemCard, PosTableOption } from "@/lib/queries"
import {
  FULL_ACCESS,
  PAYMENT_METHOD_LABEL,
  RETAIL_PAYMENT_METHODS,
  type AllowedActions,
  type PaymentMethodValue,
  type ReceiptData,
} from "@/lib/types"
import { Receipt } from "@/components/receipt"
import { IconPlus, IconSearch, IconSpinner, IconTrash, IconTable, IconWallet } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// จอขายอาหารฝั่งพนักงาน (Phase 17b) — เลือกเมนูจากรูป → ใส่ตะกร้า → เลือกโต๊ะ → ส่งเข้าครัว
///
/// ปิดบิลยังอยู่ที่หน้าเดิมของโต๊ะ (สั่งก่อน–ปิดบิลทีหลัง ตามที่ตกลงไว้ใน Phase 17)
/// ราคาที่เห็นบนจอเป็นค่าประมาณให้พนักงานบอกลูกค้าได้ — ราคาจริงถูกคิดใหม่ฝั่ง server เสมอ

type CartLine = {
  /// คีย์ของบรรทัด (เมนูเดียวกันแต่ตัวเลือกต่างกัน = คนละบรรทัด)
  key: string
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
  optionIds: string[]
  optionNames: string[]
  note?: string
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function MenuPos({
  menu,
  tables,
  allowed = FULL_ACCESS,
  initialTableId,
}: {
  menu: { featured: MenuItemCard[]; all: MenuItemCard[] }
  tables: PosTableOption[]
  /// โต๊ะที่ถูกเลือกไว้ล่วงหน้า — มาจากปุ่ม "สั่งเพิ่ม" บนหน้าโต๊ะ (F13)
  initialTableId?: string
  /// สิทธิ์บนจอขายอาหาร — ADD = กดขาย/ส่งเข้าครัว (§4) · ไม่มี = ดูเมนูได้แต่ส่งออร์เดอร์ไม่ได้
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const canSell = allowed.includes("ADD")

  const [search, setSearch] = useState("")
  const [cart, setCart] = useState<CartLine[]>([])
  const [tableId, setTableId] = useState(initialTableId ?? "")
  const [pending, setPending] = useState(false)
  const [customizing, setCustomizing] = useState<MenuItemCard | null>(null)

  /// TABLE = สั่งเข้าโต๊ะแล้วปิดบิลทีหลัง · TAKEAWAY = กลับบ้าน รับเงินตอนสั่ง (Phase 17c)
  const [mode, setMode] = useState<"TABLE" | "TAKEAWAY">("TABLE")
  const [customerLabel, setCustomerLabel] = useState("")
  const [payOpen, setPayOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("CASH")
  const [receivedText, setReceivedText] = useState("")
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)

  const visibleMenu = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return menu.all
    return menu.all.filter((item) => item.name.toLowerCase().includes(keyword))
  }, [menu.all, search])

  // โต๊ะที่ถูกรวมเข้าโต๊ะอื่นไม่ต้องโชว์ — ทุกอย่างวิ่งไปที่โต๊ะหลักอยู่แล้ว
  const selectableTables = useMemo(() => tables.filter((t) => t.mergedIntoCode === null), [tables])
  const selectedTable = selectableTables.find((t) => t.id === tableId) ?? null

  const total = round2(cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))

  function addLine(item: MenuItemCard, optionIds: string[], optionNames: string[], note: string | undefined, quantity: number, unitPrice: number) {
    const key = `${item.id}|${[...optionIds].sort().join(",")}|${note ?? ""}`
    setCart((prev) => {
      const existing = prev.find((line) => line.key === key)
      if (existing) {
        return prev.map((line) => (line.key === key ? { ...line, quantity: line.quantity + quantity } : line))
      }
      return [...prev, { key, menuItemId: item.id, name: item.name, unitPrice, quantity, optionIds, optionNames, note }]
    })
  }

  function pickItem(item: MenuItemCard) {
    // เมนูที่ไม่มีตัวเลือกเสริม กดครั้งเดียวลงตะกร้าเลย — หน้าร้านต้องเร็ว
    if (item.modifierGroups.length === 0) {
      addLine(item, [], [], undefined, 1, item.price)
      return
    }
    setCustomizing(item)
  }

  function setQuantity(key: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((line) => line.key !== key))
      return
    }
    setCart((prev) => prev.map((line) => (line.key === key ? { ...line, quantity } : line)))
  }

  async function submit() {
    if (!tableId) {
      toast.error("กรุณาเลือกโต๊ะก่อนส่งออร์เดอร์")
      return
    }
    if (cart.length === 0) {
      toast.error("กรุณาเลือกเมนูก่อนส่งออร์เดอร์")
      return
    }

    setPending(true)
    try {
      const fd = new FormData()
      fd.set("tableId", tableId)
      fd.set(
        "items",
        JSON.stringify(
          cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            optionIds: line.optionIds,
            note: line.note,
          })),
        ),
      )

      const result = await createStaffTableOrder(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(result.message ?? "ส่งออร์เดอร์เรียบร้อยแล้ว")
      setCart([])
      router.refresh()
    } catch {
      toast.error("ส่งออร์เดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  const received = Number(receivedText === "" ? 0 : receivedText)
  const changeDue = paymentMethod === "CASH" ? round2(received - total) : 0

  async function submitTakeaway() {
    setPending(true)
    try {
      const fd = new FormData()
      fd.set(
        "items",
        JSON.stringify(
          cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            optionIds: line.optionIds,
            note: line.note,
          })),
        ),
      )
      fd.set("paymentMethod", paymentMethod)
      fd.set("amountReceived", paymentMethod === "CASH" ? String(received) : String(total))
      fd.set("customerLabel", customerLabel.trim())

      const result = await createTakeawaySale(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(result.message ?? "รับเงินเรียบร้อยแล้ว")
      setReceipt(result.data?.receipt ?? null)
      setCart([])
      setCustomerLabel("")
      setReceivedText("")
      setPayOpen(false)
      router.refresh()
    } catch {
      toast.error("รับเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  // ใบเสร็จของบิลกลับบ้าน — กินพื้นที่ทั้งหน้าเหมือนหน้า /pos เพื่อให้กดพิมพ์ได้ทันที
  if (receipt) {
    return (
      <>
        <div className="page-head no-print">
          <div>
            <p className="t-eyebrow">ขายอาหาร</p>
            <h1 className="t-h1">รับเงินเรียบร้อย</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
              พิมพ์ใบเสร็จ
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setReceipt(null)}>
              <IconPlus size={17} aria-hidden /> เริ่มบิลใหม่
            </button>
          </div>
        </div>

        <section className="card-ui card-pad" style={{ maxWidth: 420, margin: "0 auto", width: "100%" }}>
          <Receipt data={receipt} />
        </section>
      </>
    )
  }

  return (
    <div className="pos-layout">
      <section className="card-ui card-pad">
        <div className="panel-head">
          <h1 className="t-h2">ขายอาหาร</h1>
          <span className="t-caption">เลือกเมนูใส่ตะกร้า แล้วเลือกโต๊ะเพื่อส่งเข้าครัว</span>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <IconSearch size={18} aria-hidden />
            <input
              className="input"
              placeholder="ค้นหาเมนู…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {menu.featured.length > 0 && search.trim() === "" ? (
          <>
            <h2 className="t-h3" style={{ marginTop: 16 }}>
              เมนูแนะนำ
            </h2>
            <MenuGrid items={menu.featured} onPick={pickItem} disabled={!canSell} />
          </>
        ) : null}

        <h2 className="t-h3" style={{ marginTop: 16 }}>
          เมนูทั้งหมด
        </h2>
        {visibleMenu.length === 0 ? (
          <p className="t-body" style={{ marginTop: 8 }}>
            ไม่พบเมนูที่ค้นหา
          </p>
        ) : (
          <MenuGrid items={visibleMenu} onPick={pickItem} disabled={!canSell} />
        )}
      </section>

      <section className="card-ui card-pad">
        <div className="panel-head">
          <h2 className="t-h3">ตะกร้า</h2>
          <span className="t-caption num">{cart.length} รายการ</span>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === "TABLE" ? "btn-primary" : "btn-subtle"}`}
            onClick={() => setMode("TABLE")}
          >
            <IconTable size={16} aria-hidden /> ขายเข้าโต๊ะ
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === "TAKEAWAY" ? "btn-primary" : "btn-subtle"}`}
            onClick={() => setMode("TAKEAWAY")}
          >
            <IconWallet size={16} aria-hidden /> กลับบ้าน
          </button>
        </div>

        {mode === "TAKEAWAY" ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="t-small" htmlFor="posCustomer">
              ชื่อลูกค้า / เบอร์ 4 ตัวท้าย (ไม่บังคับ)
            </label>
            <input
              id="posCustomer"
              className="input"
              maxLength={40}
              value={customerLabel}
              onChange={(e) => setCustomerLabel(e.target.value)}
              placeholder="เช่น คุณเอ หรือ 1234"
            />
            <span className="field-hint">ใช้เรียกลูกค้ามารับ — ขึ้นบนทิกเก็ตครัวแทนเลขโต๊ะ</span>
          </div>
        ) : null}

        <div className="field" style={{ marginTop: 12, display: mode === "TABLE" ? undefined : "none" }}>
          <label className="t-small" htmlFor="posTable">
            โต๊ะ
          </label>
          <select id="posTable" className="select" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">— เลือกโต๊ะ —</option>
            {selectableTables.map((table) => (
              <option key={table.id} value={table.id} disabled={table.awaitingBill}>
                โต๊ะ {table.code}
                {table.awaitingBill
                  ? " (ขอเช็กบิลแล้ว)"
                  : table.hasOpenSession
                    ? ` (บิลเปิดอยู่ ฿${formatBaht(table.currentTotal)})`
                    : " (ว่าง)"}
              </option>
            ))}
          </select>
          <span className="field-hint">
            <IconTable size={14} aria-hidden /> โต๊ะว่างจะถูกเปิดให้อัตโนมัติเมื่อส่งออร์เดอร์
          </span>
        </div>

        {cart.length === 0 ? (
          <p className="t-body" style={{ marginTop: 12 }}>
            ยังไม่มีรายการในตะกร้า
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
            {cart.map((line) => (
              <li key={line.key} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <span className="t-body">{line.name}</span>
                  {line.optionNames.length > 0 ? (
                    <>
                      <br />
                      <span className="t-caption">{line.optionNames.join(" · ")}</span>
                    </>
                  ) : null}
                  {line.note ? (
                    <>
                      <br />
                      <span className="t-caption">โน้ต: {line.note}</span>
                    </>
                  ) : null}
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setQuantity(line.key, line.quantity - 1)}
                    aria-label={`ลดจำนวน ${line.name}`}
                  >
                    −
                  </button>
                  <span className="num">{line.quantity}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setQuantity(line.key, line.quantity + 1)}
                    aria-label={`เพิ่มจำนวน ${line.name}`}
                  >
                    +
                  </button>
                  <span className="num" style={{ minWidth: 72, textAlign: "right" }}>
                    ฿{formatBaht(round2(line.unitPrice * line.quantity))}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setQuantity(line.key, 0)}
                    aria-label={`ลบ ${line.name}`}
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <span className="t-h3">ยอดรวม</span>
          <span className="t-h3 num">฿{formatBaht(total)}</span>
        </div>

        {mode === "TABLE" ? (
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 12 }}
            disabled={!canSell || pending || cart.length === 0 || !tableId}
            onClick={submit}
          >
            {pending ? (
              <IconSpinner size={18} className="animate-spin" aria-hidden />
            ) : (
              <IconPlus size={18} aria-hidden />
            )}
            ส่งเข้าครัว
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            style={{ marginTop: 12 }}
            disabled={!canSell || pending || cart.length === 0}
            onClick={() => {
              setReceivedText("")
              setPaymentMethod("CASH")
              setPayOpen(true)
            }}
          >
            <IconWallet size={18} aria-hidden /> รับเงินและส่งเข้าครัว
          </button>
        )}

        {!canSell ? (
          <span className="field-hint" style={{ marginTop: 8 }}>
            คุณมีสิทธิ์ดูอย่างเดียว จึงส่งออร์เดอร์ไม่ได้
          </span>
        ) : null}

        {mode === "TABLE" && selectedTable?.hasOpenSession ? (
          <a
            className="btn btn-subtle btn-block"
            style={{ marginTop: 8 }}
            href={`/mobile-order/tables/${selectedTable.id}/billing`}
          >
            ไปหน้าปิดบิลของโต๊ะ {selectedTable.code}
          </a>
        ) : null}
      </section>

      <Dialog open={payOpen} onOpenChange={(open) => (pending ? null : setPayOpen(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>รับเงิน — อาหารกลับบ้าน</DialogTitle>
            <DialogDescription>
              ยอดที่ต้องชำระ ฿{formatBaht(total)} · ออกบิลและส่งเข้าครัวพร้อมกันในขั้นตอนเดียว
            </DialogDescription>
          </DialogHeader>

          <div className="field">
            <span className="t-small">วิธีชำระเงิน</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {RETAIL_PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  className={`btn btn-sm ${paymentMethod === method ? "btn-primary" : "btn-subtle"}`}
                  onClick={() => setPaymentMethod(method)}
                >
                  {PAYMENT_METHOD_LABEL[method]}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === "CASH" ? (
            <div className="field">
              <label className="t-small" htmlFor="posReceived">
                รับเงินมา (บาท)
              </label>
              <input
                id="posReceived"
                className="input num"
                inputMode="decimal"
                value={receivedText}
                onChange={(e) => setReceivedText(e.target.value)}
                placeholder={String(total)}
              />
              <span className="field-hint num">
                เงินทอน ฿{formatBaht(changeDue > 0 ? changeDue : 0)}
                {received > 0 && received < total ? " · เงินที่รับยังไม่พอ" : ""}
              </span>
            </div>
          ) : (
            <p className="t-body">เก็บเงินเต็มจำนวน ฿{formatBaht(total)} — ไม่มีเงินทอน</p>
          )}

          <DialogFooter>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setPayOpen(false)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || (paymentMethod === "CASH" && received < total)}
              onClick={submitTakeaway}
            >
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
              ยืนยันรับเงิน ฿{formatBaht(total)}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {customizing ? (
        <CustomizeDialog
          item={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={(optionIds, optionNames, note, quantity, unitPrice) => {
            addLine(customizing, optionIds, optionNames, note, quantity, unitPrice)
            setCustomizing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function MenuGrid({
  items,
  onPick,
  disabled,
}: {
  items: MenuItemCard[]
  onPick: (item: MenuItemCard) => void
  disabled: boolean
}) {
  return (
    <div className="menu-pos-grid" style={{ marginTop: 10 }}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="menu-pos-card"
          disabled={disabled}
          onClick={() => onPick(item)}
        >
          {item.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- รูปมาได้ทั้งจาก /api/assets และลิงก์ภายนอกที่ร้านกรอกเอง */
            <img src={item.imageUrl} alt="" className="menu-pos-thumb" />
          ) : (
            <div className="menu-pos-thumb menu-pos-thumb-empty" aria-hidden />
          )}
          <span className="t-body">{item.name}</span>
          <span className="t-small num">฿{formatBaht(item.price)}</span>
          {item.modifierGroups.length > 0 ? <span className="t-caption">มีตัวเลือกเสริม</span> : null}
        </button>
      ))}
    </div>
  )
}

/// เลือกตัวเลือกเสริมก่อนใส่ตะกร้า — กติกาเดียวกับหน้าลูกค้า (radio = SINGLE · checkbox = MULTIPLE)
/// server ตรวจซ้ำทุกครั้งที่ `buildOrderLines()` จึงไม่ใช่ด่านจริง แค่กันพนักงานกดผิด
function CustomizeDialog({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItemCard
  onClose: () => void
  onAdd: (optionIds: string[], optionNames: string[], note: string | undefined, quantity: number, unitPrice: number) => void
}) {
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const group of item.modifierGroups) {
      if (group.required && group.selectionType === "SINGLE" && group.options[0]) {
        initial[group.id] = [group.options[0].id]
      }
    }
    return initial
  })

  const optionIds = Object.values(selected).flat()
  const chosenOptions = item.modifierGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id))
  const unitPrice = round2(item.price + chosenOptions.reduce((sum, o) => sum + o.priceDelta, 0))

  function toggle(groupId: string, optionId: string, single: boolean) {
    setSelected((prev) => {
      const current = prev[groupId] ?? []
      if (single) return { ...prev, [groupId]: [optionId] }
      return {
        ...prev,
        [groupId]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
      }
    })
  }

  function confirm() {
    for (const group of item.modifierGroups) {
      if (group.required && (selected[group.id] ?? []).length === 0) {
        toast.error(`กรุณาเลือก "${group.name}" ก่อน`)
        return
      }
    }
    onAdd(optionIds, chosenOptions.map((o) => o.name), note.trim() === "" ? undefined : note.trim(), quantity, unitPrice)
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>เลือกตัวเลือกเสริมและจำนวนก่อนใส่ตะกร้า</DialogDescription>
        </DialogHeader>

        {item.modifierGroups.map((group) => (
          <div key={group.id} className="field">
            <span className="t-small">
              {group.name} · {group.required ? "ต้องเลือก" : "ไม่บังคับ"} ·{" "}
              {group.selectionType === "SINGLE" ? "เลือกได้ 1 อย่าง" : "เลือกได้หลายอย่าง"}
            </span>
            {group.options.map((option) => (
              <label key={option.id} className="checkbox-row">
                <input
                  type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                  name={`${item.id}-${group.id}`}
                  checked={(selected[group.id] ?? []).includes(option.id)}
                  onChange={() => toggle(group.id, option.id, group.selectionType === "SINGLE")}
                />
                <span style={{ flex: 1 }}>{option.name}</span>
                {option.priceDelta > 0 ? <span className="t-small num">+฿{formatBaht(option.priceDelta)}</span> : null}
              </label>
            ))}
          </div>
        ))}

        <div className="field">
          <label className="t-small" htmlFor="posItemNote">
            โน้ตถึงครัว (ไม่บังคับ)
          </label>
          <input
            id="posItemNote"
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น ไม่ใส่ผักชี"
          />
        </div>

        <div className="field">
          <label className="t-small" htmlFor="posItemQty">
            จำนวน
          </label>
          <input
            id="posItemQty"
            className="input num"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <DialogFooter>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            ใส่ตะกร้า · ฿{formatBaht(round2(unitPrice * quantity))}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
