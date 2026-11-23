/** 模型投影只消费 Tool 和 Skill，不把基础设施变成工具。 */
import { expect, it } from 'vitest';
import { createCamp, provider, tool, skill, offer, INFERENCE } from '@archer/camp';
import { compileModelTools } from '@archer/runtime';
it('工具名满足原生限制，描述与 Schema 独立，不包含内部引用', async () => {
  const camp = await createCamp({ providers: [provider('example', {
    run: tool({ description: 'Run.', inputSchema: { type: 'object', properties: {} }, execution: 'read', invoke: async () => null }),
    guide: skill({ name: 'Guide', description: 'Read guidance.', load: async () => ({ content: 'Guidance.' }) }),
    model: offer(INFERENCE, { description: 'Infer.' }, { infer: async () => ({ content: '' }) }),
  })] });
  try {
    const tools = compileModelTools(camp); expect(tools).toHaveLength(2);
    expect(tools.map(tool => tool.name)).toEqual(['example_run', 'load_Guide']);
    for (const tool of tools) { expect(tool.name).toMatch(/^[A-Za-z0-9_]{1,64}$/); expect(tool.description).not.toContain('revision'); }
    tools[0]!.parameters.type = 'string'; expect(compileModelTools(camp)[0]!.parameters.type).toBe('object');
  } finally { await camp.close(); }
});
it('宿主展示摘要留在声明里，不进入模型工具描述', async () => {
  const camp = await createCamp({ providers: [provider('example', {
    run: tool({
      description: 'Run the task.',
      summary: '执行任务。',
      inputSchema: { type: 'object', properties: {} },
      execution: 'read',
      invoke: async () => null,
    }),
  })] });
  try {
    const [declared] = compileModelTools(camp);
    expect(declared!.description).toBe('Run the task.');
    expect(camp.providers()[0]!.capabilities[0]!.metadata.summary).toBe('执行任务。');
  } finally { await camp.close(); }
});

it('规范化后重名明确拒绝，不以扫描顺序覆盖工具', async () => {
  const declaration = () => tool({
    description: 'Run.',
    inputSchema: { type: 'object', properties: {} },
    execution: 'read',
    invoke: async () => null,
  });
  const camp = await createCamp({ providers: [
    provider('example', { 'run-a': declaration(), run_a: declaration() }),
  ] });
  try {
    expect(() => compileModelTools(camp)).toThrow('Model tool name collision');
  } finally {
    await camp.close();
  }
});
