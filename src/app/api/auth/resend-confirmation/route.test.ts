import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true }),
  rateLimitExceeded: () => new Response("Rate limited", { status: 429 }),
  getRateLimitIdentifier: () => "test",
}));

const mockGenerateLink = vi.fn();
const mockListUsers = vi.fn();
const mockSendEmail = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        generateLink: mockGenerateLink,
        listUsers: mockListUsers,
      },
    },
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  signupConfirmationEmail: ({ confirmUrl }: { confirmUrl: string }) => ({
    subject: "Confirm your ugig.net account",
    html: confirmUrl,
    text: confirmUrl,
  }),
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/resend-confirmation", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeRawRequest(body: string) {
  return new NextRequest("http://localhost/api/auth/resend-confirmation", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/auth/resend-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateLink.mockResolvedValue({
      data: {
        properties: { hashed_token: "resend-token" },
        user: { user_metadata: { username: "testuser" } },
      },
      error: null,
    });
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            email: "test@example.com",
            email_confirmed_at: null,
            user_metadata: { username: "testuser" },
          },
        ],
      },
      error: null,
    });
    mockSendEmail.mockResolvedValue({ success: true });
  });

  it("should return success message on valid email", async () => {
    const res = await POST(makeRequest({ email: "test@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("confirmation link has been sent");
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink", email: "test@example.com" })
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@example.com",
        html: "https://ugig.net/auth/confirm?token_hash=resend-token&type=magiclink&next=%2Fdashboard",
      })
    );
  });

  it("should return same message even on error (no email leak)", async () => {
    mockGenerateLink.mockResolvedValue({ data: {}, error: { message: "User not found" } });

    const res = await POST(makeRequest({ email: "nonexistent@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("confirmation link has been sent");
  });

  it("does not create or send when the email does not exist", async () => {
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });

    const res = await POST(makeRequest({ email: "nonexistent@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("confirmation link has been sent");
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid email", async () => {
    const res = await POST(makeRequest({ email: "not-valid" }));
    expect(res.status).toBe(400);
  });

  it("should return 400 for malformed JSON without resending", async () => {
    const res = await POST(makeRawRequest("{"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });
});
