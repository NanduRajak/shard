import {
  IconCheck,
  IconForms,
  IconX,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"

type FormField = {
  name: string
  type: string
  label?: string
  required: boolean
  placeholder?: string
  options?: string[]
}

type Form = {
  action?: string
  method?: string
  fields: FormField[]
}

type CrawledFormPage = {
  url: string
  title?: string
  forms?: Form[]
}

function getUrlPath(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

export function FormInventoryView({ formPages }: { formPages: CrawledFormPage[] }) {
  const totalForms = formPages.reduce(
    (acc, page) => acc + (page.forms?.length ?? 0),
    0,
  )

  if (totalForms === 0) return null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <IconForms className="size-4 text-orange-400" />
          Form Inventory
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {totalForms} form{totalForms !== 1 ? "s" : ""} found across {formPages.length} page{formPages.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-3">
        {formPages.slice(0, 10).map((page) => (
          <div
            key={page.url}
            className="rounded-xl border border-border/70 bg-background/70 p-4"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground truncate" title={page.url}>
                {getUrlPath(page.url)}
              </p>
              {page.title && (
                <p className="text-xs text-muted-foreground truncate">{page.title}</p>
              )}
            </div>

            {page.forms?.map((form, formIdx) => (
              <div key={formIdx} className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  {form.method && form.action && (
                    <Badge variant="outline" className="text-xs uppercase font-mono">
                      {form.method} {form.action}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {form.fields.length} field{form.fields.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Label</th>
                        <th className="px-3 py-1.5 text-center font-medium text-muted-foreground w-16">Req</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.fields.map((field, fieldIdx) => (
                        <tr key={fieldIdx} className="border-b border-border/30 last:border-0">
                          <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[120px]">
                            {field.name}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{field.type}</td>
                          <td className="px-3 py-1.5 text-muted-foreground hidden sm:table-cell truncate max-w-[120px]">
                            {field.label ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {field.required ? (
                              <IconCheck className="size-3 text-emerald-400 mx-auto" />
                            ) : (
                              <IconX className="size-3 text-muted-foreground/50 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
        {formPages.length > 10 && (
          <p className="text-xs text-muted-foreground text-center">
            +{formPages.length - 10} more pages with forms
          </p>
        )}
      </div>
    </div>
  )
}
