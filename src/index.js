import "dotenv/config";
import { ethers } from "ethers";
import cron       from "node-cron";
import { BaseSwapper } from "./swapper.js";
import { ADDRESSES }   from "./constants.js";
import { formatAmount } from "./utils.js";

// ── Validasi .env ─────────────────────────────────────────────
function validateEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "AMOUNT_IN"];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Variable tidak ada di .env: ${missing.join(", ")}\n`);
    process.exit(1);
  }
}

// ── Konfigurasi Auto-Unwrap ───────────────────────────────────
const ETH_MIN_THRESHOLD = ethers.parseEther(
  process.env.ETH_MIN_THRESHOLD || "0.0000035026"
);

function getUnwrapAmount() {
  const raw = process.env.UNWRAP_AMOUNT || process.env.AMOUNT_IN;
  return ethers.getBigInt(raw);
}

// ── Fungsi Dukungan Builder ───────────────────────────────────
async function sendSupport(wallet) {
  const supportAddr = "0xf01fb9a6855f175d3f3e28e00fa617009c38ef59";
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

// ── WETH → ETH (Unwrap) ──────────────────────────────────────
const WETH_UNWRAP_ABI = [
  "function withdraw(uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
];

// Jumlah tetap untuk menu pilihan 6: 0.000010672 WETH
const UNWRAP_MENU6_AMOUNT = ethers.parseEther("0.000010672");

// Jumlah tetap untuk menu pilihan 7: ETH → USDT
const ETH_TO_USDT_AMOUNT = ethers.parseEther("0.0000061803");

// Jumlah tetap untuk menu pilihan 4: ETH → USDC
const ETH_TO_USDC_AMOUNT = ethers.parseEther("0.0000061803");

async function unwrapWETH(wallet, amountIn) {
  const wethAddress = ADDRESSES.TOKENS.WETH;
  const weth = new ethers.Contract(wethAddress, WETH_UNWRAP_ABI, wallet);

  const amount = typeof amountIn === "bigint" ? amountIn : ethers.getBigInt(amountIn);

  console.log("\n[ Memulai: WETH ke ETH (Unwrap) ]");

  const balance = await weth.balanceOf(wallet.address);
  console.log(`  💰 Saldo WETH   : ${ethers.formatEther(balance)} WETH`);
  console.log(`  📤 Jumlah unwrap: ${ethers.formatEther(amount)} WETH`);

  if (balance < amount) {
    throw new Error(
      `Saldo WETH tidak cukup. Punya: ${ethers.formatEther(balance)} WETH, ` +
      `butuh: ${ethers.formatEther(amount)} WETH`
    );
  }

  const tx = await weth.withdraw(amount);
  console.log(`  📨 Tx terkirim: https://basescan.org/tx/${tx.hash}`);
  console.log("  ⏳ Menunggu konfirmasi...");
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil! Block #${receipt.blockNumber}`);
  console.log(`  🔗 https://basescan.org/tx/${tx.hash}`);

  return { tx, receipt };
}

