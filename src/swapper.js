import { ethers } from "ethers";
import { ADDRESSES, ERC20_ABI, WETH_ABI, SWAP_ROUTER_ABI, QUOTER_V2_ABI } from "./constants.js";
import { formatAmount, applySlippage, txLink } from "./utils.js";

// Info hardcoded untuk token yang kontraknya tidak standard
const TOKEN_OVERRIDES = {
  [ADDRESSES.TOKENS.WETH.toLowerCase()]: {
    name: "Wrapped Ether", symbol: "WETH", decimals: 18,
  },
  [ADDRESSES.TOKENS.USDC.toLowerCase()]: {
    name: "USD Coin", symbol: "USDC", decimals: 6,
  },
  [ADDRESSES.TOKENS.USDT.toLowerCase()]: {
    name: "Tether USD", symbol: "USDT", decimals: 6,
  },
  [ADDRESSES.TOKENS.DAI.toLowerCase()]: {
    name: "Dai Stablecoin", symbol: "DAI", decimals: 18,
  },
};

export class BaseSwapper {
  constructor(provider, wallet) {
    this.provider = provider;
    this.wallet   = wallet;
    this.router   = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
    this.quoter   = new ethers.Contract(ADDRESSES.QUOTER_V2,   QUOTER_V2_ABI,   provider);
  }

  async getTokenInfo(tokenAddress) {
    // Handle ETH native
    if (tokenAddress.toLowerCase() === "native") {
      const balance = await this.provider.getBalance(this.wallet.address);
      return { name: "Ethereum", symbol: "ETH", decimals: 18, balance, isNative: true };
    }

    const key      = tokenAddress.toLowerCase();
    const override = TOKEN_OVERRIDES[key];
    const token    = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);

    // Ambil saldo dulu (ini selalu ada)
    const balance = await token.balanceOf(this.wallet.address);

    if (override) {
      // Pakai data hardcoded, skip panggil name()/symbol()/decimals()
      return {
        name:     override.name,
        symbol:   override.symbol,
        decimals: override.decimals,
        balance,
        address:  tokenAddress,
        isNative: false,
      };
    }

    // Token tidak dikenal — coba ambil dari kontrak dengan fallback
    let name     = "Unknown";
    let symbol   = "???";
    let decimals = 18;

    try { name     = await token.name();                } catch {}
    try { symbol   = await token.symbol();              } catch {}
    try { decimals = Number(await token.decimals());    } catch {}

    return { name, symbol, decimals, balance, address: tokenAddress, isNative: false };
  }

  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    try {
      const result = await this.quoter.quoteExactInputSingle.staticCall({
        tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
      });
      return result[0];
    } catch (err) {
      throw new Error(
        `Gagal mendapat quote.\n` +
        `  Kemungkinan sebab:\n` +
        `  - Pool dengan fee ${fee} tidak ada. Coba ganti POOL_FEE ke 500 atau 10000\n` +
        `  - Alamat TOKEN_IN / TOKEN_OUT salah\n` +
        `  Detail: ${err.message}`
      );
    }
  }

  async approveToken(tokenAddress, amount) {
    const token     = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);
    if (allowance >= amount) {
      console.log("  ✅ Allowance sudah cukup, skip approve.");
      return null;
    }
    console.log("  🔓 Approving token untuk router...");
    const tx = await token.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256);
    await tx.wait();
    console.log(`  ✅ Approved: ${txLink(tx.hash)}`);
  }

  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log("  📦 Wrapping ETH → WETH...");
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
    console.log(`  ✅ Wrapped: ${txLink(tx.hash)}`);
  }

  async swap({
    tokenIn, tokenOut, amountIn,
    fee = 3000, slippage = 0.5, deadlineMin = 20, isNativeIn = false,
  }) {
    const effectiveIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;
    const infoIn      = await this.getTokenInfo(isNativeIn ? "native" : tokenIn);
    const infoOut     = await this.getTokenInfo(tokenOut);

    if (infoIn.balance < amountIn) {
      throw new Error(
        `Saldo tidak cukup!\n` +
        `  Punya  : ${formatAmount(infoIn.balance, infoIn.decimals)} ${infoIn.symbol}\n` +
        `  Butuh  : ${formatAmount(amountIn,       infoIn.decimals)} ${infoIn.symbol}`
      );
    }

    console.log("\n  🔍 Mengambil quote harga...");
    const amountOut    = await this.getQuote({ tokenIn: effectiveIn, tokenOut, amountIn, fee });
    const amountOutMin = applySlippage(amountOut, slippage);
    console.log(`  📊 Estimasi output : ${formatAmount(amountOut,    infoOut.decimals)} ${infoOut.symbol}`);
    console.log(`  🛡️  Min output      : ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);

    if (isNativeIn) await this.wrapETH(amountIn);
    await this.approveToken(effectiveIn, amountIn);

    const swapParams = {
      tokenIn:           effectiveIn,
      tokenOut,
      fee,
      recipient:         this.wallet.address,
      amountIn,
      amountOutMinimum:  amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    let gasLimit;
    try {
      const est = await this.router.exactInputSingle.estimateGas(swapParams);
      gasLimit  = (est * 120n) / 100n;
      console.log(`\n  ⛽ Gas estimasi: ${est} units`);
    } catch {
      gasLimit = 300000n;
      console.log("  ⚠️  Pakai gas default: 300000");
    }

    console.log("\n  🚀 Mengirim transaksi swap...");
    const tx      = await this.router.exactInputSingle(swapParams, { gasLimit });
    console.log(`  📤 Tx hash : ${txLink(tx.hash)}`);
    console.log("  ⏳ Menunggu konfirmasi blok...");
    const receipt = await tx.wait();

    return { tx, receipt, amountOut, amountOutMin, infoIn, infoOut };
  }
}
