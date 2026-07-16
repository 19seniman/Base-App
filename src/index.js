import "dotenv/config";
import { ethers } from "ethers";
import cron       from "node-cron";
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
      "0x4200000000000000000000000000000000000006": { symbol: "WETH",  decimals: 18 },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC",  decimals: 6  },
      "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT",  decimals: 6  },
    },
    swapRouter: ADDRESSES.SWAP_ROUTER,
    quoterV1:   "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
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
      "0x0bd7d308f8e1639fab988df18a8011f41eacad73": { symbol: "WETH",  decimals: 18 },
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { symbol: "USDG", decimals: 18 },
      "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": { symbol: "USD.e",decimals: 18 },
    },
    // Uniswap V3 sebagai fallback jika LI.FI gagal
    swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
    quoterV1:   "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
  },
};

// ── ABI Minimal ──────────────────────────────────────
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
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
//  HELPER
// ══════════════════════════════════════════════════════
function validateEnv() {
  const required = ["PRIVATE_KEY", "AMOUNT_IN"];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) { console.error(`\n❌ Variable tidak ada di .env: ${missing.join(", ")}\n`); process.exit(1); }
}

function askQuestion(query) {
  return new Promise(resolve => {
    process.stdout.write(query);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", d => resolve(d.trim()));
  });
}

function txUrl(netKey, hash) { return `${NETWORKS[netKey].explorer}${hash}`; }

async function getBalance(provider, tokenAddr, walletAddr) {
  try {
    const iface  = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
    const result = await provider.call({ to: tokenAddr, data: iface.encodeFunctionData("balanceOf", [walletAddr]) });
    return iface.decodeFunctionResult("balanceOf", result)[0];
  } catch { return 0n; }
}

function fmt(amount, decimals, dp = 6) {
  return parseFloat(ethers.formatUnits(amount, decimals)).toFixed(dp).replace(/\.?0+$/, "");
}

function applySlippage(amount, pct) {
  return amount - (amount * BigInt(Math.round(pct * 100))) / 10000n;
}

// Token stablecoin di semua jaringan (address lowercase)
const STABLECOINS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC Base
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT Base
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG Robinhood
  "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", // USD.e Robinhood
]);

/**
 * Tentukan slippage yang tepat:
 * - Stablecoin ↔ Stablecoin : 0.1% (sangat rendah, harga hampir sama)
 * - ETH ↔ Stablecoin        : 0.5% (default)
 * - Override via .env SLIPPAGE_PERCENT jika diset manual
 */
function getSlippage(tokenIn, tokenOut) {
  // Jika user set manual di .env, pakai itu
  if (process.env.SLIPPAGE_PERCENT) {
    return parseFloat(process.env.SLIPPAGE_PERCENT);
  }
  const isStableSwap = STABLECOINS.has(tokenIn.toLowerCase()) && STABLECOINS.has(tokenOut.toLowerCase());
  return isStableSwap ? 0.1 : 0.5;
}

// ══════════════════════════════════════════════════════
//  TAMPILAN SALDO
// ══════════════════════════════════════════════════════
async function checkBalances(provider, wallet, netKey) {
  const net = NETWORKS[netKey];
  console.log(`\n📋 SALDO WALLET — ${net.name}`);
  console.log("─".repeat(48));
  const ethBal = await provider.getBalance(wallet.address);
  console.log(`  Alamat  : ${wallet.address}`);
  console.log(`  ETH     : ${fmt(ethBal, 18)} ETH`);
  for (const [sym, addr] of Object.entries(net.tokens)) {
    try {
      await new Promise(r => setTimeout(r, 300));
      const ov  = net.tokenOverrides[addr.toLowerCase()];
      const bal = await getBalance(provider, addr, wallet.address);
      console.log(`  ${sym.padEnd(6)}: ${fmt(bal, ov?.decimals || 18)} ${ov?.symbol || sym}`);
    } catch { console.log(`  ${sym.padEnd(6)}: -`); }
  }
  console.log("─".repeat(48));
}

// ══════════════════════════════════════════════════════
//  JUMPER / LI.FI SWAP (Robinhood Chain)
//  Menggunakan LI.FI REST API untuk mendapatkan route
//  terbaik, lalu eksekusi transaksi langsung dari wallet.
// ══════════════════════════════════════════════════════
const LIFI_API = "https://li.quest/v1";

async function getQuoteLiFi({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, slippage }) {
  const url = new URL(`${LIFI_API}/quote`);
  url.searchParams.set("fromChain",   fromChain);
  url.searchParams.set("toChain",     toChain);
  url.searchParams.set("fromToken",   fromToken);
  url.searchParams.set("toToken",     toToken);
  url.searchParams.set("fromAmount",  fromAmount.toString());
  url.searchParams.set("fromAddress", fromAddress);
  url.searchParams.set("slippage",    slippage.toString());
  url.searchParams.set("integrator",  "base-swap-bot");

  const res  = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  const data = await res.json();
  if (!res.ok) throw new Error(`LI.FI API error: ${data?.message || JSON.stringify(data)}`);
  return data;
}

