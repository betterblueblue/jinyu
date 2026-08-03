import { redirect } from "next/navigation";
import { isAuthenticated } from "@/auth/session";

export default async function HomePage() {
  if (await isAuthenticated()) {
    redirect("/name");
  }
  redirect("/login");
}
