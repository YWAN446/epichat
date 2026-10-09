import { Brand } from "@/components/Brand";

/** An unknown, malformed, or revoked share link. */
export default function SharedUnavailable() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-4 text-center">
      <Brand />
      <p className="text-ink-soft">This shared conversation is no longer available.</p>
    </div>
  );
}
