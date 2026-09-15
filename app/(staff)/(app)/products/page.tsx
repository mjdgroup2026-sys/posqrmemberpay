import { Suspense } from "react"
import { listProducts, listCategoryOptions } from "@/lib/queries"
import { ProductManager } from "@/components/product-manager"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "สินค้า" }

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("PRODUCTS")

  const params = await searchParams
  const search = typeof params.q === "string" ? params.q : ""
  const category = typeof params.category === "string" ? params.category : ""
  const onlyLow = params.filter === "low"

  const [allProducts, categories] = await Promise.all([
    listProducts(storeId, { search, category }),
    listCategoryOptions(storeId),
  ])

  const products = onlyLow ? allProducts.filter((p) => p.isLow) : allProducts

  return (
    <Suspense fallback={<p className="t-body">กำลังโหลด…</p>}>
      <ProductManager
        products={products}
        categories={categories}
        search={search}
        category={category}
        onlyLow={onlyLow}
      />
    </Suspense>
  )
}
