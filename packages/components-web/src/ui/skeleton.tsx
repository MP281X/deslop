import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-none rounded-none border border-border/60 bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
