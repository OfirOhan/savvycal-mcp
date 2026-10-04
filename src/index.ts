#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BASE_URL, SavvyCalClient } from "./client.js";
import { createServer } from "./server.js";

async function main() {
  const token = process.env.SAVVYCAL_TOKEN ?? "";
  if (!token) {
    console.error("savvycal-mcp: SAVVYCAL_TOKEN is not set. Create a personal access token at https://savvycal.com/developers");
    process.exit(1);
  }
  const baseUrl = process.env.SAVVYCAL_BASE_URL ?? BASE_URL;
  const server = createServer(new SavvyCalClient({ token, baseUrl }));
  await server.connect(new StdioServerTransport());
  console.error(`savvycal-mcp running (${baseUrl})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
