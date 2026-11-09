import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "#lib/utils.ts"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border-2 border-transparent bg-clip-padding text-xs font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-[transform,background-color,border-color,box-shadow,color] duration-100 outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive active:not-aria-[haspopup]:translate-y-px motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:border-primary/80 hover:bg-primary/90",
        // The page's one focal control: a hard offset that steps aside on hover.
        focal:
          "block-shadow border-foreground bg-primary text-primary-foreground hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none active:translate-x-1 active:translate-y-1 motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0",
        outline:
          "border-border bg-transparent hover:border-rule-strong hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:border-rule-strong hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        ghost:
          "border-transparent hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        destructive:
          "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive",
        link: "border-transparent text-primary normal-case tracking-normal underline underline-offset-4 hover:underline",
        search:
          "border-border bg-input/30 px-3 text-muted-foreground normal-case tracking-normal hover:bg-secondary hover:text-foreground",
      },
      size: {
        default:
          "h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        lg: "h-11 gap-1.5 px-7 has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
        search: "h-10 w-64 justify-start gap-2.5 px-3 text-sm",
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
