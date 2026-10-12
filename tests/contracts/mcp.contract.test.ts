import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerCityTools } from "../../src/tools/city.js";
import { registerGeoTools } from "../../src/tools/geo.js";
import { registerSearchTools } from "../../src/tools/search.js";
import { registerStopTools } from "../../src/tools/stops.js";
import { registerLineTools } from "../../src/tools/lines.js";
import { registerTransitTools } from "../../src/tools/transit.js";

test("MCP tools/list preserves every tool name, input schema, defaults and annotations", async () => {
  const server = new McpServer({ name: "contract", version: "1.0.0" });
  for (const register of [registerCityTools, registerGeoTools, registerSearchTools, registerStopTools, registerLineTools, registerTransitTools]) register(server);
  const client = new Client({ name: "contract-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(15);
    expect(tools.map(({ name, inputSchema, annotations }) => ({ name, inputSchema, annotations }))).toMatchSnapshot();
  } finally {
    await client.close();
    await server.close();
  }
});
