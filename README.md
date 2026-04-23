# 🔵 Base Network Swap Bot

Bot Node.js untuk melakukan swap/trade token di **Base Network** menggunakan **Uniswap V3**.

---

## 📦 Struktur Project

```
base-swap-bot/
├── src/
│   ├── index.js        ← Entry point utama
│   ├── swapper.js      ← Mesin swap (logika utama)
│   ├── constants.js    ← Alamat kontrak & ABI
│   └── utils.js        ← Helper functions
├── .env.example        ← Template konfigurasi
├── package.json
└── README.md
```

---

## 🚀 Cara Pakai

### 1. Install dependencies

```bash
npm install
```

### 2. Setup konfigurasi

```bash
cp .env.example .env
```

Lalu edit file `.env`:

```env
PRIVATE_KEY=your_private_key_tanpa_0x
RPC_URL=https://mainnet.base.org
TOKEN_IN=0x4200000000000000000000000000000000000006   # WETH
TOKEN_OUT=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  # USDC
AMOUNT_IN=1000000000000000                             # 0.001 ETH dalam wei
SLIPPAGE_PERCENT=0.5
POOL_FEE=3000
DEADLINE_MINUTES=20
```

### 3. Cek saldo wallet

```bash
npm run check
```

### 4. Jalankan swap

```bash
npm run swap
```

---

## ⚙️ Konfigurasi Parameter

| Parameter          | Penjelasan                                   | Contoh nilai            |
|--------------------|----------------------------------------------|-------------------------|
| `PRIVATE_KEY`      | Private key wallet (RAHASIA!)                | `abc123...`             |
| `RPC_URL`          | RPC endpoint Base network                    | `https://mainnet.base.org` |
| `TOKEN_IN`         | Alamat token yang dijual                     | Alamat WETH             |
| `TOKEN_OUT`        | Alamat token yang dibeli                     | Alamat USDC             |
| `AMOUNT_IN`        | Jumlah token dalam wei (unit terkecil)       | `1000000000000000`      |
| `SLIPPAGE_PERCENT` | Toleransi slippage (%)                       | `0.5`                   |
| `POOL_FEE`         | Fee tier Uniswap V3                          | `500`, `3000`, `10000`  |
| `DEADLINE_MINUTES` | Batas waktu transaksi (menit)               | `20`                    |
| `AUTO_CONFIRM`     | Skip konfirmasi manual (`true`/`false`)      | `false`                 |

---

## 🪙 Token Populer di Base

| Token  | Alamat Kontrak                               |
|--------|----------------------------------------------|
| WETH   | `0x4200000000000000000000000000000000000006` |
| USDC   | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDT   | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |
| DAI    | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` |
| cbETH  | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |

---

## 💡 Contoh Penggunaan

### Swap 0.001 ETH → USDC

```env
TOKEN_IN=0x4200000000000000000000000000000000000006
TOKEN_OUT=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
AMOUNT_IN=1000000000000000
POOL_FEE=500
```

### Swap USDC → WETH

```env
TOKEN_IN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
TOKEN_OUT=0x4200000000000000000000000000000000000006
AMOUNT_IN=5000000    # 5 USDC (6 desimal)
POOL_FEE=500
```

---

## 🔗 RPC Gratis untuk Base

| Provider | URL                                 |
|----------|-------------------------------------|
| Public   | `https://mainnet.base.org`          |
| Alchemy  | `https://base-mainnet.g.alchemy.com/v2/YOUR_KEY` |
| Infura   | `https://base-mainnet.infura.io/v3/YOUR_KEY`     |

---

## ⚠️ Peringatan Keamanan

- ❌ **JANGAN** commit file `.env` ke GitHub
- ❌ **JANGAN** bagikan private key ke siapapun
- ✅ Gunakan wallet terpisah khusus untuk bot
- ✅ Selalu test dengan jumlah kecil dahulu
- ✅ Pastikan kamu punya ETH untuk gas fee

---

## 🛠️ Troubleshooting

**Error: "Gagal mendapat quote"**
→ Pool dengan fee tier tersebut mungkin tidak ada. Coba ganti `POOL_FEE` ke `500` atau `10000`.

**Error: "Saldo tidak cukup"**
→ Cek saldo tokenmu dengan `npm run check`.

**Error: "Gagal terhubung ke RPC"**
→ Cek `RPC_URL` di file `.env`. Coba ganti ke `https://mainnet.base.org`.

---

## 📄 Lisensi

MIT License - Gunakan dengan bijak dan tanggung jawab sendiri.
