import { NextRequest, NextResponse } from "next/server";
import { syncPendingCoinpayPayments } from "@/lib/coinpay-payment-sync";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function getCronSecret(request: NextRequest): string | null {
  return (
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace("Bearer ", "") ||
    null
  );
}

/**
 * POST /api/cron/coinpay-payment-sync
 *
 * Server-side payment confirmation fallback. Webhooks still handle the happy
 * path, but this polls CoinPayPortal for pending ugig CoinPay payments so
 * bounty payouts and gig invoices settle even if the user leaves the page or a
 * webhook is missed.
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = getCronSecret(request);
    if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    const supabase = createServiceClient();
    const result = await syncPendingCoinpayPayments(supabase, { limit });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[coinpay-payment-sync] failed:", err);
    return NextResponse.json({ error: "Payment sync failed" }, { status: 500 });
  }
}
