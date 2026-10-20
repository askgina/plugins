#!/usr/bin/env python3
"""
lp_pool_scan.py: portable daily LP pool scanner (public data only, read-only, stdlib only).
Usage: python3 lp_pool_scan.py --universe {allowlist,top,wide} [--allowlist FILE] [--out DIR] [--top N] [--min-tvl X] [--format {md,json,both}]
Never signs or sends transactions; only HTTP GETs to public APIs and eth_call/eth_getLogs to a public RPC.
Universe: allowlist.json (Robinhood Chain 4663 / Base 8453 / Ethereum 1 Uniswap v3/v4, Solana Raydium CLMM/CPMM).
Sources: GeckoTerminal, DexScreener, Raydium API v3, Robinhood Chain / Base / Ethereum public RPCs (eth_call/eth_getLogs only),
GoPlus (EVM token security, chains 4663/8453/1), RugCheck (Solana token risk).
No transactions are ever sent. See README.md for formulas and gaps.
"""
import json, math, os, sys, time, gzip, datetime as dt, argparse, traceback, threading
import urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ALLOW = os.environ.get("LP_SCAN_ALLOWLIST") or os.path.join(HERE, "example_allowlist.json")
OUT_DIR = SNAP_DIR = REPORT_DIR = CACHE_DIR = None

def set_paths(out_dir, allowlist=None):
    global OUT_DIR, SNAP_DIR, REPORT_DIR, CACHE_DIR, ALLOW
    OUT_DIR = os.path.abspath(out_dir)
    SNAP_DIR, REPORT_DIR, CACHE_DIR = (os.path.join(OUT_DIR, x) for x in ("snapshots", "reports", "cache"))
    for d in (SNAP_DIR, REPORT_DIR, CACHE_DIR):
        os.makedirs(d, exist_ok=True)
    if allowlist:
        ALLOW = os.path.abspath(allowlist)
GT = "https://api.geckoterminal.com/api/v2"
DS = "https://api.dexscreener.com/latest/dex"
RAY = "https://api-v3.raydium.io"
RH_RPC = os.environ.get("RH_RPC", "https://rpc.mainnet.chain.robinhood.com")
GOPLUS = "https://api.gopluslabs.io/api/v1/token_security/4663"
RUGCHECK = "https://api.rugcheck.xyz/v1/tokens/{}/report/summary"
V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V4_STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"
EVM = ("robinhood", "base", "eth")
CHAINS = ("robinhood", "base", "eth", "solana")      # report order
CHAIN_CFG = {
    "robinhood": {"rpc": RH_RPC, "pm": V4_POOL_MANAGER, "sv": V4_STATE_VIEW, "posm": None, "goplus": 4663, "ds": "robinhood",
                  "label": "Robinhood Chain", "short": "RH", "swap_blocks": 200000},
    "base": {"rpc": os.environ.get("BASE_RPC", "https://base-rpc.publicnode.com"), "pm": "0x498581ff718922c3f8e6a244956af099b2652b2b",
             "sv": "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71", "posm": "0x7c5f5a4bbd8fd63184577525326123b519429bdc", "goplus": 8453,
             "ds": "base", "label": "Base", "short": "BASE", "swap_blocks": 10000},      # publicnode getLogs: <= ~10k blocks
    "eth": {"rpc": os.environ.get("ETH_RPC", "https://ethereum-rpc.publicnode.com"), "pm": "0x000000000004444c5dc75cb358380d2e3de08a90",
            "sv": "0x7ffe42c4a5deea5b0fec41c94c136cf115597227", "posm": "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e", "goplus": 1,
            "ds": "ethereum", "label": "Ethereum", "short": "ETH", "swap_blocks": 2000},  # publicnode getLogs: <= ~5k blocks
    "solana": {"ds": "solana", "label": "Solana", "short": "SOL"},
}
_TL = threading.local()   # current EVM chain for rpc_batch (set per worker in fetch_state)
def cur_chain(): return getattr(_TL, "chain", "robinhood")
def nkey(chain, a): return a.lower() if (chain in EVM and a) else a
TOPIC_V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
TOPIC_V4_INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
TRADE_SIZES = [1_000_000, 5_000_000, 10_000_000]
STABLES = {"USDG", "USDC", "USDT", "PYUSD", "USD1", "USDS", "DAI", "USDE", "FDUSD", "USDH", "USDC.E", "USDT0", "AUSD", "USDB"}
MIN_TICK, MAX_TICK = -887272, 887272
TYPICAL_RANGE = 0.10   # +/-10% reference range (Raydium defaultRange) for the "typical-range" IL column
LOG = []

QUIET = [False]

def log(*a):
    s = " ".join(str(x) for x in a)
    LOG.append(s)
    if not QUIET[0]:
        print(s, file=sys.stderr, flush=True)

# ---------------------------------------------------------------- HTTP with retry + per-host pacing
_last_call = {}
PACE = {"api.geckoterminal.com": 2.1, "api.dexscreener.com": 0.25, "api-v3.raydium.io": 0.3, "api.orca.so": 0.3,
        "dlmm.datapi.meteora.ag": 0.3, "api.xstocks.fi": 0.5, "api.robinhood.com": 0.5,
        "api.gopluslabs.io": 2.5, "api.rugcheck.xyz": 1.2, "rpc.mainnet.chain.robinhood.com": 0.15,
        "base-rpc.publicnode.com": 0.15, "ethereum-rpc.publicnode.com": 0.15}
RAW = {}  # raw responses kept for audit

import threading
_locks = {}
_glock = threading.Lock()

def _pace(host):
    with _glock:
        lk = _locks.setdefault(host, threading.Lock())
    with lk:
        gap = PACE.get(host, 0.5) - (time.time() - _last_call.get(host, 0))
        if gap > 0:
            time.sleep(gap)
        _last_call[host] = time.time()

CACHE_TTL = [120 * 60]          # seconds; GET responses are cached on disk so an interrupted run resumes
LONG_TTL = {"api.gopluslabs.io": [36 * 3600], "api.rugcheck.xyz": [36 * 3600]}   # token security changes slowly (--security-ttl)
CACHE_STATS = {"hits": 0, "oldest": None}

def _cache_path(url):
    import hashlib
    return os.path.join(CACHE_DIR, "http", hashlib.sha1(url.encode()).hexdigest() + ".json")

def http(url, data=None, headers=None, retries=5, key=None):
    host = urllib.parse.urlparse(url).netloc
    cp = _cache_path(url) if (data is None and CACHE_TTL[0] > 0 and CACHE_DIR) else None
    ttl = max(CACHE_TTL[0], (LONG_TTL.get(host) or [0])[0])
    if cp and os.path.exists(cp) and time.time() - os.path.getmtime(cp) < ttl:
        try:
            body = json.load(open(cp))
            CACHE_STATS["hits"] += 1
            mt = os.path.getmtime(cp)
            CACHE_STATS["oldest"] = mt if CACHE_STATS["oldest"] is None else min(CACHE_STATS["oldest"], mt)
            if key: RAW[key] = body
            return body
        except Exception:
            pass
    for attempt in range(retries):
        _pace(host)
        try:
            h = {"Accept": "application/json", "User-Agent": "lp-scan/1.0 (public research)"}
            if data is not None:
                h["Content-Type"] = "application/json"
            h.update(headers or {})
            req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h)
            with urllib.request.urlopen(req, timeout=40) as r:
                body = json.loads(r.read().decode())
            if key:
                RAW[key] = body
            if cp:
                os.makedirs(os.path.dirname(cp), exist_ok=True)
                tmp = cp + f".{threading.get_ident()}.tmp"
                json.dump(body, open(tmp, "w")); os.replace(tmp, cp)
            return body
        except urllib.error.HTTPError as e:
            wait = (65 if "geckoterminal" in host else 20) if e.code == 429 else 3 * (attempt + 1)
            if e.code in (400, 404) and attempt >= 1:
                log(f"  HTTP {e.code} {url[:120]} (giving up)")
                return None
            log(f"  HTTP {e.code} {url[:120]} retry in {wait}s")
            time.sleep(wait)
        except Exception as e:
            log(f"  ERR {type(e).__name__} {url[:120]}: {e} retry")
            time.sleep(3 * (attempt + 1))
    log(f"  FAILED {url[:140]}")
    return None

def f(x):
    try:
        if x is None or x == "":
            return None
        v = float(x)
        return v if math.isfinite(v) else None
    except Exception:
        return None

# ---------------------------------------------------------------- EVM RPC helpers (read-only)
def rpc_batch(calls, chunk=40):
    """calls: list of (method, params). Returns list of results (None on error)."""
    out = []
    for i in range(0, len(calls), chunk):
        part = calls[i:i + chunk]
        payload = [{"jsonrpc": "2.0", "id": j, "method": m, "params": p} for j, (m, p) in enumerate(part)]
        res = http(CHAIN_CFG[cur_chain()]["rpc"], data=payload)
        if not isinstance(res, list):
            out += [None] * len(part)
            continue
        byid = {r.get("id"): r.get("result") for r in res}
        out += [byid.get(j) for j in range(len(part))]
    return out

def eth_call(to, data):
    return ("eth_call", [{"to": to, "data": data}, "latest"])

def words(h):
    h = h[2:] if h and h.startswith("0x") else (h or "")
    return [h[i:i + 64] for i in range(0, len(h), 64)]

def u(w): return int(w, 16)
def s256(w):
    v = int(w, 16)
    return v - (1 << 256) if v >= 1 << 255 else v
def enc_int(v): return format(v & ((1 << 256) - 1), "064x")
def addr_of(w): return "0x" + w[-40:]

# ---------------------------------------------------------------- concentrated-liquidity swap walk
def tick_to_s(t): return 1.0001 ** (t / 2.0)

def walk(s0, L0, cur_tick, ticks, amount_in, zero_for_one, lo_edge, hi_edge, target_s=None):
    """Fee-less constant-liquidity-segment swap simulation in raw units, s = sqrt(raw price token1/token0).
    ticks: sorted list of (tick, liquidityNet). Returns dict(amount_in_used, amount_out, s_end, exhausted).
    If target_s is given, walks until price reaches target and returns the input needed."""
    s, L, rem, out = s0, L0, amount_in, 0.0
    used = 0.0
    if zero_for_one:
        cand = [t for t in ticks if t[0] <= cur_tick][::-1]
        bounds = cand + [(lo_edge, None)]
    else:
        cand = [t for t in ticks if t[0] > cur_tick]
        bounds = cand + [(hi_edge, None)]
    for t, net in bounds:
        st = tick_to_s(t)
        if target_s is not None:
            st = max(st, target_s) if zero_for_one else min(st, target_s)
        if L > 0:
            if zero_for_one:
                need = L * (1 / st - 1 / s) if st < s else 0.0
                if rem is not None and rem < need:
                    s_new = 1 / (1 / s + rem / L)
                    out += L * (s - s_new); used += rem
                    return dict(amount_in_used=used, amount_out=out, s_end=s_new, exhausted=False)
                out += L * (s - st); used += need
                if rem is not None: rem -= need
            else:
                need = L * (st - s) if st > s else 0.0
                if rem is not None and rem < need:
                    s_new = s + rem / L
                    out += L * (1 / s - 1 / s_new); used += rem
                    return dict(amount_in_used=used, amount_out=out, s_end=s_new, exhausted=False)
                out += L * (1 / s - 1 / st); used += need
                if rem is not None: rem -= need
        s = st
        if target_s is not None and abs(s - target_s) < 1e-15 * max(1, target_s):
            return dict(amount_in_used=used, amount_out=out, s_end=s, exhausted=False)
        if net is None:
            return dict(amount_in_used=used, amount_out=out, s_end=s, exhausted=True)
        L = L - net if zero_for_one else L + net
        if L < 0: L = 0.0
    return dict(amount_in_used=used, amount_out=out, s_end=s, exhausted=True)

def depth_metrics(s0, L0, cur_tick, ticks, dec0, dec1, p0usd, p1usd, lo_edge, hi_edge):
    """Price impact (excl. fee) for $1M/$5M/$10M sells of token0 and token1 + USD depth to move price +/-2%."""
    res = {"sizes": {}, "depth_2pct_usd": {}}
    if not (p0usd and p1usd and s0 and L0 is not None):
        return None
    mid = s0 * s0  # raw token1 per raw token0
    for usd in TRADE_SIZES:
        r = {}
        for side, zfo in (("sell_token0", True), ("sell_token1", False)):
            amt = usd / (p0usd if zfo else p1usd) * 10 ** (dec0 if zfo else dec1)
            w = walk(s0, L0, cur_tick, ticks, amt, zfo, lo_edge, hi_edge)
            if w["exhausted"] or w["amount_in_used"] <= 0:
                r[side] = {"impact_pct": None, "exhausted": True,
                           "fillable_usd": w["amount_in_used"] / 10 ** (dec0 if zfo else dec1) * (p0usd if zfo else p1usd)}
                continue
            exec_p = w["amount_out"] / w["amount_in_used"]
            ref = mid if zfo else 1 / mid
            r[side] = {"impact_pct": round((1 - exec_p / ref) * 100, 4), "exhausted": False,
                       "end_price_move_pct": round(((w["s_end"] / s0) ** 2 - 1) * 100, 3)}
        imps = [v["impact_pct"] for v in r.values() if v.get("impact_pct") is not None]
        r["worst_impact_pct"] = None if any(v.get("exhausted") for v in r.values() if isinstance(v, dict)) else (max(imps) if imps else None)
        r["any_exhausted"] = any(v.get("exhausted") for v in r.values() if isinstance(v, dict))
        res["sizes"][str(usd)] = r
    for side, zfo in (("down_2pct_sell_token0", True), ("up_2pct_sell_token1", False)):
        tgt = s0 * math.sqrt(0.98 if zfo else 1.02)
        w = walk(s0, L0, cur_tick, ticks, None, zfo, lo_edge, hi_edge, target_s=tgt)
        usd = w["amount_in_used"] / 10 ** (dec0 if zfo else dec1) * (p0usd if zfo else p1usd)
        res["depth_2pct_usd"][side] = None if w["exhausted"] else round(usd, 0)
    return res

# ---------------------------------------------------------------- data loaders
def load_pools():
    a = json.load(open(ALLOW))
    pools = []
    for proto, lst in a.get("robinhood_chain_4663", {}).items():
        for p in lst:
            pools.append({"chain": "robinhood", "protocol": proto, "address": p.lower()})
    for ch, k in (("base", "base_8453"), ("eth", "ethereum_1")):
        for proto, lst in a.get(k, {}).items():
            if ch == "base" and proto not in ("uniswap-v3", "uniswap-v4"): continue   # Base: Uniswap v3/v4 only (no Aerodrome etc., not even watch-only)
            for p in lst:
                pools.append({"chain": ch, "protocol": proto, "address": p.lower()})
    for proto, lst in a.get("solana", {}).items():
        for p in lst:
            pools.append({"chain": "solana", "protocol": proto, "address": p})
    return pools

def gt_multi(network, addrs):
    out = {}
    for i in range(0, len(addrs), 30):
        part = addrs[i:i + 30]
        d = http(f"{GT}/networks/{network}/pools/multi/{','.join(part)}?include=base_token,quote_token,dex",
                 key=f"gt_multi_{network}_{i}")
        if not d:
            continue
        inc = {x["id"]: x["attributes"] for x in d.get("included", [])}
        for x in d.get("data", []):
            at = dict(x["attributes"])
            rel = x.get("relationships", {})
            at["_base"] = inc.get(rel.get("base_token", {}).get("data", {}).get("id"), {})
            at["_quote"] = inc.get(rel.get("quote_token", {}).get("data", {}).get("id"), {})
            at["_dex"] = rel.get("dex", {}).get("data", {}).get("id")
            key = at["address"].lower() if network != "solana" else at["address"]
            out[key] = at
            learn_evm_stock(network, at["_base"]); learn_evm_stock(network, at["_quote"])
    return out

def ds_pairs(chain, addrs):
    out = {}
    for i in range(0, len(addrs), 30):
        d = http(f"{DS}/pairs/{chain}/{','.join(addrs[i:i + 30])}", key=f"ds_{chain}_{i}")
        for p in (d or {}).get("pairs") or []:
            k = p["pairAddress"].lower() if chain != "solana" else p["pairAddress"]
            out[k] = p
    return out

def ray_info(ids):
    out = {}
    for i in range(0, len(ids), 20):
        d = http(f"{RAY}/pools/info/ids?ids={','.join(ids[i:i + 20])}", key=f"ray_info_{i}")
        for p in (d or {}).get("data") or []:
            if p:
                out[p["id"]] = p
    return out

def gt_ohlcv(network, addr, currency, timeframe="hour", limit=720):
    d = http(f"{GT}/networks/{network}/pools/{addr}/ohlcv/{timeframe}?aggregate=1&limit={limit}&currency={currency}",
             key=f"gt_ohlcv_{currency}_{addr}")
    try:
        return sorted(d["data"]["attributes"]["ohlcv_list"], key=lambda r: r[0])
    except Exception:
        return None