async function swapViaLiFi({ provider, wallet, netKey, tokenIn, tokenOut, amountIn, slippage }) {
  const net   = NETWORKS[netKey];
  const inOvr = net.tokenOverrides[tokenIn.toLowerCase()]  || { symbol: "???", decimals: 18 };
  const outOvr= net.tokenOverrides[tokenOut.toLowerCase()] || { symbol: "???", decimals: 18 };

  // Cek saldo
  const balance = await getBalance(provider, tokenIn, wallet.address);
  if (balance < amountIn) {
    throw new Error(`Saldo ${inOvr.symbol} tidak cukup. Punya: ${fmt(balance, inOvr.decimals)}, butuh: ${fmt(amountIn, inOvr.decimals)}`);
  }

  // Ambil quote dari LI.FI
  console.log("  🌐 Meminta quote dari Jumper/LI.FI...");
  let quote;
  try {
    quote = await getQuoteLiFi({
      fromChain:   net.chainId,
      toChain:     net.chainId,
      fromToken:   tokenIn,
      toToken:     tokenOut,
      fromAmount:  amountIn,
      fromAddress: wallet.address,
      slippage:    slippage / 100,
    });
  } catch (err) {
    console.log(`  ⚠️  LI.FI gagal (${err.message}), fallback ke Uniswap...`);
    return await swapViaUniswap({ provider, wallet, netKey, tokenIn, tokenOut, amountIn, fee: parseInt(process.env.RH_POOL_FEE || "3000"), slippage });
  }

  const toAmount    = quote.estimate?.toAmount || "0";
  const toAmountMin = quote.estimate?.toAmountMin || "0";
  const tool        = quote.toolDetails?.name || quote.tool || "LI.FI";
  const approvalAddr= quote.estimate?.approvalAddress || quote.transactionRequest?.to;

  console.log(`  🔀 Router    : ${tool} (via Jumper/LI.FI)`);
  console.log(`  📊 Estimasi  : ${fmt(BigInt(toAmount), outOvr.decimals)} ${outOvr.symbol}`);
  console.log(`  🛡️  Min output: ${fmt(BigInt(toAmountMin), outOvr.decimals)} ${outOvr.symbol}`);

  // Approve ke approval address dari LI.FI
  if (approvalAddr) {
    const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
    const allowance     = await tokenContract.allowance(wallet.address, approvalAddr);
    if (allowance < amountIn) {
      console.log(`  🔓 Approving ke ${approvalAddr.slice(0,10)}...`);
      const approveTx = await tokenContract.approve(approvalAddr, ethers.MaxUint256);
      await approveTx.wait();
      console.log("  ✅ Approved.");
    } else {
      console.log("  ✅ Allowance sudah cukup.");
    }
  }

  // Kirim transaksi dari calldata LI.FI
  const txReq = quote.transactionRequest;
  if (!txReq) throw new Error("LI.FI tidak mengembalikan transactionRequest.");

  console.log("  🚀 Mengirim transaksi via Jumper/LI.FI...");
  const tx = await wallet.sendTransaction({
    to:       txReq.to,
    data:     txReq.data,
    value:    txReq.value ? BigInt(txReq.value) : 0n,
    gasLimit: txReq.gasLimit ? BigInt(txReq.gasLimit) : 400000n,
  });
  console.log(`  📤 Tx: ${txUrl(netKey, tx.hash)}`);
  console.log("  ⏳ Menunggu konfirmasi...");
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil! Block #${receipt.blockNumber}`);
  return { tx, receipt };
}

