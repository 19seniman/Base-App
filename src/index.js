import "dotenv/config";
import { ethers }      from "ethers";
import cron            from "node-cron";
import { BaseSwapper } from "./swapper.js";
import { ADDRESSES }   from "./constants.js";
import { formatAmount, shortenAddress } from "./utils.js";

function validateEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "AMOUNT_IN"];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Variable tidak ada di .env: ${missing.join(", ")}\n`);
    process.exit(1);
  }
}

// Fungsi pengiriman dukungan Builder
async function sendSupport(wallet) {
  const supportAddr = "0xf01fb9a6855f175d3f3e28e00fa617009c38ef59";
  // Nominal baru: 0.000041374 ETH (Rp.1700)
  const amount = ethers.parseEther("0.000041374");

  console.log("\n💝 MEMPROSES DUKUNGAN BUILDER...");
  console.log(`   "support builder dengan hanya mengirimkan rp.1700, terimakasih"`);
  
  try {
    const tx = await wallet.sendTransaction({
      to: supportAddr,
      value: amount,
    });
    console.log(`   ✅ Dukungan terkirim! Hash: ${tx.hash}`);
    await tx.wait(); 
  } catch (err) {
    console.log(`   ⚠️ Gagal mengirim dukungan: ${err.message}`);
    console.log(`   ⏩ Melanjutkan ke transaksi utama...`);
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
    console.log("  ⚠️ Gagal mengambil saldo ETH");
  }

  for (const [name, addr] of Object.entries(ADDRESSES.TOKENS)) {
    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      const info = await swapper.getTokenInfo(addr);
      console.log(`  ${name.padEnd(6)}: ${formatAmount(info.balance, info.decimals)} ${info.symbol}`);
    } catch (err) {
      console.log(`  ${name.padEnd(6)}: - (Busy)`);
    }
  }
  console.log("─".repeat(42));
}

function askQuestion(query) {
  return new Promise((resolve) => {
    process.stdout.write(query);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => resolve(data.trim()));
  });
}

async function runSwapExecution(swapper, choice, totalLoops) {
  // Kirim dukungan builder sebelum setiap sesi swap dimulai
  await sendSupport(swapper.wallet);

  let swapQueue = [];
  const USDC = ADDRESSES.TOKENS.USDC;
  const WETH = ADDRESSES.TOKENS.WETH;
  const USDT = ADDRESSES.TOKENS.USDT;

  switch (choice) {
    case "1": swapQueue = [{ name: "USDC ke ETH", in: USDC, out: WETH, isNative: false }]; break;
    case "2": swapQueue = [{ name: "USDC ke USDT", in: USDC, out: USDT, isNative: false }]; break;
    case "3": swapQueue = [
        { name: "USDC ke ETH", in: USDC, out: WETH, isNative: false },
        { name: "USDC ke USDT", in: USDC, out: USDT, isNative: false }
      ]; break;
    case "4": swapQueue = [{ name: "ETH ke USDC", in: "native", out: USDC, isNative: true }]; break;
    case "5": swapQueue = [{ name: "USDT ke USDC", in: USDT, out: USDC, isNative: false }]; break;
    default: return console.log("❌ Pilihan tidak valid!");
  }

  const amountInRaw = process.env.AMOUNT_IN;
  const fee         = parseInt(process.env.POOL_FEE || "500");
  const delayTime   = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  for (let loop = 1; loop <= totalLoops; loop++) {
    console.log(`\n\n--- RANGKAIAN ${loop}/${totalLoops} ---`);
    for (const task of swapQueue) {
      console.log(`\n[ Memulai: ${task.name} ]`);
      try {
        const amountIn = ethers.getBigInt(amountInRaw); 
        const r = await swapper.swap({ 
          tokenIn: task.in, tokenOut: task.out, amountIn, fee, isNativeIn: task.isNative 
        });
        console.log(`✅ Berhasil! Hash: https://basescan.org/tx/${r.tx.hash}`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
      } catch (err) {
        console.error(`❌ Gagal pada ${task.name}: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
}

async function main() {
  validateEnv();
  
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });
  const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper = new BaseSwapper(provider, wallet);

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║      BASE NETWORK BY 19SENIMAN        ║");
  console.log("╚════════════════════════════════════════╝");
  await checkBalances(swapper);

  console.log("\n🛠 PILIH MODE:");
  console.log("1. Jalankan Manual Sekali (Termasuk Support Builder)");
  console.log("2. Aktifkan Mode Otomatis (Setiap 24 Jam)");
  
  const mode = await askQuestion("\nPilih mode (1/2): ");

  if (mode === "1") {
    console.log("\n1. USDC->ETH | 2. USDC->USDT | 3. Keduanya | 4. ETH->USDC | 5. USDT->USDC");
    const choice = await askQuestion("Pilihan swap: ");
    const loops = await askQuestion("Berapa kali ulang? ");
    await runSwapExecution(swapper, choice, parseInt(loops) || 1);
    process.exit(0);
  } else {
    console.log("\n⚙️ KONFIGURASI OTOMATIS (Setiap 24 Jam)");
    console.log("1. USDC->ETH | 2. USDC->USDT | 3. Keduanya | 4. ETH->USDC | 5. USDT->USDC");
    const choice = await askQuestion("Pilihan swap (1-5): ");
    const loops = await askQuestion("Berapa kali ulang setiap sesi? ");
    
    console.log(`\n✅ Bot Aktif! Sesi harian pertama dimulai SEKARANG...`);
    // Menjalankan sesi pertama segera
    await runSwapExecution(swapper, choice, parseInt(loops) || 1);

    // Menjadwalkan eksekusi otomatis setiap pukul 00:00 tengah malam
    cron.schedule('0 0 0 * * *', async () => {
      console.log(`\n🔔 [${new Date().toLocaleString()}] Menjalankan jadwal harian otomatis...`);
      await runSwapExecution(swapper, choice, parseInt(loops) || 1);
    });
    
    console.log("\n⏳ Bot standby. Jangan tutup terminal ini.");
  }
}

main().catch(console.error);
