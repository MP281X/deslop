import { cn } from "#lib/classes.ts"
import { SpinnerIcon } from "@phosphor-icons/react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <SpinnerIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4", className)} {...props} />
  )
}

export { Spinner }
