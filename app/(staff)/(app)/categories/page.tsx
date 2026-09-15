import { listCategoriesWithCount } from "@/lib/queries"
import { CategoryManager } from "@/components/category-manager"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "หมวดหมู่สินค้า" }

export default async function CategoriesPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("CATEGORIES")

  const categories = await listCategoriesWithCount(storeId)

  return <CategoryManager categories={categories} />
}
