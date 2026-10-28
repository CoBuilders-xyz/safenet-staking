import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { ConnectButton } from "@/components/wallet/ConnectButton"
import { useDarkMode } from "@/hooks/useDarkMode"
import { cn } from "@/lib/utils"
import Menu from "lucide-react/dist/esm/icons/menu"
import X from "lucide-react/dist/esm/icons/x"
import Sun from "lucide-react/dist/esm/icons/sun"
import Moon from "lucide-react/dist/esm/icons/moon"
import { Button } from "@/components/ui/button"
import { LanguageSwitcher } from "./LanguageSwitcher"

/** Desktop navigation has its own row so wallet controls fit with longer translated labels. */
export function Header() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navItems = [
    { label: t("header.nav.overview", "Overview"), path: "/" },
    { label: t("header.nav.dashboard", "Dashboard"), path: "/dashboard" },
    { label: t("header.nav.validators", "Validators"), path: "/validators" },
    { label: t("header.nav.withdrawals", "Withdrawals"), path: "/withdrawals" },
    { label: t("header.nav.rewards", "Rewards"), path: "/rewards" },
  ]
  const { isDark, toggle } = useDarkMode()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="flex flex-col items-start gap-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            onClick={closeMobileMenu}
          >
            <span className="font-heading text-lg font-semibold leading-none tracking-tight text-foreground">
              Safenet Staking
            </span>
            <span className="text-xs leading-none text-muted-foreground">{t("shell.byCoBuilders", "by CoBuilders")}</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={isDark ? t("header.lightMode", "Switch to light mode") : t("header.darkMode", "Switch to dark mode")}
          >
            {isDark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
          </Button>
          <div className="hidden xl:block">
            <ConnectButton />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? t("header.closeMenu", "Close menu") : t("header.openMenu", "Open menu")}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <nav className="container mx-auto hidden xl:flex items-stretch min-h-12 gap-1 px-4 -mb-px">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            aria-current={pathname === item.path ? "page" : undefined}
            className={cn(
              "flex items-center px-4 py-3 text-sm font-medium uppercase tracking-wider leading-5 transition-colors border-b-2",
              pathname === item.path
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {mobileMenuOpen && (
        <div className="border-t xl:hidden">
          <nav className="container mx-auto flex flex-col gap-1 px-4 py-3">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={closeMobileMenu}
                aria-current={pathname === item.path ? "page" : undefined}
                className={cn(
                  "px-6 py-2 text-sm font-medium uppercase tracking-wider leading-5 transition-colors border-b-2 -mb-[1px]",
                  pathname === item.path
                    ? "text-foreground border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-2">
              <ConnectButton />
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