// ══════════════════════════════════════════════════════
//  FALLBACK: UNISWAP V3 SWAP
// ══════════════════════════════════════════════════════
async function swapViaUniswap({ provider, wallet, netKey, tokenIn, tokenOut, amountIn, fee, slippage }) {
  const net    = NETWORKS[netKey];
  const outOvr = net.tokenOverrides[tokenOut.toLowerCase()] || { symbol: "???", decimals: 18 };

  let amountOutMin = 0n;
  try {
    const quoter    = new ethers.Contract(net.quoterV1, QUOTER_V1_ABI, provider);
    const amountOut = await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0n);
    amountOutMin    = applySlippage(amountOut, slippage);
    console.log(`  📊 Estimasi (Uniswap): ${fmt(amountOut, outOvr.decimals)} ${outOvr.symbol}`);
  } catch { console.log("  ⚠️  Quote Uniswap tidak tersedia."); }

  // Approve ke SwapRouter
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const allowance     = await tokenContract.allowance(wallet.address, net.swapRouter);
  if (allowance < amountIn) {
    console.log("  🔓 Approving ke Uniswap router...");
    await (await tokenContract.approve(net.swapRouter, ethers.MaxUint256)).wait();
    console.log("  ✅ Approved.");
  }

  const router = new ethers.Contract(net.swapRouter, SWAP_ROUTER_ABI, wallet);
  const params = { tokenIn, tokenOut, fee, recipient: wallet.address, amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n };

  let gasLimit = 300000n;
  try { const e = await router.exactInputSingle.estimateGas(params); gasLimit = (e * 120n) / 100n; } catch {}

  console.log("  🚀 Mengirim transaksi via Uniswap V3...");
  const tx      = await router.exactInputSingle(params, { gasLimit });
  console.log(`  📤 Tx: ${txUrl(netKey, tx.hash)}`);
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
  const bal  = await getBalance(provider, net.tokens.WETH, wallet.address);
  if (bal < amount) throw new Error(`Saldo WETH tidak cukup. Punya: ${ethers.formatEther(bal)}, butuh: ${ethers.formatEther(amount)}`);
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
const ETH_MIN_THRESHOLD   = ethers.parseEther(process.env.ETH_MIN_THRESHOLD || "0.0000035026");
const UNWRAP_MENU6_AMOUNT = ethers.parseEther("0.000010672");

async function autoUnwrapIfLow(provider, wallet) {
  const bal = await provider.getBalance(wallet.address);
  if (bal > ETH_MIN_THRESHOLD) return;
  console.log(`\n⚠️  SALDO ETH RENDAH! (${ethers.formatEther(bal)} ETH) — auto-unwrap WETH→ETH...`);
  try { await doUnwrap(provider, wallet, "base", ethers.getBigInt(process.env.UNWRAP_AMOUNT || process.env.AMOUNT_IN)); }
  catch (err) { console.log(`  ❌ Auto-unwrap gagal: ${err.message}`); }
}

// ══════════════════════════════════════════════════════
//  DUKUNGAN BUILDER
// ══════════════════════════════════════════════════════
async function sendSupport(wallet) {
  const amount = ethers.parseEther("0.000041374");
  console.log("\n💝 MEMPROSES DUKUNGAN BUILDER...");
  try {
    const tx = await wallet.sendTransaction({ to: "0xf01fb9a6855f175d3f3e28e00fa617009c38ef59", value: amount });
    await tx.wait();
    console.log(`   ✅ Terkirim: ${tx.hash}`);
  } catch (err) { console.log(`   ⚠️ Gagal: ${err.message}`); }
}

