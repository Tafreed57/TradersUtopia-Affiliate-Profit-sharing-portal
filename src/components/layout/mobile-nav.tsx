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
import { BrandLogo } from "@/components/layout/brand-logo";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/commissions", label: "Commissions", icon: BarChart3 },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/promo-codes", label: "Promo Codes", icon: Tag },
  { href: "/students", label: "Students", icon: Users, teacherOnly: true },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminItems = [
  { href: "/admin", label: "Admin Panel", icon: Shield, exact: true },
  { href: "/admin/proposals", label: "Proposals", icon: ClipboardList, exact: false },
  { href: "/admin/promo-codes", label: "Promo Codes", icon: Tag, exact: false },
];

export function MobileNav() {
  const pathname = usePathname();
  const isAdmin = useAdmin();
  const isTeacher = useIsTeacher();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-20 items-center border-b border-border/50 px-5">
        <BrandLogo priority />
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
            {adminItems.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
          </>
        )}
      </nav>
    </div>
  );
}
