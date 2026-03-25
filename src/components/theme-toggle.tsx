"use client"

import { IconMoon, IconSun } from "@tabler/icons-react"

import { useTheme } from "@/components/theme-provider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <ToggleGroup
      aria-label="Theme"
      value={[theme]}
      variant="outline"
      size="sm"
      spacing={1}
      onValueChange={(value) => {
        const nextTheme = value.at(-1)

        if (nextTheme === "light" || nextTheme === "dark") {
          setTheme(nextTheme)
        }
      }}
    >
      <ToggleGroupItem value="light" aria-label="Light mode">
        <IconSun data-icon="inline-start" />
        Light
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark mode">
        <IconMoon data-icon="inline-start" />
        Dark
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
