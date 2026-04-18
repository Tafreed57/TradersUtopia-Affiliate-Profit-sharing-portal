"use client";

import {
  BarChart3,
  Bell,
  CalendarCheck,
  ClipboardList,
  Home,
  Settings,
  Shield,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { useIsTeacher } from "@/hooks/use-teacher";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/commissions", label: "Commissions", icon: BarChart3 },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/promo-codes", label: "Promo Codes", icon: Tag },
  { href: "/students", label: "Students", icon: Users, teacherOnly: true },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const isAdmin = useAdmin();
  const isTeacher = useIsTeacher();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-16 items-center gap-2 border-b border-border/50 px-6">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-sm font-bold text-primary-foreground">TU</span>
        </div>
        <span className="font-semibold text-sidebar-foreground">
          TradersUtopia
        </span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          if (item.teacherOnly && !isTeacher && !isAdmin) return null;
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="my-4 border-t border-border/50" />
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                pathname === "/admin"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Shield className="h-4 w-4" />
              Admin Panel
            </Link>
            <Link
              href="/admin/proposals"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                pathname.startsWith("/admin/proposals")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <ClipboardList className="h-4 w-4" />
              Proposals
            </Link>
            <Link
              href="/admin/promo-codes"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                pathname.startsWith("/admin/promo-codes")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Tag className="h-4 w-4" />
              Promo Codes
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
