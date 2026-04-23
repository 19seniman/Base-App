import "dotenv/config";
import { ethers }      from "ethers";
import { BaseSwapper } from "./swapper.js";
import { ADDRESSES }   from "./constants.js";
import { formatAmount, shortenAddress } from "./utils.js";

function validateEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "TOKEN_IN", "TOKEN_OUT", "AMOUNT_IN"];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Variable tidak ada di .env: ${missing.join(", ")}\n`);
    process.exit(1);
  }
}

async function checkBalances(swapper) {
  console.log("\n📋 SALDO WALLET");
  console.log("─".repeat(42));
  
  try {
    const ethBal = await swapper.provider.getBalance(swapper.wallet.address);
    console.log(`  Alamat : ${swapper.wallet.address}`);
    console.log(`  ETH    : ${formatAmount(ethBal, 18)} ETH`);
  } catch (e) {
    console.log("  ⚠️ Gagal mengambil saldo ETH (RPC Down)");
  }

  for (const [name, addr] of Object.entries(ADDRESSES.TOKENS)) {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const info = await swapper.getTokenInfo(addr);
      console.log(`  ${name.padEnd(6)}: ${formatAmount(info.balance, info.decimals)} ${info.symbol}`);
    } catch (err) {
      console.log(`  ${name.padEnd(6)}: - (Timeout/Busy)`);
    }
  }
  console.log("─".repeat(42));
}

function promptConfirm(msg) {
  return new Promise((resolve) => {
    process.stdout.write(msg);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => resolve(d.trim().toLowerCase() === "y"));
  });
}

async function main() {
  validateEnv();

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║      BASE NETWORK SWAP BOT  v1.1      ║");
  console.log("╚════════════════════════════════════════╝");

  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL, 
    { chainId: 8453, name: 'base' },
    { staticNetwork: true }
  );

  const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper = new BaseSwapper(provider, wallet);

  console.log(`\n🔗 RPC    : ${process.env.RPC_URL}`);
  console.log(`👛 Wallet : ${shortenAddress(wallet.address)}`);

  try {
    const net = await provider.getNetwork();
    console.log(`✅ Network: chain ID ${net.chainId}`);
  } catch {
    console.error("❌ Gagal konek RPC. Cek RPC_URL di .env");
    process.exit(1);
  }

  await checkBalances(swapper);

  if (process.argv[2] === "check") process.exit(0);

  // --- KONFIGURASI LOOPING ---
  const iterations = parseInt(process.env.TOTAL_ITERATIONS || "1");
  const delayTime  = parseInt(process.env.DELAY_BETWEEN_SWAP || "5000");

  const tokenIn    = process.env.TOKEN_IN;
  const tokenOut   = process.env.TOKEN_OUT;
  const amountIn   = BigInt(process.env.AMOUNT_IN);
  const fee        = parseInt(process.env.POOL_FEE           || "3000");
  const slippage   = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const deadline   = parseInt(process.env.DEADLINE_MINUTES  || "20");
  const isNativeIn = ["native", "eth"].includes(tokenIn.toLowerCase());

  console.log(`\n🚀 RENCANA: ${iterations}x Transaksi`);
  console.log(`⏳ Jeda   : ${delayTime / 1000} detik antar swap`);

  if (process.env.AUTO_CONFIRM !== "true") {
    const ok = await promptConfirm("\n  ⚠️  Mulai jalankan antrean swap? (y/n): ");
    if (!ok) { console.log("  ❌ Dibatalkan.\n"); process.exit(0); }
  }

  // --- LOGIKA UTAMA PERULANGAN ---
  for (let i = 1; i <= iterations; i++) {
    console.log(`\n[ TRANSAKSI KE-${i} DARI ${iterations} ]`);
    
    try {
      const r = await swapper.swap({ 
        tokenIn, tokenOut, amountIn, fee, slippage, 
        deadlineMin: deadline, isNativeIn 
      });

      console.log(`\n✅ BERHASIL KE-${i}`);
      console.log(`   Hash: ${r.tx.hash}`);

      if (i < iterations) {
        console.log(`\n⏳ Menunggu ${delayTime / 1000} detik sebelum transaksi berikutnya...`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    } catch (err) {
      console.error(`\n❌ Gagal pada transaksi ke-${i}: ${err.message}`);
      if (i < iterations) {
        console.log("⏩ Melanjutkan ke transaksi berikutnya dalam 3 detik...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  console.log("\n✨ SEMUA TUGAS SELESAI!");
  await checkBalances(swapper);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Critical Error: ${err.message}\n`);
  process.exit(1);
});
