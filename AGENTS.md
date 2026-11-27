# Agent rulebook

Read this file before changing this project. Anyone who pulls this code and writes prompts should follow this file.

## Mobile and desktop

Every code change must leave the site looking good on a desktop webpage and on a phone.

A phone visitor must see a clean landing page. The phone layout may vary slightly from the desktop layout when that keeps the page clean.

## Company and fund display names

Use the shortest recognizable name for each company in search results, stock pages, watchlists, and any new UI. Use the shared `displayCompanyName` helper in `lib/market.ts` so the same ticker has a consistent label.

Remove legal suffixes such as Inc., Corp., and Ltd. and filing qualifiers such as `/CAN/` and `/DE/` from display names. Preserve brand capitalization and meaningful fund details such as CAD hedging. Keep the original source names in Supabase and support useful search aliases.

Display GOOG and GOOGL as **Google**, with **Alphabet** as a search alias. Display CM as **Canadian Imperial Bank Of Commerce**.

## Changing this file

Do not add rules to this file unless the project owners explicitly approve the addition, or they write the rule themselves.
