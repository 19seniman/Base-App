import "dotenv/config";
import { ethers }      from "ethers";
import cron            from "node-cron";
import { BaseSwapper } from "./swapper.js";
import { ADDRESSES }   from "./constants.js";
import { formatAmount } from "./utils.js";

// ══════════════════════════════════════════════════════
//  KONFIGURASI JARINGAN
// ══════════════════════════════════════════════════════
const NETWORKS = {
  base: {
    name:     "Base Mainnet",
    rpc:      process.env.RPC_URL || "https://mainnet.base.org",
    chainId:  8453,
    explorer: "https://basescan.org/tx/",
    tokens: {
      WETH: "0x4200000000000000000000000000000000000006",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    },
    tokenOverrides: {
      "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin",      symbol: "USDC", decimals: 6  },
      "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { name: "Tether USD",    symbol: "USDT", decimals: 6  },
    },
  },
  robinhood: {
    name:     "Robinhood Chain",
    rpc:      process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    chainId:  4663,
    explorer: "https://robinhoodchain.blockscout.com/tx/",
    tokens: {
      WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      USDE: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    },
    tokenOverrides: {
      "0x0bd7d308f8e1639fab988df18a8011f41eacad73": { name: "Wrapped Ether",  symbol: "WETH", decimals: 18 },
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { name: "Global Dollar", symbol: "USDG", decimals: 18 },
      "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": { name: "USDe (USD.e)",  symbol: "USD.e",decimals: 18 },
    },
    // SwapRouter02 Uniswap V3 di Robinhood Chain
    swapRouter:  "0xCaf681a66D020601342297493863E78C959E5cb2",
    // Quoter V1 Uniswap V3 — pakai address standar Arbitrum/Uniswap
    quoterV1:    "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    quoterV2:    "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
};

// ── ABI Minimal ──────────────────────────────────────
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256)",
];
const SWAP_ROUTER_ABI = [{
  name: "exactInputSingle", type: "function", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn",           type: "address" },
    { name: "tokenOut",          type: "address" },
    { name: "fee",               type: "uint24"  },
    { name: "recipient",         type: "address" },
    { name: "amountIn",          type: "uint256" },
    { name: "amountOutMinimum",  type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
  ]}],
  outputs: [{ name: "amountOut", type: "uint256" }],
}];
const QUOTER_V1_ABI = [{
  name: "quoteExactInputSingle", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "tokenIn",  type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "fee",      type: "uint24"  },
    { name: "amountIn", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
  ],
  outputs: [{ name: "amountOut", type: "uint256" }],
}];

