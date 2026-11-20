import { Input } from '@archer/ui';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@archer/ui';
/** 设置中的只读来源浏览：小卡片、能力列表、契约详情共用一个内容区域。 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client } from '../../lib/api';
import { Button } from '@archer/ui';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@archer/ui';
import { SkillLibraryEditor } from './SkillLibraryEditor';
import type { CapabilityDescriptor } from '@archer/contracts';
import { useProviders } from '../../hooks/use-runtime';
import { capabilityKey, providerDescription, schemaFields, searchProviders } from '../../lib/provider-browser';
import { contractInfo, summaryOf } from '../../lib/provider-presentation';
import { sourceLabel } from '../../lib/skill-detail';
import { Icon } from '@archer/ui';
import { SegmentedControl } from '@archer/ui';
import { SkillDetail } from './SkillDetail';
import { ResourceIcon } from '../primitives/ResourceIcon';

type Selection = { providerId: string; capability?: string; fromSearch?: boolean } | null;

export function ProviderBrowser() {
  const query = useProviders();
  const library = useQuery({ queryKey: ['skill-library'], queryFn: () => client.skillLibrary() });
  const [editor, setEditor] = useState<'create' | 'import' | null>(null);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const [schemaMode, setSchemaMode] = useState<'fields' | 'raw'>('fields');
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTargets = useRef(new Map<string, HTMLElement>());
  const returnFocus = useRef<string | undefined>(undefined);
  const sources = query.data ?? [];
  const visible = searchProviders(sources, search);
  const source = sources.find(item => item.id === selection?.providerId);
  const capability = source?.capabilities.find(item => capabilityKey(item) === selection?.capability);
  const fields = schemaFields(capability?.metadata.inputSchema);

  useEffect(() => {
    // 只由显式导航移动阅读焦点，后台刷新注册信息不抢用户焦点。
    if (returnFocus.current) {
      focusTargets.current.get(returnFocus.current)?.focus();
      returnFocus.current = undefined;
    } else if (selection) heading.current?.focus();
  }, [selection]);

  function open(next: Selection, focusKey?: string) {
    returnFocus.current = focusKey;
    setSchemaMode('fields');
    setSelection(next);
  }
  function capabilityButton(item: CapabilityDescriptor, providerId: string, fromSearch = false) {
    const info = contractInfo(item.ref.contractId);
    const execution = item.ref.contractId === 'archer.tool@1'
      ? { read: '读取', write: '写入', shell: '宿主命令' }[String(item.metadata.execution)] : undefined;
    const source = item.ref.contractId === 'archer.skill@1' && typeof item.metadata.source === 'string'
      ? ` · ${sourceLabel(item.metadata.source)}` : '';
    return <Item
      key={capabilityKey(item)}
      variant="default"
      size="sm"
      className="provider-capability-card"
      render={<button type="button" />}
      ref={node => {
        if (node) focusTargets.current.set(`cap:${capabilityKey(item)}`, node);
        else focusTargets.current.delete(`cap:${capabilityKey(item)}`);
      }}
      onClick={() => open({ providerId, capability: capabilityKey(item), fromSearch })}
    >
      <ItemMedia><ResourceIcon providerId={providerId} capability={item} /></ItemMedia>
      <ItemContent>
        <ItemTitle>{typeof item.metadata.name === 'string' ? item.metadata.name : item.ref.capabilityId}</ItemTitle>
        <ItemDescription title={summaryOf(item) ?? info.purpose}>{summaryOf(item) ?? info.purpose}</ItemDescription>
        <small className="provider-capability-meta">{execution ?? info.label}{source}{fromSearch ? ` · ${providerId}` : ''}</small>
      </ItemContent>
      <ItemActions><Icon name="chevron-right" size="xs" /></ItemActions>
    </Item>;
  }

  if (editor) return <SkillLibraryEditor mode={editor} onBack={() => setEditor(null)} />;

  return <section className="provider-browser" aria-label="能力来源浏览" aria-busy={query.isFetching}>
    {library.data?.canAdd && (!selection || source?.id === 'skills' && !selection.capability) && <div className="skill-library-actions">
      <Button variant="secondary" onClick={() => setEditor('import')}>导入 SKILL.md</Button>
      <Button variant="default" onClick={() => setEditor('create')}>创建技能</Button>
    </div>}
    {library.error && <p className="provider-browser-note">技能管理入口读取失败。<Button variant="secondary" onClick={() => void library.refetch()}>重试</Button></p>}
    {!selection && <label className="provider-browser-search">
      <Icon name="search" size="sm" />
      <Input aria-label="搜索 Provider 或能力" placeholder="搜索来源、能力或用途…" value={search} onChange={event => {
        setSearch(event.target.value);
        setSelection(null);
      }} />
    </label>}
    {query.error && <p role="alert">读取失败，已显示的数据可能不是最新注册信息。{query.error.message}<Button variant="secondary" onClick={() => void query.refetch()}>重试</Button></p>}
    {query.isLoading && <p role="status">正在读取能力来源…</p>}
    {selection && <nav className="provider-browser-breadcrumb" aria-label="能力来源路径">
      <Button variant="link" size="sm" onClick={() => open(selection.capability && !selection.fromSearch ? { providerId: selection.providerId } : null, selection.capability ? `cap:${selection.capability}` : `source:${selection.providerId}`)}>
        <Icon name="arrow-left" size="sm" />{selection.capability && !selection.fromSearch ? `返回 ${selection.providerId}` : '返回能力来源'}
      </Button>
      {selection.capability && selection.fromSearch && <Button variant="link" size="sm" onClick={() => open({ providerId: selection.providerId })}>{selection.providerId}</Button>}
    </nav>}
    {selection && !source && query.data && <p role="status">该来源已不在当前注册信息中，请返回列表查看。</p>}
    {selection?.capability && source && !capability && <p role="status">该能力或来源 revision 已变化；不会自动替换所选契约。请返回能力列表重新选择。</p>}
    {!selection && <>
      <div className="provider-browser-grid">
        {visible.map(({ source }) => {
          const kinds = [...new Set(source.capabilities.map(item => contractInfo(item.ref.contractId).label))];
          return <Item
            key={source.id}
            variant="outline"
            size="default"
            className="provider-browser-card"
            render={<button type="button" />}
            ref={node => {
              if (node) focusTargets.current.set(`source:${source.id}`, node);
              else focusTargets.current.delete(`source:${source.id}`);
            }}
            onClick={() => open({ providerId: source.id })}
          >
            <ItemMedia><ResourceIcon providerId={source.id} /></ItemMedia>
            <ItemContent>
              <ItemTitle title={source.id}>{source.id}</ItemTitle>
              <ItemDescription title={providerDescription(source)}>
                {source.capabilities.length} 项能力 · {kinds.join(' / ') || '能力来源'}
              </ItemDescription>
            </ItemContent>
            <ItemActions><Icon name="chevron-right" size="xs" /></ItemActions>
          </Item>;
        })}
      </div>
      {search.trim() && visible.some(item => item.capabilities.length) && <section className="provider-browser-list">
        <h4>匹配的能力</h4>
        <div className="provider-browser-grid">
          {visible.flatMap(({ source, capabilities }) => capabilities.map(item => capabilityButton(item, source.id, true)))}
        </div>
      </section>}
      {query.data && !visible.length && <p role="status">{search.trim() ? '没有匹配的来源或能力。' : '当前宿主尚未接入能力来源。'}</p>}
    </>}
    {source && selection && !selection.capability && <>
      <h3 className="provider-capability-title" ref={heading} tabIndex={-1}>
        <ResourceIcon providerId={source.id} />{source.id}
      </h3>
      <p className="provider-browser-description">{providerDescription(source)}</p>
      <p className="provider-browser-note">{source.capabilities.length} 项能力 · 当前宿主注册声明</p>
      <div className="provider-browser-list"><h4>提供的能力</h4><div className="provider-browser-grid">{source.capabilities.map(item => capabilityButton(item, source.id))}</div></div>
      <Collapsible className="provider-browser-raw">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="provider-browser-raw-toggle" />}>
          <Icon name="chevron-right" size="xs" />来源声明
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>由实现作者声明，不代表代码签名或外部内容校验。</p>
          <pre>{JSON.stringify(source.identity, null, 2)}</pre>
        </CollapsibleContent>
      </Collapsible>
    </>}
    {source && capability && <>
      <h3 className="provider-capability-title" ref={heading} tabIndex={-1}>
        <ResourceIcon providerId={source.id} capability={capability} />
        {typeof capability.metadata.name === 'string' ? capability.metadata.name : capability.ref.capabilityId}</h3>
      <p className="provider-browser-description">{summaryOf(capability) ?? contractInfo(capability.ref.contractId).purpose}</p>
      {capability.ref.contractId === 'archer.skill@1' ? <SkillDetail capability={capability} /> : <>
        <dl className="provider-browser-reference">
          <div><dt>Provider</dt><dd>{capability.ref.providerId}</dd></div>
          <div><dt>能力 ID</dt><dd>{capability.ref.capabilityId}</dd></div>
          <div><dt>Contract</dt><dd>{capability.ref.contractId}</dd></div>
          <div><dt>来源 revision</dt><dd>{capability.ref.revision}</dd></div>
          {typeof capability.metadata.execution === 'string' && <div><dt>执行声明</dt><dd>{capability.metadata.execution}</dd></div>}
          {typeof capability.metadata.interaction === 'string' && <div><dt>交互声明</dt><dd>{capability.metadata.interaction}</dd></div>}
        </dl>
        {capability.metadata.inputSchema !== undefined ? <section className="provider-browser-schema">
          <header><h4>参数 Schema</h4><SegmentedControl<'fields' | 'raw'> label="Schema 阅读方式" value={schemaMode}
            options={[{ value: 'fields', label: '结构化' }, { value: 'raw', label: '原始 Schema' }]} onChange={setSchemaMode} /></header>
          {schemaMode === 'raw' ? <pre>{JSON.stringify(capability.metadata.inputSchema, null, 2)}</pre> : <>
            {fields.length ? <div className="provider-browser-fields">{fields.map(field => <div key={field.name}>
              <header><code>{field.name}</code><span>{field.type}</span><small>{field.required ? '必填' : '可选'}</small></header><p>{field.description}</p>
            </div>)}</div> : <p>未声明可平铺的对象字段，请查看原始 Schema。</p>}
            <p className="provider-browser-note">此处仅概览当前层字段；嵌套、引用、组合和其他约束以原始 Schema 为准。</p>
          </>}
        </section> : <p className="provider-browser-note">此能力未公开输入 Schema。</p>}
      </>}
      <Collapsible className="provider-browser-raw">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="provider-browser-raw-toggle" />}>
          <Icon name="chevron-right" size="xs" />完整能力声明
        </CollapsibleTrigger>
        <CollapsibleContent><pre>{JSON.stringify(capability, null, 2)}</pre></CollapsibleContent>
      </Collapsible>
    </>}
    <p className="provider-browser-note">这里只读展示当前宿主声明。已接入不代表已授权，也不代表某次模型请求实际获得了这些能力。</p>
  </section>;
}
