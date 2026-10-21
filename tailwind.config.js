/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        /* Tokens de marque GBS (définis dans src/index.css) — RVB +
           <alpha-value> pour que bg-ambre/30, ring-danger/40… fonctionnent */
        ambre: {
          DEFAULT: "rgb(var(--ambre) / <alpha-value>)",
          actif: "rgb(var(--ambre-actif) / <alpha-value>)",
        },
        "sur-ambre": "rgb(var(--sur-ambre) / <alpha-value>)",
        encre: "rgb(var(--encre) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        controle: "rgb(var(--controle) / <alpha-value>)",
        sable: "rgb(var(--sable) / <alpha-value>)",
        creme: "rgb(var(--creme) / <alpha-value>)",
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          clair: "rgb(var(--danger-clair) / <alpha-value>)",
        },
        succes: {
          DEFAULT: "rgb(var(--succes) / <alpha-value>)",
          clair: "rgb(var(--succes-clair) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
          clair: "rgb(var(--info-clair) / <alpha-value>)",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      fontFamily: {
        /* Page d'accueil (maquette) : titres Bricolage, corps Instrument.
           Le reste de l'app reste sur Inter (body). */
        titre: ["'Bricolage Grotesque'", "'Inter'", "sans-serif"],
        corps: ["'Instrument Sans'", "'Inter'", "sans-serif"],
        /* Chiffres (maquette Pilotage, --fn) : JetBrains Mono tabulaire.
           La classe .font-mono de src/index.css précise la famille. */
        mono: ["'JetBrains Mono'", "ui-monospace", "Menlo", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}