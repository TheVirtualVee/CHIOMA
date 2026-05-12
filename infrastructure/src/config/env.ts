export type ChiomaConfig = {
  nodeEnv: string;
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChiomaConfig {
  return {
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
