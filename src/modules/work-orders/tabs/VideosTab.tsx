import { useQuery } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { listVideos } from "../api";

export function VideosTab() {
  const query = useQuery({
    queryKey: ["work-orders", "videos"],
    queryFn: listVideos,
  });

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load videos"
        description={(query.error as Error)?.message ?? "Try again in a moment."}
      />
    );
  }

  const files = query.data ?? [];
  if (files.length === 0) {
    return (
      <EmptyState
        title="No training videos yet"
        description="Videos pulled from the operations Google Drive folder."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <a
          key={file.id}
          href={file.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="group"
        >
          <Card className="overflow-hidden transition group-hover:ring-2 group-hover:ring-frost">
            {file.thumbnailLink ? (
              <img
                src={file.thumbnailLink}
                alt={file.name}
                className="h-32 w-full object-cover"
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Video
              </div>
            )}
            <CardBody>
              <div className="text-sm font-semibold tracking-tight text-midnight line-clamp-2">
                {file.name}
              </div>
              {file.createdTime && (
                <div className="mt-1 text-xs text-zinc-500">
                  Added {new Date(file.createdTime).toLocaleDateString()}
                </div>
              )}
            </CardBody>
          </Card>
        </a>
      ))}
    </div>
  );
}
