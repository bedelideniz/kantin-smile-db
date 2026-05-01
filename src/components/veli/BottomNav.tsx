import { Ban, Wallet, Receipt } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

interface Props {
  /** Optional center action override (defaults to navigating to /veli/yukle) */
  onTopUp?: () => void;
}

export default function BottomNav({ onTopUp }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isActive = (p: string) => pathname === p;

  return (
    <>
      {/* spacer so content isn't hidden behind the bar */}
      <div className="h-24" aria-hidden />
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-accent/20 bg-background/95 shadow-[0_-4px_20px_-4px_hsl(var(--primary)/0.15)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="relative mx-auto flex max-w-md items-end justify-between px-6 pt-2 pb-2">
          {/* Left: blocked products */}
          <button
            onClick={() => navigate("/veli/yasaklilar")}
            className={`flex flex-1 flex-col items-center gap-1 rounded-md py-2 text-xs transition-colors ${
              isActive("/veli/yasaklilar")
                ? "text-destructive"
                : "text-muted-foreground hover:text-destructive/80"
            }`}
            aria-label="Yasaklı ürünler"
          >
            <Ban className="h-6 w-6" />
            <span className="font-medium">Yasaklılar</span>
          </button>

          {/* Center spacer for the floating button */}
          <div className="w-20 shrink-0" />

          {/* Right: transactions (panel) */}
          <button
            onClick={() => navigate("/veli")}
            className={`flex flex-1 flex-col items-center gap-1 rounded-md py-2 text-xs transition-colors ${
              isActive("/veli") ? "text-primary" : "text-muted-foreground hover:text-primary/80"
            }`}
            aria-label="Hareketler"
          >
            <Receipt className="h-6 w-6" />
            <span className="font-medium">Hareketler</span>
          </button>

          {/* Center floating ₺ top-up button — gold gradient */}
          <button
            onClick={() => (onTopUp ? onTopUp() : navigate("/veli/yukle"))}
            aria-label="Bakiye yükle"
            className="absolute left-1/2 -top-7 -translate-x-1/2 flex h-16 w-16 items-center justify-center rounded-full text-accent-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-105 active:scale-95"
            style={{ background: "var(--gradient-gold)" }}
          >
            <span className="flex flex-col items-center leading-none">
              <Wallet className="mb-0.5 h-5 w-5" />
              <span className="text-[11px] font-bold">Yükle</span>
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
