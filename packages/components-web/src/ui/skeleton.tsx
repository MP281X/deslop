import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-sm border-2 border-border/60 bg-surface", className)}
      {...props}
    />
  )
}

export { Skeleton }
