"use client";

import { ArrowRight, CalendarCheck, Loader2, Tag } from "lucide-react";
import { signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkAuthForm({ register = false }: { register?: boolean }) {
  return <Suspense><WorkForm register={register} /></Suspense>;
}

function WorkForm({ register }: { register: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authError = searchParams.has("error")
    ? "Sign-in could not be completed. Please try again."
    : null;

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signIn("google", {
        onboardingType: "WORK",
        callbackUrl: "/auth/complete",
      });
    } catch {
      setError("Google sign-in is unavailable right now. Please try again.");
      setBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (register && password !== form.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (register) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.get("name"), email, password, accountType: "WORK" }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Your account could not be created. Please try again.");
        }
      }
      const result = await signIn("credentials", {
        email, password, redirect: false, callbackUrl: "/auth/complete",
      });
      if (!result || result.error) {
        setError(register
          ? "Your account was created. Please sign in to continue."
          : "The email or password is incorrect.");
        return;
      }
      router.push("/auth/complete");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="work-theme relative flex min-h-screen flex-col overflow-hidden bg-[#11100e] text-[#f5f1e9]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_8%_70%,rgba(244,173,62,0.07),transparent_55%)]" />
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between border-b border-white/10 px-6 py-6 sm:px-10">
        <Link href="/work" className="flex items-center gap-3" aria-label="Traders Utopia Affiliate Work home">
          <Image src="/brand/logo-icon.png" alt="" width={38} height={38} className="h-[38px] w-[38px] shrink-0 rounded-lg object-contain" priority />
          <span className="text-sm font-semibold tracking-[0.12em]">TRADERS UTOPIA</span>
        </Link>
        <span className="border border-amber-300/30 px-3 py-1.5 font-mono text-xs tracking-[0.2em] text-amber-300">WORK</span>
      </header>

      <div className="relative mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        <section className="max-w-xl">
          <p className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.22em] text-amber-300"><span className="h-px w-8 bg-amber-300" />Your everyday workspace</p>
          <h1 className="font-[Georgia,serif] text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Traders Utopia<br /><span className="text-[#a9a397]">Affiliate</span> <span className="text-amber-300">Work</span>
          </h1>
          <p className="mt-7 max-w-md text-base leading-relaxed text-[#bdb5a7] sm:text-lg">Show up. Go live. Make it yours.<br />Your attendance and promo codes, together in one place.</p>
          <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
            <div className="flex items-center gap-4 py-5"><CalendarCheck className="h-5 w-5 shrink-0 text-amber-300" /><div><h2 className="text-sm font-medium">Mark your attendance</h2><p className="mt-1 text-sm text-[#a9a397]">Keep a record of the days you go live.</p></div><span className="ml-auto font-mono text-xs text-[#6f695e]">01</span></div>
            <div className="flex items-center gap-4 py-5"><Tag className="h-5 w-5 shrink-0 text-amber-300" /><div><h2 className="text-sm font-medium">Create your promo code</h2><p className="mt-1 text-sm text-[#a9a397]">Choose your code and share it with your audience.</p></div><span className="ml-auto font-mono text-xs text-[#6f695e]">02</span></div>
          </div>
        </section>

        <section aria-labelledby="work-form-title" className="w-full rounded-2xl border border-white/10 bg-[#1b1915] p-6 shadow-2xl shadow-black/20 sm:p-9">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-300">Affiliate Work</p>
          <h2 id="work-form-title" className="mt-3 text-2xl font-semibold tracking-tight">{register ? "Create your account" : "Welcome to your workspace"}</h2>
          <p className="mt-2 text-sm text-[#a9a397]">{register ? "Get ready for your next live session." : "Sign in to get ready for your next live session."}</p>
          <Button type="button" variant="outline" className="mt-7 h-11 w-full border-white/15 bg-white/[0.03] hover:bg-white/[0.07]" onClick={handleGoogle} disabled={busy}>
            <svg aria-hidden="true" className="mr-2 h-4 w-4" viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4ZM12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22ZM6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3A10 10 0 0 0 2 12c0 1.6.4 3.2 1 4.5l3.4-2.6ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 6Z" /></svg>
            Continue with Google
          </Button>
          <div className="my-6 flex items-center gap-4 text-xs text-[#948d80]"><span className="h-px flex-1 bg-white/10" />or use your email<span className="h-px flex-1 bg-white/10" /></div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {register && <div className="space-y-2"><Label htmlFor="work-name">Full name</Label><Input id="work-name" name="name" autoComplete="name" required maxLength={100} className="h-11 border-white/15 bg-black/10" /></div>}
            <div className="space-y-2"><Label htmlFor="work-email">Email</Label><Input id="work-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required className="h-11 border-white/15 bg-black/10" /></div>
            <div className="space-y-2"><Label htmlFor="work-password">Password</Label><Input id="work-password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} maxLength={100} className="h-11 border-white/15 bg-black/10" />{register && <p className="text-xs text-[#a9a397]">Use at least 8 characters.</p>}</div>
            {register && <div className="space-y-2"><Label htmlFor="work-confirm">Confirm password</Label><Input id="work-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={100} className="h-11 border-white/15 bg-black/10" /></div>}
            {(error || authError) && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error ?? authError}</p>}
            <Button type="submit" disabled={busy} className="mt-2 h-11 w-full bg-amber-300 font-semibold text-[#17120a] hover:bg-amber-200">{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Please wait...</> : <>{register ? "Create account" : "Sign in"}<ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-[#a9a397]">{register ? "Already have an account?" : "New to Affiliate Work?"}{" "}<Link href={register ? "/work" : "/work/register"} className="font-medium text-amber-300 underline-offset-4 hover:underline">{register ? "Sign in" : "Create an account"}</Link></p>
        </section>
      </div>
      <footer className="relative mx-auto flex w-full max-w-7xl justify-between border-t border-white/10 px-6 py-5 text-[11px] text-[#948d80] sm:px-10"><span>TRADERS UTOPIA</span><span>Affiliate Work</span></footer>
    </main>
  );
}
