import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackToTickets({ projectId, ticketId }: { projectId?: string; ticketId?: string }) {
  const href = projectId ? `/?${new URLSearchParams({ workspace: projectId, ...(ticketId ? { ticket: ticketId } : {}) })}` : "/";
  return <Button nativeButton={false} render={<Link href={href} />} variant="ghost" size="sm"><ArrowLeftIcon />Back</Button>;
}
