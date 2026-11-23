/** 只在独立诊断窗口注入 React Profiler；正式模块、用户窗口及业务事实不变。 */
import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import ts from 'typescript';

const { fetch, WebSocket } = globalThis;

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpointValue = option('--main-endpoint');
if (!endpointValue) throw new Error('必须提供 Electron 主进程的 --main-endpoint');
const endpoint = new URL(endpointValue);
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
  throw new Error('只允许本机 Electron 主进程 Inspector');
}
const output = resolve(option('--output', '/tmp/archer-renderer-profile'));
const targets = await (await fetch(new URL('/json/list', endpoint))).json();
if (targets.length !== 1 || targets[0].type !== 'node') throw new Error('主进程调试目标不唯一');
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((accept, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspector 连接超时')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); accept(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector 连接失败')); }, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message));
  else request.accept(message.result);
});
function call(method, params = {}) {
  return new Promise((accept, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 60000);
    pending.set(id, { accept, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function main(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const electron = `process.getBuiltinModule('node:module').createRequire(process.cwd()+'/__diagnostic__.cjs')('electron')`;
const session = 'globalThis.__archerRendererDiagnostic';
async function command(method, params = {}) {
  return main(`${session}.window.webContents.debugger.sendCommand(${JSON.stringify(method)}, ${JSON.stringify(params)})`);
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const components = new Set(['AgentDetail', 'EventTimeline', 'ComposerControls', 'PublicFeedback', 'FinalAnswer', 'DraftComposerTextarea', 'DraftComposerSendButton']);
const counted = new Set([...components, 'ContextPanel', 'InvocationPanel', 'EventFactsPanel', 'Markdown', 'ConversationActivity', 'ActivityFlow']);
const projections = new Set(['buildItems', 'activitySections', 'workspaceGroups', 'turnPresentations', 'turnNavEntries', 'contextRequests', 'planRecords', 'taskChanges']);
function instrument(source, url, reactUrl) {
  const file = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  const wrappers = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name && node.body) {
      const name = node.name.text.replace(/\d+$/, '');
      if (projections.has(name)) {
        edits.push({ at: node.body.getStart(file) + 1, text: `const __profileStart = performance.now(); try {` });
        edits.push({ at: node.body.end - 1, text: `} finally { window.__archerCapture.projection(${JSON.stringify(name)}, __profileStart, arguments[0]?.length ?? 0); }` });
      } else if (counted.has(name)) {
        edits.push({ at: node.body.getStart(file) + 1, text: `window.__archerCapture.rendered(${JSON.stringify(name)}${name === 'Markdown' ? ', arguments[0]?.streaming' : ''});` });
        if (components.has(name) && ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          const exported = node.modifiers.find(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
          edits.push({ at: exported.getStart(file), end: exported.end, text: '' });
          edits.push({ at: node.name.getStart(file), end: node.name.end, text: `${name}ProfileInner` });
          wrappers.push(`export function ${name}(props) { return __ArcherProfileReact.createElement(__ArcherProfileReact.Profiler, {id:${JSON.stringify(name)},onRender:window.__archerCapture.onRender}, __ArcherProfileReact.createElement(${name}ProfileInner,props)); }`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!edits.length) return source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.end ?? edit.at);
  if (wrappers.length) source = `import __ArcherProfileReact from ${JSON.stringify(reactUrl)};\n${source}\n${wrappers.join('\n')}`;
  return source;
}

const bootstrap = `(() => {
  performance.setResourceTimingBufferSize(10000);
  const storage = new Map();
  for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);storage.set(key,localStorage.getItem(key));}
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:key=>storage.get(String(key))??null,setItem:(key,value)=>storage.set(String(key),String(value)),
    removeItem:key=>storage.delete(String(key)),clear:()=>storage.clear(),key:index=>[...storage.keys()][index]??null,
    get length(){return storage.size;}
  }});
  const capture = window.__archerCapture = {
    phase: null, phases: {}, queryClient: null,
    ensure() { return this.phases[this.phase] ??= {startedAt:performance.now(),renders:{},projections:{},profilers:[],actors:{},longTasks:[],inputs:[]}; },
    rendered(name, streaming) { if(this.phase) { const key=name==='Markdown'?name+(streaming?'[streaming]':'[static]'):name;const p=this.ensure(); p.renders[key]=(p.renders[key]??0)+1; } },
    projection(name, start, size) {
      if(!this.phase) return;
      const p=this.ensure(); const item=p.projections[name]??={calls:0,totalMs:0,maxMs:0,maxInput:0};
      const duration=performance.now()-start;
      item.calls++; item.totalMs+=duration; item.maxMs=Math.max(item.maxMs,duration); item.maxInput=Math.max(item.maxInput,size);
    },
    actor(name) { if(this.phase) {const p=this.ensure();p.actors[name]=(p.actors[name]??0)+1;} },
    onRender(id,phase,actualDuration,baseDuration,startTime,commitTime) {
      const c=window.__archerCapture;
      if(c.phase)c.ensure().profilers.push({id,phase,actualDuration,baseDuration,startTime,commitTime});
    }
  };
  capture.observer = new PerformanceObserver(list => {
    if(capture.phase)for(const task of list.getEntries())capture.ensure().longTasks.push({startTime:task.startTime,duration:task.duration});
  });
  capture.observer.observe({type:'longtask',buffered:false});
  document.addEventListener('input', () => {
    const phase=capture.phase, time=performance.now();
    capture.actor('input-event');
    if(phase)requestAnimationFrame(()=>{if(capture.phase===phase)capture.ensure().inputs.push(performance.now()-time);});
  },true);
})()`;

let created = false;
let profiling = false;
let pumping = false;
let pumpTask;
const intercepted = [];
const moduleUrls = {};
const sourceChanges = [];
let activePhase = null;
let reactUrl;
try {
  console.info('准备独立诊断窗口');
  const info = await main(`(async () => {
    if(${session})throw new Error('已有 Renderer 诊断窗口');
    const electron=${electron};
    const original=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:5173/'));
    if(!original)throw new Error('未找到开发窗口');
    const config=await original.webContents.executeJavaScript('({apiUrl:window.archerDesktop?.apiUrl,serviceKey:window.archerDesktop?.serviceKey})');
    if(!config.apiUrl)throw new Error('正式窗口未提供 API 地址');
    const preload=process.getBuiltinModule('node:path').join(electron.app.getAppPath(),'dist/preload.cjs');
    const additionalArguments=['--archer-api-url='+config.apiUrl,'--archer-service-key='+config.serviceKey];
    const bounds=original.getContentBounds();
    const window=new electron.BrowserWindow({show:false,width:bounds.width,height:bounds.height,webPreferences:{
      preload,additionalArguments,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false
    }});
    ${session}={window,originalId:original.id};
    await window.loadURL('data:text/html,<html><body>Archer diagnostic</body></html>');
    window.webContents.debugger.attach('1.3');
    return {url:original.webContents.getURL(),width:bounds.width,height:bounds.height};
  })()`);
  created = true;
  // 只拦截诊断窗口；主窗口的网络会话和已有鉴权处理保持原样。
  await main(`(() => {
    const session=${session};
    session.requests=[];
    session.handler=async (_event,method,params) => {
      if(method!=='Fetch.requestPaused')return;
      const debugger_=session.window.webContents.debugger;
      try {
        if(!['GET','HEAD','OPTIONS'].includes(params.request.method)) {
          await debugger_.sendCommand('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'});
          return;
        }
        if(params.responseStatusCode && new URL(params.request.url).pathname.startsWith('/src/')) {
          const response=await debugger_.sendCommand('Fetch.getResponseBody',{requestId:params.requestId});
          const source=response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body;
          const result=await new Promise(resolve=>{session.requests.push({params,source,resolve});});
          if(result.changed) {
            const headers=(params.responseHeaders??[]).filter(h=>!['content-length','content-encoding'].includes(h.name.toLowerCase()));
            await debugger_.sendCommand('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:params.responseStatusCode,responseHeaders:headers,body:Buffer.from(result.source).toString('base64')});
          } else await debugger_.sendCommand('Fetch.continueRequest',{requestId:params.requestId});
        } else await debugger_.sendCommand('Fetch.continueRequest',{requestId:params.requestId});
      } catch(error) {session.error=String(error);}
    };
    session.window.webContents.debugger.on('message',session.handler);
  })()`);
  console.info('连接诊断 Renderer');
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap });
  await command('Fetch.enable', { patterns: [
    { urlPattern: '*', requestStage: 'Request' },
    { urlPattern: '*://127.0.0.1:5173/src/*', requestStage: 'Response' },
  ] });
  // 模块响应只在这个窗口内替换；TypeScript AST 定位函数体，不修改磁盘源码。
  pumping = true;
  const pump = pumpTask = (async () => {
    while (pumping) {
      const requests = await main(`${session}.requests.map((r,i)=>({i,url:r.params.request.url,source:r.source})).filter(r=>!${session}.requests[r.i].handled)`);
      for (const request of requests) {
        const path = new URL(request.url).pathname;
        if (activePhase && moduleUrls[path] && moduleUrls[path] !== request.url) sourceChanges.push({phase:activePhase,path});
        moduleUrls[path] = request.url;
        let source = request.source;
        if (new URL(request.url).pathname === '/src/main.tsx') {
          const react = source.match(/import\s+(\w+)\s+from\s+"([^"]*\/react\.js[^"]*)"/);
          const client = source.match(/const createRoot = (\w+)\["createRoot"\];/);
          if (!react || !client) throw new Error('main.tsx 的开发模块格式不支持诊断注入');
          reactUrl = react[2];
          source = source.replace(client[0], `const createRoot=(...args)=>{const root=${client[1]}["createRoot"](...args);const render=root.render.bind(root);root.render=element=>render(${react[1]}.createElement(${react[1]}.Profiler,{id:'App',onRender:window.__archerCapture.onRender},element));return root;};`);
          source = source.replace('createRoot(container).render(', 'window.__archerCapture.queryClient=queryClient;\ncreateRoot(container).render(');
        } else if (reactUrl) source = instrument(source, request.url, reactUrl);
        intercepted.push({ path: new URL(request.url).pathname, changed: source !== request.source });
        await main(`${session}.requests[${request.i}].handled=true;${session}.requests[${request.i}].resolve(${JSON.stringify({ source, changed: source !== request.source })})`);
      }
      await new Promise(accept => setTimeout(accept, activePhase ? 100 : 5));
    }
  })();
  await main(`void ${session}.window.loadURL(${JSON.stringify(info.url)}).catch(error=>{${session}.error=String(error)}); true`);
  for (let index = 0; index < 120; index++) {
    const ready = await evaluate(`Boolean(window.__archerCapture?.queryClient && document.querySelector('textarea'))`);
    if (ready) break;
    if (index === 119) { const error=await evaluate('document.body.innerText.slice(-200)'); throw new Error('诊断窗口未进入会话: '+error); }
    await new Promise(accept => setTimeout(accept, 250));
  }
  await new Promise(accept => setTimeout(accept, 1500));
  console.info('会话加载完成，开始采样');
  const metadata = await evaluate(`(async () => {
    const urls=${JSON.stringify(moduleUrls)};
    const resource=name=>urls['/src/'+name];
    const events=await import(resource('store/agent-stream.ts'));
    const progress=await import(resource('store/progress.ts'));
    const api=await import(resource('lib/api.ts'));
    const id=decodeURIComponent(location.hash.slice('#agent/'.length));
    const capture=window.__archerCapture;
    capture.eventStore=events.useAgentStreamStore;capture.progressStore=progress.useProgress;capture.client=api.client;capture.agentId=id;
    capture.unsubscribers=[events.useAgentStreamStore.subscribe((next,previous)=>{if(next.eventsByAgent[capture.agentId]!==previous.eventsByAgent[capture.agentId])capture.actor('event-store');}),progress.useProgress.subscribe((next,previous)=>{if(next.frames[capture.agentId]!==previous.frames[capture.agentId])capture.actor('progress-store');}),capture.queryClient.getQueryCache().subscribe(event=>capture.actor('query-'+event.query?.queryKey?.[0]+'-'+event.type))];
    const list=await capture.client.list({limit:200});
    const states=await Promise.all(list.map(item=>capture.client.agentState(item.id)));
    const idle=states.filter(state=>!state.activeTurn&&state.seq>=1000).sort((a,b)=>b.seq-a.seq);
    const selected=idle.find(state=>state.id!==id)??idle[0];
    if(!selected)throw new Error('没有可用于受控实验的千条事件空闲会话');
    const ui=await import(resource('store/ui.ts'));
    capture.agentId=selected.id;capture.initialState={seq:selected.seq,active:Boolean(selected.activeTurn)};
    ui.useUiStore.getState().selectAgent(selected.id);
    return {events:0,nodes:document.getElementsByTagName('*').length,visibility:document.visibilityState,backendBefore:capture.initialState};
  })()`);
  for(let index=0;index<120;index++) {
    const loaded=await evaluate('window.__archerCapture.eventStore.getState().eventsByAgent[window.__archerCapture.agentId]?.length??0');
    if(loaded) {metadata.events=loaded;break;}
    if(index===119)throw new Error('历史事件未加载完成');
    await new Promise(accept=>setTimeout(accept,250));
  }
  let stable=0,previous=-1;
  for(let index=0;index<80;index++) {
    const count=await evaluate('window.__archerCapture.eventStore.getState().eventsByAgent[window.__archerCapture.agentId]?.length??0');
    stable=count===previous?stable+1:0;previous=count;
    if(stable>=12){metadata.events=count;break;}
    if(index===79)throw new Error('历史仍在补齐，不能建立受控样本');
    await new Promise(accept=>setTimeout(accept,250));
  }
  console.info('历史就绪：'+metadata.events+' 条事件');
  await command('Performance.enable');
  async function phase(name, work) {
    console.info('采样 '+name);
    activePhase=name;
    await evaluate(`window.__archerCapture.phase=${JSON.stringify(name)};window.__archerCapture.ensure(); true`);
    await evaluate('window.__archerCapture.ensure().eventsBefore=window.__archerCapture.eventStore.getState().eventsByAgent[window.__archerCapture.agentId].length;true');
    await command('Profiler.enable');
    await command('Profiler.start');
    profiling = true;
    const before = await command('Performance.getMetrics');
    await work();
    await new Promise(accept => setTimeout(accept, 300));
    const after = await command('Performance.getMetrics');
    const { profile } = await command('Profiler.stop');
    profiling = false;
    await writeFile(`${output}-${name}.cpuprofile`, JSON.stringify(profile));
    await evaluate(`(() => {
      const c=window.__archerCapture,p=c.ensure();p.endedAt=performance.now();
      for(const task of c.observer.takeRecords())p.longTasks.push({startTime:task.startTime,duration:task.duration});
      p.longTasks=p.longTasks.filter(task=>task.startTime>=p.startedAt&&task.startTime<p.endedAt);
      p.metrics=${JSON.stringify({before,after})};p.events=c.eventStore.getState().eventsByAgent[c.agentId].length;
      c.phase=null;return true;
    })()`);
    activePhase=null;
  }
  await phase('idle', () => new Promise(accept => setTimeout(accept, 2500)));
  await phase('input', async () => {
    await evaluate(`document.querySelector('textarea[aria-label="消息"]').focus(); true`);
    for (const text of 'renderer-profile-text') {
      await command('Input.insertText', { text });
      await new Promise(accept => setTimeout(accept, 50));
    }
  });
  await evaluate(`(() => {
    const capture=window.__archerCapture,id=capture.agentId;
    const events=capture.eventStore.getState().eventsByAgent[id];
    const seq=events.at(-1).seq,time=Date.now();
    const target={providerId:'diagnostic',capabilityId:'inference',contractId:'archer.inference@1',revision:'diagnostic'};
    capture.eventStore.getState().appendEvents(id,[
      {id:id+':'+(seq+1),agentId:id,seq:seq+1,ts:time,fact:{scope:'turn',turnId:'diagnostic-turn',turnSeq:1,event:{type:'effect.created',data:{effectId:'diagnostic-infer',effect:{type:'INFER',target,messages:[],tools:[]},createdAt:time}}}},
      {id:id+':'+(seq+2),agentId:id,seq:seq+2,ts:time,fact:{scope:'turn',turnId:'diagnostic-turn',turnSeq:2,event:{type:'effect.started',data:{effectId:'diagnostic-infer',effectType:'INFER',startedAt:time,attempt:1}}}}
    ]);return true;
  })()`);
  await new Promise(accept => setTimeout(accept, 400));
  const sizes = [];
  for (const requested of ['loaded', 'padded']) {
    if (requested === 'padded') {
      await evaluate(`(() => {
        const c=window.__archerCapture,id=c.agentId,start=c.eventStore.getState().eventsByAgent[id].at(-1).seq;
        const facts=Array.from({length:5000},(_,index)=>({id:id+':'+(start+index+1),agentId:id,seq:start+index+1,ts:Date.now(),fact:{scope:'agent',event:{type:'execution.configured',data:{workspaceAccess:'read',expectedRevision:0,revision:1}}}}));
        c.eventStore.getState().appendEvents(id,facts);return true;
      })()`);
      await new Promise(accept => setTimeout(accept, 500));
    }
    const size = await evaluate(`window.__archerCapture.eventStore.getState().eventsByAgent[window.__archerCapture.agentId].length`);
    sizes.push({requested,actual:size});
    await phase(`stream-${requested}`, async () => {
      for (let index=0;index<40;index++) {
        await evaluate(`(() => {const capture=window.__archerCapture;capture.progressStore.getState().update({agentId:capture.agentId,turnId:'diagnostic-turn',effectId:'diagnostic-infer',phase:'generating',content:${JSON.stringify('Diagnostic preview. '.repeat(index+1))}});return true;})()`);
        await new Promise(accept=>setTimeout(accept,50));
      }
    });
    if(requested==='loaded') await phase('stream-input-loaded',async()=>{
      await evaluate(`document.querySelector('textarea[aria-label="消息"]').focus();true`);
      await Promise.all([
        (async()=>{for(let index=0;index<40;index++) {
          await evaluate(`(() => {const c=window.__archerCapture;c.progressStore.getState().update({agentId:c.agentId,turnId:'diagnostic-turn',effectId:'diagnostic-infer',phase:'generating',content:'Concurrent diagnostic preview. '.repeat(${index+1})});return true;})()`);
          await new Promise(accept=>setTimeout(accept,50));
        }})(),
        (async()=>{for(const text of 'concurrent-input-text') {
          await command('Input.insertText',{text});
          await new Promise(accept=>setTimeout(accept,75));
        }})(),
      ]);
    });
    await phase(`events-${requested}`, async () => {
      for (let index=0;index<20;index++) {
        await evaluate(`(() => {const capture=window.__archerCapture,id=capture.agentId,seq=capture.eventStore.getState().eventsByAgent[id].at(-1).seq+1;capture.eventStore.getState().appendEvents(id,[{id:id+':'+seq,agentId:id,seq,ts:Date.now(),fact:{scope:'agent',event:{type:'execution.configured',data:{workspaceAccess:'read',expectedRevision:0,revision:1}}}}]);return true;})()`);
        await new Promise(accept=>setTimeout(accept,80));
      }
    });
  }
  const scrollBefore=await evaluate(`(() => {const e=document.querySelector('.chat-scroll'),r=e.getBoundingClientRect();return {top:e.scrollTop,height:e.scrollHeight,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await phase('scroll',async()=>{
    for(let index=0;index<20;index++) {
      await command('Input.dispatchMouseEvent',{type:'mouseWheel',x:scrollBefore.x,y:scrollBefore.y,deltaX:0,deltaY:-200});
      await new Promise(accept=>setTimeout(accept,75));
    }
  });
  const scrollAfter=await evaluate(`(() => {const e=document.querySelector('.chat-scroll');return {top:e.scrollTop,height:e.scrollHeight};})()`);
  const results = await evaluate(`(async () => {
    const c=window.__archerCapture,state=await c.client.agentState(c.agentId);
    return {phases:c.phases,nodes:document.getElementsByTagName('*').length,backendAfter:{seq:state.seq,active:Boolean(state.activeTurn)}};
  })()`);
  const report = { methodology: 'Separate hidden Electron window, original preload/auth, backend mutation requests blocked. React development StrictMode. Official React Profiler injected into in-memory module responses, function invocation counters and projection timers. An idle real conversation, virtual localStorage, synthetic Store-level progress/events; padded scenario adds 5000 filtered local facts while preserving visible messages. No Agent execution or backend writes. Hidden-window rendering is not a paint/FPS benchmark.', viewport:info,metadata,sizes,scroll:{before:scrollBefore,after:scrollAfter},sourceChanges,...results,intercepted:intercepted.filter(item=>item.changed) };
  delete report.viewport.url;
  await writeFile(`${output}.json`, JSON.stringify(report,null,2));
  pumping = false;
  await pump;
  console.info(`Renderer 诊断完成：${output}.json`);
} finally {
  pumping = false;
  if (pumpTask) await pumpTask.catch(() => {});
  if (created) {
    if (profiling) await command('Profiler.stop').catch(()=>{});
    await main(`(() => {const session=${session};if(!session)return;session.window.webContents.debugger.removeListener('message',session.handler);session.window.destroy();delete ${session};})()`).catch(()=>{});
  }
  socket.close();
}
