import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 保留 shadcn 的类名组合与 Tailwind 冲突处理方式。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
