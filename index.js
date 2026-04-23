// ============================================================
//  INDEX.JS — Entry point Bot Swap Base Network
// ============================================================
import "dotenv/config";
import { ethers }       from "ethers";
import { BaseSwapper }  from "./swapper.js";
import { ADDRESSES }    from "./constants.js";
import { formatAmount, shortenAddress } from "./utils.js";

// ── Validasi environment variables ──────────────────────────
function validateEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "TOKEN_IN", "TOKEN_OUT", "AMOUNT_IN"];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ Environment variable tidak ditemukan: ${missing.join(", ")}`);
    console.error("   Salin .env.example menjadi .env lalu isi nilainya.\n");
    process.exit(1);
  }
}

// ── Tampilan header ─────────────────────────────────────────
function printHeader() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║        BASE NETWORK SWAP BOT  v1.0      ║");
  console.log("║   Powered by Uniswap V3 · ethers.js v6  ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

// ── Cek saldo wallet ─────────────────────────────────────────
async function checkBalances(swapper) {
  console.log("📋 CEK SALDO WALLET");
  console.log("─".repeat(44));

  const ethBalance = await swapper.provider.getBalance(swapper.wallet.address);
  console.log(`  Alamat  : ${swapper.wallet.address}`);
  console.log(`  ETH     : ${formatAmount(ethBalance, 18, 6)} ETH`);

  // Tampilkan saldo token populer
  const tokens = [
    { label: "WETH ", address: ADDRESSES.TOKENS.WETH  },
    { label: "USDC ", address: ADDRESSES.TOKENS.USDC  },
    { label: "USDT ", address: ADDRESSES.TOKENS.USDT  },
  ];

  for (const t of tokens) {
    try {
      const info = await swapper.getTokenInfo(t.address);
      console.log(`  ${t.label}   : ${formatAmount(info.balance, info.decimals, 4)} ${info.symbol}`);
    } catch {
      console.log(`  ${t.label}   : (tidak dapat diambil)`);
    }
  }
  console.log("─".repeat(44) + "\n");
}

// ── Eksekusi swap ─────────────────────────────────────────────
async function runSwap(swapper) {
  const tokenIn   = process.env.TOKEN_IN;
  const tokenOut  = process.env.TOKEN_OUT;
  const amountIn  = BigInt(process.env.AMOUNT_IN);
  const fee       = parseInt(process.env.POOL_FEE       || "3000");
  const slippage  = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const deadline  = parseInt(process.env.DEADLINE_MINUTES  || "20");

  // Deteksi apakah input adalah ETH native
  const isNativeIn = tokenIn.toLowerCase() === "native" ||
                     tokenIn.toLowerCase() === "eth";
  const effectiveIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;

  // Ambil info token
  let infoIn, infoOut;
  try {
    infoIn  = await swapper.getTokenInfo(isNativeIn ? "native" : tokenIn);
    infoOut = await swapper.getTokenInfo(tokenOut);
  } catch (err) {
    throw new Error(`Gagal mengambil info token: ${err.message}`);
  }

  console.log("🔄 DETAIL SWAP");
  console.log("─".repeat(44));
  console.log(`  Dari    : ${formatAmount(amountIn, infoIn.decimals)} ${infoIn.symbol}`);
  console.log(`  Ke      : ${infoOut.symbol}`);
  console.log(`  Fee     : ${fee / 10000}%`);
  console.log(`  Slippage: ${slippage}%`);
  console.log(`  Deadline: ${deadline} menit`);
  console.log("─".repeat(44));

  // Konfirmasi sebelum swap (opsional, nonaktifkan jika mau auto)
  if (process.env.AUTO_CONFIRM !== "true") {
    const confirmed = await promptConfirm("  ⚠️  Lanjutkan swap? (y/n): ");
    if (!confirmed) {
      console.log("\n  ❌ Swap dibatalkan.\n");
      return;
    }
  }

  // Eksekusi
  const result = await swapper.swap({
    tokenIn:     effectiveIn,
    tokenOut,
    amountIn,
    fee,
    slippage,
    deadlineMin: deadline,
    isNativeIn,
  });

  // Ringkasan hasil
  console.log("\n✅ SWAP BERHASIL!");
  console.log("─".repeat(44));
  console.log(`  Block   : #${result.receipt.blockNumber}`);
  console.log(`  Gas used: ${result.receipt.gasUsed.toString()}`);
  console.log(`  Output  : ${formatAmount(result.amountOut, result.infoOut.decimals)} ${result.infoOut.symbol}`);
  console.log(`  Tx Hash : ${result.tx.hash}`);
  console.log(`  BaseScan: https://basescan.org/tx/${result.tx.hash}`);
  console.log("─".repeat(44) + "\n");
}

// ── Prompt konfirmasi sederhana ──────────────────────────────
function promptConfirm(message) {
  return new Promise((resolve) => {
    process.stdout.write(message);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      resolve(data.trim().toLowerCase() === "y");
    });
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  validateEnv();
  printHeader();

  // Setup provider & wallet
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper  = new BaseSwapper(provider, wallet);

  console.log(`🔗 Terhubung ke: ${process.env.RPC_URL}`);
  console.log(`👛 Wallet      : ${shortenAddress(wallet.address)}\n`);

  // Cek koneksi jaringan
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 8453n) {
      console.warn(`⚠️  Peringatan: Chain ID ${network.chainId} bukan Base Mainnet (8453)`);
    } else {
      console.log(`✅ Terhubung ke Base Mainnet (chain ID: ${network.chainId})\n`);
    }
  } catch {
    console.error("❌ Gagal terhubung ke RPC. Cek RPC_URL di file .env\n");
    process.exit(1);
  }

  const command = process.argv[2] || "swap";

  if (command === "check") {
    await checkBalances(swapper);
  } else {
    await checkBalances(swapper);
    await runSwap(swapper);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
