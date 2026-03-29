import {
  HeadContent,
  Scripts,
  Link,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  IconStack2,
  IconHome2,
  IconLayoutDashboard,
  IconMessage2Bolt,
  IconKey,
  IconHistory,
} from "@tabler/icons-react";
import { AppProviders } from "@/components/app-providers";
import { HomeRunGuide } from "@/components/home-run-guide";
import { Toaster } from "@/components/ui/sonner";
import {
  AppSidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { env } from "~/env";

import appCss from "../styles.css?url";

void env.VITE_CONVEX_URL;

const themeInitScript = `
  (() => {
    try {
      document.documentElement.classList.add("dark")
      document.documentElement.style.colorScheme = "dark"
    } catch {}
  })();
`;

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
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const getPageHeader = (path: string) => {
    if (path === "/") return { title: "Home", icon: IconHome2 };
    if (path.startsWith("/review-bot"))
      return { title: "Review Bot", icon: IconMessage2Bolt };
    if (path.startsWith("/dashboard"))
      return { title: "Dashboard", icon: IconLayoutDashboard };
    if (path.startsWith("/background-agents"))
      return { title: "Background Agents", icon: IconStack2 };
    if (path.startsWith("/credentials"))
      return { title: "Credentials", icon: IconKey };
    if (path.startsWith("/history"))
      return { title: "History", icon: IconHistory };

    const segment = path.split("/").filter(Boolean)[0];
    const title = segment
      ? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")
      : "Home";
    return { title, icon: IconHome2 };
  };

  const { title, icon: PageIcon } = getPageHeader(pathname);

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
                      <SidebarTrigger className="md:hidden" />
                      <div className="flex items-center gap-2.5">
                        <PageIcon className="size-5 shrink-0 text-sidebar-accent-foreground/80 md:size-6" />
                        <h1 className="text-base font-semibold text-foreground md:text-lg">
                          {title}
                        </h1>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {pathname === "/" ? <HomeRunGuide /> : null}
                    </div>
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
            <Toaster richColors position="top-right" />
            <Scripts />
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}

function RootNotFound() {
  return (
    <div className="flex min-h-[calc(100svh-12rem)] items-center justify-center">
      <div className="max-w-md rounded-[1.75rem] border border-border/70 bg-card/80 p-8 text-center shadow-[0_24px_70px_-50px_rgba(15,23,42,0.55)]">
        <p className="text-xs font-medium tracking-[0.26em] text-muted-foreground uppercase">
          Not found
        </p>
        <h1 className="mt-3 text-2xl font-medium text-foreground">
          This route does not exist.
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Return to the command center or open the run history to inspect
          archived QA reports.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button render={<Link to="/" />} className="rounded-2xl">
            Go home
          </Button>
          <Button
            render={<Link to="/history" />}
            variant="outline"
            className="rounded-2xl"
          >
            Open history
          </Button>
        </div>
      </div>
    </div>
  );
}