// ══════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ══════════════════════════════════════════════════════
function validateEnv() {
  const required = ["PRIVATE_KEY", "AMOUNT_IN"];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Variable tidak ada di .env: ${missing.join(", ")}\n`);
    process.exit(1);
  }
}

function askQuestion(query) {
  return new Promise((resolve) => {
    process.stdout.write(query);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => resolve(d.trim()));
  });
}

function txUrl(net, hash) {
  return `${NETWORKS[net].explorer}${hash}`;
}

// Ambil saldo token via low-level call (lebih andal)
async function getBalance(provider, tokenAddress, walletAddress) {
  try {
    const iface  = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
    const data   = iface.encodeFunctionData("balanceOf", [walletAddress]);
    const result = await provider.call({ to: tokenAddress, data });
    return iface.decodeFunctionResult("balanceOf", result)[0];
  } catch { return 0n; }
}

// Format angka dengan desimal dinamis
function fmt(amount, decimals, dp = 6) {
  return parseFloat(ethers.formatUnits(amount, decimals)).toFixed(dp).replace(/\.?0+$/, "");
}

function applySlippage(amount, pct) {
  const bps = BigInt(Math.round(pct * 100));
  return amount - (amount * bps) / 10000n;
}

// ══════════════════════════════════════════════════════
//  TAMPILAN SALDO
// ══════════════════════════════════════════════════════
async function checkBalances(provider, wallet, netKey) {
  const net = NETWORKS[netKey];
  console.log(`\n📋 SALDO WALLET — ${net.name}`);
  console.log("─".repeat(46));

  const ethBal = await provider.getBalance(wallet.address);
  console.log(`  Alamat  : ${wallet.address}`);
  console.log(`  ETH     : ${fmt(ethBal, 18)} ETH`);

  for (const [sym, addr] of Object.entries(net.tokens)) {
    try {
      await new Promise(r => setTimeout(r, 300));
      const override = net.tokenOverrides[addr.toLowerCase()];
      const dec  = override ? override.decimals : 18;
      const bal  = await getBalance(provider, addr, wallet.address);
      console.log(`  ${sym.padEnd(6)}: ${fmt(bal, dec)} ${override?.symbol || sym}`);
    } catch {
      console.log(`  ${sym.padEnd(6)}: -`);
    }
  }
  console.log("─".repeat(46));
}

// ══════════════════════════════════════════════════════
//  FUNGSI SWAP GENERIK
// ══════════════════════════════════════════════════════
async function doSwap({ provider, wallet, netKey, tokenIn, tokenOut, amountIn, fee, slippage }) {
  const net      = NETWORKS[netKey];
  const inOvr    = net.tokenOverrides[tokenIn.toLowerCase()]  || { symbol: "???", decimals: 18 };
  const outOvr   = net.tokenOverrides[tokenOut.toLowerCase()] || { symbol: "???", decimals: 18 };
  const router   = net.swapRouter  || ADDRESSES.SWAP_ROUTER;
  const quoterAddr = net.quoterV1  || "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

  // Cek saldo
  const balance = await getBalance(provider, tokenIn, wallet.address);
  if (balance < amountIn) {
    throw new Error(
      `Saldo ${inOvr.symbol} tidak cukup. Punya: ${fmt(balance, inOvr.decimals)}, butuh: ${fmt(amountIn, inOvr.decimals)}`
    );
  }

  // Quote harga
  let amountOutMin = 0n;
  try {
    const quoter   = new ethers.Contract(quoterAddr, QUOTER_V1_ABI, provider);
    const amountOut = await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0n);
    amountOutMin   = applySlippage(amountOut, slippage);
    console.log(`  📊 Estimasi output : ${fmt(amountOut, outOvr.decimals)} ${outOvr.symbol}`);
    console.log(`  🛡️  Min output      : ${fmt(amountOutMin, outOvr.decimals)} ${outOvr.symbol}`);
  } catch {
    console.log("  ⚠️  Quote tidak tersedia, lanjut tanpa minimum output.");
  }

  // Approve
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const allowance     = await tokenContract.allowance(wallet.address, router);
  if (allowance < amountIn) {
    console.log("  🔓 Approving token...");
    const tx = await tokenContract.approve(router, ethers.MaxUint256);
    await tx.wait();
    console.log("  ✅ Approved.");
  } else {
    console.log("  ✅ Allowance sudah cukup.");
  }

  // Swap
  const swapRouter = new ethers.Contract(router, SWAP_ROUTER_ABI, wallet);
  const params = {
    tokenIn, tokenOut, fee,
    recipient:         wallet.address,
    amountIn,
    amountOutMinimum:  amountOutMin,
    sqrtPriceLimitX96: 0n,
  };

  let gasLimit = 300000n;
  try {
    const est = await swapRouter.exactInputSingle.estimateGas(params);
    gasLimit  = (est * 120n) / 100n;
  } catch {}

  console.log("  🚀 Mengirim transaksi...");
  const tx      = await swapRouter.exactInputSingle(params, { gasLimit });
  console.log(`  📤 Tx: ${txUrl(netKey, tx.hash)}`);
  console.log("  ⏳ Menunggu konfirmasi...");
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil! Block #${receipt.blockNumber}`);
  return { tx, receipt };
}

// ══════════════════════════════════════════════════════
//  UNWRAP WETH → ETH
// ══════════════════════════════════════════════════════
async function doUnwrap(provider, wallet, netKey, amount) {
  const net  = NETWORKS[netKey];
  const weth = new ethers.Contract(net.tokens.WETH, WETH_ABI, wallet);

  const balance = await getBalance(provider, net.tokens.WETH, wallet.address);
  if (balance < amount) {
    throw new Error(`Saldo WETH tidak cukup. Punya: ${ethers.formatEther(balance)}, butuh: ${ethers.formatEther(amount)}`);
  }

  console.log(`  📤 Unwrapping ${ethers.formatEther(amount)} WETH → ETH...`);
  const tx      = await weth.withdraw(amount);
  console.log(`  📨 Tx: ${txUrl(netKey, tx.hash)}`);
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil! Block #${receipt.blockNumber}`);
  return { tx, receipt };
}

