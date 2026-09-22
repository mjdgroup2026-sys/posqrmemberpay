/// Prisma คืน Decimal เป็น object — ต้องแปลงก่อนส่งเข้า Client Component เสมอ
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber()
  }
  return Number(value)
}

export function formatBaht(value: unknown): string {
  return toNumber(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatNumber(value: unknown): string {
  return toNumber(value).toLocaleString("th-TH")
}

export function formatDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })
}

/// เวลาแบบนาฬิกา (14:32) ตามเวลาไทยเสมอ — ระบุ timeZone ชัด ๆ เพื่อให้ค่าฝั่ง server กับ client ตรงกัน
/// ไม่งั้น container ที่รันด้วย UTC จะ render คนละเวลากับเบราว์เซอร์แล้ว hydration พัง
export function formatClock(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value
  return d.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  })
}

/// ระยะเวลาเป็นข้อความไทยจากจำนวนนาที — ใช้กับ "เปิดโต๊ะมาแล้วกี่นาที" (คำนวณสดทุกครั้งที่ render)
export function formatElapsed(minutes: number): string {
  if (minutes < 1) return "เพิ่งเปิด"
  if (minutes < 60) return `${minutes} นาที`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} ชม.` : `${hours} ชม. ${rest} นาที`
}

export function minutesSince(value: Date | string, now: number = Date.now()): number {
  const d = typeof value === "string" ? new Date(value) : value
  return Math.max(0, Math.floor((now - d.getTime()) / 60_000))
}

/// วันที่แบบเต็มพร้อมชื่อวัน ("จันทร์ 22 ก.ย. 2569") ตามเวลาไทยเสมอ — ใช้บนหัวหน้าขาย/ปิดรอบ
/// ระบุ timeZone ชัด ๆ ด้วยเหตุผลเดียวกับ formatClock (server UTC vs เบราว์เซอร์ไทย)
export function formatBusinessDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value
  return d.toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  })
}
