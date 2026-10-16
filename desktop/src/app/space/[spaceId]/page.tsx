import { Suspense } from "react";
import { Loader2Icon } from "lucide-react";
import { Workspace } from "@/components/space/workspace";

interface RouteProps {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function Page({ params, searchParams }: RouteProps) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2Icon className="mr-2 size-4 animate-spin" /> Loading…
        </div>
      }
    >
      <SpaceRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SpaceRoute({ params, searchParams }: RouteProps) {
  const { spaceId } = await params;
  const { pr, file } = await searchParams;
  return (
    <Workspace
      key={spaceId}
      spaceId={decodeURIComponent(spaceId)}
      initialTarget={typeof pr === "string" ? pr : null}
      initialFile={typeof file === "string" ? file : null}
    />
  );
}
