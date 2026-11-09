import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-none border-2 border-border/50 bg-card motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
