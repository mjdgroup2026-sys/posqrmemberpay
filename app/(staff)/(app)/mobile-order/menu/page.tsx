import { listMenuForManage } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { MenuAdmin } from "@/components/menu-admin"

export const metadata = { title: "จัดการเมนูอาหาร" }

export default async function ManageMenuPage() {
  const { storeId } = await requireStorePage()
  const items = await listMenuForManage(storeId)
  return <MenuAdmin items={items} />
}
