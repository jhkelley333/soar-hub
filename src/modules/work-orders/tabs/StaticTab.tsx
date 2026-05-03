import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import type { StaticContent } from "./staticContent";

export function StaticTab({ content }: { content: StaticContent }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={content.title} description={content.subtitle} />
        <CardBody>
          <p className="text-sm leading-6 text-zinc-700">{content.summary}</p>
        </CardBody>
      </Card>

      {content.sections.map((section) => (
        <Card key={section.heading}>
          <CardHeader title={section.heading} />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {section.items.map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-zinc-800">
                    {item.href ? (
                      <a
                        href={item.href}
                        className="font-medium text-accent hover:underline"
                        target={item.href.startsWith("http") ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
