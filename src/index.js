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
  const ethBal = await swapper.provider.getBalance(swapper.wallet.address);
  console.log(`  Alamat : ${swapper.wallet.address}`);
  console.log(`  ETH    : ${formatAmount(ethBal, 18)} ETH`);

  for (const [name, addr] of Object.entries(ADDRESSES.TOKENS)) {
    try {
      // Tambahkan delay 200ms setiap cek saldo agar tidak kena rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const info = await swapper.getTokenInfo(addr);
      console.log(`  ${name.padEnd(6)}: ${formatAmount(info.balance, info.decimals)} ${info.symbol}`);
    } catch (err) {
      console.log(`  ${name.padEnd(6)}: - (RPC Timeout)`);
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
  console.log("║      BASE NETWORK SWAP BOT  v1.0      ║");
  console.log("╚════════════════════════════════════════╝");

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, undefined, {
    staticNetwork: true
});
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const swapper  = new BaseSwapper(provider, wallet);

  console.log(`\n🔗 RPC    : ${process.env.RPC_URL}`);
  console.log(`👛 Wallet : ${shortenAddress(wallet.address)}`);

  try {
    const net = await provider.getNetwork();
    console.log(`✅ Network: chain ID ${net.chainId}`);
    if (net.chainId !== 8453n) console.warn("⚠️  Bukan Base Mainnet!");
  } catch {
    console.error("❌ Gagal konek RPC. Cek RPC_URL di .env");
    process.exit(1);
  }

  await checkBalances(swapper);

  if (process.argv[2] === "check") process.exit(0);

  const tokenIn    = process.env.TOKEN_IN;
  const tokenOut   = process.env.TOKEN_OUT;
  const amountIn   = BigInt(process.env.AMOUNT_IN);
  const fee        = parseInt(process.env.POOL_FEE          || "3000");
  const slippage   = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const deadline   = parseInt(process.env.DEADLINE_MINUTES  || "20");
  const isNativeIn = ["native", "eth"].includes(tokenIn.toLowerCase());

  const infoIn  = await swapper.getTokenInfo(isNativeIn ? "native" : tokenIn);
  const infoOut = await swapper.getTokenInfo(tokenOut);

  console.log("\n🔄 DETAIL SWAP");
  console.log("─".repeat(42));
  console.log(`  Dari    : ${formatAmount(amountIn, infoIn.decimals)} ${infoIn.symbol}`);
  console.log(`  Ke      : ${infoOut.symbol}`);
  console.log(`  Fee tier: ${fee / 10000}%  |  Slippage: ${slippage}%`);
  console.log("─".repeat(42));

  if (process.env.AUTO_CONFIRM !== "true") {
    const ok = await promptConfirm("\n  ⚠️  Lanjutkan swap? (y/n): ");
    if (!ok) { console.log("  ❌ Dibatalkan.\n"); process.exit(0); }
  }

  const r = await swapper.swap({ tokenIn, tokenOut, amountIn, fee, slippage, deadlineMin: deadline, isNativeIn });

  console.log("\n✅ SWAP BERHASIL!");
  console.log("─".repeat(42));
  console.log(`  Block   : #${r.receipt.blockNumber}`);
  console.log(`  Gas used: ${r.receipt.gasUsed}`);
  console.log(`  Output  : ${formatAmount(r.amountOut, r.infoOut.decimals)} ${r.infoOut.symbol}`);
  console.log(`  Link    : https://basescan.org/tx/${r.tx.hash}`);
  console.log("─".repeat(42) + "\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
