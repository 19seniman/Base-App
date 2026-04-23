cat > src/swapper.js << 'EOF'
import { ethers } from "ethers";
import { ADDRESSES, ERC20_ABI, WETH_ABI, SWAP_ROUTER_ABI, QUOTER_V2_ABI } from "./constants.js";
import { formatAmount, applySlippage, getDeadline, txLink } from "./utils.js";

export class BaseSwapper {
  constructor(provider, wallet) {
    this.provider = provider;
    this.wallet   = wallet;
    this.router   = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);
    this.quoter   = new ethers.Contract(ADDRESSES.QUOTER_V2,   QUOTER_V2_ABI,   provider);
  }

  async getTokenInfo(tokenAddress) {
    const isNative = tokenAddress.toLowerCase() === "native";
    if (isNative) {
      const balance = await this.provider.getBalance(this.wallet.address);
      return { name: "Ethereum", symbol: "ETH", decimals: 18, balance, isNative: true };
    }
    const isWETH = tokenAddress.toLowerCase() === ADDRESSES.TOKENS.WETH.toLowerCase();
    const token  = new ethers.Contract(tokenAddress, isWETH ? WETH_ABI : ERC20_ABI, this.wallet);
    const [name, symbol, decimals, balance] = await Promise.all([
      token.name(), token.symbol(), token.decimals(), token.balanceOf(this.wallet.address),
    ]);
    return { name, symbol, decimals: Number(decimals), balance, address: tokenAddress, isNative: false };
  }

  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    try {
      const result = await this.quoter.quoteExactInputSingle.staticCall({
        tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
      });
      return result[0];
    } catch (err) {
      throw new Error(`Gagal mendapat quote: ${err.message}`);
    }
  }

  async approveToken(tokenAddress, amount) {
    const token     = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);
    if (allowance >= amount) return null;
    console.log("  🔓 Approving token...");
    const tx = await token.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256);
    await tx.wait();
    console.log(`  ✅ Approved: ${txLink(tx.hash)}`);
    return tx;
  }

  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log("  📦 Wrapping ETH → WETH...");
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
    console.log(`  ✅ Wrapped: ${txLink(tx.hash)}`);
    return tx;
  }

  async swap({ tokenIn, tokenOut, amountIn, fee=3000, slippage=0.5, deadlineMin=20, isNativeIn=false }) {
    const effectiveTokenIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;
    const infoIn  = await this.getTokenInfo(isNativeIn ? "native" : tokenIn);
    const infoOut = await this.getTokenInfo(tokenOut);

    if (infoIn.balance < amountIn) {
      throw new Error(`Saldo tidak cukup! Punya: ${formatAmount(infoIn.balance, infoIn.decimals)} ${infoIn.symbol}`);
    }

    console.log("\n  🔍 Mengambil quote...");
    const amountOut    = await this.getQuote({ tokenIn: effectiveTokenIn, tokenOut, amountIn, fee });
    const amountOutMin = applySlippage(amountOut, slippage);
    console.log(`  📊 Estimasi: ${formatAmount(amountOut, infoOut.decimals)} ${infoOut.symbol}`);
    console.log(`  🛡️  Min output: ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);

    if (isNativeIn) await this.wrapETH(amountIn);
    await this.approveToken(effectiveTokenIn, amountIn);

    const swapParams = {
      tokenIn: effectiveTokenIn, tokenOut, fee,
      recipient: this.wallet.address,
      amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n,
    };

    let gasEstimate;
    try {
      gasEstimate = await this.router.exactInputSingle.estimateGas(swapParams);
    } catch { gasEstimate = 300000n; }

    console.log("\n  🚀 Mengirim transaksi...");
    const tx      = await this.router.exactInputSingle(swapParams, { gasLimit: (gasEstimate * 120n) / 100n });
    console.log(`  📤 Tx: ${txLink(tx.hash)}`);
    console.log("  ⏳ Menunggu konfirmasi...");
    const receipt = await tx.wait();
    return { tx, receipt, amountOut, amountOutMin, infoIn, infoOut };
  }
}
EOF
