/** Client-safe auth option labels (no Node crypto / server secrets). */

export const HEAR_ABOUT_OPTIONS = [
  { value: "social_media", label: "Social media" },
  { value: "friends_family", label: "Friends and family" },
  { value: "other", label: "Other" },
] as const;

export type HearAbout = (typeof HEAR_ABOUT_OPTIONS)[number]["value"];
