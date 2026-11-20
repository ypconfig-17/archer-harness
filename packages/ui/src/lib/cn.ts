import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 官方组件以类名组合表达变体；合并时以后传入的业务类为准。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
