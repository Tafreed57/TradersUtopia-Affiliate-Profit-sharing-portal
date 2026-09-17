"use client";

import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  compact?: boolean;
  href?: string;
  className?: string;
  priority?: boolean;
  work?: boolean;
}

export function BrandLogo({
  compact = false,
  href = "/",
  className,
  priority = false,
  work = false,
}: BrandLogoProps) {
  if (work) {
    return (
      <Link href={href === "/" ? "/attendance" : href} className={cn("inline-flex items-center gap-3", className)} aria-label="Traders Utopia Affiliate Work home">
        <Image src="/brand/logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg object-contain" priority={priority} />
        <span className="leading-tight"><span className="block text-xs font-semibold tracking-wide">TRADERS UTOPIA</span><span className="mt-1 block text-sm font-medium text-amber-300">Affiliate Work</span></span>
      </Link>
    );
  }
  const content = compact ? (
    <div
      className={cn(
        "relative h-10 w-10 overflow-hidden rounded-xl border border-border/50 bg-card/60 shadow-[0_10px_30px_rgba(0,0,0,0.18)]",
        className
      )}
    >
      <Image
        src="/brand/logo-icon.png"
        alt="TradersUtopia"
        fill
        priority={priority}
        sizes="40px"
        className="object-cover"
      />
    </div>
  ) : (
    <div
      className={cn(
        "relative h-12 w-[220px]",
        className
      )}
    >
      <Image
        src="/brand/logo-full.png"
        alt="TradersUtopia Commission Tracking"
        fill
        priority={priority}
        sizes="220px"
        className="object-contain object-left"
      />
    </div>
  );

  return (
    <Link
      href={href}
      className="inline-flex items-center"
      aria-label="TradersUtopia home"
    >
      {content}
    </Link>
  );
}
