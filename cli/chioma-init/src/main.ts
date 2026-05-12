import { platformEnvHints, runBootstrapReadiness } from "@chioma/infrastructure";

async function main(): Promise<void> {
  const { platform, readiness } = runBootstrapReadiness();
  const hints = platformEnvHints(platform);
  const report = {
    platform,
    missingRequired: readiness.missingRequired,
    missingOptional: readiness.missingOptional,
    hints,
    notes: readiness.notes,
  };
  // SIDE EFFECT: stdout for founder onboarding. Why necessary and unavoidable: CLI primary output channel.
  console.log(JSON.stringify(report, null, 2));
  if (readiness.missingRequired.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
