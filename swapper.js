// ============================================================
//  SWAPPER.JS — Mesin utama untuk eksekusi swap
// ============================================================
import { ethers } from "ethers";
import {
  ADDRESSES,
  ERC20_ABI,
  WETH_ABI,
  SWAP_ROUTER_ABI,
  QUOTER_V2_ABI,
} from "./constants.js";
import { formatAmount, applySlippage, getDeadline, txLink } from "./utils.js";

export class BaseSwapper {
  /**
   * @param {ethers.JsonRpcProvider} provider
   * @param {ethers.Wallet} wallet
   */
  constructor(provider, wallet) {
    this.provider = provider;
    this.wallet   = wallet;
    this.router   = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
    this.quoter   = new ethers.Contract(ADDRESSES.QUOTER_V2,   QUOTER_V2_ABI,   provider);
  }

  // ── Info Token ───────────────────────────────────────────

  /**
   * Ambil informasi token (nama, simbol, desimal, saldo)
   */
  async getTokenInfo(tokenAddress) {
    const isNative = tokenAddress.toLowerCase() === "native";
    if (isNative) {
      const balance = await this.provider.getBalance(this.wallet.address);
      return { name: "Ethereum", symbol: "ETH", decimals: 18, balance, isNative: true };
    }

    const isWETH = tokenAddress.toLowerCase() === ADDRESSES.TOKENS.WETH.toLowerCase();
    const abi    = isWETH ? WETH_ABI : ERC20_ABI;
    const token  = new ethers.Contract(tokenAddress, abi, this.wallet);

    const [name, symbol, decimals, balance] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
      token.balanceOf(this.wallet.address),
    ]);

    return { name, symbol, decimals: Number(decimals), balance, address: tokenAddress, isNative: false };
  }

  // ── Quote (Estimasi Harga) ───────────────────────────────

  /**
   * Dapatkan estimasi jumlah token output sebelum swap
   */
  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    try {
      const result = await this.quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      return result[0]; // amountOut
    } catch (err) {
      throw new Error(`Gagal mendapat quote: ${err.message}`);
    }
  }

  // ── Approve Token ────────────────────────────────────────

  /**
   * Approve router untuk menggunakan token kita
   */
  async approveToken(tokenAddress, amount) {
    const token     = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);

    if (allowance >= amount) {
      return null; // Sudah diapprove
    }

    console.log("  🔓 Approving token untuk router...");
    const tx = await token.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256);
    await tx.wait();
    console.log(`  ✅ Approval berhasil: ${txLink(tx.hash)}`);
    return tx;
  }

  // ── Wrap ETH ─────────────────────────────────────────────

  /**
   * Wrap ETH native menjadi WETH
   */
  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log("  📦 Wrapping ETH → WETH...");
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
    console.log(`  ✅ Wrap berhasil: ${txLink(tx.hash)}`);
    return tx;
  }

  // ── Swap Utama ───────────────────────────────────────────

  /**
   * Eksekusi swap exactInputSingle
   * @param {object} params
   * @param {string}  params.tokenIn       - address token masuk
   * @param {string}  params.tokenOut      - address token keluar
   * @param {bigint}  params.amountIn      - jumlah token masuk (wei)
   * @param {number}  params.fee           - fee tier (500/3000/10000)
   * @param {number}  params.slippage      - slippage persen (misal 0.5)
   * @param {number}  params.deadlineMin   - deadline dalam menit
   * @param {boolean} params.isNativeIn    - apakah input adalah ETH native
   */
  async swap({
    tokenIn,
    tokenOut,
    amountIn,
    fee         = 3000,
    slippage    = 0.5,
    deadlineMin = 20,
    isNativeIn  = false,
  }) {
    const effectiveTokenIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;

    // 1. Cek saldo
    const infoIn  = await this.getTokenInfo(isNativeIn ? "native" : tokenIn);
    const infoOut = await this.getTokenInfo(tokenOut);

    if (infoIn.balance < amountIn) {
      throw new Error(
        `Saldo tidak cukup! Kamu punya ${formatAmount(infoIn.balance, infoIn.decimals)} ${infoIn.symbol}, ` +
        `butuh ${formatAmount(amountIn, infoIn.decimals)} ${infoIn.symbol}`
      );
    }

    // 2. Dapatkan quote
    console.log("\n  🔍 Mengambil quote harga...");
    const amountOut = await this.getQuote({
      tokenIn:  effectiveTokenIn,
      tokenOut,
      amountIn,
      fee,
    });
    const amountOutMin = applySlippage(amountOut, slippage);

    console.log(`  📊 Estimasi output: ${formatAmount(amountOut, infoOut.decimals)} ${infoOut.symbol}`);
    console.log(`  🛡️  Min output (slippage ${slippage}%): ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);

    // 3. Wrap ETH jika diperlukan
    if (isNativeIn) {
      await this.wrapETH(amountIn);
    }

    // 4. Approve
    if (!isNativeIn) {
      await this.approveToken(tokenIn, amountIn);
    } else {
      await this.approveToken(ADDRESSES.TOKENS.WETH, amountIn);
    }

    // 5. Estimasi gas
    const deadline = getDeadline(deadlineMin);
    const swapParams = {
      tokenIn:           effectiveTokenIn,
      tokenOut,
      fee,
      recipient:         this.wallet.address,
      amountIn,
      amountOutMinimum:  amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    console.log("\n  ⛽ Estimasi gas...");
    let gasEstimate;
    try {
      gasEstimate = await this.router.exactInputSingle.estimateGas(swapParams);
      const feeData = await this.provider.getFeeData();
      const gasCostWei = gasEstimate * (feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n);
      console.log(`  ⛽ Gas: ~${gasEstimate.toString()} units | Biaya: ~${ethers.formatEther(gasCostWei)} ETH`);
    } catch {
      gasEstimate = 300000n;
      console.log(`  ⚠️  Estimasi gas gagal, pakai default: ${gasEstimate}`);
    }

    // 6. Eksekusi swap
    console.log("\n  🚀 Mengirim transaksi swap...");
    const tx = await this.router.exactInputSingle(swapParams, {
      gasLimit: (gasEstimate * 120n) / 100n, // +20% buffer
    });

    console.log(`  📤 Transaksi terkirim: ${txLink(tx.hash)}`);
    console.log("  ⏳ Menunggu konfirmasi...");

    const receipt = await tx.wait();

    return { tx, receipt, amountOut, amountOutMin, infoIn, infoOut };
  }
}
