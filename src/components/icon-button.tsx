import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  label: string;
  icon: LucideIcon;
  iconClassName?: string;
};

export function IconButton({ label, icon: Icon, iconClassName, title, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger data-slot="button" render={
        <Button {...props} data-slot="button" size="icon-sm" aria-label={label} title={title}>
          <Icon aria-hidden="true" className={iconClassName} />
        </Button>
      } />
      <TooltipContent>{title ?? label}</TooltipContent>
    </Tooltip>
  );
}
