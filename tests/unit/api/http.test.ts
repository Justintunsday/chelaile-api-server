import { expect, test } from "bun:test";
import type { IncomingMessage } from "node:http";
import { getClientIp } from "../../../src/api/http.js";
import { loadConfig } from "../../../src/api/config.js";

function request(remoteAddress: string, forwarded: string): IncomingMessage {
  return { headers: { "x-forwarded-for": forwarded }, socket: { remoteAddress } } as IncomingMessage;
}

test("only explicitly trusted immediate peers can forward IPs, walking right to left", () => {
  const config = loadConfig({ TRUSTED_PROXY_IPS: "127.0.0.1, 10.0.0.1" });
  expect(getClientIp(request("::ffff:127.0.0.1", "9.9.9.9, 1.2.3.4, 10.0.0.1"), config.trustedProxyIps)).toBe("1.2.3.4");
  expect(getClientIp(request("8.8.8.8", "1.2.3.4"), config.trustedProxyIps)).toBe("8.8.8.8");
  expect(getClientIp(request("127.0.0.1", "invalid-ip"), config.trustedProxyIps)).toBe("127.0.0.1");
});

test("proxy trust is disabled by default and invalid trust configuration fails closed", () => {
  expect(loadConfig({}).trustedProxyIps).toEqual([]);
  expect(() => loadConfig({ TRUSTED_PROXY_IPS: "*" })).toThrow(/TRUSTED_PROXY_IPS/);
});
