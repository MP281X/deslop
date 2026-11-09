import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-full bg-secondary motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
