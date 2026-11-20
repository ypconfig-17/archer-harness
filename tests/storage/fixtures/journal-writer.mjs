/** 子进程故障只控制文件读取/写入边界，实际提交仍调用生产 Journal。 */
import fs from 'node:fs/promises';
import process from 'node:process';
import { syncBuiltinESMExports } from 'node:module';
const [directory, mode] = process.argv.slice(2);
const originalOpen = fs.open;
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (String(args[0]).endsWith('.jsonl')) {
    if (mode === 'pause') {
      const read = handle.readFile.bind(handle);
      handle.readFile = async () => {
        process.send('locked');
        await new Promise(resolve => process.once('message', resolve));
        return read();
      };
    } else {
      handle.writeFile = async bytes => {
        await handle.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        process.exit(23);
      };
    }
  }
  return handle;
};
syncBuiltinESMExports();
const { JsonlAgentJournal } = await import('../../../packages/storage/dist/agent-journal.js');
await new JsonlAgentJournal(directory).append({
  agentId: 'a', expectedSeq: 1,
  drafts: [{ scope: 'agent', event: { type: 'agent.renamed', data: { title: 'child', renamedAt: 100 } } }],
});
process.disconnect();
