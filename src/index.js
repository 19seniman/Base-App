import "dotenv/config";
import { ethers }      from "ethers";
import cron            from "node-cron"; // Modul baru
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

// Logika Utama Swap (Dipisah agar bisa dipanggil manual atau otomatis)
async function runSwapExecution(swapper, choice, totalLoops) {
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

async function main(isAuto = false) {
  validateEnv();
  
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });
  const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper = new BaseSwapper(provider, wallet);

  if (!isAuto) {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║      BASE NETWORK AUTO-CRON BOT        ║");
    console.log("╚════════════════════════════════════════╝");
    await checkBalances(swapper);

    console.log("\n🛠 PILIH MENU:");
    console.log("1. Jalankan Manual Sekali");
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
      const choice = await askQuestion("Pilihan swap (1-5): ");
      const loops = await askQuestion("Berapa kali ulang setiap sesi? ");
      
      console.log(`\n✅ Bot Aktif! Akan berjalan otomatis setiap 24 jam dengan pilihan menu ${choice}.`);
      console.log("Sesi pertama akan dimulai SEKARANG...");
      
      // Jalankan pertama kali
      await runSwapExecution(swapper, choice, parseInt(loops) || 1);

      // Jadwalkan untuk setiap 24 jam ke depan
      // Format: '0 0 */24 * * *' atau simpelnya gunakan jam tertentu, misal tiap tengah malam: '0 0 0 * * *'
      cron.schedule('0 0 0 * * *', async () => {
        console.log(`\n🔔 [${new Date().toLocaleString()}] Menjalankan jadwal harian otomatis...`);
        await runSwapExecution(swapper, choice, parseInt(loops) || 1);
      });
    }
  } else {
    // Dipanggil oleh cron
    await runSwapExecution(swapper, "3", 1); // Default jika dipanggil paksa
  }
}

main().catch(console.error);
