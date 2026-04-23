import "dotenv/config";
import { ethers }      from "ethers";
import { BaseSwapper } from "./swapper.js";
import { ADDRESSES }   from "./constants.js";
import { formatAmount, shortenAddress } from "./utils.js";

function validateEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "TOKEN_IN", "AMOUNT_IN"];
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
  console.log("║      BASE NETWORK MULTI-SWAP BOT       ║");
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

  // --- DEFINISI ANTREAN TRANSAKSI ---
  // Bot akan menjalankan tugas ini satu per satu
  const swapQueue = [
    { name: "SWAP USDC KE ETH",  out: ADDRESSES.TOKENS.WETH },
    { name: "SWAP USDC KE USDT", out: ADDRESSES.TOKENS.USDT }
  ];

  const tokenIn    = process.env.TOKEN_IN;
  const amountIn   = BigInt(process.env.AMOUNT_IN);
  const fee        = parseInt(process.env.POOL_FEE           || "500"); // Pakai 500 (0.05%) untuk USDC pair
  const slippage   = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const deadline   = parseInt(process.env.DEADLINE_MINUTES  || "20");
  const delayTime  = parseInt(process.env.DELAY_BETWEEN_SWAP || "10000");

  console.log(`\n🚀 RENCANA: Menjalankan ${swapQueue.length} Tugas Swap`);
  console.log(`⏳ Jeda   : ${delayTime / 1000} detik antar tugas`);

  if (process.env.AUTO_CONFIRM !== "true") {
    const ok = await promptConfirm("\n  ⚠️  Mulai jalankan antrean multi-swap? (y/n): ");
    if (!ok) { console.log("  ❌ Dibatalkan.\n"); process.exit(0); }
  }

  // --- LOGIKA UTAMA EKSEKUSI ANTREAN ---
  for (let i = 0; i < swapQueue.length; i++) {
    const task = swapQueue[i];
    console.log(`\n[ TUGAS ${i + 1}: ${task.name} ]`);
    
    try {
      const isNativeIn = ["native", "eth"].includes(tokenIn.toLowerCase());
      
      const r = await swapper.swap({ 
        tokenIn, 
        tokenOut: task.out, 
        amountIn, 
        fee, 
        slippage, 
        deadlineMin: deadline, 
        isNativeIn 
      });

      console.log(`\n✅ BERHASIL: ${task.name}`);
      console.log(`   Hash: https://basescan.org/tx/${r.tx.hash}`);

      // Jika masih ada antrean berikutnya, beri jeda
      if (i < swapQueue.length - 1) {
        console.log(`\n⏳ Menunggu ${delayTime / 1000} detik sebelum tugas berikutnya...`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    } catch (err) {
      console.error(`\n❌ Gagal pada ${task.name}: ${err.message}`);
      if (i < swapQueue.length - 1) {
        console.log("⏩ Lanjut ke tugas berikutnya dalam 3 detik...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  console.log("\n✨ SEMUA TUGAS ANTREAN SELESAI!");
  await checkBalances(swapper);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Critical Error: ${err.message}\n`);
  process.exit(1);
});
