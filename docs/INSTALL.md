# Installing the uPlexa pool

This project's own real deployment: the pool runs on the MAIN server (95.216.18.84), the uPlexa
daemon (`uplexad`) and wallet-rpc (`uplexa-wallet-rpc`) run on a different server (`srv5`,
144.76.186.203, SSH alias `srv5`) that already had a whole pre-existing coin family running on it --
see `upx-project.md` for how that was found. The pool reaches them across servers through an SSH
tunnel, never by exposing either RPC on a public interface.

## 1. uPlexa daemon + wallet (already running on srv5 in this deployment)

`uplexad` is a prebuilt binary (`/root/uplexa2/build/Linux/stable/release/bin/uplexad --detach
--bootstrap-daemon-address=remote.uplexa.com:21061 --out-peers=32`) kept alive by that server's own
watchdog script (`/root/demoncrash.sh`, NOT systemd -- see `upx-project.md` before trying to
stop/restart it). Its RPC is the standard Monero-style `POST /json_rpc` on port 21061 (127.0.0.1 only;
the P2P port, 21060, is the only one bound publicly). Confirm it's actually synced before trusting
anything: `curl -s -X POST http://127.0.0.1:21061/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}'`
and check `"height"` equals (or exceeds) `"target_height"`, and `"was_bootstrap_ever_used": false`
(real P2P sync, not just a bootstrap-proxied answer).

The pool wallet (`/root/uplexa_pool/pool.wallet`, a brand new wallet -- the old `/home/upx` deployment's
wallet/address was deliberately NOT reused) is served by the STANDARD Monero-style `uplexa-wallet-rpc`:

```
uplexa-wallet-rpc --wallet-file=<path> --password '<wallet file password>' \
  --daemon-address=127.0.0.1:21061 --rpc-bind-port=41062 --rpc-bind-ip=127.0.0.1 \
  --disable-rpc-login --log-level=1
```

`--disable-rpc-login` is safe here because it is bound to 127.0.0.1 only and reached exclusively
through the SSH tunnel below (same posture already used for this project's other Monero-wallet-rpc
pools, e.g. Salvium) -- confirmed with a real `get_balance`/`get_address` call before being trusted.
This is a genuinely different, simpler RPC shape than WrkzCoin's own `wrkz-wallet-api` (a TurtleCoin-
lineage REST-only service needing a translation layer in `rpc.js`) -- uPlexa's `rpc.js` talks the SAME
plain `/json_rpc` shape to both the daemon and the wallet, no translation needed.

If the node and the pool run on different machines, forward both RPC ports over SSH instead of
exposing them -- this project's own `upx-tunnel.service` (two `-L` forwards over one SSH connection,
127.0.0.1:21061 and 127.0.0.1:41062, both into `srv5`) is the exact unit used in production here; copy
its pattern (same one `xkr-tunnel.service` uses for Kryptokrona, `wrkz-tunnel.service` for WrkzCoin)
for any other split-server coin.

## 2. blobtool.js (no C++ helper here, just header parsing)

uPlexa's `getblocktemplate` hands back the plain STANDARD CryptoNote header shape (unlike WrkzCoin,
which needs a nested merge-mining-placeholder header): major_version + minor_version + timestamp (all
LEB128 varints) + prev_id (32 bytes) + the 4-byte nonce right there. `blobtool.js` finds this offset by
actually walking the varints (not a hardcoded byte count), confirmed empirically 2026-11-10 against the
real synced daemon: across several independently-fetched fresh unmined templates, 4 all-zero bytes sat
at the computed offset (39 every time so far), with a believable Unix timestamp decoding cleanly right
before it. Also confirmed: the daemon's `blockhashing_blob` and `blocktemplate_blob` fields share
byte-identical header bytes, so the same offset applies to both.

**This offset must NOT be sent to poolpayminer as a `nonce_offset` stratum field** (unlike WrkzCoin's
own pool, which must send `"nonce_offset": 73` because it shares `Algorithm::CN_UPX2` with uPlexa but
needs a different position) -- omitting the field lets poolpayminer fall through to its ordinary
per-algorithm default (39), which is already correct here. See poolpayminer's own `Job.cpp`
(`setNonceOffsetOverride`) for the full reasoning, and don't copy this pool's `pool.js` buildJob() back
into WrkzCoin's without that field, or vice versa without removing it.

## 3. Hasher

`hasher/upxhash` is poolpayminer's own already-shipped, already-self-tested `cn/upx2` implementation
(`Algorithm::CN_UPX2`), vendored verbatim from its `src/crypto/cn/` + `src/base/crypto/` (the SAME
source WrkzCoin's own `wrkzhash` helper uses -- this hash is coin-agnostic, only the blob SHAPE around
it differs per coin) -- this keeps the pool's own share check and the real miner's PoW guaranteed
identical by construction. Build with `cd hasher && make` (needs a CPU with AES-NI; no key/dataset
setup needed, unlike a RandomX-based pool's hasher). Verified against poolpayminer's own shipped
self-test vector (`test_input[0:76]` -> `test_output_femto_upx2`, see `CryptoNight_test.h`) before being
trusted -- re-run that check (`./upxhash --hash <the 76-byte hex test vector>`) after any rebuild.

## 4. Redis

A dedicated instance with a password and AOF: this deployment's own `upx-pool-redis.service`
(`/root/claude/upx/redis.conf`, port 6409).

## 5. The pool

```
cd upx-nodejs-pool && npm install --production
make -C hasher
cp config_examples/upx.json config.json      # then edit it for real
```

Edit `config.json`: `poolHost`, `poolServer.poolAddress`, the ports and the certificate for TLS
(`poolServer.sslCert`/`sslKey`), `redis`, `api.password`, `blockUnlocker.poolFee` and `donations`,
`payments`, `node`, `wallet` (host/port only -- no password field needed with `--disable-rpc-login`),
`hasher.path`.
**Keep `payments.dryRun: true` until the rehearsal below.**

The pool runs as separate modules (`init.js -module=pool|api|unlocker|payments|chartsDataCollector`),
each in its own systemd unit, same pattern as every other coin in this project.

## 6. Website

Copy `website_example/` to the web root, set `poolHost`, the contact and links in `config.js`, and
proxy `/api` to the pool API (127.0.0.1:8487 in this deployment, real path `/stats` etc -- see `lib/api.js`'s
own route table, not `/api/stats` directly against the backend; the public vhost adds the `/api` prefix).

## 7. Rehearse the payments

1. `payments.dryRun: true`: the log of the payments module shows what would be paid.
2. Fund the pool wallet with a few coins (or wait for the first block), credit a small balance in
   Redis to your own test addresses (`<coin>:workers:<address>`, field `balance`), set
   `payments.onlyAccounts` to them, `dryRun: false`, and watch the payout confirm.
3. Remove the test accounts from Redis and set `onlyAccounts` to `[]`.

Good to know: `transfer`'s `priority`/`unlock_time` fields are plain Monero-wallet-rpc defaults (0);
`deployment/pause-payments.sh` stops new payouts at once; a wallet cannot abandon a transaction, so a
payout that stays unconfirmed for `pendingTimeoutHours` is only reported in the log and must be checked
by hand. No exchange/sweep/custodial-credit wiring exists for UPX at all -- there is no real sell
automation for this coin, so it can only be mined with a miner's own address (direct payout), never
custodially credited in USDT.
