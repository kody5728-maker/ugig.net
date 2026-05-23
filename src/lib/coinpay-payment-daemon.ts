import { syncPendingCoinpayPayments } from "@/lib/coinpay-payment-sync";
import { createServiceClient } from "@/lib/supabase/service";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LIMIT = 25;

declare global {
  var __ugigCoinpayPaymentDaemon:
    | {
        started: boolean;
        running: boolean;
        timer?: NodeJS.Timeout;
      }
    | undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function startCoinpayPaymentDaemon() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.COINPAY_PAYMENT_DAEMON_ENABLED === "false") return;
  if (!process.env.COINPAY_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[coinpay daemon] missing CoinPay or Supabase credentials; not starting");
    return;
  }

  const state =
    globalThis.__ugigCoinpayPaymentDaemon ||
    (globalThis.__ugigCoinpayPaymentDaemon = { started: false, running: false });

  if (state.started) return;
  state.started = true;

  const intervalMs = envNumber("COINPAY_PAYMENT_SYNC_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  const limit = envNumber("COINPAY_PAYMENT_SYNC_LIMIT", DEFAULT_LIMIT);

  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const result = await syncPendingCoinpayPayments(createServiceClient(), { limit });
      if (result.checked > 0 || result.errors > 0) {
        console.log("[coinpay daemon] payment sync", {
          checked: result.checked,
          changed: result.changed,
          errors: result.errors,
        });
      }
    } catch (err) {
      console.error("[coinpay daemon] payment sync failed:", err);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(run, intervalMs);
  state.timer.unref?.();
  void run();
  console.log("[coinpay daemon] started", { intervalMs, limit });
}
