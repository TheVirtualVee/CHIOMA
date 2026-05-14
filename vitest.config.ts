export default {
  test: {
    environment: "node" as const,
    include: ["**/*.test.ts"],
    passWithNoTests: false,
  },
};
