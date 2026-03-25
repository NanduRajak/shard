import Steel from "steel-sdk";
import { chromium } from "playwright";
import { env } from "process";

// Initialize Steel client with API key
const client = new Steel({
  steelAPIKey: env.VITE_STEEL_API_KEY,
});

async function main() {
  // Create a session
  const session = await client.sessions.create();

  console.log(`View live session at: ${session.sessionViewerUrl}`);

  // Connect to the Steel session
  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${env.VITE_STEEL_API_KEY}&sessionId=${session.id}`,
  );

  // Create page at existing context to ensure session is recorded
  const currentContext = browser.contexts()[0];
  const page = await currentContext.pages()[0];

  console.log("Navigating to Hacker News...");
  await page.goto("https://news.ycombinator.com", {
    waitUntil: "networkidle",
  });

  // Extract the top 5 stories
  const stories = await page.evaluate(() => {
    const items: { title: string; link: string; points: string }[] = [];
    // Get all story items
    const storyRows = document.querySelectorAll("tr.athing");

    // Loop through first 5 stories
    for (let i = 0; i < 5; i++) {
      const row = storyRows[i];
      const titleElement = row.querySelector(".titleline > a");
      const subtext = row.nextElementSibling;
      const score = subtext?.querySelector(".score");

      items.push({
        title: titleElement?.textContent || "",
        link: titleElement?.getAttribute("href") || "",
        points: score?.textContent?.split(" ")[0] || "0",
      });
    }
    return items;
  });

  // Print the results
  console.log("\nTop 5 Hacker News Stories:");
  stories.forEach((story, index) => {
    console.log(`\n${index + 1}. ${story.title}`);
    console.log(`   Link: ${story.link}`);
    console.log(`   Points: ${story.points}`);
  });

  // Clean up resources
  await browser.close();
  await client.sessions.release(session.id);
}

// Run the script
main();
