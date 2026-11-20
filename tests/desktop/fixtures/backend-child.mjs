/** 生命周期测试使用的独立子进程，不启动 Agent 或访问工作区。 */
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { setTimeout, setInterval } from 'node:timers';
if (process.env.HOST !== '127.0.0.1' || process.env.PORT !== '0' || !process.env.HARNESS_TOKEN || realpathSync(process.env.HARNESS_DATA_DIR) !== process.cwd()) process.exit(8);
const mode = process.env.ARCHER_BACKEND_TEST;
if (mode === 'early-exit') { process.stderr.write('startup failure'); process.exit(2); }
if (mode !== 'wait') {
  process.send?.({ type: 'archer.ready', url: 'http://127.0.0.1:12345' });
  if (mode === 'late-exit') setTimeout(() => { process.stderr.write(`failure ${process.env.HARNESS_TOKEN}`); process.exit(3); }, 20);
}
setInterval(() => {}, 1000);
