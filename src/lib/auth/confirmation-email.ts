import type { User } from "@supabase/supabase-js";
import type { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, signupConfirmationEmail } from "@/lib/email";

type ServiceClient = ReturnType<typeof createServiceClient>;

export function isAlreadyRegisteredAuthError(error: unknown): boolean {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return /already.*registered|email.*registered/i.test(message);
}

export async function findAuthUserByEmail(
  supabase: ServiceClient,
  email: string
): Promise<User | null> {
  const target = email.toLowerCase();
  let page = 1;

  while (page <= 100) {
    const {
      data: { users },
      error,
    } = await supabase.auth.admin.listUsers({ page, perPage: 100 });

    if (error) {
      console.error("Confirmation email user lookup error:", error.message);
      return null;
    }

    const match = users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) return null;
    page += 1;
  }

  return null;
}

function userConfirmationName(user: User): string {
  const metadata = user.user_metadata || {};
  if (typeof metadata.agent_name === "string" && metadata.agent_name) return metadata.agent_name;
  if (typeof metadata.username === "string" && metadata.username) return metadata.username;
  if (typeof metadata.full_name === "string" && metadata.full_name) return metadata.full_name;
  return "there";
}

export async function sendGeneratedSignupConfirmationEmail({
  email,
  name,
  appUrl,
  tokenHash,
  type,
  next,
}: {
  email: string;
  name: string;
  appUrl: string;
  tokenHash: string;
  type: "signup" | "magiclink";
  next?: string;
}) {
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
  const confirmUrl = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}${nextParam}`;
  const confirmation = signupConfirmationEmail({ name, confirmUrl });

  return sendEmail({
    to: email,
    subject: confirmation.subject,
    html: confirmation.html,
    text: confirmation.text,
  });
}

export async function resendExistingUserConfirmationEmail({
  supabase,
  email,
  appUrl,
}: {
  supabase: ServiceClient;
  email: string;
  appUrl: string;
}): Promise<{ sent: boolean; skipped?: boolean; error?: unknown }> {
  const existingUser = await findAuthUserByEmail(supabase, email);
  if (!existingUser || existingUser.email_confirmed_at) {
    return { sent: false, skipped: true };
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${appUrl}/auth/confirm`,
    },
  });

  if (error) {
    console.error("Resend confirmation error:", error.message);
    return { sent: false, error };
  }

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    return { sent: false, error: new Error("Missing confirmation token") };
  }

  const result = await sendGeneratedSignupConfirmationEmail({
    email,
    name: userConfirmationName(existingUser),
    appUrl,
    tokenHash,
    type: "magiclink",
    next: "/dashboard",
  });

  if (!result.success || "skipped" in result) {
    console.error("Confirmation email delivery failed:", result);
    return { sent: false, error: result };
  }

  return { sent: true };
}
