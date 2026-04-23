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
    if (tokenAddress.toLowerCase() === "native" || tokenAddress === ethers.ZeroAddress) {
      const balance = await this.provider.getBalance(this.wallet.address);
      return { name: "Ethereum", symbol: "ETH", decimals: 18, balance };
    }

    const addr = tokenAddress.toLowerCase();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const balance = await contract.balanceOf(this.wallet.address);

    if (TOKEN_OVERRIDES[addr]) {
      return { ...TOKEN_OVERRIDES[addr], balance };
    }

    const [name, symbol, decimals] = await Promise.all([
      contract.name(), contract.symbol(), contract.decimals(),
    ]);
    return { name, symbol, decimals, balance };
  }

  async getQuote({ tokenIn, tokenOut, amountIn, fee }) {
    try {
      console.log("  🔍 Mencoba Quoter V1...");
      // Menambahkan sqrtPriceLimitX96: 0 sebagai argumen terakhir
      const amountOut = await this.quoterV1.quoteExactInputSingle.staticCall(
        tokenIn, tokenOut, fee, amountIn, 0
      );
      return amountOut;
    } catch (e1) {
      console.log(`  ⚠️  Quoter V1 gagal: ${e1.reason || "ERROR"}`);
      try {
        console.log("  🔍 Mencoba Quoter V2...");
        const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
        const result = await this.quoterV2.quoteExactInputSingle.staticCall(params);
        return result.amountOut;
      } catch (e2) {
        console.log(`  ⚠️  Quoter V2 gagal: ${e2.reason || "ERROR"}`);
        return null;
      }
    }
  }

  async approveToken(tokenAddress, amount) {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const allowance = await token.allowance(this.wallet.address, ADDRESSES.SWAP_ROUTER);
    
    if (allowance < amount) {
      console.log(`  🔓 Menyetujui penggunaan token...`);
      const tx = await token.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256);
      await tx.wait();
    }
  }

  async wrapETH(amount) {
    const weth = new ethers.Contract(ADDRESSES.TOKENS.WETH, WETH_ABI, this.wallet);
    console.log(`  🌀 Wrapping ETH menjadi WETH...`);
    const tx = await weth.deposit({ value: amount });
    await tx.wait();
  }

  async swap({
    tokenIn, tokenOut, amountIn,
    fee = 3000, slippage = 0.5, deadlineMin = 20, isNativeIn = false,
  }) {
    const effectiveIn = isNativeIn ? ADDRESSES.TOKENS.WETH : tokenIn;
    const infoIn      = await this.getTokenInfo(isNativeIn ? "native" : tokenIn);
    const infoOut     = await this.getTokenInfo(tokenOut);

    console.log(`\n  💰 Saldo ${infoIn.symbol}: ${formatAmount(infoIn.balance, infoIn.decimals)}`);

    if (infoIn.balance < amountIn) {
      throw new Error("Saldo tidak cukup!");
    }

    let amountOut = null; 
    let amountOutMin = 0n;

    try {
      amountOut = await this.getQuote({ tokenIn: effectiveIn, tokenOut, amountIn, fee });
      if (amountOut !== null && amountOut !== undefined) {
        amountOutMin = applySlippage(amountOut, slippage);
        console.log(`  📊 Estimasi output : ${formatAmount(amountOut,    infoOut.decimals)} ${infoOut.symbol}`);
        console.log(`  🛡️  Min output      : ${formatAmount(amountOutMin, infoOut.decimals)} ${infoOut.symbol}`);
      } else {
        console.log("  ⚠️  Quote tidak tersedia. Lanjut dengan min output 0.");
      }
    } catch (err) {
      console.log("  ⚠️  Gagal memproses quote harga.");
    }

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
      gasLimit  = (est * 135n) / 100n; // Menambah buffer gas 35%
    } catch {
      gasLimit = 400000n;
      console.log("  ⚠️  Gagal estimasi gas, pakai default: 400000");
    }

    console.log("\n  🚀 Mengirim transaksi swap...");
    const tx = await this.router.exactInputSingle(swapParams, { gasLimit });
    console.log(`  📤 Tx hash : ${txLink(tx.hash)}`);
    const receipt = await tx.wait();

    return { tx, receipt, amountOut, amountOutMin, infoIn, infoOut };
  }
} // TANDA KURUNG TUTUP INI SANGAT PENTING
