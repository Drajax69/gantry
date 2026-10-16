import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsLink() {
  return (
    <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/settings" />} aria-label="Settings">
      <SettingsIcon />
    </Button>
  );
}
