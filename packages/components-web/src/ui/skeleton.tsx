import { cn } from "#lib/utils.ts"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-[3px] bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
