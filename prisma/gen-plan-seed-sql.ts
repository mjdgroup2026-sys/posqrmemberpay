import { standardPlanSeeds, TRIAL_DAYS, TIER_SPEC } from "../lib/subscription"

/// พิมพ์ VALUES ของแพ็กเกจมาตรฐาน version 1 สำหรับ migration add_store_subscription — รันครั้งเดียวตอนเขียน migration
/// (ไม่ใช่สคริปต์ที่ใช้ตอน deploy) เก็บไว้เพื่อให้ตารางราคาใน lib/subscription.ts กับ SQL ไม่หลุดจากกัน
const rows = standardPlanSeeds().map(
  (p) =>
    `    ('plan_${p.code.toLowerCase().replace("-", "_")}_v1', '${p.code}', 1, '${p.name}', '${p.tier}', ${p.tableLimit}, ${p.durationDays}, ${p.ratePerDay.toFixed(2)}, ${p.discountPercent.toFixed(2)}, ${p.price.toFixed(2)}, ${p.sortOrder})`,
)
rows.push(
  `    ('plan_trial_v1', 'TRIAL', 1, 'ทดลองใช้ ${TRIAL_DAYS} วัน', 'S', ${TIER_SPEC.S.tableLimit}, ${TRIAL_DAYS}, 0.00, 0.00, 0.00, 99)`,
)
console.log(rows.join(",\n"))
