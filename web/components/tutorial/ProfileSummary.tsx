import { countryLabel, diseaseLabel } from "@/lib/client/profile";
import { EXPERIENCE_LABELS, GOAL_LABELS, ROLE_LABELS } from "@/lib/enums";
import type { DiseaseOption } from "@/lib/profile/options";
import type { ProfileFields } from "@/lib/profile/schema";

const NONE = "Not set";

/** The practice run's Profile tab: the participant's own answers as plain text. Nothing here can be pressed or saved. */
export function ProfileSummary({ profile, diseases }: { profile: ProfileFields; diseases: DiseaseOption[] }) {
  const rows: [string, string][] = [
    ["Role", profile.role ? ROLE_LABELS[profile.role] : NONE],
    ["Modelling experience", profile.experience ? EXPERIENCE_LABELS[profile.experience] : NONE],
    ["Goals", profile.goals.length > 0 ? profile.goals.map((goal) => GOAL_LABELS[goal]).join(", ") : NONE],
    ["Disease of interest", diseaseLabel(profile.diseaseInterest, diseases) || NONE],
    ["Country of interest", countryLabel(profile.countryInterest) || NONE],
  ];
  return (
    <div className="px-4 py-3 text-sm">
      <p className="mb-3 text-xs text-ink-faint">You can edit your profile in your own conversations.</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
