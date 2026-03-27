import {
  HeadContent,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { AppProviders } from "@/components/app-providers"
import { AppSidebar, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { env } from "~/env"

import appCss from "../styles.css?url"

void env.VITE_CONVEX_URL

const themeInitScript = `
  (() => {
    try {
      const themeKey = "shard-theme"
      const storedTheme = window.localStorage.getItem(themeKey)
      const theme =
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"

      document.documentElement.classList.toggle("dark", theme === "dark")
      document.documentElement.style.colorScheme = theme
    } catch {}
  })();
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Shard",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/jpeg",
        href: "/shard-profile.jpeg",
      },
      {
        rel: "apple-touch-icon",
        href: "/shard-profile.jpeg",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <AppProviders>
            <SidebarProvider defaultOpen>
              <AppSidebar />
              <SidebarInset className="min-h-svh">
                <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 backdrop-blur">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
                    <div className="flex items-center gap-3">
                      <SidebarTrigger />
                      <img
                        src="/shard-profile.jpeg"
                        alt="Shard"
                        className="size-9 rounded-xl object-cover shadow-sm"
                      />
                      <div>
                        <div className="text-[0.7rem] font-medium tracking-[0.28em] text-muted-foreground uppercase">
                          Shard
                        </div>
                        <p className="text-sm text-foreground">
                          Autonomous QA runs and review workflows
                        </p>
                      </div>
                    </div>
                    <ThemeToggle />
                  </div>
                </header>
                <div className="flex-1 px-4 py-4 md:px-6 md:py-6">
                  {children}
                </div>
              </SidebarInset>
            </SidebarProvider>
            <TanStackDevtools
              config={{
                position: "bottom-right",
              }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
            <Scripts />
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  )
}
