import { Input } from '@archer/ui';
/** 新增技能只保存宿主文件，生效时间由宿主回执表达，不伪装为已注册能力。 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { client } from '../../lib/api';
import { Button, ConfirmDialog, FormField, Textarea } from '@archer/ui';
import { Icon } from '@archer/ui';
import { ResourceIcon } from '../primitives/ResourceIcon';

export function SkillLibraryEditor({ mode, onBack }: { mode: 'create' | 'import'; onBack(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [document, setDocument] = useState('');
  const [fileError, setFileError] = useState('');
  const [confirmBack, setConfirmBack] = useState(false);
  const dirty = !!(name || description || body || document);
  const save = useMutation({ mutationFn: (content: string) => client.addSkill(content) });
  return <section className="skill-library-editor">
    <nav className="provider-browser-breadcrumb" aria-label="技能编辑路径">
      <Button variant="link" size="sm" onClick={() => dirty && !save.data ? setConfirmBack(true) : onBack()} disabled={save.isPending}>
        <Icon name="arrow-left" size="sm" />返回能力来源
      </Button>
    </nav>
    {confirmBack && <ConfirmDialog
      title="放弃未保存的技能？"
      description="当前编辑内容尚未保存。"
      confirmLabel="放弃编辑"
      onConfirm={onBack}
      onClose={() => setConfirmBack(false)}
    />}
    <header className="skill-editor-heading">
      <ResourceIcon providerId="skills" />
      <div>
        <h3 ref={heading} tabIndex={-1}>{mode === 'create' ? '创建技能' : '导入技能'}</h3>
        <p>{mode === 'create' ? '定义用途与指导，让 Agent 按需使用。' : '从已有的 SKILL.md 添加技能。'}</p>
      </div>
    </header>
    {save.data ? <div className="skill-editor-result" role="status">
      <h4>{save.data.name} 已保存 · 待重启加载</h4>
      <p className="provider-browser-note">{save.data.path}</p>
      <p>请在当前任务结束后自行重启应用。刷新能力列表不会加载新技能。</p>
      <Button variant="secondary" onClick={onBack}>返回浏览</Button>
    </div> : <form onSubmit={event => {
      event.preventDefault();
      const content = mode === 'import' ? document
        : `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
      save.mutate(content);
    }}>
      {mode === 'create' ? <>
        <FormField label="技能名称">
          <Input disabled={save.isPending} required maxLength={64}
            pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" placeholder="例如 code-review"
            value={name} onChange={event => setName(event.target.value)} />
          <small>小写字母、数字和连字符，最多 64 个字符。</small>
        </FormField>
        <FormField label="用途描述">
          <Input placeholder="一句话说明用途，以及何时使用" disabled={save.isPending}
            required maxLength={1024} value={description}
            onChange={event => setDescription(event.target.value)} />
        </FormField>
        <FormField label="技能指导">
          <Textarea placeholder="写下执行步骤、检查要点和约束…" disabled={save.isPending}
            required rows={10} value={body} onChange={event => setBody(event.target.value)} />
          <small>支持 Markdown · 文件总大小不超过 64 KiB</small>
        </FormField>
      </> : <>
        <p className="provider-browser-note">仅导入单个 SKILL.md，不包含 references、scripts 或 assets。依赖附带资源的技能包需手动完整放入技能目录。</p>
        <FormField label="选择 SKILL.md"><input disabled={save.isPending} type="file" accept=".md,text/markdown" onChange={event => {
          const file = event.target.files?.[0];
          setFileError('');
          if (!file) return;
          if (file.size > 65536) { setFileError('文件不能超过 64 KiB。'); return; }
          void file.text().then(setDocument, () => setFileError('文件读取失败，请重新选择。'));
        }} /></FormField>
        <FormField label="检查技能文件内容"><Textarea disabled={save.isPending} required rows={10} value={document} onChange={event => setDocument(event.target.value)} /></FormField>
      </>}
      {fileError && <p role="alert">{fileError}</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
      <footer className="skill-editor-footer">
        <p><Icon name="info" size="sm" />保存到 Archer 技能目录，重启后加载。</p>
        <div>
          <Button variant="secondary" disabled={save.isPending} onClick={() => dirty ? setConfirmBack(true) : onBack()}>取消</Button>
          <Button type="submit" variant="default" disabled={save.isPending}>{save.isPending ? '正在保存…' : '保存技能'}</Button>
        </div>
      </footer>
    </form>}
  </section>;
}
