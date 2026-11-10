/**
 * uPlexa (UPX) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * JSON-RPC 2.0 client of the uPlexa daemon (uplexad, POST /json_rpc, confirmed standard Monero-style
 * convention -- both underscored (get_last_block_header/get_block_header_by_height) and the older
 * non-underscored aliases (getlastblockheader/getblockheaderbyheight) answer identically on this real
 * daemon; getblocktemplate/submitblock have no underscored form either way, same as Monero itself) and
 * of the pool wallet (uplexa-wallet-rpc, same /json_rpc shape, standard get_balance/get_address/transfer/
 * get_transfers/get_transfer_by_txid -- confirmed working directly, see upx-project.md). Unlike WrkzCoin's
 * wallet-api (a different, REST-only turtlecoin-wallet-backend-js family needing a translation layer).
 * no translation layer is needed here at all.
 * Settings: config.node {host, port} (default 127.0.0.1:21061), config.wallet {host, port} (default
 * 127.0.0.1:41062). Both are reached through the upx-tunnel SSH forward to srv5 -- see upx-project.md.
 * The wallet-rpc is started with --disable-rpc-login (bound 127.0.0.1 only, same posture already used
 * for Salvium's own wallet-rpc) -- no auth header needed.
 **/
let http = require('http');

/**
 * call(method, params, callback(err, result), options). err is {code, message} for an RPC error (the other side said no),
 * an Error for a transport problem (outcome unknown). options: {wallet: true} talks to the wallet, timeout in ms.
 **/
exports.call = function (method, params, callback, options) {
	options = options || {};
	let target = (options.wallet ? config.wallet : config.node) || {};
	let body = JSON.stringify({jsonrpc: '2.0', id: '0', method: method, params: params || {}});
	let done = false;
	let finish = function (err, result) {
		if (done) return;
		done = true;
		callback(err, result);
	};

	let req = http.request({
		host: target.host || '127.0.0.1',
		port: target.port || (options.wallet ? 41062 : 21061),
		path: '/json_rpc',
		method: 'POST',
		headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
		timeout: options.timeout || 30000
	}, function (res) {
		let chunks = [];
		res.on('data', function (c) { chunks.push(c); });
		res.on('end', function () {
			let text = Buffer.concat(chunks).toString('utf8');
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				return finish(new Error('Bad answer from the ' + (options.wallet ? 'wallet' : 'daemon') + ' (HTTP ' + res.statusCode + '): ' + text.slice(0, 120)));
			}
			if (parsed.error) return finish(parsed.error);
			finish(null, parsed.result);
		});
	});
	req.on('timeout', function () { req.destroy(new Error('RPC timeout: ' + method)); });
	req.on('error', function (e) { finish(e); });
	req.end(body);
};
