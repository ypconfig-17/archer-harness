# 桌面视觉语言

## 目标与取舍

Archer 采用接近 Codex 的桌面工具比例、层级与控件密度，采用中性表面与深灰正文，保留 Archer 蓝色动作和品牌图形。对齐参考产品的视觉组织，不承诺逐像素一致，蓝色用于选择、焦点与主要操作。

统一的对象包括页面布局、表面深度、控件比例、内容密度、选择和状态反馈；仅复用字体、颜色或修改设置页不足以形成统一产品。视觉变化必须落到实际组件和样式，不能只存在于规范中。

## 区域与约束

| 区域 | 当前视觉约束 | 实现入口 |
| --- | --- | --- |
| 原生窗口与顶栏 | 保留原生系统按钮，标题栏与当前主题导航相接；会话名与工作区采用单行主次排列，工作区与文件检查栏头共用 44px | desktop/src/main.ts、layout/foundation.css、workspace/conversation.css |
| 侧栏与收起态 | 44px 应用窄栏使用框架底色与 1px 分界，236px 会话导航独立成列；单行品牌、24px 标识、与行同底色的紧凑搜索与工作区浮层菜单；会话选中使用中性浅表面，当前项目只在文件夹图标上提示强调色 | Sidebar.tsx、workspace-interactions.css、navigation.css |
| 首次使用与首页 | 保持单一欢迎入口和工作区选择，输入区与对话使用同一阅读线，不增加仪表盘卡片 | NewAgentForm.tsx |
| 对话与输入区 | 780px 阅读线、开放回复、低饱和用户气泡；12px 输入区圆角、28px 空正文高度、圆形强调色发送动作 | AgentDetail.tsx、EventTimeline.tsx、workspace/composer.css、workspace/conversation.css |
| 模型、等级与命令选择 | 紧凑选择器与辅助字号，发送和停止始终可达，不引入额外权限入口 | ComposerControls.tsx |
| 计划与输入队列 | 当前计划只在输入区上方保留一行入口，展开显示声明步骤，不进入对话段落或摘要；调用明细默认收起；队列不能挤走输入区 | CurrentPlan.tsx、QueuePanel.tsx |
| 模型过程与工具记录 | 公开反馈开始自然段落，连续工具缩进分组；每轮一行累计摘要；原始推理只在活动页阅读；当前阶段只显示一处轻量状态，整理结束后不进入答复；答复底部的模型和用量默认收进运行详情 | EventTimeline.tsx |
| Markdown、代码、图表与 Diff | 保留正文排版，代码栏头与复制动作采用统一尺寸，技术内容用共享代码底和圆角 | Markdown.tsx、markdown.css、ToolOutput.tsx |
| 审批、人工回答与对账 | 纵向呈现实际操作和选择，动作复用公共按钮；警告表面保持克制，未知状态明确 | PendingInteraction.tsx |
| 文件检查器与活动页 | 工作台默认 400px，审阅只阅读任务确认的变更，工作区只读本地 Git 未提交改动并标注为磁盘状态；中间「活动」承载已提交事件、筛选与单条记录详情，不提供请求上下文、能力来源或会话概览二级视图 | Workbench.tsx、EventPanel.tsx、ChangesPanel.tsx、WorkspaceGitPanel.tsx |
| 通用、外观、快捷键与关于 | 同一设置行、标题、导航和说明层级；外观模式使用分段选择，界面主题使用缩略选择卡，强调色使用单选项与自定义输入，页面底部提供可折叠主页实时预览 | Settings.tsx、SettingsControls.tsx |
| 对话记录与工作区 | 搜索与动作复用标准控件，记录以行呈现，行内操作不形成按钮矩阵 | SessionManager.tsx、ProjectManager.tsx |
| 模型服务与模型配置 | 提供者分组、模型折叠行、32px 表单控件；保存与反馈固定在相同位置 | ModelSettingsEditor.tsx |
| 上下文与高级策略链 | 模板为单列选择行，步骤与条件通过细线和缩进组织，统计为行内信息 | ContextManagement.tsx、ContextStepEditor.tsx、ContextFields.tsx |
| 应用菜单 | 包内 Menu / Popover 统一表面、圆角、32px 菜单行和浮层阴影，键盘与焦点返回由组件负责，入口只提供锚点与动作 | packages/ui/src/primitives/Menu.tsx、Sidebar.tsx、AgentDetail.tsx |
| 工作区、记录、重命名、删除与草稿确认 | 共用 `@archer/ui` Dialog 外壳、标题和操作节奏，配置删除使用应用内确认 | packages/ui/src/primitives/Dialog.tsx、WorkspaceDialog.tsx、SessionRemoval.tsx、RecoveryRecordsPanel.tsx、Settings.tsx |
| 空、加载、失败与断连 | 使用原位置的文字、状态色和恢复动作，不用大面积装饰或不真实的统计 | layout/foundation.css、settings.css |

实现入口均相对于 `apps/desktop/renderer/src`，原生窗口入口相对于 `apps`。

## 保持的行为边界

视觉组件只组织信息与收集显式操作。命令授权、未知结果重试、输入队列、会话删除和持久化仍由既有 Client / Runtime 契约决定。图标和颜色不能代替状态文字。窗口缩放、侧栏收起与检查栏调整不得隐藏必需的确认条件或改变事实顺序。

普通按钮默认 type=button；只有明确的表单提交动作使用 submit。危险确认的呈现不执行动作，取消与 Esc 不删除配置；确认框提供标题、说明和可访问名称，默认焦点在取消操作。

## 验证

桌面构建检查主进程与渲染进程编译、样式解析和资源打包。`tests/desktop/renderer` 检查展示投影、消息提交、权限选择、队列与偏好；公共表面测试检查按钮的表单语义和确认框的可访问结构。全量测试保护执行、提交和恢复不变量。

这些检查不代表实际视觉验收。实际观感、窗口缩放、浅深主题、键盘焦点、长文本与弹窗叠放需要运行界面后评估；不进行浏览器测试的任务必须明确保留这一验证边界。

## 全局组件约束

完整区域职责与组件矩阵见 [Desktop UI 设计规范](../guides/desktop-ui-spec.md)。导航与菜单使用独立辅助字号，正文保持阅读密度；设置使用分类、固定标题、滚动内容与设置行。弹窗内容同样受公共字段、标题、操作栏规范约束，确认、删除、重命名和未保存提示不再各自定义表单表面。所有设置字段的外观由 surfaces.css 管理，settings.css 仅补充布局及校验状态。全局空工具输出不渲染空框，事实与原始数据不受影响。

## 外观、界面主题与强调色的分离

Graphite Iris 是默认强调色，另有三套预设与自定义输入；Graphite 是默认界面主题，另有 Midnight、Slate、Warm。明暗模式、界面主题、强调色和结构刻度相互独立，偏好仅保存在本机，默认组合为深色、Graphite、Graphite Iris。中性层由界面主题按明暗定义；强调色块只覆盖填充、强调文本与前景色，其余强调层级由 Token 统一派生；自定义强调色在运行时推导可读的文字与前景色。颜色仍由 design-tokens.css 集中定义；业务组件不感知主题细节。新增界面主题或强调色不需要更改业务布局。运行中状态与当前项目提示跟随强调色，会话选中保持中性浅表面；成功、失败、警告与等待授权仍使用独立语义色；品牌保持独立。Agent 专用交互约束见 ../guides/desktop-agent-interaction.md，不由视觉示例推断新的执行状态。
