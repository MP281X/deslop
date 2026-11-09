import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-sm border border-dashed border-border bg-muted/40", className)}
      {...props}
    />
  )
}

export { Skeleton }
