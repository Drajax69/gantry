import { Suspense } from "react";
import { Loader2Icon } from "lucide-react";
import { Review } from "@/components/review/review";

interface RouteProps {
  params: Promise<{ slug: string[] }>;
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
      <ReviewRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReviewRoute({ params, searchParams }: RouteProps) {
  const { slug } = await params;
  const { file } = await searchParams;
  const id = slug.map(decodeURIComponent).join("/");
  return <Review key={id} id={id} initialFile={typeof file === "string" ? file : null} />;
}
