import { describe, expect, it } from "vitest"
import { groupByStation, hasStationSplit, UNASSIGNED_STATION_LABEL } from "@/lib/ticket-lines"

/// จัดกลุ่มบรรทัดทิกเก็ตตามประเภทครัว (Phase 19) — KDS / ทิกเก็ต PDF / ESC-POS ใช้ตัวเดียวกัน
describe("groupByStation", () => {
  const line = (name: string, stationId: string | null, stationName: string | null) => ({ name, stationId, stationName })

  it("ไม่มีใครระบุครัว → กลุ่มเดียว 'ไม่ระบุครัว' และถือว่าไม่ต้องพิมพ์หัวกลุ่ม", () => {
    const groups = groupByStation([line("ก", null, null), line("ข", null, null)])
    expect(groups).toHaveLength(1)
    expect(groups[0].stationId).toBeNull()
    expect(groups[0].stationName).toBe(UNASSIGNED_STATION_LABEL)
    expect(groups[0].items.map((i) => i.name)).toEqual(["ก", "ข"])
    expect(hasStationSplit(groups)).toBe(false)
  })

  it("เรียงตาม sortOrder ของร้านก่อน · ไม่รู้จัก sortOrder เรียงตามชื่อ · ไม่ระบุครัวอยู่ท้ายเสมอ", () => {
    const groups = groupByStation(
      [
        line("ข้าวเปล่า", null, null),
        line("ไก่ทอด", "fried", "ของทอด"),
        line("ชาเย็น", "drink", "บาร์น้ำ"),
        line("ปลาทอด", "fried", "ของทอด"),
        line("ต้มยำ", "soup", "ต้ม"),
      ],
      [
        { id: "fried", sortOrder: 2 },
        { id: "drink", sortOrder: 1 },
      ],
    )
    expect(groups.map((g) => g.stationName)).toEqual(["บาร์น้ำ", "ของทอด", "ต้ม", UNASSIGNED_STATION_LABEL])
    expect(groups[1].items.map((i) => i.name)).toEqual(["ไก่ทอด", "ปลาทอด"]) // ลำดับภายในกลุ่มคงเดิม
    expect(hasStationSplit(groups)).toBe(true)
  })

  it("ทุกบรรทัดอยู่ครัวเดียวกัน → ยังนับว่าแยกครัว (พิมพ์หัวกลุ่มให้รู้ว่าของครัวไหน)", () => {
    const groups = groupByStation([line("ก", "s1", "ของผัด")])
    expect(hasStationSplit(groups)).toBe(true)
  })

  it("station ที่ไม่มีใน order list เรียงตามชื่อไทยและอยู่หลังตัวที่มี sortOrder", () => {
    const groups = groupByStation(
      [line("1", "z", "ฮ"), line("2", "y", "ก"), line("3", "x", "ข")],
      [{ id: "z", sortOrder: 0 }],
    )
    expect(groups.map((g) => g.stationName)).toEqual(["ฮ", "ก", "ข"])
  })

  it("รายการว่าง → ไม่มีกลุ่ม", () => {
    expect(groupByStation([])).toEqual([])
    expect(hasStationSplit([])).toBe(false)
  })
})
