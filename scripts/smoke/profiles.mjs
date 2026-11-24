/** Stable functional names; old phase flags remain supported for existing docs. */
export const profiles = [
  { id: 'core', file: 'core.cjs', report: 'review-core', legacy: [] },
  {
    id: 'inspiration',
    file: 'inspiration.cjs',
    report: 'review-inspiration',
    legacy: ['--ideas'],
  },
  {
    id: 'delivery',
    file: 'delivery.cjs',
    report: 'review-delivery',
    legacy: ['--stage3'],
  },
  {
    id: 'editor',
    file: 'editor.cjs',
    report: 'review-editor',
    legacy: ['--patch131'],
  },
  {
    id: 'organization',
    file: 'organization.cjs',
    report: 'review-organization',
    legacy: ['--boxes'],
  },
  {
    id: 'professional',
    file: 'professional.cjs',
    report: 'review-professional',
    legacy: ['--stage4a'],
  },
  {
    id: 'interface',
    file: 'interface.cjs',
    report: 'review-interface',
    legacy: [],
  },
];

export function selectProfile(args) {
  const requested = args
    .find((arg) => arg.startsWith('--scenario='))
    ?.slice('--scenario='.length);
  const profile = requested
    ? profiles.find((item) => item.id === requested)
    : profiles.find((item) =>
        item.legacy.some((flag) => args.includes(flag)),
      ) || profiles[0];
  if (!profile) throw new Error(`Unknown smoke scenario: ${requested}`);
  return profile;
}
