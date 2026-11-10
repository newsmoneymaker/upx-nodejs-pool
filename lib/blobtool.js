/**
 * uPlexa (UPX) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Builds the job + submission data from the daemon's `getblocktemplate` response.
 *
 * **2026-11-10 fix**: this used to treat the full `blocktemplate_blob` (the one `submitblock` wants)
 * as ALSO the PoW-hashing blob, with the nonce spliced in at the same offset either way. That is
 * WRONG past the header: real consensus hashing is over a shorter blob where the raw
 * baseTransactionBranch/minerTx/blockchainBranch bytes the submission blob carries are replaced by a
 * single computed merkleRoot (standard CryptoNote `get_block_hashing_blob` behaviour, same shape of
 * bug just found+fixed on [[wrkz-project]]'s WrkzCoin pool, which has an extra nested "parent block"
 * wrapper on top of this same problem -- uPlexa's daemon does not have that wrapper, so the fix here
 * is simpler). The real bytes were never being reconstructed by hand, though: uPlexa's modern daemon
 * RPC already hands back a SEPARATE `blockhashing_blob` field in the same `getblocktemplate` response
 * -- the exact bytes real consensus hashes, precomputed by the node itself -- this file (and pool.js)
 * just weren't using it. Confirmed by diffing a real template: `blockhashing_blob` and
 * `blocktemplate_blob` share an IDENTICAL 43-byte header (majorVersion, minorVersion, timestamp,
 * prev_id, nonce) and then diverge completely -- `blockhashing_blob` has 33 more bytes (a computed
 * merkleRoot + a transaction-count byte) and stops, `blocktemplate_blob` continues into real
 * miner-transaction bytes for hundreds more bytes.
 *
 * Takes BOTH blobs now. The nonce offset is computed once (by walking the shared header's own
 * varints, same defensive approach as before) and used for both -- verified below that the two blobs
 * really do still share that same header byte-for-byte before trusting the offset for both, so a
 * future daemon change that breaks this assumption fails loudly instead of silently mis-hashing.
 *
 * run(templateHex, hashingHex, cb)  cb(err, {template, hashing, templateNonceOffset, hashingNonceOffset, prevHash})
 **/

/** LEB128 varint at `offset` in a Buffer: returns its byte length */
function varintLength (buf, offset) {
	let length = 0;
	let byte;
	do {
		if (offset + length >= buf.length || length > 9) throw new Error('bad varint in the block blob');
		byte = buf[offset + length];
		length++;
	} while (byte & 0x80);
	return length;
}

/** byte offset right after major_version, minor_version, timestamp (all varints) -- i.e. where prev_id (32 bytes) starts */
function prevIdOffset (buf) {
	let offset = 0;
	for (let i = 0; i < 3; i++) offset += varintLength(buf, offset);
	return offset;
}

exports.run = function (templateHex, hashingHex, callback) {
	if (typeof templateHex !== 'string' || !/^[0-9a-f]+$/.test(templateHex)) {
		return callback(new Error('block template is not valid hex'));
	}
	if (typeof hashingHex !== 'string' || !/^[0-9a-f]+$/.test(hashingHex)) {
		return callback(new Error('blockhashing_blob is not valid hex'));
	}

	let hashingBuf = Buffer.from(hashingHex, 'hex');
	let prevStart, nonceOffset;
	try {
		prevStart = prevIdOffset(hashingBuf);
		nonceOffset = prevStart + 32;
	} catch (e) {
		return callback(new Error('could not find the nonce in blockhashing_blob: ' + e.message));
	}
	if (hashingBuf.length < nonceOffset + 4) {
		return callback(new Error('blockhashing_blob too short (' + hashingBuf.length + ' bytes, nonce expected at byte ' + nonceOffset + ')'));
	}

	let templateBuf = Buffer.from(templateHex, 'hex');
	if (templateBuf.length < nonceOffset + 4) {
		return callback(new Error('blocktemplate_blob too short (' + templateBuf.length + ' bytes, nonce expected at byte ' + nonceOffset + ')'));
	}
	// the two blobs must share an identical header through the nonce -- if a future daemon change
	// ever breaks that, fail loudly instead of splicing the submission blob's nonce at the wrong spot
	if (!hashingBuf.slice(0, nonceOffset + 4).equals(templateBuf.slice(0, nonceOffset + 4))) {
		return callback(new Error('blockhashing_blob and blocktemplate_blob headers differ -- cannot assume the same nonce offset for both'));
	}

	let prevHash = hashingBuf.slice(prevStart, prevStart + 32).toString('hex');

	callback(null, {
		template: templateHex,
		hashing: hashingHex,
		templateNonceOffset: nonceOffset,
		hashingNonceOffset: nonceOffset,
		prevHash: prevHash
	});
};
