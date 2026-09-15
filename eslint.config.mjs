import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Phase 13 — ชั้นกันลืม `where: { storeId }`: โค้ดที่แตะข้อมูลร้านต้องผ่าน forStore() จาก lib/db.ts เท่านั้น
  // import `@/lib/prisma` ตรง ๆ ใน action/query ได้เฉพาะจุดที่ต้องค้นข้ามร้านโดยตั้งใจ (เช่น สลับร้าน)
  // และต้องปิดกฎบรรทัดนั้นด้วย eslint-disable พร้อมเหตุผล — ให้คนรีวิวเห็นชัดว่าจงใจ
  {
    files: ["app/actions/**/*.ts", "lib/queries.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "ห้ามใช้ prisma ตรง ๆ ใน Server Action / lib/queries.ts — ใช้ forStore(storeId) จาก @/lib/db " +
                "เพื่อให้ทุก query ถูกกรองด้วย storeId เสมอ (Phase 13) · ถ้าจำเป็นต้องค้นข้ามร้านจริง ๆ " +
                "ให้ปิดกฎเฉพาะบรรทัดพร้อมอธิบายเหตุผล",
            },
          ],
        },
      ],
    },
  },
])

export default eslintConfig
