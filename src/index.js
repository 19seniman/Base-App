import "dotenv/config";
import { ethers }      from "ethers";
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

async function main() {
  validateEnv();

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║      BASE NETWORK ADVANCED BOT v1.2    ║");
  console.log("╚════════════════════════════════════════╝");

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, { chainId: 8453, name: 'base' }, { staticNetwork: true });
  const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper = new BaseSwapper(provider, wallet);

  await checkBalances(swapper);

  if (process.argv[2] === "check") process.exit(0);

  // --- MENU PILIHAN TOKEN ---
  console.log("\n🛠 PILIH TARGET SWAP:");
  console.log("1. USDC -> ETH");
  console.log("2. USDC -> USDT");
  console.log("3. Keduanya (USDC -> ETH & USDT)");
  console.log("4. ETH -> USDC");
  console.log("5. USDT -> USDC");
  
  const choice = await askQuestion("\nMasukkan pilihan (1-5): ");
  
  let swapQueue = [];
  const USDC = ADDRESSES.TOKENS.USDC;
  const WETH = ADDRESSES.TOKENS.WETH;
  const USDT = ADDRESSES.TOKENS.USDT;

  switch (choice) {
    case "1":
      swapQueue = [{ name: "USDC ke ETH", in: USDC, out: WETH, isNative: false }];
      break;
    case "2":
      swapQueue = [{ name: "USDC ke USDT", in: USDC, out: USDT, isNative: false }];
      break;
    case "3":
      swapQueue = [
        { name: "USDC ke ETH", in: USDC, out: WETH, isNative: false },
        { name: "USDC ke USDT", in: USDC, out: USDT, isNative: false }
      ];
      break;
    case "4":
      swapQueue = [{ name: "ETH ke USDC", in: "native", out: USDC, isNative: true }];
      break;
    case "5":
      swapQueue = [{ name: "USDT ke USDC", in: USDT, out: USDC, isNative: false }];
      break;
    default:
      console.log("❌ Pilihan tidak valid!");
      process.exit(1);
  }

  // --- PERTANYAAN JUMLAH ITERASI ---
  const inputLoops = await askQuestion("❓ Berapa kali rangkaian ini ingin diulang? ");
  const totalLoops = parseInt(inputLoops) || 1;

  const amountInRaw = process.env.AMOUNT_IN;
  const fee         = parseInt(process.env.POOL_FEE || "500");
  const delayTime   = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  console.log(`\n🚀 RENCANA: Mengulang ${totalLoops}x rangkaian.`);
  const confirm = await askQuestion("⚠️ Konfirmasi jalankan? (y/n): ");
  if (confirm.toLowerCase() !== "y") process.exit(0);

  // --- LOOPING EKSEKUSI ---
  for (let loop = 1; loop <= totalLoops; loop++) {
    console.log(`\n\n--- RANGKAIAN ${loop}/${totalLoops} ---`);

    for (const task of swapQueue) {
      console.log(`\n[ Memulai: ${task.name} ]`);
      try {
        // Konversi amountIn berdasarkan desimal token asal
        const infoTokenIn = await swapper.getTokenInfo(task.in);
        const amountIn = ethers.parseUnits(amountInRaw, 0); // Mengambil mentah dari .env (BigInt)

        const r = await swapper.swap({ 
          tokenIn: task.in, 
          tokenOut: task.out, 
          amountIn: amountIn, 
          fee, 
          isNativeIn: task.isNative 
        });

        console.log(`✅ Berhasil! Hash: https://basescan.org/tx/${r.tx.hash}`);
        
        if (totalLoops > 1 || swapQueue.length > 1) {
          console.log(`⏳ Tunggu ${delayTime / 1000} detik...`);
          await new Promise(resolve => setTimeout(resolve, delayTime));
        }
      } catch (err) {
        console.error(`❌ Gagal pada ${task.name}: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  console.log("\n✨ SEMUA SELESAI!");
  await checkBalances(swapper);
  process.exit(0);
}

main().catch(console.error);