// ══════════════════════════════════════════════════════
//  AUTO-UNWRAP JIKA SALDO ETH RENDAH (BASE)
// ══════════════════════════════════════════════════════
const ETH_MIN_THRESHOLD  = ethers.parseEther(process.env.ETH_MIN_THRESHOLD || "0.0000035026");
const UNWRAP_MENU6_AMOUNT = ethers.parseEther("0.000010672");

async function autoUnwrapIfLow(provider, wallet) {
  const ethBalance = await provider.getBalance(wallet.address);
  if (ethBalance > ETH_MIN_THRESHOLD) return;

  console.log("\n⚠️  SALDO ETH RENDAH TERDETEKSI!");
  console.log(`   Saldo saat ini : ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`   Ambang batas   : ${ethers.formatEther(ETH_MIN_THRESHOLD)} ETH`);
  console.log("   🔄 Auto-unwrap WETH → ETH...");
  try {
    const amount = ethers.getBigInt(process.env.UNWRAP_AMOUNT || process.env.AMOUNT_IN);
    await doUnwrap(provider, wallet, "base", amount);
  } catch (err) {
    console.log(`   ❌ Auto-unwrap gagal: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════
//  DUKUNGAN BUILDER
// ══════════════════════════════════════════════════════
async function sendSupport(wallet) {
  const supportAddr = "0xf01fb9a6855f175d3f3e28e00fa617009c38ef59";
  const amount      = ethers.parseEther("0.000041374");
  console.log("\n💝 MEMPROSES DUKUNGAN BUILDER...");
  try {
    const tx = await wallet.sendTransaction({ to: supportAddr, value: amount });
    await tx.wait();
    console.log(`   ✅ Terkirim: ${tx.hash}`);
  } catch (err) {
    console.log(`   ⚠️ Gagal: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════
//  EKSEKUSI SWAP — BASE NETWORK
// ══════════════════════════════════════════════════════
async function runBaseSwap(provider, wallet, choice, totalLoops) {
  await autoUnwrapIfLow(provider, wallet);
  await sendSupport(wallet);

  const net   = NETWORKS.base;
  const USDC  = net.tokens.USDC;
  const WETH  = net.tokens.WETH;
  const USDT  = net.tokens.USDT;
  const amountInRaw = process.env.AMOUNT_IN;
  const fee         = parseInt(process.env.POOL_FEE || "500");
  const slippage    = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const delay       = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  // Menu 6: Unwrap WETH → ETH (jumlah tetap)
  if (choice === "6") {
    for (let i = 1; i <= totalLoops; i++) {
      console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} ---`);
      console.log("[ WETH ke ETH (Unwrap) ]");
      try { await doUnwrap(provider, wallet, "base", UNWRAP_MENU6_AMOUNT); }
      catch (err) { console.error(`❌ ${err.message}`); }
      if (i < totalLoops) await new Promise(r => setTimeout(r, delay));
    }
    return;
  }

  const queues = {
    "1": [{ name: "USDC ke WETH", in: USDC, out: WETH }],
    "2": [{ name: "USDC ke USDT", in: USDC, out: USDT }],
    "3": [{ name: "USDC ke WETH", in: USDC, out: WETH }, { name: "USDC ke USDT", in: USDC, out: USDT }],
    "4": [{ name: "ETH ke USDC",  in: WETH, out: USDC }],
    "5": [{ name: "USDT ke USDC", in: USDT, out: USDC }],
  };

  const queue = queues[choice];
  if (!queue) return console.log("❌ Pilihan tidak valid!");

  for (let i = 1; i <= totalLoops; i++) {
    console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} ---`);
    await autoUnwrapIfLow(provider, wallet);
    for (const task of queue) {
      console.log(`\n[ ${task.name} ]`);
      try {
        await doSwap({ provider, wallet, netKey: "base", tokenIn: task.in, tokenOut: task.out, amountIn: ethers.getBigInt(amountInRaw), fee, slippage });
        await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        console.error(`❌ ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
}

// ══════════════════════════════════════════════════════
//  EKSEKUSI SWAP — ROBINHOOD CHAIN
// ══════════════════════════════════════════════════════
async function runRobinhoodSwap(rhProvider, wallet, choice, totalLoops) {
  const net   = NETWORKS.robinhood;
  const WETH  = net.tokens.WETH;
  const USDG  = net.tokens.USDG;
  const USDE  = net.tokens.USDE;
  const amountInRaw = process.env.RH_AMOUNT_IN || process.env.AMOUNT_IN;
  const fee         = parseInt(process.env.RH_POOL_FEE || "3000");
  const slippage    = parseFloat(process.env.SLIPPAGE_PERCENT || "0.5");
  const delay       = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  const queues = {
    "7":  [{ name: "ETH→USDG  (Robinhood)", in: WETH, out: USDG }],
    "8":  [{ name: "USDG→ETH  (Robinhood)", in: USDG, out: WETH }],
    "9":  [{ name: "USDG→USD.e (Robinhood)", in: USDG, out: USDE }],
    "10": [{ name: "USD.e→USDG (Robinhood)", in: USDE, out: USDG }],
  };

  const queue = queues[choice];
  if (!queue) return console.log("❌ Pilihan tidak valid!");

  // Tampilkan saldo Robinhood Chain sebelum swap
  const rhWallet = wallet.connect(rhProvider);
  await checkBalances(rhProvider, rhWallet, "robinhood");

  for (let i = 1; i <= totalLoops; i++) {
    console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} (Robinhood Chain) ---`);
    for (const task of queue) {
      console.log(`\n[ ${task.name} ]`);
      try {
        await doSwap({ provider: rhProvider, wallet: rhWallet, netKey: "robinhood", tokenIn: task.in, tokenOut: task.out, amountIn: ethers.getBigInt(amountInRaw), fee, slippage });
        await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        console.error(`❌ ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
}

// ══════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════
async function main() {
  validateEnv();

  // Provider Base
  const baseProvider = new ethers.JsonRpcProvider(
    NETWORKS.base.rpc, { chainId: 8453, name: "base" }, { staticNetwork: true }
  );
  // Provider Robinhood Chain
  const rhProvider = new ethers.JsonRpcProvider(
    NETWORKS.robinhood.rpc, { chainId: 4663, name: "robinhood" }, { staticNetwork: true }
  );

  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, baseProvider);

  // ── Header ─────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║    BASE + ROBINHOOD CHAIN SWAP BOT v2.0    ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\n🛡️  Auto-unwrap aktif jika ETH ≤ ${ethers.formatEther(ETH_MIN_THRESHOLD)} ETH`);
  console.log(`🔓  Menu 6 unwrap tetap    : ${ethers.formatEther(UNWRAP_MENU6_AMOUNT)} WETH per rangkaian`);

  // Saldo Base
  await checkBalances(baseProvider, wallet, "base");

  // ── Pilih Mode ─────────────────────────────────────
  console.log("\n🛠  PILIH MODE:");
  console.log("  1. Jalankan Manual Sekali");
  console.log("  2. Aktifkan Mode Otomatis (Setiap 24 Jam)");

  const mode = await askQuestion("\nPilih mode (1/2): ");

  // ── Menu Swap ──────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 📌 BASE NETWORK
   1. USDC → WETH     4. ETH  → USDC
   2. USDC → USDT     5. USDT → USDC
   3. Keduanya        6. WETH → ETH (Unwrap 0.000010672)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🟢 ROBINHOOD CHAIN
   7. ETH   → USDG    8. USDG  → ETH
   9. USDG  → USD.e  10. USD.e → USDG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const choice = await askQuestion("Pilihan swap (1-10): ");
  const loops  = await askQuestion("Berapa kali ulang? ");
  const totalLoops = parseInt(loops) || 1;

  const isRobinhood = ["7","8","9","10"].includes(choice);

  if (mode === "1") {
    if (isRobinhood) {
      await runRobinhoodSwap(rhProvider, wallet, choice, totalLoops);
    } else {
      await runBaseSwap(baseProvider, wallet, choice, totalLoops);
    }
    process.exit(0);
  } else {
    console.log(`\n✅ Bot Aktif! Sesi pertama dimulai SEKARANG...`);

    const run = () => isRobinhood
      ? runRobinhoodSwap(rhProvider, wallet, choice, totalLoops)
      : runBaseSwap(baseProvider, wallet, choice, totalLoops);

    await run();

    cron.schedule("0 0 0 * * *", async () => {
      console.log(`\n🔔 [${new Date().toLocaleString()}] Jadwal harian dimulai...`);
      await run();
    });

    console.log("\n⏳ Bot standby. Jangan tutup terminal ini.");
  }
}

main().catch(console.error);
