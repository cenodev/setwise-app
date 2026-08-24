/**
 * Setwise Theme
 *
 * A graphite-neutral system with icy blue reserved for Setwise branding,
 * interaction, focus, and selection. Status colors are independent semantic
 * families and must not be used as brand accents.
 *
 * Dark-only for now (single values apply to both modes); the app pins
 * mode="dark" in AppProviders.
 *
 * Build the committed CSS artifact with:
 *   npx astryx theme build src/theme/setwiseTheme.ts -o src/theme/setwise.css
 */

import { defineTheme } from "@astryxdesign/core/theme";

const palette = {
  graphite: {
    950: "#0c0d0f",
    900: "#141619",
    850: "#181a1e",
    800: "#202328",
  },
  neutral: {
    primary: "#f2f3f5",
    secondary: "#a7abb2",
    muted: "#686d75",
    subtle: "#ffffff14",
    emphasized: "#3a3e45",
  },
  setwiseBlue: {
    primary: "#7ddfff",
    light: "#b7efff",
    interactive: "#43b9dc",
    muted: "#7ddfff1a",
  },
  positive: {
    primary: "#62d49b",
    light: "#93e4ba",
    muted: "#62d49b1f",
  },
  negative: {
    primary: "#f06c75",
    light: "#ff9ca3",
    muted: "#f06c751f",
  },
  warning: {
    primary: "#e6b85c",
    light: "#f0ca7a",
    muted: "#e6b85c1f",
  },
  information: {
    primary: "#91a7ff",
    light: "#b5c2ff",
    muted: "#91a7ff1f",
  },
} as const;

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
    // Core semantic. Blue is for interaction, selection, and brand emphasis;
    // neutral surfaces never inherit it.
    // =========================================================================
    "--color-accent": palette.setwiseBlue.primary,
    "--color-accent-muted": palette.setwiseBlue.muted,
    "--color-neutral": "#ffffff0d",
    "--color-background-surface": palette.graphite[900],
    "--color-background-body": palette.graphite[950],
    "--color-overlay": "#0c0d0fcc",
    "--color-overlay-hover": "#ffffff0a",
    "--color-overlay-pressed": "#ffffff12",
    "--color-background-muted": palette.graphite[850],

    // Text
    "--color-text-primary": palette.neutral.primary,
    "--color-text-secondary": palette.neutral.secondary,
    "--color-text-disabled": palette.neutral.muted,
    "--color-text-accent": palette.setwiseBlue.primary,
    "--color-on-dark": palette.neutral.primary,
    "--color-on-light": palette.graphite[950],
    "--color-on-accent": palette.graphite[950],
    "--color-on-success": "#08150f",
    "--color-on-error": "#1b090b",
    "--color-on-warning": "#181205",

    // Icon
    "--color-icon-accent": palette.setwiseBlue.primary,
    "--color-icon-primary": palette.neutral.primary,
    "--color-icon-secondary": palette.neutral.secondary,
    "--color-icon-disabled": palette.neutral.muted,

    // Graphite elevation: 950 body → 900 surface → 850 card → 800 popover.
    "--color-background-card": palette.graphite[850],
    "--color-background-popover": palette.graphite[800],
    "--color-background-inverted": palette.neutral.primary,

    // Functional colors remain semantically separate from Setwise blue.
    "--color-success": palette.positive.primary,
    "--color-success-muted": palette.positive.muted,
    "--color-error": palette.negative.primary,
    "--color-error-muted": palette.negative.muted,
    "--color-warning": palette.warning.primary,
    "--color-warning-muted": palette.warning.muted,

    // Neutral structure; focus and selected states use --color-accent instead.
    "--color-border": palette.neutral.subtle,
    "--color-border-emphasized": palette.neutral.emphasized,

    // Neutral effects; no ambient brand-color glow.
    "--color-skeleton": "#272a30",
    "--color-shadow": "#00000070",
    "--color-tint-hover": palette.setwiseBlue.interactive,

    // =========================================================================
    // Categorical families
    // =========================================================================
    // The blue categorical family is information, not the brand accent.
    "--color-background-blue": palette.information.muted,
    "--color-border-blue": palette.information.primary,
    "--color-icon-blue": palette.information.light,
    "--color-text-blue": palette.information.light,

    "--color-background-green": palette.positive.muted,
    "--color-border-green": palette.positive.primary,
    "--color-icon-green": palette.positive.light,
    "--color-text-green": palette.positive.light,

    "--color-background-yellow": palette.warning.muted,
    "--color-border-yellow": palette.warning.primary,
    "--color-icon-yellow": palette.warning.light,
    "--color-text-yellow": palette.warning.light,

    "--color-background-red": palette.negative.muted,
    "--color-border-red": palette.negative.primary,
    "--color-icon-red": palette.negative.light,
    "--color-text-red": palette.negative.light,

    "--color-background-gray": "#ffffff0a",
    "--color-border-gray": palette.neutral.emphasized,
    "--color-icon-gray": palette.neutral.secondary,
    "--color-text-gray": palette.neutral.secondary,

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
    // Shadows — depth without colored glow
    // =========================================================================
    "--shadow-low": "0 2px 4px #00000040, 0 4px 8px #00000052",
    "--shadow-med": "0 2px 4px #00000040, 0 4px 12px #00000052",
    "--shadow-high": "0 4px 6px #00000052, 0 12px 24px #00000070",
    "--shadow-inset-hover": "inset 0px 0px 0px 2px #7ddfff4d",
    "--shadow-inset-selected": "inset 0px 0px 0px 2px #7ddfff80",
    "--shadow-inset-success": "inset 0px 0px 0px 2px #62d49b66",
    "--shadow-inset-warning": "inset 0px 0px 0px 2px #e6b85c66",
    "--shadow-inset-error": "inset 0px 0px 0px 2px #f06c7566",
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
