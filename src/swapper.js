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

  async getTokenInfo(tokenAddress) {
    if (tokenAddress.toLowerCase() === "native" || tokenAddress === ADDRESSES.TOKENS.WETH) {
      const bal = await this.provider.getBalance(this.wallet.address);
      return { ...TOKEN_OVERRIDES[ADDRESSES.TOKENS.WETH.toLowerCase()], balance: bal };
    }
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const [name, symbol, decimals, balance] = await Promise.all([
      contract.name(), contract.symbol(), contract.decimals(), contract.balanceOf(this.wallet.address)
    ]);
    return { name, symbol, decimals: Number(decimals), balance };
  }

  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    // Coba Quoter V1
    try {
      console.log("  🔍 Mencoba Quoter V1...");
      return await this.quoterV1.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
    } catch (e1) {
      console.log(`  ⚠️  Quoter V1 gagal: ${e1.reason || "ERROR"}`);
      // Coba Quoter V2
      try {
        console.log("  🔍 Mencoba Quoter V2...");
        const res = await this.quoterV2.quoteExactInputSingle.staticCall({
          tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0
        });
        return res.amountOut;
      } catch (e2) {
        console.log(`  ⚠️  Quoter V2 gagal: ${e2.reason || "ERROR"}`);
        return null;
      }
    }
  }

  async approveToken(tokenAddress, amount) {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await contract.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);
    if (allowance < amount) {
      console.log(`  🔓 Approving token...`);
      const tx = await contract.approve(ADDRESSES.SWAP_ROUTER, amount);
      await tx.wait();
    }
  }

  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log(`  📦 Wrapping ETH ke WETH...`);
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
  }

  async swap({ tokenIn, tokenOut, amountIn, fee = 3000, slippage = 0.5, isNativeIn = false }) {
    const effectiveIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;
    const infoOut = await this.getTokenInfo(tokenOut);
    
    let amountOut = null;
    let amountOutMin = 0n;

    try {
      amountOut = await this.getQuote({ tokenIn: effectiveIn, tokenOut, amountIn, fee });
      if (amountOut) {
        amountOutMin = applySlippage(amountOut, slippage);
        console.log(`  📊 Estimasi: ${formatAmount(amountOut, infoOut.decimals)} | Min: ${formatAmount(amountOutMin, infoOut.decimals)}`);
      }
    } catch (e) {
      console.log("  ⚠️  Quote gagal, lanjut tanpa slippage protection.");
    }

    if (isNativeIn) await this.wrapETH(amountIn);
    await this.approveToken(effectiveIn, amountIn);

    const params = {
      tokenIn: effectiveIn,
      tokenOut,
      fee,
      recipient: this.wallet.address,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0,
    };

    const tx = await this.router.exactInputSingle(params, { gasLimit: 400000 });
    const receipt = await tx.wait();
    return { tx, receipt };
  }
}
