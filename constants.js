// ============================================================
//  CONSTANTS.JS — Alamat kontrak & ABI untuk Base Network
// ============================================================

// ── Alamat Kontrak di Base Mainnet ──────────────────────────
export const ADDRESSES = {
  // Uniswap V3 SwapRouter02
  SWAP_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",

  // Uniswap V3 Quoter V2
  QUOTER_V2: "0x3d4e44Eb1374240CE5F1B136588eDdB77284a1d",

  // Token populer di Base
  TOKENS: {
    WETH:  "0x4200000000000000000000000000000000000006",
    USDC:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT:  "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    DAI:   "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    CBETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  }
};

// ── ABI Minimal ERC-20 ──────────────────────────────────────
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// ── ABI WETH (Wrapped ETH) ──────────────────────────────────
export const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256 amount)",
];

// ── ABI Uniswap V3 SwapRouter02 ────────────────────────────
export const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn",           type: "address" },
          { name: "tokenOut",          type: "address" },
          { name: "fee",               type: "uint24"  },
          { name: "recipient",         type: "address" },
          { name: "amountIn",          type: "uint256" },
          { name: "amountOutMinimum",  type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "exactOutputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn",          type: "address" },
          { name: "tokenOut",         type: "address" },
          { name: "fee",              type: "uint24"  },
          { name: "recipient",        type: "address" },
          { name: "amountOut",        type: "uint256" },
          { name: "amountInMaximum",  type: "uint256" },
          { name: "sqrtPriceLimitX96",type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountIn", type: "uint256" }],
  },
];

// ── ABI Uniswap V3 QuoterV2 ────────────────────────────────
export const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn",            type: "address" },
          { name: "tokenOut",           type: "address" },
          { name: "amountIn",           type: "uint256" },
          { name: "fee",                type: "uint24"  },
          { name: "sqrtPriceLimitX96",  type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut",                   type: "uint256" },
      { name: "sqrtPriceX96After",           type: "uint160" },
      { name: "initializedTicksCrossed",     type: "uint32"  },
      { name: "gasEstimate",                 type: "uint256" },
    ],
  },
];
