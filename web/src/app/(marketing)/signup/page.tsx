import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Sign up — create a free vault",
  description:
    "Create a free Nodum vault. Open-source markdown notes with [[wikilinks]], automatic backlinks and a knowledge graph. No card, import an Obsidian vault.",
  path: "/signup",
  keywords: ["free note taking app", "obsidian alternative", "open source notes", "sign up"],
});

export default function SignupPage() {
  return (
    <AuthShell>
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
