import Link from "next/link"
import { Copyright } from "@/components/copyright"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-5)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="row" style={{ justifyContent: "center", marginBottom: 20 }}>
          <span
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: "var(--brand)",
              color: "var(--brand-ink)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
            }}
          >
            MJD
          </span>
          <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>Mobile Order</span>
        </div>
        <div className="card-ui card-pad">{children}</div>
        <p className="t-small" style={{ textAlign: "center", marginTop: 14 }}>
          <Link href="/welcome">รู้จัก MJD Mobile Order</Link> · <Link href="/contact">ติดต่อทีมงาน</Link>
        </p>
        <Copyright className="auth-copyright" />
      </div>
    </main>
  )
}
