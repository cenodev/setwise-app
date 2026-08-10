/**
 * Setwise Theme
 *
 * Matches the Setwise landing page (https://setwisemarkets.github.io/setwise-landing/):
 * near-black blue-tinted surfaces, ice-blue ink, and the signature ice-cyan
 * accent (#67dcff) with subtle cyan glows. The landing page only defines a
 * positive green beyond the blue family, so this theme adds two accents that
 * harmonize with the ice palette: a warm amber for warning and a soft coral
 * for error.
 *
 * Dark-only for now (single values apply to both modes); the app pins
 * mode="dark" in AppProviders.
 *
 * Build the committed CSS artifact with:
 *   npx astryx theme build src/theme/setwiseTheme.ts -o src/theme/setwise.css
 */

import { defineTheme } from "@astryxdesign/core/theme";

export const setwiseTheme = defineTheme({
  name: "setwise",

  typography: {
    scale: { base: 16, ratio: 1.25 },
    body: {
      family: "Arial",
      fallbacks: "Helvetica, sans-serif",
    },
    heading: {
      family: "Arial",
      fallbacks: "Helvetica, sans-serif",
    },
    code: {
      family: '"Courier New"',
      fallbacks: "Courier, monospace",
    },
  },

  // Sharp corners, matching the landing page's brutalist grid.
  radius: { base: 4, multiplier: 0 },

  // Landing transitions sit at .2s/.3s.
  motion: { fast: 120, medium: 200, slow: 300, ratio: 0.8 },

  tokens: {
    // =========================================================================
    // Core semantic — landing page palette
    // =========================================================================
    "--color-accent": "#67dcff",
    "--color-accent-muted": "#67dcff1f",
    "--color-neutral": "#addeef14",
    "--color-background-surface": "#10171b",
    "--color-background-body": "#0a0f12",
    "--color-overlay": "#0a0f12cc",
    "--color-overlay-hover": "#67dcff0d",
    "--color-overlay-pressed": "#67dcff1a",
    "--color-background-muted": "#151e23",

    // Text
    "--color-text-primary": "#eaf7fb",
    "--color-text-secondary": "#8da3ad",
    "--color-text-disabled": "#52636b",
    "--color-text-accent": "#67dcff",
    "--color-on-dark": "#eaf7fb",
    "--color-on-light": "#071014",
    "--color-on-accent": "#071014",
    "--color-on-success": "#06231a",
    "--color-on-error": "#3d0a14",
    "--color-on-warning": "#2e1f00",

    // Icon
    "--color-icon-accent": "#67dcff",
    "--color-icon-primary": "#eaf7fb",
    "--color-icon-secondary": "#8da3ad",
    "--color-icon-disabled": "#52636b",

    // Surface variants — landing tile / chip / footer tones
    "--color-background-card": "#131e23",
    "--color-background-popover": "#17242a",
    "--color-background-inverted": "#eaf7fb",

    // Status — success is the landing's positive green; warning/error are the
    // added accents (warm amber, soft coral) tuned to sit beside the ice cyan.
    "--color-success": "#7fe1bf",
    "--color-success-muted": "#7fe1bf",
    "--color-error": "#ff8fa3",
    "--color-error-muted": "#ff8fa3",
    "--color-warning": "#ffd166",
    "--color-warning-muted": "#ffd166",

    // Hairline borders carry an ice tint; emphasis is the landing's tile hover
    "--color-border": "#addeef26",
    "--color-border-emphasized": "#67dcff61",

    // Effects — deep card shadow, hover is the landing's blue-bright
    "--color-skeleton": "#1a262c",
    "--color-shadow": "#00000070",
    "--color-tint-hover": "#a5ecff",

    // =========================================================================
    // Categorical families
    // =========================================================================
    "--color-background-blue": "#67dcff",
    "--color-border-blue": "#a5ecff",
    "--color-icon-blue": "#06303e",
    "--color-text-blue": "#06303e",

    "--color-background-green": "#7fe1bf",
    "--color-border-green": "#a4ebd4",
    "--color-icon-green": "#06231a",
    "--color-text-green": "#06231a",

    "--color-background-yellow": "#ffd166",
    "--color-border-yellow": "#ffe09a",
    "--color-icon-yellow": "#2e1f00",
    "--color-text-yellow": "#2e1f00",

    "--color-background-red": "#ff8fa3",
    "--color-border-red": "#ffb3c1",
    "--color-icon-red": "#3d0a14",
    "--color-text-red": "#3d0a14",

    // Slate gray from the landing's allocation scale
    "--color-background-gray": "#40515b",
    "--color-border-gray": "#708895",
    "--color-icon-gray": "#eaf7fb",
    "--color-text-gray": "#eaf7fb",

    // =========================================================================
    // Radius — sharp / brutalist
    // =========================================================================
    "--radius-none": "0px",
    "--radius-inner": "0px",
    "--radius-element": "0px",
    "--radius-container": "0px",
    "--radius-page": "0px",
    "--radius-full": "0px",

    // =========================================================================
    // Shadows — deep, with the landing's cyan glow on the high level
    // =========================================================================
    "--shadow-low": "0 2px 4px #00000040, 0 4px 8px #00000052",
    "--shadow-med": "0 2px 4px #00000040, 0 4px 12px #00000052",
    "--shadow-high": "0 4px 6px #00000052, 0 12px 24px #0000005e, 0 0 35px #67dcff1f",
    "--shadow-inset-hover": "inset 0px 0px 0px 2px #67dcff4d",
    "--shadow-inset-selected": "inset 0px 0px 0px 2px #67dcff80",
    "--shadow-inset-success": "inset 0px 0px 0px 2px #06231a80",
    "--shadow-inset-warning": "inset 0px 0px 0px 2px #2e1f0080",
    "--shadow-inset-error": "inset 0px 0px 0px 2px #3d0a1480",
  },

  components: {
    button: {
      base: {
        borderRadius: "0px",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "var(--color-border)",
      },
      "variant:primary": {
        backgroundColor: "var(--color-accent)",
        color: "var(--color-on-accent)",
        borderColor: "transparent",
        ":hover": {
          backgroundColor: "var(--color-tint-hover)",
        },
      },
      "variant:secondary": {
        backgroundColor: "var(--color-accent-muted)",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "var(--color-accent)",
        color: "var(--color-text-accent)",
      },
      "variant:ghost": {
        borderColor: "transparent",
      },
      "variant:destructive": {
        backgroundColor: "var(--color-background-red)",
        color: "var(--color-text-red)",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "var(--color-text-red)",
      },
    },

    badge: {
      base: {
        borderRadius: "9999px",
        borderWidth: "1.5px",
        borderStyle: "solid",
        borderColor: "color-mix(in srgb, currentColor 30%, transparent)",
      },
      "variant:info": {
        backgroundColor: "var(--color-background-blue)",
        color: "var(--color-text-blue)",
      },
      "variant:neutral": {
        backgroundColor: "var(--color-background-gray)",
        color: "var(--color-text-gray)",
      },
      "variant:success": {
        backgroundColor: "var(--color-background-green)",
        color: "var(--color-text-green)",
      },
      "variant:warning": {
        backgroundColor: "var(--color-background-yellow)",
        color: "var(--color-text-yellow)",
      },
      "variant:error": {
        backgroundColor: "var(--color-background-red)",
        color: "var(--color-text-red)",
      },
    },

    banner: {
      base: {
        borderRadius: "0px",
      },
      "status:info": {
        backgroundColor: "var(--color-background-blue)",
        "--color-text-primary": "var(--color-text-blue)",
        "--color-text-secondary": "var(--color-text-blue)",
        "--color-accent": "var(--color-text-blue)",
      },
      "status:success": {
        backgroundColor: "var(--color-background-green)",
        "--color-text-primary": "var(--color-text-green)",
        "--color-text-secondary": "var(--color-text-green)",
        "--color-success": "var(--color-text-green)",
      },
      "status:warning": {
        backgroundColor: "var(--color-background-yellow)",
        "--color-text-primary": "var(--color-text-yellow)",
        "--color-text-secondary": "var(--color-text-yellow)",
        "--color-warning": "var(--color-text-yellow)",
      },
      "status:error": {
        backgroundColor: "var(--color-background-red)",
        "--color-text-primary": "var(--color-text-red)",
        "--color-text-secondary": "var(--color-text-red)",
        "--color-error": "var(--color-text-red)",
      },
    },

    field: {
      base: {
        borderRadius: "0px",
      },
    },

    card: {
      base: {
        borderRadius: "0px",
        padding: "var(--spacing-3)",
      },
    },

    section: {
      base: {
        padding: "var(--spacing-3)",
      },
    },
  },
});
