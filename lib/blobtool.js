/**
 * uPlexa (UPX) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Builds the job + submission data from a raw `blocktemplate_blob`.
 *
 * Unlike WrkzCoin (see wrkz-nodejs-pool's own blobtool.js -- a nested "parent block" merge-mining
 * placeholder header pushes WRKZ's real nonce to byte 73), uPlexa's own daemon hands back the plain
 * STANDARD CryptoNote header shape: major_version(varint) + minor_version(varint) + timestamp(varint)
 * + prev_id(32 bytes) + nonce(4 bytes) + ... Confirmed empirically 2026-11-10 against the real, synced
 * uplexad daemon (not assumed from the old /home/upx config's `cnBlobType: 0`): across several
 * independently-fetched fresh unmined templates, 4 all-zero bytes sat at this computed offset (39 for
 * every template seen so far -- major/minor version were always 1-byte varints, i.e. values < 128, and
 * the timestamp varint was always 5 bytes for any real 2026-era Unix time), with a believable timestamp
 * decoding cleanly right before it. The daemon's `blockhashing_blob` and `blocktemplate_blob` fields
 * share byte-identical header bytes (confirmed directly), so the SAME offset applies to both -- the
 * short `blockhashing_blob` is used for actual PoW hashing, the full `blocktemplate_blob` for
 * `submitblock` once a real block is found.
 *
 * The offset below is computed by actually walking the varints (not hardcoded), so a future
 * major/minor-version bump past 127 (needing 2+ varint bytes) would still resolve correctly instead of
 * silently drifting -- same defensive approach already used by this project's other standard-layout
 * CryptoNote/RandomX pools (e.g. sal-nodejs-pool's own `nonceOffset()`).
 *
 * run(blobHex, cb)  cb(err, {template, hashing, templateNonceOffset, hashingNonceOffset, prevHash})
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

exports.run = function (blobHex, callback) {
	if (typeof blobHex !== 'string' || !/^[0-9a-f]+$/.test(blobHex)) {
		return callback(new Error('block template is not valid hex'));
	}

	let buf = Buffer.from(blobHex.slice(0, 2 * 48), 'hex');
	let prevStart, offset;
	try {
		prevStart = prevIdOffset(buf);
		offset = prevStart + 32;
	} catch (e) {
		return callback(new Error('could not find the nonce in the block template: ' + e.message));
	}
	if (blobHex.length < (offset + 4) * 2) {
		return callback(new Error('block template too short (' + blobHex.length + ' hex chars, nonce expected at byte ' + offset + ')'));
	}
	let prevHash = blobHex.slice(prevStart * 2, prevStart * 2 + 64);

	callback(null, {
		template: blobHex,
		hashing: blobHex,
		templateNonceOffset: offset,
		hashingNonceOffset: offset,
		prevHash: prevHash
	});
};
