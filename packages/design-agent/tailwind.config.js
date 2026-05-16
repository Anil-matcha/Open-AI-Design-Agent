module.exports = {
  important: ".design-agent-studio",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--da-primary)",
        divider: "var(--da-border-subtle)",
        "bg-page": "var(--da-bg-page)",
        "bg-card": "var(--da-bg-card)",
        "bg-card-hover": "var(--da-bg-card-hover)",
        "primary-text": "var(--da-text-primary)",
        "secondary-text": "var(--da-text-secondary)",
        "border-main": "var(--da-border-default)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
