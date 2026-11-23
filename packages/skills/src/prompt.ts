/** 技能资源工具对模型可见的文案；正文由 SKILL.md 提供，不在这里复述。 */
import { SKILL_RESOURCE_MAX_BYTES } from './resources.js';

export const READ_RESOURCE_DESCRIPTION = `Read a UTF-8 text resource from a local skill package. Only paths under references/ or scripts/ are readable, and each file is limited to ${SKILL_RESOURCE_MAX_BYTES} bytes. Reading a resource grants no additional permissions.`;
export const READ_RESOURCE_SUMMARY = '读取技能包中的参考文件或脚本内容。';
export const READ_RESOURCE_PATH_DESCRIPTION = 'Path relative to the skill directory, for example references/checklist.md.';