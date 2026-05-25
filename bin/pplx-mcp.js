#!/usr/bin/env node
import { runMcpServer } from '../src/mcp-server.js';

runMcpServer().catch((error) => {
  console.error('pplx MCP server error:', error?.message || error);
  process.exit(1);
});
