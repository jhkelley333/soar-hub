// Shared hook: the DO + GM checklist templates, assembled from the DB (admin-
// editable) with a fall back to the built-in defaults before the migration is
// applied. Also exposes whether the caller can manage them.
import { useQuery } from "@tanstack/react-query";
import { fetchTemplateItems } from "./api";
import { buildTemplates, CHANGEOVER_TEMPLATES } from "./templates";

export function useChangeoverTemplates() {
  const q = useQuery({ queryKey: ["changeover-templates"], queryFn: fetchTemplateItems });
  const templates = q.data && q.data.items.length ? buildTemplates(q.data.items) : CHANGEOVER_TEMPLATES;
  return { templates, canManage: q.data?.can_manage ?? false, items: q.data?.items ?? [], isLoading: q.isLoading };
}
