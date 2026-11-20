import { useState } from 'react';
import { FileTree } from '@archer/ui';

/** 选择仅返回节点路径，不读取磁盘。 */
export default function Example({ state = 'default' }: { state?: string }) {
  const [path, setPath] = useState('src/agent.ts');
  return (
    <div className="file-tree-demo">
      <p className="ai-example-intro">文件树只使用传入节点，选择返回路径身份。</p>
      <div className="file-tree-demo-tree">
        <FileTree
          nodes={
            state === 'empty'
              ? []
              : [
                  {
                    type: 'folder',
                    name: 'src',
                    path: 'src',
                    children: [
                      { type: 'file', name: 'agent.ts', path: 'src/agent.ts' },
                      { type: 'file', name: 'theme.css', path: 'src/theme.css' },
                    ],
                  },
                ]
          }
          selectedPath={path}
          onSelect={setPath}
        />
      </div>
      <p className="ai-example-note" role="status">
        选中路径：{path || '尚未选择'}
      </p>
    </div>
  );
}
