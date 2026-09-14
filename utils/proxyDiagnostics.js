// Pure, opt-in diagnostic for a controlled request on Render. No endpoint or
// automatic logging is installed; the result contains no IP, URL or header text.
export function inspectProxyChain(req, expectedClientIp) {
  const forwarded = String(req.get("X-Forwarded-For") || "").split(",").map(ip => ip.trim()).filter(Boolean);
  return {
    expressChainLength: req.ips.length,
    forwardedChainLength: forwarded.length,
    ipMatchesFirstForwarded: forwarded.length > 0 && req.ip === forwarded[0],
    ipMatchesLastForwarded: forwarded.length > 0 && req.ip === forwarded[forwarded.length - 1],
    ipMatchesSocket: req.ip === req.socket.remoteAddress,
    ipMatchesExpectedClient: expectedClientIp ? req.ip === expectedClientIp : null,
    expectedClientForwardedIndex: expectedClientIp ? forwarded.indexOf(expectedClientIp) : null
  };
}
