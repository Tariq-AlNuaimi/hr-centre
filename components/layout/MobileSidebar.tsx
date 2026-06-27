"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/Wordmark";
import { SidebarNav } from "./SidebarNav";

export function MobileSidebar({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = React.useState(false);
  const t = useTranslations("shell");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t("openMenu")}
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetTitle className="sr-only">{t("openMenu")}</SheetTitle>
        <div className="px-2 pb-2 pt-1">
          <Wordmark />
        </div>
        <div className="overflow-y-auto">
          <SidebarNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
