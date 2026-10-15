/**
 * Chart colours. Categorical slots 1–3 of the validated reference palette, in
 * fixed order (never cycled): blue, orange, aqua. Checked on the white card
 * surface with the dataviz validator (CVD ΔE ≥ 9.2 adjacent, normal-vision
 * ≥ 27.6). Aqua is below 3:1 contrast on white, so every chart also ships a
 * table of its numbers. The admin UI is light-only, so there is no dark set.
 */
export const VIZ = {
  series: ["#2a78d6", "#eb6834", "#1baf7a"] as const,
  /** Unfilled track of a meter: a lighter step of the blue ramp. */
  track: "#cde2fb",
  surface: "#ffffff",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  axisText: "#5c5c5c",
  hover: "rgba(11, 11, 11, 0.04)",
} as const;
