import type { CSSProperties, JSX } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowUpIcon } from '@phosphor-icons/react/dist/csr/ArrowUp';
import { ArrowDownIcon } from '@phosphor-icons/react/dist/csr/ArrowDown';
import { StopIcon } from '@phosphor-icons/react/dist/csr/Stop';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock';
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText';
import { FileIcon } from '@phosphor-icons/react/dist/csr/File';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PencilSimpleLineIcon } from '@phosphor-icons/react/dist/csr/PencilSimpleLine';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { FolderIcon } from '@phosphor-icons/react/dist/csr/Folder';
import { FolderPlusIcon } from '@phosphor-icons/react/dist/csr/FolderPlus';
import { TerminalWindowIcon } from '@phosphor-icons/react/dist/csr/TerminalWindow';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { TrashSimpleIcon } from '@phosphor-icons/react/dist/csr/TrashSimple';
import { ArrowBendDownRightIcon } from '@phosphor-icons/react/dist/csr/ArrowBendDownRight';
import { CopySimpleIcon } from '@phosphor-icons/react/dist/csr/CopySimple';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { MonitorIcon } from '@phosphor-icons/react/dist/csr/Monitor';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutSimple';
import { ArrowsInSimpleIcon } from '@phosphor-icons/react/dist/csr/ArrowsInSimple';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link';
import { PaperclipIcon } from '@phosphor-icons/react/dist/csr/Paperclip';
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image';
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch';
export type IconName = 'home' | 'more' | 'plus' | 'panel' | 'sun' | 'moon' | 'arrow-left' | 'arrow-up' | 'arrow-down' | 'stop' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'check' | 'x' | 'alert' | 'clock' | 'file' | 'file-plain' | 'pencil' | 'compose' | 'folder' | 'folder-closed' | 'folder-plus' | 'terminal' | 'refresh' | 'trash' | 'corner' | 'copy' | 'spark' | 'shield' | 'settings' | 'search' | 'monitor' | 'list' | 'drive' | 'maximize' | 'minimize' | 'info' | 'link' | 'paperclip' | 'image' | 'git-branch';
const ICONS: Record<IconName, PhosphorIcon> = {
  'home': HouseIcon,
  'more': DotsThreeIcon,
  'plus': PlusIcon,
  'panel': SidebarSimpleIcon,
  'sun': SunIcon,
  'moon': MoonIcon,
  'arrow-left': ArrowLeftIcon,
  'arrow-up': ArrowUpIcon,
  'arrow-down': ArrowDownIcon,
  'stop': StopIcon,
  'chevron-down': CaretDownIcon,
  'chevron-left': CaretLeftIcon,
  'chevron-right': CaretRightIcon,
  'check': CheckIcon,
  'x': XIcon,
  'alert': WarningCircleIcon,
  'clock': ClockIcon,
  'file': FileTextIcon,
  'file-plain': FileIcon,
  'pencil': PencilSimpleIcon,
  'compose': PencilSimpleLineIcon,
  'folder': FolderOpenIcon,
  'folder-closed': FolderIcon,
  'folder-plus': FolderPlusIcon,
  'terminal': TerminalWindowIcon,
  'refresh': ArrowClockwiseIcon,
  'trash': TrashSimpleIcon,
  'corner': ArrowBendDownRightIcon,
  'copy': CopySimpleIcon,
  'spark': SparkleIcon,
  'shield': ShieldCheckIcon,
  'settings': GearSixIcon,
  'search': MagnifyingGlassIcon,
  'monitor': MonitorIcon,
  'list': ListBulletsIcon,
  'drive': HardDrivesIcon,
  'maximize': ArrowsOutSimpleIcon,
  'minimize': ArrowsInSimpleIcon,
  'info': InfoIcon,
  'link': LinkIcon,
  'paperclip': PaperclipIcon,
  'image': ImageIcon,
  'git-branch': GitBranchIcon,
};

/** 图标只选语义尺寸与统一 regular 轮廓，实际尺寸集中在全局规范。 */
export function Icon({ name, size = 'md', className, style }: { name: IconName; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string; style?: CSSProperties }): JSX.Element {
  const Glyph = ICONS[name];
  const sizeClass = { xs: 'icon-mini', sm: 'icon-small', md: '', lg: 'icon-brand' }[size];
  return <Glyph weight="regular" className={['ui-icon', sizeClass, className].filter(Boolean).join(' ')} style={style} aria-hidden="true" focusable="false" />;
}
