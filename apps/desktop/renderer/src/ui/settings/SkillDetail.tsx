/** 技能详情：正文与资源按需读取，只读展示；不产生 Agent Effect。 */
import { useState } from 'react';
import type { CapabilityDescriptor, SkillResource } from '@archer/contracts';
import { useSkillContent, useSkillResource } from '../../hooks/use-runtime';
import { formatSize, groupResources, readableResource, resourcesTruncated, skillPath, skillResources, sourceLabel } from '../../lib/skill-detail';
import { Icon } from '@archer/ui';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@archer/ui';
import { Markdown } from '../primitives/Markdown';
import { Button } from '@archer/ui';

function CopyPath({ path }: { path: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return <Button variant="link" size="xs" className="skill-copy" onClick={() => {
    void navigator.clipboard.writeText(path).then(
      () => setState('copied'),
      () => setState('error'),
    ).finally(() => setTimeout(() => setState('idle'), 1500));
  }}>{state === 'copied' ? '已复制' : state === 'error' ? '复制失败' : '复制路径'}</Button>;
}

/** 资源列表来自能力声明；只有 references 与 scripts 允许展开预览。 */
function ResourceRow({ capability, resource }: { capability: CapabilityDescriptor; resource: SkillResource }) {
  const [open, setOpen] = useState(false);
  const readable = readableResource(resource.path);
  const query = useSkillResource(capability.ref, resource.path, readable && open);
  const head = <>
    <ItemMedia><Icon name="file" size="sm" /></ItemMedia>
    <ItemContent>
      <ItemTitle>{resource.path}</ItemTitle>
      <ItemDescription>{formatSize(resource.size)}{readable ? '' : ' · 仅列出，不预览'}</ItemDescription>
    </ItemContent>
    {readable && <ItemActions><Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" /></ItemActions>}
  </>;
  if (!readable) return <Item variant="default" size="sm" className="skill-resource-row">{head}</Item>;
  return <div className="skill-resource">
    <Item
      variant="default"
      size="sm"
      className="skill-resource-row"
      render={<button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} />}
    >{head}</Item>
    {open && <div className="skill-resource-content">
      {query.isLoading ? <p role="status">正在读取资源…</p>
        : query.error ? <p role="alert">{query.error.message}</p>
        : <pre>{query.data?.content}</pre>}
    </div>}
  </div>;
}

export function SkillDetail({ capability }: { capability: CapabilityDescriptor }) {
  const content = useSkillContent(capability.ref);
  const metadata = capability.metadata;
  const path = skillPath(metadata);
  const groups = groupResources(skillResources(metadata));

  return <div className="skill-detail">
    <dl className="provider-browser-reference">
      <div><dt>来源</dt><dd>{sourceLabel(metadata.source)}</dd></div>
      {path && <div><dt>路径</dt><dd className="skill-path"><span>{path}</span><CopyPath path={path} /></dd></div>}
      <div><dt>能力 ID</dt><dd>{capability.ref.capabilityId}</dd></div>
      <div><dt>来源 revision</dt><dd>{capability.ref.revision}</dd></div>
    </dl>

    <section className="skill-document" aria-label="技能正文">
      <header>
        <h4>SKILL.md</h4>
        {content.data?.revision && <small>内容 revision {content.data.revision.slice(0, 12)}</small>}
      </header>
      {content.isLoading ? <p role="status">正在读取技能正文…</p>
        : content.error ? <p role="alert">读取失败：{content.error.message}<Button variant="secondary" onClick={() => void content.refetch()}>重试</Button></p>
        : <div className="skill-markdown"><Markdown text={content.data?.content ?? ''} /></div>}
    </section>

    {groups.length > 0 && <section className="skill-resources" aria-label="技能资源">
      <h4>资源</h4>
      {groups.map(({ group, items }) => <div key={group} className="skill-resource-group">
        <h5>{group}</h5>
        {items.map(item => <ResourceRow key={item.path} capability={capability} resource={item} />)}
      </div>)}
      {resourcesTruncated(metadata) && <p className="provider-browser-note">资源清单已达展示上限，其余文件未列出。</p>}
    </section>}
  </div>;
}