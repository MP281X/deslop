import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "#lib/utils.ts"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border-2 border-transparent bg-clip-padding font-mono text-stamp font-semibold tracking-widest whitespace-nowrap uppercase transition duration-140 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 max-sm:min-h-12 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "hard-offset border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border-border bg-card text-foreground hover:bg-secondary aria-expanded:bg-secondary",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        destructive:
          "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive",
        port: "border-primary/70 bg-primary/10 text-primary normal-case hover:bg-primary/20",
        link: "border-transparent text-primary underline underline-offset-4 hover:underline",
        search:
          "inset-field border-border bg-background px-3 font-mono text-xs font-normal tracking-normal normal-case text-muted-foreground hover:bg-secondary hover:text-foreground",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9 max-sm:size-12",
        "icon-xs": "size-7 max-sm:size-12 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 max-sm:size-12",
        "icon-lg": "size-11 max-sm:size-12",
        search: "h-9 w-full justify-start gap-2.5 px-3 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
