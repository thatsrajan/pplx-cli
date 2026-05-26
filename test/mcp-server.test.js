import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPplxMcpServer } from '../src/mcp-server.js';

async function connectTestClient() {
  const server = createPplxMcpServer();
  const client = new Client({ name: 'pplx-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, clientTransport, serverTransport };
}

describe('pplx MCP server', () => {
  it('exposes the expected Claude/Codex tool surface', async () => {
    const { client, clientTransport, serverTransport } = await connectTestClient();
    try {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name).sort();
      assert.deepEqual(toolNames, [
        'pplx_auth_status',
        'pplx_computer_create',
        'pplx_computer_import',
        'pplx_computer_read_task',
        'pplx_computer_status',
        'pplx_council_create',
        'pplx_council_import',
        'pplx_council_read_task',
        'pplx_council_status',
        'pplx_labs',
        'pplx_models',
        'pplx_search',
      ]);
    } finally {
      await clientTransport.close();
      await serverTransport.close();
    }
  });

  it('supports model listing and computer artifact calls over MCP', async () => {
    const { client, clientTransport, serverTransport } = await connectTestClient();
    const root = mkdtempSync(join(tmpdir(), 'pplx-mcp-computer-'));

    try {
      const models = await client.callTool({ name: 'pplx_models', arguments: {} });
      assert.equal(models.structuredContent.modes.pro.default, 'pplx_pro');

      const created = await client.callTool({
        name: 'pplx_computer_create',
        arguments: {
          task: 'compare dinner options nearby',
          out: root,
          artifactId: 'dinner-options',
        },
      });
      assert.equal(created.structuredContent.artifactId, 'dinner-options');
      assert.equal(existsSync(join(root, 'dinner-options', 'task.md')), true);

      const status = await client.callTool({
        name: 'pplx_computer_status',
        arguments: { run: 'dinner-options', out: root },
      });
      assert.equal(status.structuredContent.status, 'pending');

      const task = await client.callTool({
        name: 'pplx_computer_read_task',
        arguments: { run: 'dinner-options', out: root },
      });
      assert.match(task.structuredContent.task, /compare dinner options nearby/);

      const council = await client.callTool({
        name: 'pplx_council_create',
        arguments: {
          task: 'review the dinner-options evidence',
          evidencePath: join(root, 'dinner-options', 'computer-result.json'),
          out: root,
          artifactId: 'dinner-council',
        },
      });
      assert.equal(council.structuredContent.artifactId, 'dinner-council');
      assert.equal(existsSync(join(root, 'dinner-council', 'task.md')), true);

      const councilStatus = await client.callTool({
        name: 'pplx_council_status',
        arguments: { run: 'dinner-council', out: root },
      });
      assert.equal(councilStatus.structuredContent.status, 'pending');

      const councilTask = await client.callTool({
        name: 'pplx_council_read_task',
        arguments: { run: 'dinner-council', out: root },
      });
      assert.match(councilTask.structuredContent.task, /review the dinner-options evidence/);
      assert.match(councilTask.structuredContent.task, /computer-result\.json/);
    } finally {
      await clientTransport.close();
      await serverTransport.close();
    }
  });
});
