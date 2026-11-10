# Changes

## 1.0.0 (2026-11-10)

* First release: uPlexa (UPX) pool, a fresh build (adapted from wrkz-nodejs-pool's own structure, which
  is itself adapted from kryptokrona-nodejs-pool) -- NOT a revival of the old, dormant dvandal
  cryptonote-nodejs-pool deployment at `/home/upx` on its node server (left untouched, not started; its
  old pool address was not reused either, a brand new wallet was created). Stratum for `cn/upx2`
  (CryptoNight-UPX2, 128 KB scratchpad, shared with WrkzCoin), plain cryptonote-nodejs-pool JSON-RPC
  (`login`/`job`/`submit`).
* uPlexa's daemon (`uplexad`) speaks the standard Monero-style `POST /json_rpc` -- confirmed by direct
  probing of the real, synced daemon that BOTH the underscored (`get_last_block_header`,
  `get_block_header_by_height`) and the older non-underscored aliases (`getlastblockheader`,
  `getblockheaderbyheight`) answer identically; `getblocktemplate`/`submitblock` have no underscored
  form either way, same as Monero itself.
* The pool wallet is served by `uplexa-wallet-rpc`, the STANDARD Monero-style wallet-rpc (`get_balance`,
  `get_address`, `transfer`, `get_transfers`, `get_transfer_by_txid`) -- confirmed directly, no REST
  translation layer needed (unlike WrkzCoin's own `wrkz-wallet-api`, a different, TurtleCoin-lineage
  REST-only service). Run with `--disable-rpc-login`, bound to 127.0.0.1 only (same posture already
  used for this project's other Monero-wallet-rpc pools, e.g. Salvium).
* Share checking with the `hasher/upxhash` helper: poolpayminer's own already-shipped, already-self-
  tested `cn/upx2` implementation (vendored verbatim from its `src/crypto/cn/` + `src/base/crypto/`,
  the SAME source WrkzCoin's own `wrkzhash` helper uses), NOT a second independent vendoring -- keeps
  the pool's own share check and the real miner's PoW guaranteed identical by construction. Verified
  byte-for-byte against poolpayminer's own shipped self-test vector before being trusted.
* **The critical nonce-position fix, shared with WrkzCoin**: WrkzCoin and uPlexa both use
  `Algorithm::CN_UPX2` in poolpayminer, but WrkzCoin's real blob needs its nonce at byte 73 (a nested
  merge-mining-placeholder header) while uPlexa's needs the plain standard byte 39 -- confirmed
  empirically 2026-11-10 against uPlexa's real, synced daemon: across several independently-fetched
  fresh unmined templates, 4 all-zero bytes sat at the varint-computed offset 39, with a believable
  timestamp decoding cleanly right before it. A blanket per-algorithm miner-side default can't serve
  both coins at once, so poolpayminer's `Job.cpp` was changed to a genuine per-pool flag: WrkzCoin's own
  pool now sends an explicit `"nonce_offset": 73` field in every job; this pool deliberately does NOT,
  so poolpayminer falls through to its ordinary per-algorithm default (39), which is already correct
  here. See poolpayminer's own `Job.cpp` (`setNonceOffsetOverride`) and this repo's `blobtool.js`/
  `pool.js` for the full reasoning.
* `blobtool.js` finds the real nonce position by walking the header's own LEB128 varints (major
  version, minor version, timestamp) rather than a hardcoded byte count -- a future version-number bump
  would still resolve correctly instead of silently drifting.
* Real UPX address decoded directly from the pool's own brand new wallet address (not assumed, and NOT
  the old `/home/upx` deployment's `intAddressPrefix: 6`, which is a different, integrated-address-only
  field): base58 prefix 1449763, 98-character `UPX1...` addresses, 71 raw bytes (3-byte varint prefix +
  32-byte spend key + 32-byte view key + 4-byte checksum) -- cross-checked byte for byte against that
  same wallet's own reported spend/view public keys.
* `coinUnits` = 100 atomic units per UPX, `coinDifficultyTarget` = 120 (2-minute blocks) -- cross-checked
  against a live `get_info` (`"target": 120`) and a live `get_last_block_header` (`reward: 131882`,
  i.e. 1318.82 UPX), not just carried over from the old `/home/upx` config's own `coinDecimalPlaces: 2`.
* TCP keepalive on every stratum socket, double-credit protection in the block unlocker (dedup by block
  hash before crediting -- the exact class of bug found+fixed on QWC previously), guarded
  `/get_payments`/`/get_blocks` API endpoints (no crash on a missing `?time=`/`?height=` param), no
  donation address in the live `config.json` (folded into `poolFee` instead, see README.md) -- all
  standing checklist items for every pool in this project, applied from the start here.
* `blockUnlocker.js`'s block-reward lookup reads the daemon's own `get_block_header_by_height` `reward`
  field directly -- no wallet RPC call needed for this step at all (this coin has no masternode/
  service-node split to separate out either).
* Real end-to-end tested against the live, fully-synced uplexad mainnet node and poolpayminer (`-a
  cn/upx2`, poolpayminer's own real built-in algorithm name for this hash -- no algorithm porting
  needed): real shares genuinely **accepted (16/0, zero rejected)**. The same poolpayminer binary was
  then re-tested against the live WrkzCoin pool to confirm the shared `Job.cpp` refactor did not break
  it: still genuinely accepted (37/0, zero rejected) after restarting that pool with its own
  `nonce_offset: 73` field.
* Payments stay `dryRun` until a real block matures and a real payout is rehearsed end to end through
  the pool's own `paymentProcessor.js` -- `get_balance`/`transfer` are confirmed reachable and correctly
  shaped, but a real `transfer` send has not yet been exercised, same standing gate as every other new
  coin in this project. No exchange/sweep/custodial-credit wiring for UPX at all (no real sell
  automation exists for this coin) -- direct-address mining only.
