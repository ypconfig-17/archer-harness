/** 改编自 shadcn/ui（revision e62c943），来源与本地改动见包内 THIRD_PARTY.md。 */
import { cn } from '../lib/cn.js'

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("cn-skeleton animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
