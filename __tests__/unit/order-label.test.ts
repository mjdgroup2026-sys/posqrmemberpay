import { describe, expect, it } from "vitest"
import { orderTicketLabel, placeLabel, placeNoun, ticketHeading } from "@/lib/order-label"

/// คำเรียกที่นั่ง โต๊ะ/ห้อง (2026-10-08) — ตัดสินจากชนิดของโต๊ะ ไม่ใช่ประเภทร้าน
describe("placeLabel / ticketHeading", () => {
  it("ห้องนวด = ห้อง · โต๊ะปกติ/ไม่รู้ชนิด = โต๊ะ", () => {
    expect(placeNoun("ROOM")).toBe("ห้อง")
    expect(placeNoun("TABLE")).toBe("โต๊ะ")
    expect(placeNoun(null)).toBe("โต๊ะ")
    expect(placeLabel("ROOM", "3/1")).toBe("ห้อง 3/1")
    expect(placeLabel("TABLE", "A1")).toBe("โต๊ะ A1")
  })

  it("หัวทิกเก็ตครัว: กินที่ร้านเติมโต๊ะ/ห้อง · กลับบ้านไม่เติมอะไร (เดิมเครื่องพิมพ์ครัวพิมพ์ว่า \"โต๊ะ กลับบ้าน #3\")", () => {
    expect(ticketHeading({ orderType: "DINE_IN", tableCode: "A1", tableKind: "TABLE" })).toBe("โต๊ะ A1")
    expect(ticketHeading({ orderType: "DINE_IN", tableCode: "3/1", tableKind: "ROOM" })).toBe("ห้อง 3/1")
    const takeaway = orderTicketLabel({ orderType: "TAKEAWAY", tableCode: null, orderNumber: 3, customerLabel: "คุณบี" })
    expect(ticketHeading({ orderType: "TAKEAWAY", tableCode: takeaway, tableKind: null })).toBe("กลับบ้าน #3 · คุณบี")
  })
})