def realized_vol(ohlcv_hourly, now_ts):
    """Daily closes (UTC day buckets, last candle per day) over last 30d -> stdev of log returns."""
    if not ohlcv_hourly:
        return None, 0
    closes = {}
    for ts, o, h, l, c, v in ohlcv_hourly:
        if ts >= now_ts - 31 * 86400 and c and c > 0:
            closes[int(ts // 86400)] = c  # sorted asc -> last per day wins
    days = sorted(closes)
    if len(days) < 2:
        return None, 0
    # forward-fill missing days (no trades -> unchanged price)
    filled, last = [], None
    for d in range(days[0], days[-1] + 1):
        last = closes.get(d, last)
        filled.append(last)
    rets = [math.log(filled[i] / filled[i - 1]) for i in range(1, len(filled))]
    if len(rets) < 7:
        return None, len(rets)
    m = sum(rets) / len(rets)
    var = sum((r - m) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var), len(rets)

# ---------------------------------------------------------------- Robinhood on-chain (v3 / v4)
def bitmap_ticks(word_results, spacing, w_lo):
    ticks = []
    for k, res in enumerate(word_results):
        if not res:
            continue
        bm = int(res, 16)
        if bm == 0:
            continue
        w = w_lo + k
        for bit in range(256):
            if bm >> bit & 1:
                ticks.append((w * 256 + bit) * spacing)
    return sorted(ticks)

def word_range(tick, spacing, span_ticks):
    comp_lo = math.floor((tick - span_ticks) / spacing)
    comp_hi = math.floor((tick + span_ticks) / spacing)
    return max(comp_lo >> 8, -3466), min(comp_hi >> 8, 3466)

SPAN_TICKS = 46055  # ln(100)/ln(1.0001): scan liquidity for prices within 1/100x .. 100x of spot

def v3_state(addr):
    sel = {"slot0": "0x3850c7bd", "liquidity": "0x1a686502", "tickSpacing": "0xd0c93a7c", "fee": "0xddca3f43",
           "token0": "0x0dfe1681", "token1": "0xd21220a7"}
    names = list(sel)
    r = rpc_batch([eth_call(addr, sel[n]) for n in names])
    d = dict(zip(names, r))
    if not d["slot0"] or not d["liquidity"]:
        return None
    w = words(d["slot0"])
    st = {"sqrtPriceX96": u(w[0]), "tick": s256(w[1]), "feeProtocol": u(w[5]), "liquidity": u(words(d["liquidity"])[0]),
          "tickSpacing": s256(words(d["tickSpacing"])[0]), "fee": u(words(d["fee"])[0]),
          "token0": addr_of(words(d["token0"])[0]), "token1": addr_of(words(d["token1"])[0])}
    fp0, fp1 = st["feeProtocol"] % 16, st["feeProtocol"] >> 4
    # v3: protocol takes 1/feeProtocol of swap fee per side (0 = off)
    st["lp_fee_share"] = 1 - 0.5 * ((1 / fp0 if fp0 else 0) + (1 / fp1 if fp1 else 0))
    lo, hi = word_range(st["tick"], st["tickSpacing"], SPAN_TICKS)
    wr = rpc_batch([eth_call(addr, "0x5339c296" + enc_int(wi)) for wi in range(lo, hi + 1)])
    tks = bitmap_ticks(wr, st["tickSpacing"], lo)
    tr = rpc_batch([eth_call(addr, "0xf30dba93" + enc_int(t)) for t in tks])
    ticks = []
    for t, res in zip(tks, tr):
        if res:
            ticks.append((t, s256(words(res)[1])))
    st["ticks"] = ticks
    st["window"] = ((lo * 256) * st["tickSpacing"], ((hi + 1) * 256) * st["tickSpacing"] - 1)
    st["words_scanned"] = hi - lo + 1
    return st

def block_at(ts):
    latest = rpc_batch([("eth_getBlockByNumber", ["latest", False])])[0]
    hi = int(latest["number"], 16); lo = 0
    tlat = int(latest["timestamp"], 16)
    if ts >= tlat:
        return hi
    while hi - lo > 2000:
        mid = (lo + hi) // 2
        b = rpc_batch([("eth_getBlockByNumber", [hex(mid), False])])[0]
        if b and int(b["timestamp"], 16) < ts:
            lo = mid
        else:
            hi = mid
    return lo

def v4_key(pool_id, created_ts, cache):
    ch = cur_chain(); cfg = CHAIN_CFG[ch]
    ck = pool_id if ch == "robinhood" else f"{ch}:{pool_id}"
    if ck in cache:
        return cache[ck]
    if cfg.get("posm"):   # Base/Ethereum: PositionManager.poolKeys(bytes25) (eth_call; public RPC getLogs ranges are too small)
        r = rpc_batch([eth_call(cfg["posm"], "0x86b6be7d" + pool_id[2:52] + "0" * 14)])[0]
        w = words(r) if r else []
        if len(w) >= 5 and s256(w[3]) != 0:
            key = {"currency0": addr_of(w[0]), "currency1": addr_of(w[1]), "fee": u(w[2]), "tickSpacing": s256(w[3]),
                   "hooks": addr_of(w[4]), "source": "PositionManager.poolKeys"}
            cache[ck] = key
            return key
        return None
    if not created_ts:
        return None
    b = block_at(created_ts)
    for lo, hi in ((b - 300000, b + 300000), (b - 5000000, b + 4999999)):
        r = rpc_batch([("eth_getLogs", [{"address": cfg["pm"], "fromBlock": hex(max(lo, 0)), "toBlock": hex(hi),
                                          "topics": [TOPIC_V4_INIT, pool_id]}])])[0]
        if r:
            lg = r[0]; w = words(lg["data"])
            key = {"currency0": "0x" + lg["topics"][2][-40:], "currency1": "0x" + lg["topics"][3][-40:],
                   "fee": u(w[0]), "tickSpacing": s256(w[1]), "hooks": addr_of(w[2]),
                   "init_block": int(lg["blockNumber"], 16), "init_tx": lg["transactionHash"]}
            cache[ck] = key
            return key
    return None

def v4_state(pool_id, key):
    pid = pool_id[2:]; V4_STATE_VIEW = CHAIN_CFG[cur_chain()]["sv"]
    r = rpc_batch([eth_call(V4_STATE_VIEW, "0xc815641c" + pid), eth_call(V4_STATE_VIEW, "0xfa6793d5" + pid)])
    if not r[0] or not r[1]:
        return None
    w = words(r[0])
    sp = key["tickSpacing"]
    st = {"sqrtPriceX96": u(w[0]), "tick": s256(w[1]), "protocolFee": u(w[2]), "lpFee": u(w[3]),
          "liquidity": u(words(r[1])[0]), "tickSpacing": sp, "fee": key["fee"],
          "token0": key["currency0"], "token1": key["currency1"], "hooks": key["hooks"]}
    # v4: protocolFee (pips, 12 bits per direction) is charged on top of lpFee; lpFee accrues fully to LPs
    st["protocol_fee_pips"] = [st["protocolFee"] & 0xFFF, st["protocolFee"] >> 12]
    st["lp_fee_share"] = 1.0
    lo, hi = word_range(st["tick"], sp, SPAN_TICKS)
    wr = rpc_batch([eth_call(V4_STATE_VIEW, "0x1c7ccb4c" + pid + enc_int(wi)) for wi in range(lo, hi + 1)])
    tks = bitmap_ticks(wr, sp, lo)
    tr = rpc_batch([eth_call(V4_STATE_VIEW, "0xcaedab54" + pid + enc_int(t)) for t in tks])
    st["ticks"] = [(t, s256(words(res)[1])) for t, res in zip(tks, tr) if res]
    st["window"] = ((lo * 256) * sp, ((hi + 1) * 256) * sp - 1)
    st["words_scanned"] = hi - lo + 1
    return st

def v4_recent_swap_fees(pool_id, blocks=None):
    """Fee (pips) actually charged, from PoolManager Swap events in the last `blocks` blocks (dynamic-fee pools)."""
    bn = rpc_batch([("eth_blockNumber", [])])[0]
    if not bn: return None
    b = int(bn, 16); cfg = CHAIN_CFG[cur_chain()]; blocks = blocks or cfg["swap_blocks"]
    r = rpc_batch([("eth_getLogs", [{"address": cfg["pm"], "fromBlock": hex(b - blocks), "toBlock": hex(b),
                                      "topics": [TOPIC_V4_SWAP, pool_id]}])])[0]
    if not r: return None
    return [u(words(x["data"])[5]) for x in r]

def erc20_decimals(addrs):
    out = {}
    addrs = [a for a in addrs if a]
    r = rpc_batch([eth_call(a, "0x313ce567") for a in addrs if a != "0x" + "0" * 40])
    i = 0
    for a in addrs:
        if a == "0x" + "0" * 40:
            out[a] = 18
        else:
            out[a] = u(words(r[i])[0]) if r[i] else None
            i += 1
    return out

# ---------------------------------------------------------------- security sources
def goplus(addrs, chain="robinhood"):
    GOPLUS = f"https://api.gopluslabs.io/api/v1/token_security/{CHAIN_CFG[chain]['goplus']}"
    out = {}
    addrs = sorted(set(a for a in addrs if a and a != "0x" + "0" * 40))
    for i, a in enumerate(addrs):   # free tier: one address per request is reliable
        d = http(f"{GOPLUS}?contract_addresses={a}", key=f"goplus_{a}")
        for k, v in ((d or {}).get("result") or {}).items():
            out[k.lower()] = v
    return out

def rugcheck(mints, cache):
    out = {}
    for m in sorted(set(mints)):
        d = http(RUGCHECK.format(m), retries=3, key=f"rugcheck_{m}")
        if d:
            out[m] = d
    return out

# ---------------------------------------------------------------- registries (canonical tokenized-stock lists)
RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
SEC_SKIP = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"}
RAYDIUM_CPMM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
REG = {"rh": {}, "xstocks": {}, "ondo": {}, "evm": {"base": {}, "eth": {}}}
BASE_STOCK_PREFIX = "0xb2000000000000000000"   # Base tokenized-equity contracts use this vanity prefix (e.g. AAPL 0xb200…d1fb)
COINBASE_STOCKS_URL = "https://api.coinbase.com/v1/tokenized-stocks"   # official Coinbase Tokenized Stock list (Base; ticker + 'c', e.g. NVDAc)
COINBASE_STOCKS_CACHE = os.environ.get("LP_SCAN_CB_CACHE", "/workspace/cb_all.json")   # list of token dicts; refreshed on every successful fetch
CB_ISSUER = "Coinbase Tokenized Stock"

def load_coinbase_stocks():
    """Seed REG['evm']['base'] from Coinbase's official list (paginated via next_page_token). Falls back to the cached JSON.
    The BASE_STOCK_PREFIX rule in learn_evm_stock stays as a backup for tokens missing from the list."""
    toks, tok, ok = [], None, True
    for _ in range(50):
        url = COINBASE_STOCKS_URL + (f"?page_token={urllib.parse.quote(tok)}" if tok else "")
        d = http(url, retries=3)
        if not isinstance(d, dict) or not isinstance(d.get("tokens"), list): ok = False; break
        toks += d["tokens"]; tok = d.get("next_page_token")
        if not tok: break
    src = "api"
    if ok and toks:
        try:
            tmp = COINBASE_STOCKS_CACHE + ".tmp"; json.dump(toks, open(tmp, "w")); os.replace(tmp, COINBASE_STOCKS_CACHE)
        except OSError as e: log(f"Coinbase stock cache write failed: {e}")
    else:
        try: toks = json.load(open(COINBASE_STOCKS_CACHE)); src = f"cache {COINBASE_STOCKS_CACHE}"
        except (OSError, ValueError): toks = []; src = "unavailable"
    n = 0
    for t in toks:
        a = (t.get("contract_address") or "").lower(); sym = t.get("symbol") or ""
        if a.startswith(BASE_STOCK_PREFIX) and sym.endswith("c"):
            REG["evm"]["base"][a] = [sym, CB_ISSUER]; n += 1
    log(f"Coinbase tokenized stocks (Base): {n} from {src}")
    return n

def learn_evm_stock(chain, tk, issuer=None):
    """Base/Ethereum tokenized-stock detection by token metadata: Ondo Global Markets ('… (Ondo Tokenized …)', symbol …on),
    xStocks/Backed ('… xStock', symbol …x), Base 0xb2000… stock contracts, or an allowlist 'tokenized-stock' pool leg."""
    if chain not in ("base", "eth") or not tk or not tk.get("address"): return
    a = tk["address"].lower(); n = (tk.get("name") or ""); sym = tk.get("symbol") or ""
    if a in REG["evm"][chain]: return
    nl = n.lower()
    if "ondo tokenized" in nl and sym.lower().endswith("on"): issuer = "Ondo Global Markets"
    elif (nl.endswith("xstock") or "backed" in nl) and sym.endswith("x"): issuer = "xStocks/Backed"
    elif chain == "base" and a.startswith(BASE_STOCK_PREFIX): issuer = "Base 0xb2000… stock token"
    if issuer: REG["evm"][chain][a] = [sym, issuer]

def load_registries(wide, ondo_max_age_days=0):
    today = dt.date.today().isoformat()
    cf = os.path.join(CACHE_DIR, "registries.json")
    old_ondo = None; evm_old = None
    if os.path.exists(cf):
        c = json.load(open(cf))
        if c.get("date") == today and (c.get("ondo") or not wide) and "evm" in c:
            REG.update({k: c[k] for k in ("rh", "xstocks", "ondo", "evm")}); load_coinbase_stocks(); return
        evm_old = (c.get("evm"), c.get("evm_ondo_date")) if c.get("evm") else None
        od = c.get("ondo_date") or (c.get("date") if c.get("ondo") else None)
        if c.get("ondo") and od:
            old_ondo = (c["ondo"], od)
            if not ((ondo_max_age_days and (dt.date.today() - dt.date.fromisoformat(od)).days <= ondo_max_age_days) or not wide):
                old_ondo = None
    d = http("https://api.robinhood.com/rhj/assets", key="rh_registry") or {}
    for x in d.get("assets") or []:
        for dep in x.get("deployments") or []:
            if dep.get("chainId") == 4663:
                REG["rh"][dep["contractAddress"].lower()] = x.get("tokenSymbol")
    page = 0
    while page < 20:
        d = http(f"https://api.xstocks.fi/api/v2/public/assets?page={page}&pageSize=100&network=Solana", key=f"xstocks_{page}")
        if not d: break
        for n in d.get("nodes") or []:
            for dep in n.get("deployments") or []:
                if dep.get("network") == "Solana" and dep.get("address", "").startswith("Xs") and (n.get("name") or "").endswith("xStock"):
                    REG["xstocks"][dep["address"]] = n.get("symbol")
        if not (d.get("page") or {}).get("hasNextPage"): break
        page += 1
    for net, ch in (("Ethereum", "eth"), ("Base", "base")):   # xStocks EVM deployments
        page = 0
        while page < 20:
            d = http(f"https://api.xstocks.fi/api/v2/public/assets?page={page}&pageSize=100&network={net}", key=f"xstocks_{net}_{page}")
            if not d: break
            for n in d.get("nodes") or []:
                for dep in n.get("deployments") or []:
                    if dep.get("network") == net and (n.get("name") or "").endswith("xStock") and dep.get("address", "").startswith("0x"):
                        REG["evm"][ch][dep["address"].lower()] = [n.get("symbol"), "xStocks/Backed"]
            if not (d.get("page") or {}).get("hasNextPage"): break
            page += 1
    evm_ondo_date = None
    if evm_old and evm_old[1] and (dt.date.today() - dt.date.fromisoformat(evm_old[1])).days <= 7:
        for ch in ("base", "eth"):
            for a_, v_ in (evm_old[0].get(ch) or {}).items():
                if v_[1] == "Ondo Global Markets": REG["evm"][ch].setdefault(a_, v_)
        evm_ondo_date = evm_old[1]; log(f"Ondo EVM list reused from {evm_ondo_date}")
    ondo_date = today if wide else None
    if old_ondo:   # keep a previous Ondo list (non-wide runs never search, so they must not wipe it)
        REG["ondo"] = old_ondo[0]; ondo_date = old_ondo[1]; wide = False
        log(f"Ondo list reused from {ondo_date} ({len(REG['ondo'])} tokens)")
    if wide:
        # Ondo Global Markets: no keyless registry -> DexScreener search "<TICKER>on", keep Solana tokens named "(Ondo Tokenized)"
        tick = set(v for v in REG["rh"].values() if v)   # ~195 US tickers -> "<T>on" searches
        log(f"Ondo discovery: {len(tick)} ticker searches on DexScreener")
        for t in sorted(tick):
            res = http(f"{DS}/search?q={urllib.parse.quote(t + 'on')}", retries=2) or {}
            for p in res.get("pairs") or []:
                if p.get("chainId") != "solana": continue
                for tk in (p.get("baseToken") or {}, p.get("quoteToken") or {}):
                    if (tk.get("name") or "").endswith("(Ondo Tokenized)") and (tk.get("symbol") or "").endswith("on"):
                        REG["ondo"][tk["address"]] = tk.get("symbol")
    if evm_ondo_date is None and REG["rh"]:
        # Ondo Global Markets on Ethereum/Base: DexScreener search "<TICKER>on", keep tokens named "(Ondo Tokenized …)"
        tick = sorted(set(v for v in REG["rh"].values() if v))
        log(f"Ondo EVM discovery: {len(tick)} DexScreener searches")
        for t in tick:
            res = http(f"{DS}/search?q={urllib.parse.quote(t + 'on')}", retries=2) or {}
            for p in res.get("pairs") or []:
                ch = {"ethereum": "eth", "base": "base"}.get(p.get("chainId"))
                if not ch: continue
                for tk in (p.get("baseToken") or {}, p.get("quoteToken") or {}):
                    learn_evm_stock(ch, tk)
        evm_ondo_date = today
    load_coinbase_stocks()
    log(f"registries: Robinhood {len(REG['rh'])}, xStocks(Solana) {len(REG['xstocks'])}, Ondo(Solana, name-matched) {len(REG['ondo'])}, "
        f"Base stocks {len(REG['evm']['base'])}, Ethereum stocks {len(REG['evm']['eth'])}")
    json.dump({"date": today, "ondo_date": ondo_date, "evm_ondo_date": evm_ondo_date, **REG}, open(cf, "w"))

def stock_symbol(chain, addr):
    if not addr: return None
    if chain == "robinhood":
        return REG["rh"].get(addr.lower())
    if chain in ("base", "eth"):
        v = REG["evm"][chain].get(addr.lower()); return v[0] if v else None
    return REG["xstocks"].get(addr) or REG["ondo"].get(addr)

def stock_issuer(chain, addr):
    if chain == "robinhood": return "Robinhood" if addr and addr.lower() in REG["rh"] else None
    if chain in ("base", "eth"):
        v = REG["evm"][chain].get((addr or "").lower()); return v[1] if v else None
    if addr in REG["xstocks"]: return "xStocks/Backed"
    if addr in REG["ondo"]: return "Ondo(name-matched)"
    return None

# ---------------------------------------------------------------- protocol classification
def classify(chain, dex_id, labels=None, ray=None):
    dex_id = (dex_id or "").lower().replace("_", "-"); labels = [x.lower() for x in (labels or [])]
    if chain in EVM:
        if dex_id.startswith("uniswap-v3") or (dex_id == "uniswap" and "v3" in labels): return "uniswap-v3"
        if dex_id.startswith("uniswap-v4") or (dex_id == "uniswap" and "v4" in labels): return "uniswap-v4"
        if dex_id.startswith("uniswap-v2") or (dex_id == "uniswap" and "v2" in labels): return "uniswap-v2"
        if "v4" in dex_id or "infinity" in dex_id or "v4" in labels: return "v4-fork:" + dex_id
        if "v3" in dex_id or "clmm" in dex_id or dex_id.endswith("-cl") or "v3" in labels: return "v3-fork:" + dex_id
        if "v2" in dex_id or "v2" in labels: return "v2-fork:" + dex_id
        return "other:" + dex_id
    if ray:
        if ray.get("type") == "Concentrated": return "raydium-clmm"
        if ray.get("programId") == RAYDIUM_CPMM: return "raydium-cpmm"
        if ray.get("programId") == RAYDIUM_AMM_V4: return "raydium-amm"
        return "raydium-other"
    if dex_id.startswith("raydium"):
        if "clmm" in dex_id or "clmm" in labels: return "raydium-clmm"
        if "cp" in dex_id or "cpmm" in labels: return "raydium-cpmm"
        return "raydium-amm"
    if dex_id.startswith("orca"): return "orca-whirlpool"
    if dex_id.startswith("meteora"):
        if "dlmm" in dex_id or "dlmm" in labels: return "meteora-dlmm"
        if "dyn2" in labels or "damm-v2" in dex_id or "v2" in dex_id: return "meteora-damm-v2"
        return "meteora-damm"
    if "pump" in dex_id: return "pumpswap"
    return "other:" + dex_id

DEX_LABEL = {"uniswap-v3": "RH / Uni v3", "uniswap-v4": "RH / Uni v4", "uniswap-v2": "RH / Uni v2", "raydium-clmm": "SOL / Ray CLMM",
             "raydium-cpmm": "SOL / Ray CPMM", "raydium-amm": "SOL / Ray AMM", "orca-whirlpool": "SOL / Orca", "meteora-dlmm": "SOL / Meteora DLMM",
             "meteora-damm": "SOL / Meteora DAMM", "meteora-damm-v2": "SOL / Meteora DAMMv2", "pumpswap": "SOL / PumpSwap"}

def chain_dex(row):
    p = row["protocol"]
    if row["chain"] in EVM and p.startswith("uniswap-"): return f"{CHAIN_CFG[row['chain']]['short']} / Uni {p.split('-')[1]}"
    if p in DEX_LABEL: return DEX_LABEL[p]
    return (CHAIN_CFG.get(row["chain"], {}).get("short", "SOL") + " / ") + p.split(":", 1)[-1].replace("-robinhood", "")

CP_PROTOCOLS = {"raydium-cpmm", "raydium-amm", "uniswap-v2", "pumpswap", "meteora-damm"}

# ---------------------------------------------------------------- discovery (wide universe)
def gt_list(path, pages, key):
    out = []
    for pg in range(1, pages + 1):
        d = http(f"{GT}/{path}{'&' if '?' in path else '?'}page={pg}&include=base_token,quote_token,dex", retries=3, key=f"{key}_{pg}")
        if not d or not d.get("data"): break
        inc = {x["id"]: x["attributes"] for x in d.get("included", [])}
        for x in d["data"]:
            at = dict(x["attributes"]); rel = x.get("relationships", {})
            at["_base"] = inc.get(rel.get("base_token", {}).get("data", {}).get("id"), {})
            at["_quote"] = inc.get(rel.get("quote_token", {}).get("data", {}).get("id"), {})
            at["_dex"] = rel.get("dex", {}).get("data", {}).get("id")
            if "/networks/" in f"/{path}": learn_evm_stock(path.split("/")[1], at["_base"]); learn_evm_stock(path.split("/")[1], at["_quote"])
            out.append(at)
        if len(d["data"]) < 20: break
    return out

def discover_stock_pools(add, stats):
    """Tokenized-stock pools via DexScreener token-pairs (all DEXes) + Raydium by mint; token-pairs and Raydium run in parallel."""
    def ds_token_pairs(chain, tok):
        res = http(f"https://api.dexscreener.com/token-pairs/v1/{chain}/{tok}", retries=3)
        return res if isinstance(res, list) else []
    toks_by = {"robinhood": list(REG["rh"]), "base": list(REG["evm"]["base"]), "eth": list(REG["evm"]["eth"]),
               "solana": list(REG["xstocks"]) + list(REG["ondo"])}
    log("discovery: DexScreener presence check for stock tokens " + ", ".join(f"{k} {len(v)}" for k, v in toks_by.items()))
    toks_by = {k: v for k, v in toks_by.items() if k in CHAINS}
    with_pairs = {k: [] for k in toks_by}
    for chain, toks in toks_by.items():
        dsn = CHAIN_CFG[chain]["ds"]
        for i in range(0, len(toks), 30):   # batch presence check: which stock tokens have any DEX pair at all
            part = toks[i:i + 30]
            res = http(f"https://api.dexscreener.com/tokens/v1/{dsn}/{','.join(part)}", retries=3)
            seen = set()
            for p in res if isinstance(res, list) else []:
                for tk in (p.get("baseToken") or {}, p.get("quoteToken") or {}):
                    seen.add(nkey(chain, tk.get("address") or ""))
            with_pairs[chain] += [t for t in part if nkey(chain, t) in seen]
    stats["stock_tokens_with_dex_pairs"] = {k: len(v) for k, v in with_pairs.items()}
    log(f"  stock tokens with DEX pairs: " + ", ".join(f"{k} {len(v)}" for k, v in with_pairs.items()) + "; token-pairs + Raydium-by-mint")
    capped = [0]
    def ds_part():
        for chain in CHAINS:
            dsn = CHAIN_CFG[chain]["ds"]
            for t in with_pairs[chain]:
                prs = ds_token_pairs(dsn, t)
                if len(prs) >= 30: capped[0] += 1
                for p in prs:
                    if p.get("chainId") != dsn: continue
                    add(chain, p["pairAddress"], p.get("dexId"), p.get("labels"), "tokenized_stock", f((p.get("liquidity") or {}).get("usd")),
                        vol24=f((p.get("volume") or {}).get("h24")))
    def ray_part():
        for t in with_pairs.get("solana", []):
            d = http(f"{RAY}/pools/info/mint?mint1={t}&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=100&page=1", retries=2) or {}
            for p in ((d.get("data") or {}).get("data") or []):
                RAY_PREFETCH.setdefault(p["id"], p)
                add("solana", p["id"], "raydium", None, "tokenized_stock", f(p.get("tvl")), vol24=f((p.get("day") or {}).get("volume")))
    th = threading.Thread(target=ray_part); th.start(); ds_part(); th.join()
    stats["ds_token_pairs_capped_at_30"] = capped[0]

DEX_SCOPE = ["core"]   # core: Robinhood = Uniswap v2/v3/v4 only, Solana = Raydium AMM/CPMM/CLMM only; all: every DEX
SCOPE_STATS = {"dropped_out_of_scope": 0}

def dex_in_scope(chain, dex_id):
    """Discovery-time check on a raw DEX id (GeckoTerminal/DexScreener). Unknown id -> True (decided later from the row protocol)."""
    if (DEX_SCOPE[0] == "all" and chain != "base") or not dex_id: return True   # Base: Uniswap v3/v4 only in every mode
    d = dex_id.lower().replace("_", "-")
    if chain == "robinhood": return d.startswith("uniswap")
    if chain in EVM: return d.startswith("uniswap") and "v2" not in d     # Base/Ethereum: Uniswap v3/v4 only
    return d.startswith("raydium")

def proto_in_scope(r):
    p = r.get("protocol") or ""
    if r["chain"] == "robinhood": return p in ("uniswap-v2", "uniswap-v3", "uniswap-v4")
    if r["chain"] in EVM: return p in ("uniswap-v3", "uniswap-v4")
    return p.startswith("raydium")

def scope_ok(r, snap):
    if r.get("chain") == "base": return proto_in_scope(r)   # Base: Uniswap v3/v4 only, not even allowlist/watch-only rows elsewhere
    return (snap.get("dex_scope") or "all") == "all" or proto_in_scope(r)

def make_adder(cands):
    lock = threading.Lock()
    def add(chain, addr, dex_id=None, labels=None, cat=None, tvl=None, vol24=None):
        if not addr or chain not in CHAINS: return   # --chains subset
        k = (chain, nkey(chain, addr))
        if (cat not in ("allowlist", "pinned") or chain == "base") and not dex_in_scope(chain, dex_id):
            with lock: SCOPE_STATS["dropped_out_of_scope"] += 1
            return
        with lock:
            c = cands.setdefault(k, {"chain": chain, "address": k[1], "dex_id": dex_id, "labels": labels, "categories": set(), "hint_tvl": None, "hint_vol24": None})
            if dex_id and not c.get("dex_id"): c["dex_id"] = dex_id
            if labels and not c.get("labels"): c["labels"] = labels
            if cat: c["categories"].add(cat)
            if tvl is not None: c["hint_tvl"] = max(c["hint_tvl"] or 0, tvl)
            if vol24 is not None: c["hint_vol24"] = max(c.get("hint_vol24") or 0, vol24)
    return add

def discover_top(allow, pins, args):
    """Daily 'top' universe: GT top-N by 24h volume per chain (+ Raydium/Orca/Meteora volume lists), all stock-token pools, allowlist, pins."""
    cands = {}; add = make_adder(cands); stats = {}
    for p in allow:
        add(p["chain"], p["address"], cat="allowlist"); cands[(p["chain"], p["address"])]["allow_protocol"] = p["protocol"]
    for a in pins:
        add("robinhood" if a.startswith("0x") else "solana", a, cat="pinned")
    th = threading.Thread(target=discover_stock_pools, args=(add, stats)); th.start()
    log(f"discovery: GeckoTerminal top {args.gt_pages * 20} pools by 24h volume per chain; DEX scope {DEX_SCOPE[0]}"
        + (" (RH Uniswap, Base/Ethereum Uniswap v3/v4, Solana Raydium)" if DEX_SCOPE[0] == "core" else "; Raydium/Orca/Meteora volume lists"))
    for net in CHAINS:
        lst = gt_list(f"networks/{net}/pools?sort=h24_volume_usd_desc", args.gt_pages, f"gt_{net}_top_vol")
        stats[f"{net}_gt_top_volume"] = len(lst)
        for x in lst:
            k = (net, nkey(net, x["address"]))
            GT_PREFETCH[k] = x
            add(net, x["address"], x["_dex"], None, "volume", f(x.get("reserve_in_usd")), vol24=f((x.get("volume_usd") or {}).get("h24")))
            for tk in (x["_base"], x["_quote"]):
                if stock_symbol(net, tk.get("address")): add(net, x["address"], x["_dex"], cat="tokenized_stock")
    core = DEX_SCOPE[0] == "core"
    d = http(f"{RAY}/pools/info/list?poolType=all&poolSortField=volume24h&sortType=desc&pageSize={100 if core else 50}&page=1", key="ray_top_vol") or {}
    for p in ((d.get("data") or {}).get("data") or []):
        RAY_PREFETCH[p["id"]] = p; add("solana", p["id"], "raydium", None, "volume", f(p.get("tvl")), vol24=f((p.get("day") or {}).get("volume")))
    d = (http("https://api.orca.so/v2/solana/pools?sortBy=volume24h&sortDirection=desc&size=50", key="orca_top_vol") or {}) if not core else {}
    for p in d.get("data") or []:
        ORCA_PREFETCH[p["address"]] = p
        add("solana", p["address"], "orca", None, "volume", f(p.get("tvlUsdc")), vol24=f(((p.get("stats") or {}).get("24h") or {}).get("volume")))
    d = (http("https://dlmm.datapi.meteora.ag/pools?page=1&page_size=30&sort_by=volume_24h:desc", key="meteora_top_vol") or {}) if not core else {}
    for p in d.get("data") or []:
        MET_PREFETCH[p["address"]] = p
        add("solana", p["address"], "meteora-dlmm", ["DLMM"], "volume", f(p.get("tvl")), vol24=f((p.get("volume") or {}).get("24h")))
    th.join()
    stats["dex_scope"] = DEX_SCOPE[0]; stats["dropped_out_of_scope_at_discovery"] = SCOPE_STATS["dropped_out_of_scope"]
    for k, c in cands.items():   # stock pools found via the volume lists
        g = GT_PREFETCH.get(k) or {}
        if any(stock_symbol(c["chain"], (g.get(t) or {}).get("address")) for t in ("_base", "_quote")): c["categories"].add("tokenized_stock")
    return cands, stats

def prev_hints(snap_root):
    """fee APR 7d / fee tier from the latest top or wide snapshot (cheap pre-ranking signal; never reported as today's data)."""
    best = None
    for sub in ("top", "wide"):
        dd = os.path.join(snap_root, sub)
        if not os.path.isdir(dd): continue
        c = sorted(x for x in os.listdir(dd) if x.endswith(".json"))
        if c and (best is None or c[-1] > best[1]): best = (dd, c[-1])
    if not best: return {}, None
    try:
        snap = json.load(open(os.path.join(*best)))
    except Exception:
        return {}, None
    return {(r["chain"], r["address"]): {"fee_apr_7d": r.get("fee_apr_7d"), "fee_tier_pct": r.get("fee_tier_pct")} for r in snap["pools"]}, best[1][:-5]

def select_top(cands, ds, prev, args):
    """Pick the pools that could make the 4 tables (+ allowlist/pins) before spending GeckoTerminal OHLCV calls."""
    def hint(c):
        d = ds.get(c["address"]) or {}; g = GT_PREFETCH.get((c["chain"], c["address"])) or {}; r = RAY_PREFETCH.get(c["address"]) or {}
        tv = [x for x in (f(r.get("tvl")), f(g.get("reserve_in_usd")), f((d.get("liquidity") or {}).get("usd")), c.get("hint_tvl")) if x is not None]
        vv = [x for x in (f((r.get("day") or {}).get("volume")), f((g.get("volume_usd") or {}).get("h24")), f((d.get("volume") or {}).get("h24")), c.get("hint_vol24")) if x is not None]
        tvl = tv[0] if tv else None; v24 = vv[0] if vv else None
        fee = f(g.get("pool_fee_percentage"))
        if fee is None and r: fee = (f(r.get("feeRate")) or 0) * 100 or None
        ph = prev.get((c["chain"], c["address"])) or {}
        if fee is None: fee = ph.get("fee_tier_pct")
        if fee is None: fee = 0.3
        p24 = v24 * fee / 100 * 365 / tvl * 100 if (tvl and v24 is not None) else None
        proxy = max([x for x in (p24, ph.get("fee_apr_7d")) if x is not None] or [None]) if (p24 is not None or ph.get("fee_apr_7d") is not None) else None
        return tvl, v24, proxy
    sel, why = {}, {}
    H = {k: hint(c) for k, c in cands.items()}
    def insc(k, c):
        g = GT_PREFETCH.get(k) or {}; d = ds.get(c["address"]) or {}
        if c.get("allow_protocol"): return proto_in_scope({"chain": c["chain"], "protocol": c["allow_protocol"]})
        return dex_in_scope(c["chain"], g.get("_dex") or c.get("dex_id") or d.get("dexId"))
    for ch in CHAINS:
        st = [k for k, c in cands.items() if c["chain"] == ch and "tokenized_stock" in c["categories"] and (H[k][0] or 0) >= stock_min_tvl(ch) and insc(k, c)]
        st.sort(key=lambda k: -(H[k][2] if H[k][2] is not None else -1))
        for k in st[:args.stock_candidates]: why.setdefault(k, set()).add("stock_candidate")
        vo = [k for k, c in cands.items() if c["chain"] == ch and (H[k][0] or 0) >= MAJOR_MIN_TVL and insc(k, c)]
        vo.sort(key=lambda k: -(H[k][1] or 0))
        for k in vo[:args.volume_candidates]: why.setdefault(k, set()).add("volume_candidate")
    for k, c in cands.items():
        if "pinned" in c["categories"]: why.setdefault(k, set()).add("pinned")
        elif "allowlist" in c["categories"] and (H[k][0] or 0) >= STOCK_MIN_TVL: why.setdefault(k, set()).add("allowlist")
    skipped = []
    for k, c in cands.items():
        if k in why:
            c["selected_as"] = sorted(why[k]); sel[k] = c
        elif not insc(k, c):
            continue
        elif (H[k][0] or 0) >= (stock_min_tvl(c["chain"]) if "tokenized_stock" in c["categories"] else STOCK_MIN_TVL) and ("tokenized_stock" in c["categories"] or (H[k][0] or 0) >= MAJOR_MIN_TVL or "allowlist" in c["categories"]):
            skipped.append({"chain": c["chain"], "address": c["address"], "categories": sorted(c["categories"]), "tvl_hint": H[k][0],
                            "vol24_hint": H[k][1], "fee_apr_proxy": H[k][2]})
    return sel, skipped

def discover_wide(allow):
    cands = {}; add = make_adder(cands)
    for p in allow:
        add(p["chain"], p["address"], cat="allowlist"); cands[(p["chain"], p["address"])]["allow_protocol"] = p["protocol"]
    stats = {}
    discover_stock_pools(add, stats)
    # 2) majors
    log("discovery: Robinhood all-DEX pool enumeration (GeckoTerminal)")
    dexes = [x["id"] for x in (http(f"{GT}/networks/robinhood/dexes?page=1", key="gt_rh_dexes") or {}).get("data", [])]  # single page
    rh_all = gt_list("networks/robinhood/pools?sort=h24_volume_usd_desc", 10, "gt_rh_top_vol")
    rh_all += gt_list("networks/robinhood/pools?sort=h24_tx_count_desc", 5, "gt_rh_top_tx")
    dexes = [dx for dx in dexes if dex_in_scope("robinhood", dx)]
    for dx in dexes:   # one page per DEX catches big pools on small DEXes
        rh_all += gt_list(f"networks/robinhood/dexes/{dx}/pools?sort=h24_volume_usd_desc", 1, f"gt_rh_dex_{dx}")
    stats["robinhood_dexes"] = len(dexes); stats["robinhood_pools_enumerated"] = len({x["address"] for x in rh_all})
    GT_PREFETCH.update({("robinhood", x["address"].lower()): x for x in rh_all})
    for x in rh_all:
        for tk in (x["_base"], x["_quote"]):
            if stock_symbol("robinhood", tk.get("address")):
                add("robinhood", x["address"], x["_dex"], None, "tokenized_stock", f(x.get("reserve_in_usd")))
    rh_sorted = sorted({x["address"].lower(): x for x in rh_all}.values(), key=lambda x: -(f(x.get("reserve_in_usd")) or 0))
    for x in [x for x in rh_sorted if (f(x.get("reserve_in_usd")) or 0) >= 1e6][:20]:
        add("robinhood", x["address"], x["_dex"], None, "major", f(x.get("reserve_in_usd")))
    log("discovery: Solana majors (Raydium, Orca, Meteora DLMM by TVL)")
    sol_major = []
    d = http(f"{RAY}/pools/info/list?poolType=all&poolSortField=liquidity&sortType=desc&pageSize=40&page=1", key="ray_top") or {}
    ray_top = [(p["id"], "raydium", f(p.get("tvl"))) for p in ((d.get("data") or {}).get("data") or [])]
    for p in ((d.get("data") or {}).get("data") or []): RAY_PREFETCH[p["id"]] = p
    core = DEX_SCOPE[0] == "core"
    d = (http("https://api.orca.so/v2/solana/pools?sortBy=tvl&sortDirection=desc&size=40", key="orca_top") or {}) if not core else {}
    for p in d.get("data") or []: ORCA_PREFETCH[p["address"]] = p
    orca_top = [(p["address"], "orca", f(p.get("tvlUsdc"))) for p in d.get("data") or []]
    d = (http("https://dlmm.datapi.meteora.ag/pools?page=1&page_size=40&sort_by=tvl:desc", key="meteora_top") or {}) if not core else {}
    for p in d.get("data") or []: MET_PREFETCH[p["address"]] = p
    met_top = [(p["address"], "meteora-dlmm", f(p.get("tvl"))) for p in d.get("data") or []]
    ray_major = [x for x in ray_top if (x[2] or 0) >= 1e6][:20]
    overall = sorted([x for x in ray_top + orca_top + met_top if (x[2] or 0) >= 1e6], key=lambda x: -x[2])[:20]
    for a_, dx, tvl in ray_major + overall:
        add("solana", a_, dx, ["DLMM"] if dx == "meteora-dlmm" else None, "major", tvl)
    stats["solana_major_sources"] = {"raydium_top_ge_1m": len(ray_major), "overall_top20": [x[1] for x in overall]}
    stats["dex_scope"] = DEX_SCOPE[0]; stats["dropped_out_of_scope_at_discovery"] = SCOPE_STATS["dropped_out_of_scope"]
    return cands, stats

GT_PREFETCH, RAY_PREFETCH, ORCA_PREFETCH, MET_PREFETCH = {}, {}, {}, {}

# ---------------------------------------------------------------- per-pool state fetchers (run in a thread pool)
def v2_state(addr):
    r = rpc_batch([eth_call(addr, "0x0902f1ac"), eth_call(addr, "0x0dfe1681"), eth_call(addr, "0xd21220a7")])
    if not r[0] or not r[1]: return None
    w = words(r[0])
    return {"reserve0": u(w[0]), "reserve1": u(w[1]), "token0": addr_of(words(r[1])[0]), "token1": addr_of(words(r[2])[0])}

def fetch_state(row, cache_v4):
    """Everything except GeckoTerminal OHLCV (which is rate-limited and done serially)."""
    p, a = row["protocol"], row["address"]
    st = {}
    _TL.chain = row["chain"] if row["chain"] in EVM else "robinhood"
    try:
        if p == "uniswap-v3" or p.startswith("v3-fork"):
            st["cl"] = v3_state(a)
        elif p == "uniswap-v4":
            key = v4_key(a, row.get("_cts"), cache_v4)
            st["v4key"] = key
            if key:
                st["cl"] = v4_state(a, key)
                if key["fee"] == 0x800000:
                    st["v4fees"] = v4_recent_swap_fees(a)
        elif p == "uniswap-v2" or p.startswith("v2-fork"):
            st["v2"] = v2_state(a)
        elif p == "raydium-clmm":
            st["ray_line"] = http(f"{RAY}/pools/line/position?id={a}", key=f"ray_line_{a}")
        elif p == "orca-whirlpool":
            st["orca"] = ORCA_PREFETCH.get(a) or ((http(f"https://api.orca.so/v2/solana/pools/{a}", key=f"orca_{a}") or {}).get("data"))
        elif p == "meteora-dlmm":
            st["met"] = MET_PREFETCH.get(a) or http(f"https://dlmm.datapi.meteora.ag/pools/{a}", key=f"met_{a}")
        if st.get("cl") and st["cl"].get("token0"):
            st["decs"] = erc20_decimals([st["cl"]["token0"].lower(), st["cl"]["token1"].lower()])
        if st.get("v2"):
            st["decs"] = erc20_decimals([st["v2"]["token0"].lower(), st["v2"]["token1"].lower()])
    except Exception as e:
        st["error"] = f"{type(e).__name__}: {e}"
    return st

# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(prog="lp_pool_scan.py", description="Read-only LP pool scanner (Robinhood Chain Uniswap, Solana Raydium/Orca/Meteora)")
    ap.add_argument("--universe", choices=["allowlist", "top", "wide"], default="allowlist",
                    help="allowlist: your pools; top: daily top pools by volume + stock pools per chain (~5-10 min); wide: everything (~45 min)")
    ap.add_argument("--allowlist", help="allowlist JSON (default: $LP_SCAN_ALLOWLIST or example_allowlist.json next to this script)")
    ap.add_argument("--out", default=os.environ.get("LP_SCAN_OUT") or os.path.join(os.getcwd(), "lp-scan-output"),
                    help="output dir (default $LP_SCAN_OUT or ./lp-scan-output)")
    ap.add_argument("--format", choices=["md", "json", "both"], default="both", help="md: print markdown report; json: print JSON summary; both: write both, print markdown")
    ap.add_argument("--quiet", action="store_true", help="no progress log on stderr")
    ap.add_argument("--date", help="override snapshot date (YYYY-MM-DD, default today Europe/London)")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--min-tvl", "--floor", dest="floor", type=float, default=10_000, help="TVL dust floor for ranking (wide; default 10000)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--rank-min-tvl", dest="rank_min_stock", type=float, default=50_000, help="wide: min TVL for a pool to get OHLCV/vol/IL and be ranked (majors need $1M)")
    ap.add_argument("--cache-ttl", type=float, default=120, help="minutes to reuse cached GET responses (resume); 0 disables")
    ap.add_argument("--pin", action="append", default=[], help="pool address always shown in the allowlist section (repeatable; also \"pinned\" list in the allowlist JSON)")
    ap.add_argument("--gt-pages", type=int, default=5, help="top: GeckoTerminal pages (20 pools each) of top-24h-volume pools per chain")
    ap.add_argument("--stock-candidates", type=int, default=60, help="top: stock pools per chain (TVL >= $100k, best fee-APR proxy) that get full OHLCV/IL/security")
    ap.add_argument("--volume-candidates", type=int, default=20, help="top: pools per chain (TVL >= $1M, highest 24h volume) that get full OHLCV/IL/security")
    ap.add_argument("--dex-scope", choices=["core", "all"], default="core",
                    help="top/wide: core = Robinhood Uniswap v2/v3/v4 + Solana Raydium AMM/CPMM/CLMM only (default); all = every DEX")
    ap.add_argument("--security-ttl", type=float, default=36, help="hours to reuse cached GoPlus/RugCheck responses")
    ap.add_argument("--chains", help="comma-separated subset of robinhood,base,eth,solana for top/wide discovery and report tables (default: all)")
    ap.add_argument("--render-only", action="store_true", help="re-score and re-render the latest (or --date) snapshot; no network")
    ap.add_argument("--from-cache", action="store_true", help="recompute from the last fetch pickle (debug; no network for pool data)")
    args = ap.parse_args(argv)
    if args.chains:
        global CHAINS
        want = [c.strip() for c in args.chains.split(",") if c.strip()]
        bad = [c for c in want if c not in CHAINS]
        if bad: raise SystemExit(f"lp_pool_scan: error: unknown chain(s) {bad}; choose from {list(CHAINS)}")
        CHAINS = tuple(c for c in CHAINS if c in want)
    set_paths(args.out, args.allowlist)
    if args.quiet: QUIET[0] = True
    if not os.path.exists(ALLOW):
        raise SystemExit(f"lp_pool_scan: error: allowlist not found: {ALLOW}")
    wide = args.universe == "wide"; top = args.universe == "top"
    CACHE_TTL[0] = int(args.cache_ttl * 60)
    for v in LONG_TTL.values(): v[0] = int(args.security_ttl * 3600)
    DEX_SCOPE[0] = args.dex_scope if (wide or top) else "all"
    sub = {"wide": "wide", "top": "top"}.get(args.universe)
    if args.render_only:
        sd = SNAP_DIR if not sub else os.path.join(SNAP_DIR, sub); rd = REPORT_DIR if not sub else os.path.join(REPORT_DIR, sub)
        c_ = sorted(x for x in os.listdir(sd) if x.endswith(".json")) if os.path.isdir(sd) else []
        name = f"{args.date}.json" if args.date else (c_[-1] if c_ else None)
        if not name or not os.path.exists(os.path.join(sd, name)):
            raise SystemExit(f"lp_pool_scan: error: no snapshot to re-render in {sd}")
        snap = json.load(open(os.path.join(sd, name)))
        for r_ in snap["pools"]:
            score_row(r_)
            if not r_.get("rank_eligible", True): r_["score"] = None
        snap["pools"].sort(key=rank_key)
        for k_, r_ in enumerate(snap["pools"]): r_["rank"] = k_ + 1
        json.dump(snap, open(os.path.join(sd, name), "w"), indent=1, default=str)
        pv = previous_snapshot(snap["date"], sd)
        md = render_wide(snap, pv) if wide else render_top(snap, pv, args.top) if top else render(snap, args.top, pv)
        os.makedirs(rd, exist_ok=True); open(os.path.join(rd, name[:-5] + ".md"), "w").write(md)
        if args.format == "json":
            keep = ("rank", "name", "chain", "protocol", "address", "in_allowlist", "fee_tier_pct", "tvl_usd", "vol7d_usd", "fee_apr_7d", "il7d_pool_avg_pct", "score", "flags")
            print(json.dumps({"date": snap["date"], "universe": args.universe, "data_fetched_london": snap["data_fetched_london"],
                              "top": [{k: r_.get(k) for k in keep + ("fees_7d_pct", "net_7d_pct", "fee_cover", "breakeven_move_7d_pct", "realized_move_7d_pct")} | {"slip_1m": slip_str(r_)} for r_ in snap["pools"]
                                      if r_.get("score") is not None and not exclusion(r_, "allowlist")][:args.top]}, default=str))
        else:
            print(md)
        return
    if args.from_cache:
        import pickle
        c = pickle.load(open(os.path.join(CACHE_DIR, f"fetch_{args.universe}.pkl"), "rb"))
        RAW.update(c["RAW"]); load_registries(False)
        st_utc = dt.datetime.fromtimestamp(c["now"], dt.timezone.utc)
        from zoneinfo import ZoneInfo
        lon = st_utc.astimezone(ZoneInfo("Europe/London")); date = args.date or lon.strftime("%Y-%m-%d")
        sd = SNAP_DIR if not sub else os.path.join(SNAP_DIR, sub); rd = REPORT_DIR if not sub else os.path.join(REPORT_DIR, sub)
        return finish(args, c["rows"], c["states"], c["sources"], c["sub_floor"], c["now"], st_utc, lon, date, sd, rd, wide)
    now = time.time()
    started_utc = dt.datetime.now(dt.timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        london = started_utc.astimezone(ZoneInfo("Europe/London"))
    except Exception:
        london = started_utc
    date = args.date or london.strftime("%Y-%m-%d")
    snap_dir = SNAP_DIR if not sub else os.path.join(SNAP_DIR, sub)
    rep_dir = REPORT_DIR if not sub else os.path.join(REPORT_DIR, sub)
    allow = load_pools()
    pins = [a.lower() if a.startswith("0x") else a for a in (args.pin + (json.load(open(ALLOW)).get("pinned") or []))]
    if args.chains:   # --chains subset: keep only allowlist pools / pins on the selected chains
        allow = [p for p in allow if p["chain"] in CHAINS]
        pins = [a for a in pins if ("robinhood" if a.startswith("0x") else "solana") in CHAINS]
    allow_set = {(p["chain"], p["address"]) for p in allow}
    log(f"universe={args.universe} start {started_utc.isoformat()} (London {london.strftime('%Y-%m-%d %H:%M %Z')})")
    load_registries(wide or top, ondo_max_age_days=7 if top else 0)
    sources = {"registries": {k: len(v) for k, v in REG.items()}, "pinned": pins, "allowlist_size": len(allow)}
    if wide:
        cands, dstats = discover_wide(allow)
        sources["discovery"] = dstats
    elif top:
        cands, dstats = discover_top(allow, pins, args)
        sources["discovery"] = dstats
    else:
        cands = {(p["chain"], p["address"]): {"chain": p["chain"], "address": p["address"], "categories": {"allowlist"},
                                               "allow_protocol": p["protocol"], "dex_id": None, "labels": None, "hint_tvl": None} for p in allow}
    log(f"candidates: {len(cands)}")
    byc = {ch: [c["address"] for c in cands.values() if c["chain"] == ch] for ch in CHAINS}
    log("DexScreener pairs..."); ds = {}
    for ch in CHAINS: ds.update(ds_pairs(CHAIN_CFG[ch]["ds"], byc[ch]))
    # dust floor (wide): use best available TVL hint before spending GeckoTerminal calls
    def tvl_hint(c):
        d = ds.get(c["address"]) or {}
        vals = [c.get("hint_tvl"), f((d.get("liquidity") or {}).get("usd")), f((GT_PREFETCH.get((c["chain"], c["address"])) or {}).get("reserve_in_usd"))]
        vals = [v for v in vals if v is not None]
        return max(vals) if vals else None
    sub_floor = []
    if top:
        prev, prev_date = prev_hints(SNAP_DIR)
        n_all = len(cands)
        cands, skipped = select_top(cands, ds, prev, args)
        sources["top_selection"] = {"candidates_discovered": n_all, "deep_scanned": len(cands), "not_deep_scanned_tvl_ge_100k": len(skipped),
                                    "prev_snapshot_used_for_preranking": prev_date,
                                    "rule": f"per chain: top {args.stock_candidates} stock pools (TVL>=$100k) by max(24h fee APR proxy, previous 7d fee APR), "
                                            f"top {args.volume_candidates} pools (TVL>=$1M) by 24h volume, allowlist pools TVL>=$100k, pins"}
        sub_floor = skipped
        log(f"top selection: {len(cands)} deep-scanned of {n_all} discovered ({len(skipped)} other pools >= $100k not deep-scanned)")
    if wide:
        keep = {}
        for k, c in cands.items():
            th = tvl_hint(c)
            if "allowlist" in c["categories"] or "major" in c["categories"] or (th is not None and th >= args.floor):
                keep[k] = c
            else:
                sub_floor.append({"chain": c["chain"], "address": c["address"], "tvl_hint": th, "categories": sorted(c["categories"])})
        log(f"dust floor ${args.floor:,.0f}: kept {len(keep)}, sub-floor {len(sub_floor)}")
        cands = keep
    byc = {ch: [c["address"] for c in cands.values() if c["chain"] == ch] for ch in CHAINS}
    sol = byc.get("solana", [])
    pre = {k[1]: v for k, v in GT_PREFETCH.items() if k in cands} if top else {}
    log("GeckoTerminal multi-pool..."); gt = dict(pre)
    for ch in CHAINS: gt.update(gt_multi(ch, [a for a in byc[ch] if a not in pre]))
    for k, v in pre.items(): learn_evm_stock(next((c["chain"] for c in cands.values() if c["address"] == k), None), v.get("_base")); learn_evm_stock(next((c["chain"] for c in cands.values() if c["address"] == k), None), v.get("_quote"))
    meta = json.load(open(ALLOW)).get("allowlist_meta") or {}
    for p in allow:   # allowlist 'tokenized-stock' pools on Base/Ethereum: the non-stable, non-major leg is a stock token
        m = meta.get(p["address"]) or {}
        if p["chain"] in ("base", "eth") and m.get("category") == "tokenized-stock":
            g_ = gt.get(p["address"]) or {}
            for tk in (g_.get("_base") or {}, g_.get("_quote") or {}):
                if (tk.get("symbol") or "").upper() not in STABLES | MAJOR_SYMS: learn_evm_stock(p["chain"], tk, issuer="allowlist tokenized-stock leg")
    sources["geckoterminal_pools"] = f"{len(gt)}/{len(cands)}"
    sources["dexscreener_pairs"] = f"{len(ds)}/{len(cands)}"
    sol_ray = [a for a in sol if a not in RAY_PREFETCH]
    log("Raydium API v3..."); ray = {**{k: v for k, v in RAY_PREFETCH.items() if k in set(sol)}, **ray_info(sol_ray)}
    sources["raydium_v3"] = f"{len(ray)} Raydium pools resolved"

    rows = []
    for k, c in cands.items():
        a = c["address"]; g = gt.get(a) or {}; d = ds.get(a) or {}; r = ray.get(a) or {}
        if c.get("allow_protocol"):
            proto = c["allow_protocol"]
        else:
            proto = classify(c["chain"], g.get("_dex") or c.get("dex_id") or d.get("dexId"), d.get("labels") or c.get("labels"), r or None)
        row = {"chain": c["chain"], "protocol": proto, "address": a, "in_allowlist": k in allow_set,
               "categories": sorted(c["categories"]), "flags": [], "notes": [], "src": {"gt": bool(g), "ds": bool(d), "raydium": bool(r)}}
        if c.get("selected_as"): row["selected_as"] = c["selected_as"]
        row["in_dex_scope"] = DEX_SCOPE[0] == "all" or proto_in_scope(row)
        if a in pins: row["pinned"] = True
        created = g.get("pool_created_at")
        cts = dt.datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() if created else \
            (d.get("pairCreatedAt") / 1000 if d.get("pairCreatedAt") else (f(r.get("openTime")) or None))
        row["_cts"] = cts if cts else None
        row["_g"], row["_d"], row["_r"] = g, d, r
        rows.append(row)

    for row in rows:
        g, r = row["_g"], row["_r"]
        th = f(r.get("tvl")) if r else None
        th = th if th is not None else f(g.get("reserve_in_usd"))
        if th is None: th = f(((row["_d"] or {}).get("liquidity") or {}).get("usd"))
        cats = set(row["categories"])
        row["_eligible"] = (not wide) or row["in_allowlist"] or (th is not None and (("major" in cats and th >= 1e6) or th >= args.rank_min_stock))
    log(f"rank-eligible pools (OHLCV/vol/IL/security): {sum(r_['_eligible'] for r_ in rows)} of {len(rows)}")
    v4cache_f = os.path.join(CACHE_DIR, "v4_pool_keys.json")
    v4cache = json.load(open(v4cache_f)) if os.path.exists(v4cache_f) else {}
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(max_workers=args.workers)
    fut_state = {id(row): pool.submit(fetch_state, row, v4cache) for row in rows}
    if top:
        def sec_prefetch():
            ev, sm = {ch: set() for ch in EVM}, set()
            for row in rows:
                g, r = row["_g"], row["_r"] or {}
                if row["chain"] in EVM:
                    for t in ((g.get("_base") or {}).get("address"), (g.get("_quote") or {}).get("address")):
                        if t and t.lower() not in REG["rh"]: ev[row["chain"]].add(t.lower())
                else:
                    for t in ((g.get("_base") or {}).get("address"), (g.get("_quote") or {}).get("address"),
                              (r.get("mintA") or {}).get("address"), (r.get("mintB") or {}).get("address")):
                        if t and t not in SEC_SKIP: sm.add(t)
            t1 = threading.Thread(target=lambda: [goplus(ev[ch], ch) for ch in EVM]); t1.start(); rugcheck(sm, {}); t1.join()
        sec_thread = threading.Thread(target=sec_prefetch, daemon=True); sec_thread.start()
    # OHLCV (GeckoTerminal, serial, paced) runs while on-chain/Raydium/Orca/Meteora fetches proceed in threads
    log(f"GeckoTerminal OHLCV for {sum(1 for r_ in rows if r_['_g'])} pools (~{2.2 * sum(1 for r_ in rows if r_['_g']) / 60:.0f}+ min)")
    for i, row in enumerate(rows):
        g = row["_g"]
        if not g: continue
        if not row["_eligible"]:
            row["notes"].append(f"below rank threshold (stock < ${args.rank_min_stock:,.0f} / major < $1M): vol/IL n/a, unranked"); continue
        net = row["chain"]   # GeckoTerminal network slug: robinhood / base / eth / solana
        row["_oh"] = gt_ohlcv(net, row["address"], "token")
        quote_sym = ((g.get("_quote") or {}).get("symbol") or "").upper()
        need_usd = row["protocol"] not in ("raydium-clmm", "raydium-cpmm", "raydium-amm", "raydium-other", "orca-whirlpool") and quote_sym not in STABLES
        if need_usd:
            row["_ohu"] = gt_ohlcv(net, row["address"], "usd", limit=200)
        if (i + 1) % 25 == 0: log(f"  OHLCV {i + 1}/{len(rows)}")
    states = {k: v.result() for k, v in fut_state.items()}
    if top: sec_thread.join()
    json.dump(v4cache, open(v4cache_f, "w"), indent=1)
    import pickle
    states = {i: states[id(row)] for i, row in enumerate(rows)}
    pickle.dump({"rows": rows, "states": states, "sources": sources, "sub_floor": sub_floor, "RAW": RAW, "now": now},
                open(os.path.join(CACHE_DIR, f"fetch_{args.universe}.pkl"), "wb"))
    return finish(args, rows, states, sources, sub_floor, now, started_utc, london, date, snap_dir, rep_dir, wide, pool)

def finish(args, rows, states, sources, sub_floor, now, started_utc, london, date, snap_dir, rep_dir, wide, pool=None):
    from concurrent.futures import ThreadPoolExecutor
    if pool is None: pool = ThreadPoolExecutor(max_workers=args.workers)

    evm_tokens, sol_mints = {ch: set() for ch in EVM}, set()
    for i, row in enumerate(rows):
        try:
            compute_row(row, states[i], now)
        except Exception as e:
            row["notes"].append(f"error: {type(e).__name__}: {e}"); log("  error", row["address"], traceback.format_exc())
        elig = row.pop("_eligible", True)
        row["rank_eligible"] = elig
        for x in ("_g", "_d", "_r", "_oh", "_ohu", "_cts"): row.pop(x, None)
        if not elig: continue
        if row["chain"] in EVM:
            for t in (row.get("token0"), row.get("token1"), (row["base"].get("address") or "").lower(), (row["quote"].get("address") or "").lower()):
                if t and t not in REG["rh"]: evm_tokens[row["chain"]].add(t)    # canonical stock tokens: issuer-known, skip GoPlus
        else:
            for t in (row.get("mintA_addr"), row.get("mintB_addr")):
                if t: sol_mints.add(t)
    log(f"GoPlus ({sum(len(v) for v in evm_tokens.values())} tokens) + RugCheck ({len(sol_mints)} mints) in parallel...")
    skip = SEC_SKIP
    f_gp = {ch: pool.submit(goplus, evm_tokens[ch], ch) for ch in EVM}
    f_rc = pool.submit(rugcheck, [m for m in sol_mints if m not in skip], {})
    gpc = {ch: f_.result() for ch, f_ in f_gp.items()}; rc = f_rc.result()
    pool.shutdown()
    sources["goplus_4663"] = ", ".join(f"{CHAIN_CFG[ch]['short']} {len(gpc[ch])}/{len(evm_tokens[ch])}" for ch in EVM) + " non-registry tokens"
    sources["rugcheck"] = f"{len(rc)}/{len([m for m in sol_mints if m not in skip])} mints"
    sources["rugcheck_missing"] = sorted(m for m in sol_mints if m not in skip and m not in rc)
    sources["goplus_missing"] = sorted(f"{ch}:{t}" for ch in EVM for t in evm_tokens[ch] if t not in gpc[ch])
    for row in rows:
        add_security_flags(row, gpc.get(row["chain"], {}), rc)
        if wide and row.get("tvl_usd") is not None and row["tvl_usd"] < args.floor and not row["in_allowlist"]:
            row["flags"].append("below_floor")
        score_row(row)
        if not row.get("rank_eligible", True):
            row["score"] = None
    rows.sort(key=rank_key)
    for k_, row in enumerate(rows):
        row["rank"] = k_ + 1
    finished_utc = dt.datetime.now(dt.timezone.utc)
    snap = {"date": date, "universe": args.universe, "data_fetched_utc": [started_utc.isoformat(), finished_utc.isoformat()],
            "data_fetched_london": [started_utc.astimezone(london.tzinfo).isoformat(), finished_utc.astimezone(london.tzinfo).isoformat()],
            "sources": sources, "pools": rows, "sub_floor": sub_floor,
            "unresolved": [r_["address"] for r_ in rows if not (r_["src"]["gt"] or r_["src"]["ds"] or r_["src"]["raydium"])],
            "log_tail": LOG[-80:],
            "http_cache": {"hits": CACHE_STATS["hits"], "oldest_cached_response_utc": dt.datetime.fromtimestamp(CACHE_STATS["oldest"], dt.timezone.utc).isoformat() if CACHE_STATS["oldest"] else None}}
    snap["runtime_s"] = round((finished_utc - started_utc).total_seconds())
    snap["dex_scope"] = DEX_SCOPE[0]
    if wide: snap["universe_counts"] = universe_counts(snap)
    os.makedirs(snap_dir, exist_ok=True)
    prev = previous_snapshot(date, snap_dir)
    snap_path = os.path.join(snap_dir, f"{date}.json")
    json.dump(snap, open(snap_path, "w"), indent=1, default=str)
    rawdir = os.path.join(snap_dir, "raw"); os.makedirs(rawdir, exist_ok=True)
    with gzip.open(os.path.join(rawdir, f"{date}.json.gz"), "wt") as fh:
        json.dump(RAW, fh)
    md = render_wide(snap, prev) if wide else render_top(snap, prev, args.top) if args.universe == "top" else render(snap, args.top, prev)
    os.makedirs(rep_dir, exist_ok=True)
    if args.format in ("md", "both"):
        open(os.path.join(rep_dir, f"{date}.md"), "w").write(md)
    if args.format == "json":
        keep = ("rank", "name", "chain", "protocol", "address", "in_allowlist", "fee_tier_pct", "tvl_usd", "vol24_usd", "vol7d_usd",
                "fee_apr_7d", "vol_ann", "il7d_pool_avg_pct", "fees_7d_pct", "net_7d_pct", "fee_cover", "breakeven_move_7d_pct", "realized_move_7d_pct", "score", "flags")
        print(json.dumps({"date": date, "universe": args.universe, "data_fetched_london": snap["data_fetched_london"], "snapshot": snap_path,
                          "top": [{k: r_.get(k) for k in keep} | {"slip_1m": slip_str(r_)} for r_ in snap["pools"][:args.top]]}, default=str))
    else:
        print(md)
    resolved = sum(1 for r_ in rows if r_["src"]["gt"] or r_["src"]["ds"] or r_["src"]["raydium"])
    if resolved == 0:
        raise RuntimeError("no pools resolved from any public API (network down?)")
    log(f"Snapshot: {snap_path}  Report: {os.path.join(rep_dir, date + '.md')}")

def compute_row(row, st, now):
    g, d, r = row["_g"], row["_d"], row["_r"]
    p, a, chain = row["protocol"], row["address"], row["chain"]
    if st.get("error"): row["notes"].append("state fetch error: " + st["error"])
    o, m = st.get("orca"), st.get("met")
    row["name"] = g.get("name") or (f"{d['baseToken']['symbol']} / {d['quoteToken']['symbol']}" if d else None) \
        or (f"{r['mintA']['symbol']} / {r['mintB']['symbol']}" if r else None) or (m or {}).get("name") \
        or (f"{o['tokenA']['symbol']} / {o['tokenB']['symbol']}" if o else None)
    base, quote = g.get("_base") or {}, g.get("_quote") or {}
    db, dq = d.get("baseToken") or {}, d.get("quoteToken") or {}
    row["base"] = {"symbol": base.get("symbol") or db.get("symbol"), "address": base.get("address") or db.get("address"),
                   "name": base.get("name") or db.get("name"), "price_usd": f(g.get("base_token_price_usd")) or f(d.get("priceUsd"))}
    row["quote"] = {"symbol": quote.get("symbol") or dq.get("symbol"), "address": quote.get("address") or dq.get("address"),
                    "name": quote.get("name") or dq.get("name"), "price_usd": f(g.get("quote_token_price_usd"))}
    if row["quote"]["price_usd"] is None and d.get("priceUsd") and f(d.get("priceNative")):
        row["quote"]["price_usd"] = f(d["priceUsd"]) / f(d["priceNative"])     # DexScreener: priceUsd / priceNative
    row["dex_id"] = g.get("_dex") or d.get("dexId")
    cts = row.get("_cts")
    row["pool_created_utc"] = dt.datetime.fromtimestamp(cts, dt.timezone.utc).isoformat() if cts else None
    row["pool_age_days"] = round((now - cts) / 86400, 1) if cts else None
    row["tvl_usd_gt"] = f(g.get("reserve_in_usd")); row["tvl_usd_ds"] = f((d.get("liquidity") or {}).get("usd"))
    row["vol24_usd_gt"] = f((g.get("volume_usd") or {}).get("h24")); row["vol24_usd_ds"] = f((d.get("volume") or {}).get("h24"))
    row["vol7d_usd"] = None
    if r:
        row["tvl_usd"] = f(r.get("tvl")); row["tvl_source"] = "raydium"
        row["vol24_usd"] = f((r.get("day") or {}).get("volume")); row["vol7d_usd"] = f((r.get("week") or {}).get("volume"))
        row["vol_source"] = "raydium day/week"
        row["raydium_fee_apr_day"] = f((r.get("day") or {}).get("feeApr")); row["raydium_fee_apr_week"] = f((r.get("week") or {}).get("feeApr"))
        row["burn_percent"] = f(r.get("burnPercent"))
        row["mintA"], row["mintB"] = r["mintA"], r["mintB"]; row["mintA_addr"], row["mintB_addr"] = r["mintA"]["address"], r["mintB"]["address"]
    elif o:
        row["tvl_usd"] = f(o.get("tvlUsdc")); row["tvl_source"] = "orca"
        stt = o.get("stats") or {}
        row["vol24_usd"] = f((stt.get("24h") or {}).get("volume")); row["vol7d_usd"] = f((stt.get("7d") or {}).get("volume")); row["vol_source"] = "orca stats 24h/7d"
        row["mintA_addr"], row["mintB_addr"] = o.get("tokenMintA"), o.get("tokenMintB")
    elif m:
        row["tvl_usd"] = f(m.get("tvl")); row["tvl_source"] = "meteora"
        row["vol24_usd"] = f((m.get("volume") or {}).get("24h")); row["vol_source"] = "meteora 24h + GT hourly 7d"
        row["mintA_addr"], row["mintB_addr"] = (m.get("token_x") or {}).get("address"), (m.get("token_y") or {}).get("address")
    else:
        row["tvl_usd"] = row["tvl_usd_gt"] if row["tvl_usd_gt"] is not None else row["tvl_usd_ds"]
        row["tvl_source"] = "geckoterminal" if row["tvl_usd_gt"] is not None else ("dexscreener" if row["tvl_usd_ds"] is not None else None)
        row["vol24_usd"] = row["vol24_usd_gt"] if row["vol24_usd_gt"] is not None else row["vol24_usd_ds"]
        row["vol_source"] = "geckoterminal h24 + hourly OHLCV (168h)"
        if chain == "solana":
            row["mintA_addr"], row["mintB_addr"] = row["base"].get("address"), row["quote"].get("address")
    # OHLCV-derived
    oh, ohu = row.get("_oh"), row.get("_ohu")
    sig_d, n = realized_vol(oh, now)
    row["vol_daily"] = sig_d; row["vol_obs_days"] = n; row["vol_ann"] = sig_d * math.sqrt(365) if sig_d else None
    if not g: row["notes"].append("not on GeckoTerminal: no OHLCV volatility")
    if row["vol7d_usd"] is None:
        if ohu:
            row["vol7d_usd"] = sum(c[5] for c in ohu if c[0] >= now - 7 * 86400)
        elif oh and (row["quote"].get("symbol") or "").upper() in STABLES and row["quote"].get("price_usd"):
            row["vol7d_usd"] = sum(c[5] for c in oh if c[0] >= now - 7 * 86400) * row["quote"]["price_usd"]
            row["notes"].append("vol7d = GT hourly quote-token volume x current stable price")
    # fee tier / LP share / depth / CE
    tvl = row.get("tvl_usd"); depth = None; ce = None
    gfee = f(g.get("pool_fee_percentage"))
    cl = st.get("cl")
    if p == "uniswap-v4" and st.get("v4key") is None:
        row["notes"].append("v4 PoolKey not found")
    if cl:
        if p == "uniswap-v3":
            row["fee_tier_pct"] = cl["fee"] / 1e4; row["lp_fee_share"] = cl["lp_fee_share"]; row["fee_protocol_raw"] = cl["feeProtocol"]
        elif p == "uniswap-v4":
            key = st["v4key"]; row["v4_key"] = key; row["lp_fee_share"] = 1.0; row["v4_protocol_fee_pips"] = cl.get("protocol_fee_pips")
            row["fee_tier_pct"] = cl["lpFee"] / 1e4
            if key["fee"] == 0x800000:
                row["flags"].append("v4_dynamic_fee")
                fees = st.get("v4fees")
                if fees:
                    fees = sorted(fees); med = fees[len(fees) // 2]; row["fee_tier_pct"] = med / 1e4
                    row["notes"].append(f"dynamic fee: median of {len(fees)} recent Swap-event fees = {med / 1e4:.4f}%")
                else:
                    row["fee_tier_pct"] = None; row["notes"].append("dynamic fee, no recent Swap events: fee n/a")
            if int(key["hooks"], 16) != 0:
                row["flags"].append("v4_hook"); row["notes"].append(f"hook {key['hooks']}: depth sim ignores hook logic")
        else:  # v3 fork
            row["fee_tier_pct"] = cl["fee"] / 1e4; row["lp_fee_share"] = 1.0
            row["notes"].append("v3 fork: protocol-fee share not decoded, fee APR is gross")
        t0, t1 = cl["token0"].lower(), cl["token1"].lower(); row["token0"], row["token1"] = t0, t1
        decs = st.get("decs") or {}
        p0, p1 = price_map(row, t0, t1)
        s0 = cl["sqrtPriceX96"] / 2 ** 96
        row["active_liquidity"] = str(cl["liquidity"]); row["initialized_ticks_scanned"] = len(cl["ticks"])
        row["tick"], row["tick_spacing"] = cl["tick"], cl["tickSpacing"]
        if decs.get(t0) is not None and decs.get(t1) is not None and p0 and p1:
            lo_e, hi_e = cl["window"]
            depth = depth_metrics(s0, float(cl["liquidity"]), cl["tick"], cl["ticks"], decs[t0], decs[t1], p0, p1, lo_e, hi_e)
            depth["method"] = f"on-chain tick walk via {CHAIN_CFG[chain]['label']} RPC, {cl['words_scanned']} bitmap words, window 1/100x-100x spot"
            row["onchain_price_token1_per_token0"] = s0 * s0 * 10 ** (decs[t0] - decs[t1])
            if tvl:
                lfull = tvl / p1 * 10 ** decs[t1] / (2 * s0); ce = cl["liquidity"] / lfull if lfull > 0 else None
        else:
            row["notes"].append("missing decimals/prices for depth sim")
    elif st.get("v2"):
        v2 = st["v2"]; t0, t1 = v2["token0"].lower(), v2["token1"].lower(); row["token0"], row["token1"] = t0, t1
        decs = st.get("decs") or {}
        if p == "uniswap-v2":
            row["fee_tier_pct"] = 0.30; row["notes"].append("Uniswap v2 fee 0.30% (protocol constant), feeTo assumed off")
        else:
            row["fee_tier_pct"] = gfee
        row["lp_fee_share"] = 1.0
        p0, p1 = price_map(row, t0, t1)
        if decs.get(t0) is not None and decs.get(t1) is not None and p0 and p1:
            x, y = v2["reserve0"] / 10 ** decs[t0], v2["reserve1"] / 10 ** decs[t1]
            depth = cp_depth(x, y, p0, p1, "x*y=k from on-chain getReserves()"); ce = 1.0
    elif r:
        cfg = r.get("config") or {}
        trade = f(cfg.get("tradeFeeRate"))
        row["fee_tier_pct"] = trade / 1e4 if trade is not None else ((f(r.get("feeRate")) or 0) * 100 if r.get("feeRate") is not None else None)
        if p == "raydium-amm" and not cfg:
            row["lp_fee_share"] = 0.88; row["notes"].append("Raydium AMM v4: 0.22% of 0.25% to LPs (Raydium docs), share 0.88")
        else:
            row["lp_fee_share"] = 1 - ((f(cfg.get("protocolFeeRate")) or 0) + (f(cfg.get("fundFeeRate")) or 0)) / 1e6
        cr = f(cfg.get("creatorFeeRate"))
        if cr:
            row["creator_fee_pct"] = cr / 1e4; row["notes"].append(f"creator fee {cr / 1e4:.2f}% to pool creator (not LPs)")
        pa, pb = mint_prices(row, r["mintA"]["address"], r["mintB"]["address"])
        if p in ("raydium-cpmm", "raydium-amm"):
            x, y = f(r.get("mintAmountA")), f(r.get("mintAmountB"))
            if x and y and pa and pb:
                depth = cp_depth(x, y, pa, pb, "x*y=k from Raydium mintAmountA/B"); ce = 1.0
        elif p == "raydium-clmm":
            ln = st.get("ray_line")
            pts = ((ln or {}).get("data") or {}).get("line") or []
            da, dbb = r["mintA"]["decimals"], r["mintB"]["decimals"]
            price = f(r.get("price"))
            if pts and pa and pb and price:
                pts = sorted(pts, key=lambda z: z["tick"])
                s0 = math.sqrt(price * 10 ** (dbb - da))
                cur = math.floor(math.log(s0 * s0) / math.log(1.0001))
                ticks, prev, L0 = [], 0, 0
                for z in pts:
                    Lz = float(z["liquidity"]); ticks.append((z["tick"], Lz - prev)); prev = Lz
                    if z["tick"] <= cur: L0 = Lz
                ticks.append((pts[-1]["tick"] + (cfg.get("tickSpacing") or 1), -prev))
                depth = depth_metrics(s0, L0, cur, ticks, da, dbb, pa, pb, MIN_TICK, MAX_TICK)
                depth["method"] = f"tick walk over Raydium /pools/line/position ({len(pts)} segments)"
                row["active_liquidity"] = str(int(L0)); row["tick"] = cur
                if tvl:
                    lfull = tvl / pb * 10 ** dbb / (2 * s0); ce = L0 / lfull if lfull > 0 else None
                row["_segments_check"] = segments_token_amounts(pts, s0, cur, da, dbb, ticks[-1][0])
            else:
                row["notes"].append("Raydium liquidity line or prices unavailable: depth n/a")
    elif o:
        row["fee_tier_pct"] = (f(o.get("feeRate")) or 0) / 1e4
        row["lp_fee_share"] = 1 - (f(o.get("protocolFeeRate")) or 0) / 1e4
        if o.get("adaptiveFeeEnabled"): row["flags"].append("orca_adaptive_fee"); row["notes"].append("adaptive fee: base feeRate used")
        da, dbb = o["tokenA"]["decimals"], o["tokenB"]["decimals"]
        pa, pb = mint_prices(row, o["tokenMintA"], o["tokenMintB"])
        s0 = int(o["sqrtPrice"]) / 2 ** 64
        if tvl and pb:
            lfull = tvl / pb * 10 ** dbb / (2 * s0); ce = int(o["liquidity"]) / lfull if lfull > 0 else None
        row["active_liquidity"] = o.get("liquidity"); row["tick"] = o.get("tickCurrentIndex")
        row["notes"].append("Orca: depth n/a (tick arrays need Solana RPC account decoding; not implemented)")
    elif m:
        cfg = m.get("pool_config") or {}
        row["fee_tier_pct"] = f(cfg.get("base_fee_pct")); row["lp_fee_share"] = 1 - (f(cfg.get("protocol_fee_pct")) or 0) / 100
        fees24 = f((m.get("fees") or {}).get("24h")); pf24 = f((m.get("protocol_fees") or {}).get("24h"))
        if fees24 is not None and tvl:
            row["fee_apr_24h_actual"] = (fees24 - (pf24 or 0)) * 365 / tvl * 100
        row["notes"].append(f"Meteora DLMM bin_step {cfg.get('bin_step')}: depth n/a (bin data not fetched); 7d APR uses base fee only (dynamic fee excluded)")
    else:
        row["fee_tier_pct"] = gfee; row["lp_fee_share"] = 1.0
        if gfee is None: row["notes"].append("fee tier not exposed by public APIs: fee APR n/a")
        if p == "pumpswap" or p == "meteora-damm":
            liq = d.get("liquidity") or {}
            pa, pb = row["base"].get("price_usd"), row["quote"].get("price_usd")
            if f(liq.get("base")) and f(liq.get("quote")) and pa and pb:
                depth = cp_depth(f(liq["base"]), f(liq["quote"]), pa, pb, "x*y=k from DexScreener reserves"); ce = 1.0
    if row.get("fee_tier_pct") is None and gfee is not None:
        row["fee_tier_pct"] = gfee; row.setdefault("lp_fee_share", 1.0)
    fee = (row.get("fee_tier_pct") or 0) / 100; share = row.get("lp_fee_share") or 1.0
    if tvl and row.get("fee_tier_pct") is not None:
        if row.get("vol24_usd") is not None:
            row["fee_apr_24h_gross"] = row["vol24_usd"] * fee * 365 / tvl * 100; row["fee_apr_24h"] = row["fee_apr_24h_gross"] * share
        if row.get("vol7d_usd") is not None:
            row["fee_apr_7d_gross"] = row["vol7d_usd"] / 7 * fee * 365 / tvl * 100; row["fee_apr_7d"] = row["fee_apr_7d_gross"] * share
    row["depth"] = depth; row["capital_efficiency_vs_full_range"] = ce
    if row.get("vol_daily"):
        s7 = row["vol_daily"] * math.sqrt(7); il_full = s7 ** 2 / 8; cap = s7 / 2
        ce_typ = 1 / (1 - 1 / math.sqrt(1 + TYPICAL_RANGE))
        row["il7d_full_range_pct"] = il_full * 100
        row["il7d_typical_range_pct"] = min(il_full * ce_typ, cap) * 100
        if p in CP_PROTOCOLS:
            row["il7d_pool_avg_pct"] = il_full * 100
        elif ce:
            row["il7d_pool_avg_pct"] = min(il_full * min(max(ce, 1.0), 200.0), cap) * 100
        else:
            row["il7d_pool_avg_pct"] = row["il7d_typical_range_pct"]; row["flags"].append("il_assumed_±10%range")
    # stock tagging (canonical registries)
    stocks = []
    for tk in (row["base"], row["quote"]):
        sym = stock_symbol(chain, tk.get("address"))
        if sym:
            stocks.append(sym); row["flags"].append(f"tokenized_stock:{sym}")
        elif chain == "robinhood" and "robinhood token" in (tk.get("name") or "").lower():
            row["flags"].append(f"LOOKALIKE_stock_token:{tk.get('symbol')}")
    if not stocks and r:
        for mk in ("mintA", "mintB"):
            if "tokenized equity" in json.dumps((r.get(mk) or {}).get("extensions", {})).lower():
                stocks.append(r[mk]["symbol"]); row["flags"].append(f"tokenized_stock:{r[mk]['symbol']}")
    row["is_tokenized_stock_pool"] = bool(stocks)
    if stocks:
        majors = STABLES | MAJOR_SYMS
        for tk in (row["base"], row["quote"]):
            sym = (tk.get("symbol") or "").upper()
            if not stock_symbol(chain, tk.get("address")) and sym not in majors:
                row["flags"].append(f"meme_vs_stock:{tk.get('symbol')}")
    row["stock_issuers"] = sorted({stock_issuer(chain, tk.get("address")) for tk in (row["base"], row["quote"])} - {None})
    if stocks and "tokenized_stock" not in row["categories"]: row["categories"] = sorted(set(row["categories"]) | {"tokenized_stock"})
    if tvl is not None:
        for lvl, lab in ((5e6, "tvl_5m"), (2e6, "tvl_2m"), (1e6, "tvl_1m")):
            if tvl >= lvl: row["tier"] = lab; break
    add_basic_flags(row, now)

MAJOR_SYMS = {"SOL", "WSOL", "WETH", "ETH", "WBTC", "CBBTC", "JITOSOL", "MSOL", "BNSOL", "WSTETH", "CBETH", "STETH", "RETH", "WEETH", "TBTC", "LBTC"}

def price_map(row, t0, t1):
    pm = {}
    for tk in (row["base"], row["quote"]):
        if tk.get("address") and tk.get("price_usd"): pm[tk["address"].lower()] = tk["price_usd"]
    for t in (t0, t1):
        if t not in pm:
            other = [k for k in pm if k not in (t0, t1)]
            if other:
                pm[t] = pm[other[0]]; row["notes"].append(f"price of {t} taken from GT token {other[0]} (native/wrapped mapping)")
    return pm.get(t0), pm.get(t1)

def mint_prices(row, ma, mb):
    pa = pb = None
    for tk in (row["base"], row["quote"]):
        if tk.get("address") == ma: pa = tk.get("price_usd")
        if tk.get("address") == mb: pb = tk.get("price_usd")
    return pa, pb

def cp_depth(x, y, px, py, method):
    dpt = {"sizes": {}, "depth_2pct_usd": {}, "method": method}
    for usd in TRADE_SIZES:
        dx, dy = usd / px, usd / py
        ia, ib = dx / (x + dx) * 100, dy / (y + dy) * 100
        dpt["sizes"][str(usd)] = {"sell_token0": {"impact_pct": round(ia, 4)}, "sell_token1": {"impact_pct": round(ib, 4)},
                                  "worst_impact_pct": round(max(ia, ib), 4), "any_exhausted": False}
    dpt["depth_2pct_usd"] = {"down_2pct_sell_token0": round(x * (1 / math.sqrt(0.98) - 1) * px), "up_2pct_sell_token1": round(y * (1 / math.sqrt(0.98) - 1) * py)}
    return dpt

def segments_token_amounts(pts, s0, cur, da, db, last_tick):
    """Token amounts implied by Raydium liquidity segments (sanity check vs pool vault amounts)."""
    a0 = a1 = 0.0
    for i, z in enumerate(pts):
        t_lo = z["tick"]; t_hi = pts[i + 1]["tick"] if i + 1 < len(pts) else last_tick
        L = float(z["liquidity"]); sl, sh = tick_to_s(t_lo), tick_to_s(t_hi)
        if s0 <= sl:
            a0 += L * (1 / sl - 1 / sh)
        elif s0 >= sh:
            a1 += L * (sh - sl)
        else:
            a0 += L * (1 / s0 - 1 / sh); a1 += L * (s0 - sl)
    return {"implied_amountA": a0 / 10 ** da, "implied_amountB": a1 / 10 ** db}

def is_stock(tok, row):
    n = (tok.get("name") or "").lower()
    if "robinhood token" in n or "xstock" in n or "tokenized" in n or "backed" in n:
        return True
    for k in ("mintA", "mintB"):
        m = row.get(k) or {}
        if m.get("address") == tok.get("address") and "tokenized equity" in json.dumps(m.get("extensions", {})).lower():
            return True
    return False

def add_basic_flags(row, now):
    fl = row["flags"]
    tvl = row.get("tvl_usd")
    if tvl is not None and tvl < 50_000: fl.append("low_tvl<50k")
    if tvl is None: fl.append("tvl_n/a")
    if row.get("pool_age_days") is not None and row["pool_age_days"] < 14: fl.append(f"new_pool<14d")
    v24, v7 = row.get("vol24_usd"), row.get("vol7d_usd")
    if v24 is not None and v7:
        ratio = v24 / (v7 / 7)
        row["vol24_vs_7d_avg"] = ratio
        if ratio < 0.3: fl.append("vol_collapse(24h<30% of 7d avg)")
    if tvl and v7 is not None and v7 / 7 / tvl < 0.01: fl.append("dead_volume(<1% TVL/day)")
    for tk in (row["base"], row["quote"]):
        sym = (tk.get("symbol") or "").upper()
        if sym in STABLES and tk.get("price_usd") and abs(tk["price_usd"] - 1) > 0.01:
            fl.append(f"depeg:{sym}@{tk['price_usd']:.4f}")
    for k in ("mintA", "mintB"):
        m = row.get(k) or {}
        if "hasTransferFee" in (m.get("tags") or []):
            bps = (((m.get("extensions") or {}).get("feeConfig") or {}).get("newerTransferFee") or {}).get("transferFeeBasisPoints")
            fl.append(f"transfer_fee:{m.get('symbol')}{'=' + str(bps / 100) + '%' if bps else ''}")
        if "hasFreeze" in (m.get("tags") or []):
            fl.append(f"freeze_auth:{m.get('symbol')}")
    d = row.get("depth")
    if d:
        s1 = d["sizes"].get("1000000", {})
        if s1.get("any_exhausted"): fl.append("cannot_fill_$1M")
        elif s1.get("worst_impact_pct") is not None and s1["worst_impact_pct"] > 5: fl.append("slip$1M>5%")
        d2 = [v for v in (d.get("depth_2pct_usd") or {}).values()]
        if d2 and all(v is not None for v in d2) and min(d2) < 10_000:
            fl.append(f"thin_side(2%depth<{fmt_usd(min(d2))})")
    else:
        fl.append("depth_n/a")
    if row.get("vol_ann") is None: fl.append("vol_n/a")
    if datetime_is_weekend() and any(x.startswith("tokenized_stock") for x in fl):
        row["notes"].append("weekend: tokenized-stock 24h volume structurally low; use 7d figures")

def datetime_is_weekend():
    return dt.datetime.now(dt.timezone.utc).weekday() >= 5

def add_security_flags(row, gp, rc):
    fl = row["flags"]; stockish = any(x.startswith("tokenized_stock") for x in fl)
    row["security"] = {}
    if row["chain"] in EVM:
        toks = {row.get("token0"), row.get("token1")} - {None} or {(row["base"].get("address") or "").lower(), (row["quote"].get("address") or "").lower()} - {""}
        for t in toks:
            g = gp.get(t)
            if not g: continue
            sym = g.get("token_symbol")
            holders = g.get("holders") or []
            top_eoa = max([f(h.get("percent")) or 0 for h in holders if not h.get("is_contract")] or [0])
            row["security"][sym] = {k: g.get(k) for k in ("is_open_source", "is_proxy", "is_mintable", "owner_address", "can_take_back_ownership",
                                                          "hidden_owner", "selfdestruct", "buy_tax", "sell_tax", "is_honeypot", "holder_count",
                                                          "transfer_pausable", "is_blacklisted")}
            row["security"][sym]["top_eoa_holder_pct"] = top_eoa * 100
            if g.get("is_honeypot") == "1": fl.append(f"HONEYPOT:{sym}")
            if (f(g.get("buy_tax")) or 0) > 0 or (f(g.get("sell_tax")) or 0) > 0: fl.append(f"tax:{sym}")
            if g.get("is_open_source") == "0": fl.append(f"unverified:{sym}")
            if g.get("is_mintable") == "1": fl.append(f"mintable:{sym}")
            if g.get("hidden_owner") == "1": fl.append(f"hidden_owner:{sym}")
            if g.get("is_proxy") == "1" and not stockish and sym not in STABLES: fl.append(f"proxy:{sym}")
            if top_eoa > 0.3:
                if stock_symbol(row["chain"], t):   # registry/issuer stock token: custody concentration is structural (as for xStocks on Solana)
                    if f"holder_conc:{sym}" not in fl: fl.append(f"holder_conc:{sym}")
                    row["notes"].append(f"GoPlus top holder {int(top_eoa * 100)}% on issuer stock token {sym}: downgraded to holder_conc")
                else:
                    fl.append(f"top_holder>{int(top_eoa * 100)}%:{sym}")
    else:
        syms = {row["base"].get("address"): row["base"].get("symbol"), row["quote"].get("address"): row["quote"].get("symbol")}
        for k in ("mintA_addr", "mintB_addr"):
            ma = row.get(k)
            if not ma or ma not in rc: continue
            d = rc[ma]; sym = syms.get(ma) or (row.get(k[:5]) or {}).get("symbol") or ma[:6]
            risks = [x.get("name") for x in d.get("risks") or []]
            row["security"][sym] = {"rugcheck_score_normalised": d.get("score_normalised"), "risks": risks, "lpLockedPct": d.get("lpLockedPct")}
            xstock = ma in REG["xstocks"]
            for x in d.get("risks") or []:
                nm = x.get("name", "")
                holder_risk = any(h in nm for h in ("Single holder", "Top 10 holders", "High ownership", "High holder"))
                if x.get("level") == "danger" and holder_risk and xstock:
                    # verified xStocks (issuer registry): custody concentration is structural -> ordinary warning, not exclusion
                    if f"holder_conc:{sym}" not in fl: fl.append(f"holder_conc:{sym}")
                    row.setdefault("notes", []).append(f"RugCheck danger '{nm}' on verified xStock {sym} downgraded to holder_conc")
                elif x.get("level") == "danger":
                    if "Mint Authority" in nm: fl.append(f"mint_auth:{sym}")
                    elif "Freeze Authority" in nm: (f"freeze_auth:{sym}" in fl) or fl.append(f"freeze_auth:{sym}")
                    elif "Permanent" in nm: fl.append(f"perm_delegate:{sym}")
                    else: fl.append(f"rugcheck_danger:{sym}:{nm[:30]}")
                elif holder_risk:
                    if f"holder_conc:{sym}" not in fl: fl.append(f"holder_conc:{sym}")
    if row.get("burn_percent") is not None and row["burn_percent"] < 50 and row["protocol"] == "raydium-cpmm":
        fl.append(f"lp_unburned({row['burn_percent']:.0f}%burned)")

PEN = [("HONEYPOT", .9), ("tax:", .3), ("low_tvl", .5), ("cannot_fill_$1M", .3), ("slip$1M>5%", .15), ("depeg", .5),
       ("vol_collapse", .15), ("dead_volume", .2), ("new_pool", .2), ("unverified", .3), ("hidden_owner", .3),
       ("transfer_fee", .25), ("rugcheck_danger", .3), ("holder_conc", .1), ("top_holder", .1), ("lp_unburned", .1),
       ("v4_hook", .05), ("thin_side", .3), ("depth_n/a", .2), ("vol_n/a", .2), ("tvl_n/a", .5), ("proxy", .05)]
ISSUER_CTRL = [("mint_auth", .1), ("freeze_auth", .1), ("perm_delegate", .1), ("mintable", .1)]

def score_row(row):
    apr = row.get("fee_apr_7d")
    if apr is None:
        apr = row.get("fee_apr_24h")
    il = row.get("il7d_pool_avg_pct")
    m7 = lp7(row)
    row["fees_7d_pct"], row["net_7d_pct"] = m7["fees_7d"], m7["net_7d"]
    row["fee_cover"] = "inf" if m7["cover"] == math.inf else m7["cover"]
    row["breakeven_move_7d_pct"], row["realized_move_7d_pct"] = m7["breakeven"], m7["realized"]
    if apr is None or il is None or m7["cover"] is None:   # never rank on fees alone: IL n/a -> unscored (see needs_review)
        row["score"] = None; row["net_apr_after_il"] = None; return
    il_ann = il * 365 / 7
    net = apr - il_ann                     # legacy field only (not shown, not ranked)
    stockish = any(x.startswith("tokenized_stock") for x in row["flags"])
    mult = 1.0; used = []
    for fl in row["flags"]:
        for pfx, w in PEN:
            if fl.startswith(pfx): mult *= (1 - w); used.append(fl); break
        else:
            for pfx, w in ISSUER_CTRL:
                if fl.startswith(pfx):
                    w = w * 0.3 if stockish else w   # issuer controls are expected for regulated tokenized stocks
                    mult *= (1 - w); used.append(fl); break
    row["net_apr_after_il"] = net
    row["risk_multiplier"] = mult
    row["score"] = cover_sort(row) * mult  # allowlist ranking: fee cover x risk multiplier (tiebreak Net 7d, see rank_key)

def rank_key(z):
    return (z.get("score") is None, -(z["score"] if z.get("score") is not None else 0), -(lp7(z)["net_7d"] or 0))

def fmt_usd(x):
    if x is None: return "n/a"
    for d, s in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if abs(x) >= d: return f"${x / d:.2f}{s}"
    return f"${x:.0f}"

def fmt_pct(x, nd=1):
    return "n/a" if x is None else f"{x:.{nd}f}%"

def slip_str(row, size="1000000"):
    d = row.get("depth")
    if not d: return "n/a"
    s = d["sizes"].get(size) or {}
    if s.get("any_exhausted"):
        fill = min([v.get("fillable_usd") or 0 for v in s.values() if isinstance(v, dict) and v.get("exhausted")] or [0])
        return f"can't fill (max ~{fmt_usd(fill)})"
    return fmt_pct(s.get("worst_impact_pct"), 2)


def short_addr(a): return a[:6] + "…" + a[-4:]

# ---------------------------------------------------------------- report filters (shared by allowlist + wide reports)
EXCLUDE_FLAG_PREFIXES = ("meme_vs_stock", "dead_volume", "rugcheck_danger", "unverified", "top_holder", "HONEYPOT", "LOOKALIKE")
FAKE_TVL_MIN_DEPTH = {"stock": 5_000, "major": 50_000}   # min USD to move price 2% (either side)
MAJOR_MIN_VOL7D_TVL = 0.10
STOCK_MIN_TVL, MAJOR_MIN_TVL = 100_000, 1_000_000
STOCK_MIN_TVL_BY_CHAIN = {"base": 25_000}   # stock-pool TVL floor overrides (other chains: STOCK_MIN_TVL)
def stock_min_tvl(chain): return STOCK_MIN_TVL_BY_CHAIN.get(chain, STOCK_MIN_TVL)

def net_apr(r):
    if r.get("fee_apr_7d") is None or r.get("il7d_pool_avg_pct") is None: return None
    return r["fee_apr_7d"] - r["il7d_pool_avg_pct"] * 365 / 7

IL_ZERO_PCT = 1e-4   # Est IL 7d below this (in %) counts as ~0 -> fee cover shown as infinite

def il_model(r):
    """(C, capped) exactly as compute_row's IL estimate: constant-product C=1 uncapped; CL: measured CE clamped [1,200]
    else assumed +/-10% range CE; CL estimates are capped at sigma_w/2."""
    if (r.get("protocol") or "") in CP_PROTOCOLS: return 1.0, False
    ce = r.get("capital_efficiency_vs_full_range")
    if ce: return min(max(ce, 1.0), 200.0), True
    return 1 / (1 - 1 / math.sqrt(1 + TYPICAL_RANGE)), True

def lp7(r):
    """7-day horizon-matched LP metrics (all in %, not annualised)."""
    fees = r["fee_apr_7d"] / 52 if r.get("fee_apr_7d") is not None else None
    il = r.get("il7d_pool_avg_pct")
    net = fees - il if (fees is not None and il is not None) else None
    if fees is None or il is None: cover = None
    elif il < IL_ZERO_PCT: cover = math.inf if fees > 0 else None
    else: cover = fees / il
    be = None
    if fees is not None and fees >= 0:
        C, capped = il_model(r); F = fees / 100
        sw = math.sqrt(8 * F / C)
        if capped and sw > 4 / C: sw = 2 * F       # cap branch: IL = sigma_w/2 once sigma_w > 4/C
        be = sw * 100
    rz = r["vol_daily"] * math.sqrt(7) * 100 if r.get("vol_daily") else None
    return {"fees_7d": fees, "il_7d": il, "net_7d": net, "cover": cover, "breakeven": be, "realized": rz}

def cover_sort(r):
    c = lp7(r)["cover"]
    return -1e9 if c is None else (1e6 if c == math.inf else c)

def fmt_cover(r):
    c = lp7(r)["cover"]
    if c is None: return "n/a"
    if c == math.inf: return "∞ (IL≈0)"
    return f"{c:.0f}x" if abs(c) >= 100 else f"{c:.1f}x"

def fmt_move(r):
    m = lp7(r)
    if m["breakeven"] is None and m["realized"] is None: return "n/a"
    cush = f" ({m['breakeven'] / m['realized']:.1f}x)" if (m["breakeven"] is not None and m["realized"]) else ""
    return f"{fmt_pct(m['breakeven'], 1)} vs {fmt_pct(m['realized'], 1)}{cush}"

def lp7_cells(r):
    m = lp7(r)
    return (f"{fmt_pct(r.get('fee_apr_7d'))} | {fmt_pct(m['fees_7d'], 2)} | {fmt_pct(m['il_7d'], 2)} | {fmt_pct(m['net_7d'], 2)} | "
            f"{fmt_cover(r)} | {fmt_move(r)}")

LP7_COLS = "Fee APR 7d | Fees 7d | Est IL 7d | Net 7d | Fee cover | Break-even vs realized 7d move (cushion)"

# Column order for every report table (Sid, 2026-10-19):
# # | Pool | APR | Fee | TVL | [Tier] | Fees 7d | IL 7d | Net 7d | Cover | Break-even vs realized | Vol ... | $1M slip / max fill | Flags | Allowlist
def table_hdr(vols=("24h", "7d"), tier=False):
    cols = ["#", "Pool", "APR", "Fee", "TVL"] + (["Tier"] if tier else []) + \
           ["Fees 7d", "IL 7d", "Net 7d", "Cover", "Break-even vs realized"] + [f"Vol {v}" for v in vols] + ["$1M slip / max fill", "Flags", "Allowlist"]
    return ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]

def table_line(i, r, vols=("24h", "7d"), tier=False, full_addr=True, flags=None):
    m = lp7(r)
    addr = f"`{r['address']}`" if full_addr else short_addr(r["address"])
    cells = [str(i), f"{short_name(r)} ({chain_dex(r)}) {addr}", fmt_pct(r.get("fee_apr_7d")), fmt_pct(r.get("fee_tier_pct"), 2), fmt_usd(r.get("tvl_usd"))]
    if tier: cells.append(tier_fn(r))
    cells += [fmt_pct(m["fees_7d"], 2), fmt_pct(m["il_7d"], 2), fmt_pct(m["net_7d"], 2), fmt_cover(r), fmt_move(r)]
    cells += [fmt_usd(r.get("vol24_usd") if v == "24h" else r.get("vol7d_usd")) for v in vols]
    cells += [slip_str(r), flags if flags is not None else key_flags(r), "Y" if r.get("in_allowlist", True) else "N"]   # v1 allowlist snapshots lack the key
    return "| " + " | ".join(cells) + " |"

def stock_rank(rows):
    return sorted([r for r in rows if lp7(r)["cover"] is not None], key=lambda r: (-cover_sort(r), -(lp7(r)["net_7d"] or 0)))

def min_depth2(r):
    d = (r.get("depth") or {}).get("depth_2pct_usd") or {}
    v = [x for x in d.values() if x is not None]
    return min(v) if len(v) == 2 else (0 if d and any(x is None for x in d.values()) else None)

def exclusion(r, kind):
    """Reason string if pool must not appear in a ranked table, else None. kind: 'stock' | 'major' | 'allowlist'."""
    bad = [x for x in r["flags"] if x.startswith(EXCLUDE_FLAG_PREFIXES)]
    if bad: return "flag:" + bad[0]
    is_stock = r.get("is_tokenized_stock_pool") or any(x.startswith("tokenized_stock:") for x in r["flags"])
    k = "major" if kind == "major" or (kind == "allowlist" and not is_stock) else "stock"
    md = min_depth2(r)
    if md is not None and md < FAKE_TVL_MIN_DEPTH[k]: return f"fake_tvl:2%depth {fmt_usd(md)} < {fmt_usd(FAKE_TVL_MIN_DEPTH[k])}"
    if kind == "major":
        tvl, v7 = r.get("tvl_usd") or 0, r.get("vol7d_usd")
        if v7 is None or (tvl and v7 / tvl < MAJOR_MIN_VOL7D_TVL): return "fake_tvl:vol7d<10%TVL"
    return None

def needs_review(r):
    return r.get("il7d_pool_avg_pct") is None and any(x.startswith(("v4_hook", "v4_dynamic_fee")) for x in r["flags"])

def short_name(r):
    name = (r.get("name") or "?").replace(" / ", "/")
    for cut in (" 0.", " 1%", " 0%", " 2%", " 3%", " 5%"):
        name = name.split(cut)[0]
    return name

KEY_FLAG_SKIP = ("tokenized_stock:", "cannot_fill_$1M", "vol_n/a", "tvl_", "freeze_auth", "mint_auth", "perm_delegate", "mintable", "proxy")

def key_flags(r, n=4):
    return ", ".join([x for x in r["flags"] if not x.startswith(KEY_FLAG_SKIP)][:n]) or "–"

def tier_fn(r): return tier(r)

def tier(r):
    t = r.get("tvl_usd") or 0
    return "$5M+" if t >= 5e6 else "$2M+" if t >= 2e6 else "$1M+" if t >= 1e6 else "–"

def render(snap, top, prev):
    rows = snap["pools"]
    L = [f"# LP scan {snap['date']}", "",
         f"Data fetched {snap['data_fetched_london'][0][:16].replace('T', ' ')} – {snap['data_fetched_london'][1][11:16]} Europe/London",
         ""] + table_hdr()
    ok = [x for x in rows if x.get("score") is not None and not exclusion(x, "allowlist")]
    for i, r in enumerate(ok[:top]):
        L.append(table_line(i + 1, r, full_addr=False, flags=", ".join(r["flags"]) or "–"))
    L += ["", "Rank = Fee cover (Fees 7d / Est IL 7d) × Π(1 − flag penalty), tiebreak Net 7d; pools with IL n/a are unscored. "
          "All 7d figures are horizon-matched and not annualised. Slip = worst-direction price impact excl. swap fee.", ""]
    ex = [(x, exclusion(x, "allowlist")) for x in rows if exclusion(x, "allowlist")]
    if ex:
        L.append(f"Excluded by report filters ({len(ex)}): " + "; ".join(f"{short_name(x)} ({short_addr(x['address'])}) {why.split(':')[0]}:{why.split(':')[1].split('(')[0]}" for x, why in ex))
    rv = [x for x in rows if needs_review(x)]
    if rv:
        L.append(""); L.append("Needs review (v4 hook/dynamic fee, IL n/a): " + ", ".join(f"{short_name(x)} ({short_addr(x['address'])})" for x in rv))
    L.append(""); L.append("**What changed:** " + what_changed(snap, prev))
    unres = snap.get("unresolved") or []
    if unres:
        L.append(""); L.append("Unresolved pools: " + ", ".join(unres))
    nos = [r for r in rows if r.get("score") is None and not needs_review(r)]
    if nos:
        L.append(""); L.append("Unscored (fee APR or IL n/a): " + ", ".join(f"{short_name(r)} ({short_addr(r['address'])})" for r in nos))
    return "\n".join(L)

def previous_snapshot(date, snap_dir=None):
    if not os.path.isdir(snap_dir): return None
    c = sorted(x for x in os.listdir(snap_dir) if x.endswith(".json") and x[:-5] < date)
    if not c: return None
    try: return json.load(open(os.path.join(snap_dir, c[-1])))
    except Exception: return None

def what_changed(snap, prev):
    if not prev: return "first snapshot – no previous run to compare."
    top = 10
    cur_top = {r["address"]: r for r in snap["pools"][:top]}
    prev_all = {r["address"]: r for r in prev["pools"]}
    prev_top = {r["address"] for r in prev["pools"][:top]}
    bits = []
    new = [cur_top[a].get("name", a) for a in cur_top if a not in prev_top]
    out = [prev_all[a].get("name", a) for a in prev_top if a not in cur_top]
    if new: bits.append("new in top10: " + ", ".join(new))
    if out: bits.append("dropped: " + ", ".join(out))
    for r in snap["pools"]:
        p = prev_all.get(r["address"])
        if not p: continue
        for k, lab in (("fee_apr_7d", "APR"), ("tvl_usd", "TVL")):
            a, b = p.get(k), r.get(k)
            if a and b and abs(b / a - 1) > 0.25:
                bits.append(f"{r.get('name', '?').split(' 0.')[0]} {lab} {b / a - 1:+.0%}")
        nf = set(r["flags"]) - set(p.get("flags", []))
        nf = {x for x in nf if not x.startswith("vol_collapse") or True}
        if nf: bits.append(f"{r.get('name', '?').split(' 0.')[0]} new flags {sorted(nf)}")
    return f"vs {prev['date']}: " + ("; ".join(bits) if bits else "no material changes")

STOCK_HDR = table_hdr(vols=("7d",))
MAJOR_HDR = table_hdr(vols=("7d",), tier=True)

def stock_line(i, r):
    return table_line(i, r, vols=("7d",))

def major_line(i, r):
    return table_line(i, r, vols=("7d",), tier=True)

def universe_counts(snap):
    rows = snap["pools"]; c = {}
    for ch in CHAINS:
        rr = [r for r in rows if r["chain"] == ch]
        c[ch] = {"pools_scanned": len(rr), "tokenized_stock": sum(r["is_tokenized_stock_pool"] for r in rr),
                 "major_tagged": sum("major" in r["categories"] for r in rr),
                 "tvl_ge_1m": sum((r.get("tvl_usd") or 0) >= 1e6 for r in rr), "tvl_ge_2m": sum((r.get("tvl_usd") or 0) >= 2e6 for r in rr),
                 "tvl_ge_5m": sum((r.get("tvl_usd") or 0) >= 5e6 for r in rr), "in_allowlist": sum(r["in_allowlist"] for r in rr),
                 "stock_ge_1m": sum(r["is_tokenized_stock_pool"] and (r.get("tvl_usd") or 0) >= 1e6 for r in rr),
                 "sub_floor_excluded": sum(1 for x in snap.get("sub_floor", []) if x["chain"] == ch), "by_protocol": {}}
        for r in rr: c[ch]["by_protocol"][r["protocol"]] = c[ch]["by_protocol"].get(r["protocol"], 0) + 1
    return c

def wide_tables(snap):
    rows = snap["pools"]
    rows = [r for r in rows if scope_ok(r, snap)]
    stock_all = [r for r in rows if r["is_tokenized_stock_pool"] and (r.get("tvl_usd") or 0) >= stock_min_tvl(r["chain"])]
    stock = stock_rank([r for r in stock_all if not exclusion(r, "stock")])
    maj_all = [r for r in rows if (r.get("tvl_usd") or 0) >= MAJOR_MIN_TVL]
    major = sorted([r for r in maj_all if not exclusion(r, "major") and not needs_review(r)], key=lambda r: -(r.get("tvl_usd") or 0))
    seen, add = set(), []
    for r in stock_rank([r for r in stock + major if not r["in_allowlist"] and lp7(r)["cover"] is not None and lp7(r)["cover"] > 1]):
        if r["address"] not in seen: seen.add(r["address"]); add.append(r)
    review = sorted([r for r in rows if needs_review(r) and (r.get("tvl_usd") or 0) >= STOCK_MIN_TVL and not exclusion(r, "stock")],
                    key=lambda r: -(r.get("tvl_usd") or 0))
    excl = {}
    for r in stock_all + maj_all:
        why = exclusion(r, "major" if r in maj_all and not r["is_tokenized_stock_pool"] else "stock")
        if why: excl[why.split(":")[0] + ":" + why.split(":")[1].split(" ")[0].split("(")[0]] = excl.get(why.split(":")[0] + ":" + why.split(":")[1].split(" ")[0].split("(")[0], 0) + 1
    return {"stock": stock, "stock_all": stock_all, "major": major, "major_all": maj_all, "add": add, "review": review, "excluded_counts": excl}

def render_wide(snap, prev):
    t = wide_tables(snap)
    L = [f"# Wide LP scan {snap['date']}", "", f"Data fetched {snap['data_fetched_london'][0][:16].replace('T', ' ')} – {snap['data_fetched_london'][1][:16].replace('T', ' ')} Europe/London", ""]
    uc = snap.get("universe_counts") or universe_counts(snap)
    L += ["## Universe", "```", json.dumps(uc, indent=1), "```", ""]
    L.append(f"## (a) Top 15 tokenized-stock pools (TVL >= {fmt_usd(STOCK_MIN_TVL)} (Base {fmt_usd(stock_min_tvl('base'))}), real depth, IL measurable), by fee cover (Fees 7d / Est IL 7d)"); L += STOCK_HDR
    L += [stock_line(i + 1, r) for i, r in enumerate(t["stock"][:15])]
    L += ["", f"Eligible stock pools: {len(t['stock'])} of {len(t['stock_all'])} stock pools with TVL >= {fmt_usd(STOCK_MIN_TVL)} (Base {fmt_usd(stock_min_tvl('base'))}).", ""]
    L.append(f"## (b) Top 20 major pools (TVL >= $1M, real depth, 7d volume >= 10% TVL), by TVL"); L += MAJOR_HDR
    L += [major_line(i + 1, r) for i, r in enumerate(t["major"][:20])]
    L += ["", f"Eligible majors: {len(t['major'])} of {len(t['major_all'])} pools with TVL >= $1M "
          f"({sum(1 for r in t['major'] if (r.get('tvl_usd') or 0) >= 5e6)} at $5M+, {sum(1 for r in t['major'] if (r.get('tvl_usd') or 0) >= 2e6)} at $2M+).", ""]
    L.append("## (c) Top 10 non-allowlist pools worth adding (passes (a) or (b) filters, fee cover > 1x), by fee cover"); L += STOCK_HDR
    L += [stock_line(i + 1, r) for i, r in enumerate(t["add"][:10])]; L.append("")
    L.append(f"## Needs review: v4 hook / dynamic-fee pools with IL n/a (not ranked; {len(t['review'])} with TVL >= {fmt_usd(STOCK_MIN_TVL)})"); L += STOCK_HDR
    L += [stock_line(i + 1, r) for i, r in enumerate(t["review"][:15])]; L.append("")
    L.append("Excluded from tables (counts): " + json.dumps(t["excluded_counts"]))
    L += ["", "Filters: drop meme_vs_stock, dead_volume, rugcheck_danger, unverified, top_holder*, honeypot, lookalike; fake TVL = min ±2% depth < $5k (stock) / < $50k (major), "
          "majors also need 7d volume >= 10% of TVL; IL n/a pools are never ranked. " + LP7_NOTE + " "
          "Slip = worst-direction price impact excl. fee; 'can't fill' = pool runs out of one side."]
    L.append(""); L.append("**What changed:** " + what_changed(snap, prev))
    return "\n".join(L)

# ---------------------------------------------------------------- daily "top" report (8 tables: RH, Base, Ethereum, Solana + short allowlist section)
TOP_COLS = ["Pool", "APR", "Fee", "TVL", "Fees 7d", "IL 7d", "Net 7d", "Cover", "Break-even vs realized", "Vol 24h", "$1M slip / max fill", "Allowlist"]
TOP_HDR = ["| " + " | ".join(TOP_COLS) + " |", "|" + "---|" * len(TOP_COLS)]
LP7_NOTE = ("APR = Fee APR 7d (fees only, annualised; LP share). Fees 7d = Fee APR 7d / 52 (LP share); Net 7d = Fees 7d − Est IL 7d; Fee cover = Fees 7d / Est IL 7d; "
            "Break-even move = 1-sigma 7d move at which Est IL 7d = Fees 7d (σw* = √(8·Fees7d/C), cap-aware), shown vs realized 7d move σd·√7 "
            "(cushion = break-even / realized). Nothing is annualised except Fee APR 7d.")

def top_line(i, r):
    """Fixed daily column order (TOP_COLS); flags are listed under each table."""
    m = lp7(r)
    cells = [f"{i}. {short_name(r)} ({chain_dex(r)}) `{r['address']}`", fmt_pct(r.get("fee_apr_7d")), fmt_pct(r.get("fee_tier_pct"), 2), fmt_usd(r.get("tvl_usd")),
             fmt_pct(m["fees_7d"], 2), fmt_pct(m["il_7d"], 2), fmt_pct(m["net_7d"], 2), fmt_cover(r), fmt_move(r), fmt_usd(r.get("vol24_usd")),
             slip_str(r), "Y" if r.get("in_allowlist", True) else "N"]
    return "| " + " | ".join(cells) + " |"

def flags_block(rows):
    bits = [f"{i + 1}. {short_name(r)} {fmt_pct(r.get('fee_tier_pct'), 2)}: {key_flags(r, 6)}" for i, r in enumerate(rows) if key_flags(r, 6) != "–"]
    return "Risk flags: " + ("; ".join(bits) if bits else "none beyond structural ones") + "."

def top_tables(snap, n=10):
    rows = snap["pools"]; out = {}
    for ch in CHAINS:
        rr = [r for r in rows if r["chain"] == ch and scope_ok(r, snap)]
        vol_all = [r for r in rr if (r.get("tvl_usd") or 0) >= MAJOR_MIN_TVL]
        vol = sorted([r for r in vol_all if not exclusion(r, "major")], key=lambda r: -(r.get("vol24_usd") or 0))
        st_all = [r for r in rr if r.get("is_tokenized_stock_pool") and (r.get("tvl_usd") or 0) >= stock_min_tvl(ch)]
        st = stock_rank([r for r in st_all if not exclusion(r, "stock")])
        rv = [r for r in st_all if needs_review(r) and not exclusion(r, "stock")]
        out[ch] = {"volume": vol[:n], "volume_eligible": len(vol), "volume_all": len(vol_all),
                   "stock": st[:n], "stock_eligible": len(st), "stock_all": len(st_all), "review": rv}
    return out

def render_top(snap, prev, n=10):
    t = top_tables(snap, n)
    lon = snap["data_fetched_london"]
    L = [f"# Daily top-pool LP scan {snap['date']}", "",
         f"Data fetched {lon[0][:16].replace('T', ' ')} – {lon[1][11:16]} Europe/London (runtime {round((snap.get('runtime_s') or 0) / 60, 1)} min)", ""]
    core = (snap.get("dex_scope") or "all") == "core"
    labels = {"robinhood": "Robinhood Chain" + (" Uniswap" if core else ""), "base": "Base" + (" Uniswap v3/v4" if core else ""),
              "eth": "Ethereum" + (" Uniswap v3/v4" if core else ""), "solana": "Solana" + (" Raydium" if core else "")}
    k = 0
    for ch in CHAINS:
        k += 1; x = t[ch]
        L.append(f"## ({k}) {labels[ch]}: top {n} pools by 24h volume (TVL >= $1M, real pools only)"); L += TOP_HDR
        L += [top_line(i + 1, r) for i, r in enumerate(x["volume"])]
        L += ["", flags_block(x["volume"]), f"{x['volume_eligible']} of {x['volume_all']} deep-scanned pools with TVL >= $1M pass the filters.", ""]
        k += 1
        L.append(f"## ({k}) {labels[ch]}: top {n} tokenized-stock pools by fee cover (Fees 7d / Est IL 7d; TVL >= {fmt_usd(stock_min_tvl(ch))})"); L += TOP_HDR
        L += [top_line(i + 1, r) for i, r in enumerate(x["stock"])]
        if not x["stock_eligible"]: L.append(f"| No tokenized-stock pool on {CHAIN_CFG[ch]['label']} passes (TVL >= {fmt_usd(stock_min_tvl(ch))}, filters, IL measurable) this run |" + " |" * (len(TOP_COLS) - 1))
        L += ["", flags_block(x["stock"]), f"{x['stock_eligible']} of {x['stock_all']} deep-scanned stock pools with TVL >= {fmt_usd(stock_min_tvl(ch))} pass the filters with measurable IL."]
        if x["review"]:
            L.append("Needs review (v4 hook / dynamic fee, IL n/a, not ranked): " + ", ".join(
                f"{short_name(r)} `{r['address']}` (TVL {fmt_usd(r.get('tvl_usd'))}, fee APR 7d {fmt_pct(r.get('fee_apr_7d'))})" for r in x["review"]))
        L.append("")
    # allowlist (short)
    al = [r for r in snap["pools"] if r["in_allowlist"] or r.get("pinned")]
    L.append("## Allowlist (short)")
    for r in [r for r in al if r.get("pinned")]:
        why = exclusion(r, "allowlist")
        L.append(f"- **Pinned: {short_name(r)} {fmt_pct(r.get('fee_tier_pct'), 2)} ({chain_dex(r)}{'' if scope_ok(r, snap) else ', outside DEX scope'}, `{r['address']}`)**: TVL {fmt_usd(r.get('tvl_usd'))}, "
                 f"vol 24h {fmt_usd(r.get('vol24_usd'))}, vol 7d {fmt_usd(r.get('vol7d_usd'))}, fee APR 7d {fmt_pct(r.get('fee_apr_7d'))}, "
                 f"Fees 7d {fmt_pct(lp7(r)['fees_7d'], 2)}, est IL 7d {fmt_pct(r.get('il7d_pool_avg_pct'), 2)}, Net 7d {fmt_pct(lp7(r)['net_7d'], 2)}, "
                 f"fee cover {fmt_cover(r)}, break-even vs realized 7d move {fmt_move(r)}, slip $1M {slip_str(r)}"
                 + (f"; excluded from tables: {why}" if why else "") + f"; flags: {key_flags(r, 6)}")
    for a in [a for a in (snap.get("sources") or {}).get("pinned", []) if a not in {r["address"] for r in al}]:
        L.append(f"- Pinned `{a}`: not found in any public API response this run")
    ok = stock_rank([r for r in al if not r.get("pinned") and r["in_allowlist"] and not exclusion(r, "allowlist")])
    if ok:
        L.append("- Best other allowlist pools by fee cover: " + "; ".join(
            f"{short_name(r)} {fmt_pct(r.get('fee_tier_pct'), 2)} ({chain_dex(r)}{'' if scope_ok(r, snap) else ', outside DEX scope'}) cover {fmt_cover(r)}, Net 7d {fmt_pct(lp7(r)['net_7d'], 2)} on {fmt_usd(r.get('tvl_usd'))}" for r in ok[:5]))
    n_al = (snap.get("sources") or {}).get("allowlist_size")
    exc = [r for r in al if r["in_allowlist"] and exclusion(r, "allowlist")]
    L.append(f"- Allowlist pools deep-scanned: {sum(1 for r in al if r['in_allowlist'])}" + (f" of {n_al}" if n_al else "") +
             f" (TVL >= {fmt_usd(STOCK_MIN_TVL)} or pinned); {len(exc)} excluded by filters" +
             (" (" + ", ".join(f"{k_} {v_}" for k_, v_ in sorted(excl_reasons(exc, "allowlist").items())) + ")" if exc else "") + ".")
    L.append("")
    src = snap.get("sources") or {}
    sel = src.get("top_selection") or {}
    if core:
        L.append(f"DEX scope: Robinhood = Uniswap v2/v3/v4, Base and Ethereum = Uniswap v3/v4, Solana = Raydium AMM/CPMM/CLMM; {(src.get('discovery') or {}).get('dropped_out_of_scope_at_discovery', 'n/a')} "
                 "out-of-scope pool listings dropped at discovery (allowlist/pinned pools outside scope appear only in the allowlist section). Override: --dex-scope all.")
    L.append(f"Coverage: {sel.get('candidates_discovered')} pools discovered, {sel.get('deep_scanned')} deep-scanned (OHLCV, on-chain depth, security), "
             f"{sel.get('not_deep_scanned_tvl_ge_100k')} other pools with TVL >= $100k not deep-scanned. Selection: {sel.get('rule')}. "
             f"GoPlus {src.get('goplus_4663')}, RugCheck {src.get('rugcheck')}.")
    if src.get("rugcheck_missing"): L.append(f"RugCheck had no answer for {len(src['rugcheck_missing'])} mints: those pools carry no rugcheck flags (not proof of safety).")
    L += ["", "Filters: drop meme_vs_stock, dead_volume, rugcheck_danger, unverified, top_holder*, honeypot, lookalike; fake TVL = min ±2% depth < $5k (stock) / "
          "< $50k (volume tables), volume tables also need 7d volume >= 10% of TVL; IL n/a pools are never ranked. "
          + LP7_NOTE + " Slip = worst-direction price impact excl. fee; 'can't fill' = pool runs out of one side."]
    L.append(""); L.append("**What changed:** " + top_changes(snap, prev, n))
    return "\n".join(L)

def excl_reasons(rows, kind):
    c = {}
    for r in rows:
        w = exclusion(r, kind)
        if w:
            k_ = "fake_tvl" if w.startswith("fake_tvl") else w.split(":")[1].split("(")[0].split(">")[0]
            c[k_] = c.get(k_, 0) + 1
    return c

def top_changes(snap, prev, n=10):
    if not prev: return "first daily top snapshot – no previous run to compare."
    a, b = top_tables(snap, n), top_tables(prev, n); bits = []
    for ch in CHAINS:
        if not any(r["chain"] == ch for r in prev["pools"]): bits.append(f"{ch}: first run on this chain"); continue
        for tb in ("volume", "stock"):
            cur = {r["address"]: short_name(r) for r in a[ch][tb]}; old = {r["address"]: short_name(r) for r in b[ch][tb]}
            new = [v for k_, v in cur.items() if k_ not in old]; out = [v for k_, v in old.items() if k_ not in cur]
            if new or out:
                bits.append(f"{ch} {tb}: " + ("new " + ", ".join(new) if new else "") + ("; " if new and out else "") + ("out " + ", ".join(out) if out else ""))
    return f"vs {prev['date']}: " + ("; ".join(bits) if bits else "same pools in all tables")

def cli(argv=None):
    try:
        main(argv)
        return 0
    except SystemExit as e:
        if e.code not in (None, 0):
            print(str(e.code) if isinstance(e.code, str) else f"lp_pool_scan: exit {e.code}", file=sys.stderr)
            return 2
        return 0
    except KeyboardInterrupt:
        print("lp_pool_scan: error: interrupted", file=sys.stderr); return 130
    except Exception as e:
        print(f"lp_pool_scan: error: {type(e).__name__}: {e}", file=sys.stderr); return 1

if __name__ == "__main__":
    sys.exit(cli())
