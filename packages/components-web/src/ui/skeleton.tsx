import { cn } from "#lib/classes.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-none bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
