/** 改编自 shadcn/ui（revision e62c943），来源与本地改动见包内 THIRD_PARTY.md。 */
import * as React from "react"
import { cn } from '../lib/cn.js'

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "cn-label flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

export { Label }