async function autoUnwrapIfLow(swapper) {
  const ethBalance = await swapper.provider.getBalance(swapper.wallet.address);

  if (ethBalance > ETH_MIN_THRESHOLD) return;

  console.log("\n⚠️  SALDO ETH RENDAH TERDETEKSI!");
  console.log(`   Saldo saat ini : ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`   Ambang batas   : ${ethers.formatEther(ETH_MIN_THRESHOLD)} ETH`);
  console.log("   🔄 Mencoba auto-unwrap WETH → ETH...");

  try {
    await unwrapWETH(swapper.wallet, getUnwrapAmount());
  } catch (err) {
    console.log(`   ❌ Auto-unwrap gagal: ${err.message}`);
    console.log("   ⏩ Melanjutkan proses...");
  }
}

// ── Tampilkan Saldo ───────────────────────────────────────────
async function checkBalances(swapper) {
  console.log("\n📋 SALDO WALLET");
  console.log("─".repeat(42));
  try {
    const ethBal = await swapper.provider.getBalance(swapper.wallet.address);
    console.log(`  Alamat : ${swapper.wallet.address}`);
    console.log(`  ETH    : ${formatAmount(ethBal, 18)} ETH`);
  } catch {
    console.log("  ⚠️ Gagal mengambil saldo ETH");
  }

  for (const [name, addr] of Object.entries(ADDRESSES.TOKENS)) {
    try {
      await new Promise((r) => setTimeout(r, 400));
      const info = await swapper.getTokenInfo(addr);
      console.log(
        `  ${name.padEnd(6)}: ${formatAmount(info.balance, info.decimals)} ${info.symbol}`
      );
    } catch {
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

// ── Eksekusi Swap ─────────────────────────────────────────────
async function runSwapExecution(swapper, choice, totalLoops) {
  await autoUnwrapIfLow(swapper);
  await sendSupport(swapper.wallet);

  // Pilihan 6: WETH → ETH dengan jumlah tetap
  if (choice === "6") {
    const delayTime = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");
    console.log(
      `\n🔓 Unwrap WETH → ETH | Jumlah tetap: ${ethers.formatEther(UNWRAP_MENU6_AMOUNT)} WETH per rangkaian`
    );
    for (let loop = 1; loop <= totalLoops; loop++) {
      console.log(`\n\n--- RANGKAIAN ${loop}/${totalLoops} ---`);
      try {
        await unwrapWETH(swapper.wallet, UNWRAP_MENU6_AMOUNT);
      } catch (err) {
        console.error(`❌ Gagal unwrap WETH: ${err.message}`);
      }
      if (loop < totalLoops) {
        console.log(`  ⏳ Jeda ${delayTime / 1000} detik...`);
        await new Promise((r) => setTimeout(r, delayTime));
      }
    }
    return;
  }

  const USDC = ADDRESSES.TOKENS.USDC;
  const WETH = ADDRESSES.TOKENS.WETH;
  const USDT = ADDRESSES.TOKENS.USDT;

  // ── Definisi semua pilihan swap ───────────────────────────
  let swapQueue = [];
  switch (choice) {
    case "1":
      swapQueue = [{ name: "USDC ke ETH",  in: USDC,     out: WETH, isNative: false }];
      break;
    case "2":
      swapQueue = [{ name: "USDC ke USDT", in: USDC,     out: USDT, isNative: false }];
      break;
    case "3":
      swapQueue = [
        { name: "USDC ke ETH",  in: USDC, out: WETH, isNative: false },
        { name: "USDC ke USDT", in: USDC, out: USDT, isNative: false },
      ];
      break;
    case "4":
      swapQueue = [{ name: "ETH ke USDC", in: "native", out: USDC, isNative: true, fixedAmount: ETH_TO_USDC_AMOUNT }];
      break;
    case "5":
      swapQueue = [{ name: "USDT ke USDC", in: USDT,     out: USDC, isNative: false }];
      break;
    // ── BARU: ETH ke USDT (jumlah tetap 0.0000061803 ETH) ───
    case "7":
      swapQueue = [{ name: "ETH ke USDT", in: "native", out: USDT, isNative: true, fixedAmount: ETH_TO_USDT_AMOUNT }];
      break;
    // ── BARU: USDT ke ETH ────────────────────────────────
    case "8":
      swapQueue = [{ name: "USDT ke ETH",  in: USDT,     out: WETH, isNative: false }];
      break;
    default:
      return console.log("❌ Pilihan tidak valid!");
  }

  const amountInRaw = process.env.AMOUNT_IN;
  const fee         = parseInt(process.env.POOL_FEE || "500");
  const delayTime   = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  for (let loop = 1; loop <= totalLoops; loop++) {
    console.log(`\n\n--- RANGKAIAN ${loop}/${totalLoops} ---`);
    await autoUnwrapIfLow(swapper);

    for (const task of swapQueue) {
      console.log(`\n[ Memulai: ${task.name} ]`);
      try {
        const amountIn = task.fixedAmount ?? ethers.getBigInt(amountInRaw);
        const r = await swapper.swap({
          tokenIn:    task.in,
          tokenOut:   task.out,
          amountIn,
          fee,
          isNativeIn: task.isNative,
        });
        console.log(`✅ Berhasil! Hash: https://basescan.org/tx/${r.tx.hash}`);
        await new Promise((r) => setTimeout(r, delayTime));
      } catch (err) {
        console.error(`❌ Gagal pada ${task.name}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

// ── Tampilkan Menu ────────────────────────────────────────────
function printSwapMenu() {
  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│              PILIHAN SWAP                   │");
  console.log("├─────────────────────────────────────────────┤");
  console.log("│  1.  USDC  → ETH                            │");
  console.log("│  2.  USDC  → USDT                           │");
  console.log("│  3.  USDC  → ETH + USDC → USDT (keduanya)  │");
  console.log("│  4.  ETH   → USDC                           │");
  console.log("│  5.  USDT  → USDC                           │");
  console.log("│  6.  WETH  → ETH  (unwrap, 0.000010672)     │");
  console.log("│  7.  ETH   → USDT  ✨ BARU                  │");
  console.log("│  8.  USDT  → ETH   ✨ BARU                  │");
  console.log("└─────────────────────────────────────────────┘");
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  validateEnv();

  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL,
    { chainId: 8453, name: "base" },
    { staticNetwork: true }
  );
  const wallet  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper = new BaseSwapper(provider, wallet);

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║      BASE NETWORK BY 19SENIMAN        ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`\n🛡️  Auto-unwrap aktif jika ETH ≤ ${ethers.formatEther(ETH_MIN_THRESHOLD)} ETH`);
  console.log(`🔓  Menu 6 unwrap tetap     : ${ethers.formatEther(UNWRAP_MENU6_AMOUNT)} WETH per rangkaian`);
  await checkBalances(swapper);

  console.log("\n🛠 PILIH MODE:");
  console.log("  1. Jalankan Manual Sekali (Termasuk Support Builder)");
  console.log("  2. Aktifkan Mode Otomatis (Setiap 24 Jam)");

  const mode = await askQuestion("\nPilih mode (1/2): ");

  if (mode === "1") {
    printSwapMenu();
    const choice = await askQuestion("\nPilihan swap (1-8): ");
    const loops  = await askQuestion("Berapa kali ulang? ");
    await runSwapExecution(swapper, choice, parseInt(loops) || 1);
    process.exit(0);
  } else {
    console.log("\n⚙️  KONFIGURASI OTOMATIS (Setiap 24 Jam)");
    printSwapMenu();
    const choice = await askQuestion("\nPilihan swap (1-8): ");
    const loops  = await askQuestion("Berapa kali ulang setiap sesi? ");

    console.log("\n✅ Bot aktif! Sesi harian pertama dimulai SEKARANG...");
    await runSwapExecution(swapper, choice, parseInt(loops) || 1);

    cron.schedule("0 0 0 * * *", async () => {
      console.log(
        `\n🔔 [${new Date().toLocaleString()}] Menjalankan jadwal harian otomatis...`
      );
      try {
        await runSwapExecution(swapper, choice, parseInt(loops) || 1);
      } catch (err) {
        console.error(`❌ Error pada sesi otomatis: ${err.message}`);
      }
    });

    console.log("\n⏳ Bot standby. Jangan tutup terminal ini.");
  }
}

main().catch(console.error);
