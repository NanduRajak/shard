"use client"

import { IconMoon, IconSun } from "@tabler/icons-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const nextTheme = theme === "dark" ? "light" : "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Theme"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="size-9 rounded-xl"
      onClick={() => {
        setTheme(nextTheme)
      }}
    >
      {theme === "dark" ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </Button>
  )
}
