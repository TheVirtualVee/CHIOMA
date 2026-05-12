/** contract: TraceSpan */
export type TraceSpan = {
  name: string;
  end: () => void;
};

export function startSpan(name: string): TraceSpan {
  return {
    name,
    end() {
      // side-effect: finalize span
    },
  };
}
