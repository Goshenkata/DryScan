export const indexConfig = {
  blockMinLines: 5,
  thresholds: {
    class: 0.82,
    function: 0.85,
    block: 0.9,
  },
  weights: {
    class: { self: 1 },
    function: { self: 0.8, parentClass: 0.2 },
    block: { self: 0.7, parentFunction: 0.2, parentClass: 0.1 },
  },
};
