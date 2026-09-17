import { WorkAuthForm } from "@/components/auth/work-auth-form";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { portalHome } from "@/lib/account-access";

export default async function WorkRegisterPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) redirect(portalHome(session.user));
  return <WorkAuthForm register />;
}