// ══════════════════════════════════════════════════════
//  EKSEKUSI SWAP — BASE NETWORK (Uniswap V3)
// ══════════════════════════════════════════════════════
async function runBaseSwap(provider, wallet, choice, totalLoops) {
  await autoUnwrapIfLow(provider, wallet);
  await sendSupport(wallet);

  const { WETH, USDC, USDT } = NETWORKS.base.tokens;
  const amountIn = ethers.getBigInt(process.env.AMOUNT_IN);
  const fee      = parseInt(process.env.POOL_FEE || "500");
  const delay    = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  if (choice === "6") {
    for (let i = 1; i <= totalLoops; i++) {
      console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} ---`);
      console.log("[ WETH ke ETH (Unwrap 0.000010672) ]");
      try { await doUnwrap(provider, wallet, "base", UNWRAP_MENU6_AMOUNT); }
      catch (err) { console.error(`❌ ${err.message}`); }
      if (i < totalLoops) await new Promise(r => setTimeout(r, delay));
    }
    return;
  }

  const queues = {
    "1": [{ name: "USDC → WETH", in: USDC, out: WETH }],
    "2": [{ name: "USDC → USDT", in: USDC, out: USDT }],
    "3": [{ name: "USDC → WETH", in: USDC, out: WETH }, { name: "USDC → USDT", in: USDC, out: USDT }],
    "4": [{ name: "ETH  → USDC", in: WETH, out: USDC }],
    "5": [{ name: "USDT → USDC", in: USDT, out: USDC }],
  };

  const queue = queues[choice];
  if (!queue) return console.log("❌ Pilihan tidak valid!");

  for (let i = 1; i <= totalLoops; i++) {
    console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} ---`);
    await autoUnwrapIfLow(provider, wallet);
    for (const task of queue) {
      console.log(`\n[ ${task.name} — Base Network ]`);
      try {
        const slippage = getSlippage(task.in, task.out);
        console.log(`  🎚️  Slippage : ${slippage}%${slippage === 0.1 ? " (stablecoin rendah)" : " (default)"}`);
        await swapViaUniswap({ provider, wallet, netKey: "base", tokenIn: task.in, tokenOut: task.out, amountIn, fee, slippage });
        await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        console.error(`❌ ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
}

// ══════════════════════════════════════════════════════
//  EKSEKUSI SWAP — ROBINHOOD CHAIN (via Jumper/LI.FI)
// ══════════════════════════════════════════════════════
async function runRobinhoodSwap(rhProvider, wallet, choice, totalLoops) {
  const { WETH, USDG, USDE } = NETWORKS.robinhood.tokens;
  const amountIn = ethers.getBigInt(process.env.RH_AMOUNT_IN || process.env.AMOUNT_IN);
  const delay    = parseInt(process.env.DELAY_BETWEEN_SWAP || "15000");

  const queues = {
    "7":  [{ name: "ETH   → USDG  (Jumper/LI.FI)", in: WETH, out: USDG }],
    "8":  [{ name: "USDG  → ETH   (Jumper/LI.FI)", in: USDG, out: WETH }],
    "9":  [{ name: "USDG  → USD.e (Jumper/LI.FI)", in: USDG, out: USDE }],
    "10": [{ name: "USD.e → USDG  (Jumper/LI.FI)", in: USDE, out: USDG }],
  };

  const queue = queues[choice];
  if (!queue) return console.log("❌ Pilihan tidak valid!");

  const rhWallet = wallet.connect(rhProvider);
  await checkBalances(rhProvider, rhWallet, "robinhood");

  for (let i = 1; i <= totalLoops; i++) {
    console.log(`\n\n--- RANGKAIAN ${i}/${totalLoops} (Robinhood Chain via Jumper) ---`);
    for (const task of queue) {
      console.log(`\n[ ${task.name} ]`);
      try {
        const slippage = getSlippage(task.in, task.out);
        console.log(`  🎚️  Slippage : ${slippage}%${slippage === 0.1 ? " (stablecoin rendah)" : " (default)"}`);
        await swapViaLiFi({ provider: rhProvider, wallet: rhWallet, netKey: "robinhood", tokenIn: task.in, tokenOut: task.out, amountIn, slippage });
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

  const baseProvider = new ethers.JsonRpcProvider(NETWORKS.base.rpc, { chainId: 8453, name: "base" }, { staticNetwork: true });
  const rhProvider   = new ethers.JsonRpcProvider(NETWORKS.robinhood.rpc, { chainId: 4663, name: "robinhood" }, { staticNetwork: true });
  const wallet       = new ethers.Wallet(process.env.PRIVATE_KEY, baseProvider);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   BASE + ROBINHOOD CHAIN SWAP BOT  v2.1        ║");
  console.log("║   Robinhood: Jumper/LI.FI  |  Base: Uniswap   ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n🛡️  Auto-unwrap aktif jika ETH ≤ ${ethers.formatEther(ETH_MIN_THRESHOLD)} ETH`);
  console.log(`🔓  Menu 6 unwrap tetap : ${ethers.formatEther(UNWRAP_MENU6_AMOUNT)} WETH`);

  await checkBalances(baseProvider, wallet, "base");
  await checkBalances(rhProvider, wallet.connect(rhProvider), "robinhood");

  console.log("\n🛠  PILIH MODE:");
  console.log("  1. Jalankan Manual Sekali");
  console.log("  2. Aktifkan Mode Otomatis (Setiap 24 Jam)");
  const mode = await askQuestion("\nPilih mode (1/2): ");

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 📌 BASE NETWORK (Uniswap V3)
   1. USDC→WETH    4. ETH→USDC
   2. USDC→USDT    5. USDT→USDC
   3. Keduanya     6. WETH→ETH (Unwrap 0.000010672)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 🟢 ROBINHOOD CHAIN (Jumper/LI.FI)
   7. ETH  →USDG    8. USDG →ETH
   9. USDG →USD.e  10. USD.e→USDG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const choice = await askQuestion("Pilihan swap (1-10): ");
  const loops  = await askQuestion("Berapa kali ulang? ");
  const totalLoops  = parseInt(loops) || 1;
  const isRobinhood = ["7","8","9","10"].includes(choice);

  const run = () => isRobinhood
    ? runRobinhoodSwap(rhProvider, wallet, choice, totalLoops)
    : runBaseSwap(baseProvider, wallet, choice, totalLoops);

  if (mode === "1") {
    await run();
    process.exit(0);
  } else {
    console.log(`\n✅ Bot Aktif! Sesi pertama dimulai SEKARANG...`);
    await run();
    cron.schedule("0 0 0 * * *", async () => {
      console.log(`\n🔔 [${new Date().toLocaleString()}] Jadwal harian dimulai...`);
      await run();
    });
    console.log("\n⏳ Bot standby. Jangan tutup terminal ini.");
  }
}

main().catch(console.error);
