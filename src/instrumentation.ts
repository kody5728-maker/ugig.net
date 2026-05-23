export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCoinpayPaymentDaemon } = await import("@/lib/coinpay-payment-daemon");
    startCoinpayPaymentDaemon();
  }
}
