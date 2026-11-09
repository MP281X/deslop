import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "#lib/utils.ts"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 rounded-sm border-2 px-1.5 font-mono text-micro font-semibold tracking-widest whitespace-nowrap uppercase transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-primary/60 bg-primary/10 text-foreground [a]:hover:text-foreground/70",
        secondary: "border-border bg-surface text-muted-foreground [a]:hover:text-foreground",
        destructive:
          "border-destructive bg-destructive/10 text-destructive focus-visible:ring-destructive [a]:hover:text-destructive/70",
        outline: "border-border text-foreground [a]:hover:text-foreground/70",
        ghost: "border-transparent text-muted-foreground hover:text-foreground",
        link: "border-transparent text-foreground underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
