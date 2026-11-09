import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "#lib/utils.ts"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-none border-2 px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-border text-foreground [a]:hover:border-rule-strong",
        secondary: "border-border text-muted-foreground [a]:hover:text-foreground",
        destructive:
          "border-destructive text-destructive focus-visible:ring-destructive [a]:hover:bg-destructive/10",
        outline: "border-border text-foreground [a]:hover:border-rule-strong",
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
