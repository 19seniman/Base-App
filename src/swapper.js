import { ethers } from "ethers";
import {
  ADDRESSES, ERC20_ABI, WETH_ABI,
  SWAP_ROUTER_ABI, QUOTER_V1_ABI, QUOTER_V2_ABI,
} from "./constants.js";
import { formatAmount, applySlippage, txLink } from "./utils.js";

const TOKEN_OVERRIDES = {
  [ADDRESSES.TOKENS.WETH.toLowerCase()]: { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
  [ADDRESSES.TOKENS.USDC.toLowerCase()]: { name: "USD Coin",      symbol: "USDC", decimals: 6  },
  [ADDRESSES.TOKENS.USDT.toLowerCase()]: { name: "Tether USD",    symbol: "USDT", decimals: 6  },
  [ADDRESSES.TOKENS.DAI.toLowerCase()]:  { name: "Dai",           symbol: "DAI",  decimals: 18 },
};

export class BaseSwapper {
  constructor(provider, wallet) {
    this.provider  = provider;
    this.wallet    = wallet;
    this.router    = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
    this.quoterV1  = new ethers.Contract(ADDRESSES.QUOTER_V1,   QUOTER_V1_ABI,   provider);
    this.quoterV2  = new ethers.Contract(ADDRESSES.QUOTER_V2,   QUOTER_V2_ABI,   provider);
  }

  // ── Ambil saldo token via provider.call (lebih andal) ────
  async getBalance(tokenAddress) {
    try {
      const iface  = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
      const data   = iface.encodeFunctionData("balanceOf", [this.wallet.address]);
      const result = await this.provider.call({ to: tokenAddress, data });
      return iface.decodeFunctionResult("balanceOf", result)[0];
    } catch {
      return 0n;
    }
  }

  // ── Info token ───────────────────────────────────────────
  async getTokenInfo(tokenAddress) {
    if (tokenAddress.toLowerCase() === "native") {
      const balance = await this.provider.getBalance(this.wallet.address);
      return { name: "Ethereum", symbol: "ETH", decimals: 18, balance, isNative: true };
    }

    const key      = tokenAddress.toLowerCase();
    const override = TOKEN_OVERRIDES[key];
    const balance  = await this.getBalance(tokenAddress);

    if (override) {
      return { ...override, balance, address: tokenAddress, isNative: false };
    }

    // Token tidak dikenal
    const token  = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    let name     = "Unknown";
    let symbol   = "???";
    let decimals = 18;
    try { name     = await token.name();             } catch {}
    try { symbol   = await token.symbol();           } catch {}
    try { decimals = Number(await token.decimals()); } catch {}

    return { name, symbol, decimals, balance, address: tokenAddress, isNative: false };
  }

  // ── Quote: coba V1 dulu, fallback ke V2, lalu skip ──────
  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    // Coba Quoter V1 (parameter flat, lebih kompatibel)
    try {
      console.log("  🔍 Mencoba Quoter V1...");
      const out = await this.quoterV1.quoteExactInputSingle.staticCall(
        tokenIn, tokenOut, fee, amountIn, 0n
      );
      console.log("  ✅ Quote V1 berhasil.");
      return out;
    } catch (e1) {
      console.log(`  ⚠️  Quoter V1 gagal: ${e1.code ?? e1.message}`);
    }

    // Coba Quoter V2 (parameter struct)
    try {
      console.log("  🔍 Mencoba Quoter V2...");
      const result = await this.quoterV2.quoteExactInputSingle.staticCall({
        tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
      });
      console.log("  ✅ Quote V2 berhasil.");
      return result[0];
    } catch (e2) {
      console.log(`  ⚠️  Quoter V2 gagal: ${e2.code ?? e2.message}`);
    }

    // Kedua quoter gagal — lanjut tanpa estimasi (amountOutMinimum = 0)
    console.log("  ⚠️  Quote tidak tersedia. Swap tetap dilanjutkan dengan amountOutMinimum = 0.");
    console.log("  ⚠️  PERHATIAN: Tanpa minimum output, slippage tidak terlindungi!");
    return null;
  }

  // ── Approve ──────────────────────────────────────────────
  async approveToken(tokenAddress, amount) {
    const token     = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);
    if (allowance >= amount) {
      console.log("  ✅ Allowance sudah cukup, skip approve.");
      return;
    }
    console.log("  🔓 Approving token...");
    const tx = await token.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256);
    await tx.wait();
    console.log(`  ✅ Approved: ${txLink(tx.hash)}`);
  }

  // ── Wrap ETH ─────────────────────────────────────────────
  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log("  📦 Wrapping ETH → WETH...");
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
    console.log(`  ✅ Wrapped: ${txLink(tx.hash)}`);
  }

  // ── Swap utama ───────────────────────────────────────────
  async swap({
    tokenIn, tokenOut, amountIn,
    fee = 3000, slippage = 0.5, deadlineMin = 20, isNativeIn = false,
  }) {
    const effectiveIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;
    const infoIn      = await this.getTokenInfo(isNativeIn ? "native" : tokenIn);
    const infoOut     = await this.getTokenInfo(tokenOut);

    console.log(`\n  💰 Saldo ${infoIn.symbol}: ${formatAmount(infoIn.balance, infoIn.decimals)}`);

    if (infoIn.balance < amountIn) {
      throw new Error(
        `Saldo tidak cukup!\n` +
        `  Punya : ${formatAmount(infoIn.balance, infoIn.decimals)} ${infoIn.symbol}\n` +
        `  Butuh : ${formatAmount(amountIn,       infoIn.decimals)} ${infoIn.symbol}`
      );
    }

    // Quote harga
    let amountOutMin = 0n;
    if (amountOut !== null && amountOut !== undefined) {
      amountOutMin = applySlippage(amountOut, slippage);
      console.log(`  📊 Estimasi output : ${formatAmount(amountOut,    infoOut.decimals)} ${infoOut.symbol}`);
      console.log(`  🛡️  Min output      : ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);
    } else {
      console.log("  ⚠️  Gagal mendapatkan quote. Menggunakan amountOutMinimum = 0.");
    }

    if (amountOut) {
      console.log(`  📊 Estimasi output : ${formatAmount(amountOut,    infoOut.decimals)} ${infoOut.symbol}`);
      console.log(`  🛡️  Min output      : ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);
    }

    // Wrap & Approve
    if (isNativeIn) await this.wrapETH(amountIn);
    await this.approveToken(effectiveIn, amountIn);

    // Parameter swap
    const swapParams = {
      tokenIn:           effectiveIn,
      tokenOut,
      fee,
      recipient:         this.wallet.address,
      amountIn,
      amountOutMinimum:  amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    // Estimasi gas
    let gasLimit;
    try {
      const est = await this.router.exactInputSingle.estimateGas(swapParams);
      gasLimit  = (est * 120n) / 100n;
      console.log(`\n  ⛽ Gas estimasi: ${est} units`);
    } catch {
      gasLimit = 300000n;
      console.log("  ⚠️  Pakai gas default: 300000");
    }

    // Kirim transaksi
    console.log("\n  🚀 Mengirim transaksi swap...");
    const tx      = await this.router.exactInputSingle(swapParams, { gasLimit });
    console.log(`  📤 Tx hash : ${txLink(tx.hash)}`);
    console.log("  ⏳ Menunggu konfirmasi blok...");
    const receipt = await tx.wait();

    return { tx, receipt, amountOut, amountOutMin, infoIn, infoOut };
  }
}
