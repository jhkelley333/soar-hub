// Placeholder static info for the Solugenix / Coke / RF Tech tabs.
// Real values land in a later phase — see PHASE_2A_PLAN.md (locked default
// "Keep placeholder seed data for now").

export interface StaticItem {
  label: string;
  value: string;
  href?: string;
}

export interface StaticSection {
  heading: string;
  items: StaticItem[];
}

export interface StaticContent {
  title: string;
  subtitle: string;
  summary: string;
  sections: StaticSection[];
}

export const SOLUGENIX: StaticContent = {
  title: "Solugenix",
  subtitle: "IT helpdesk and POS support",
  summary:
    "Solugenix is the first line of support for POS, network, and back-office IT issues. Open a ticket with them before escalating to internal IT.",
  sections: [
    {
      heading: "Contact",
      items: [
        { label: "Helpdesk phone", value: "1-800-555-0100", href: "tel:18005550100" },
        { label: "Email", value: "support@solugenix.example", href: "mailto:support@solugenix.example" },
        { label: "Hours", value: "24 / 7" },
      ],
    },
    {
      heading: "When to call",
      items: [
        { label: "POS down", value: "Call immediately." },
        { label: "Card terminal offline", value: "Call after a reboot." },
        { label: "Printer / kitchen display", value: "Open a ticket via portal." },
      ],
    },
  ],
};

export const COKE: StaticContent = {
  title: "Coca-Cola",
  subtitle: "Beverage equipment and syrup",
  summary:
    "Coca-Cola handles fountain, bag-in-box, and ice machine service. Submit through their portal or call dispatch for same-day issues.",
  sections: [
    {
      heading: "Contact",
      items: [
        { label: "Dispatch phone", value: "1-800-555-0265", href: "tel:18005550265" },
        { label: "Service portal", value: "service.coke.example", href: "https://service.coke.example" },
        { label: "Account manager", value: "TBD" },
      ],
    },
    {
      heading: "Common requests",
      items: [
        { label: "Fountain not pouring", value: "Same-day dispatch." },
        { label: "Syrup BIB swap", value: "Self-serve, log via portal." },
        { label: "Ice machine cleaning", value: "Quarterly preventive service." },
      ],
    },
  ],
};

export const RF_TECH: StaticContent = {
  title: "RF Tech",
  subtitle: "Refrigeration and HVAC",
  summary:
    "RF Tech covers walk-ins, prep tables, freezers, and HVAC. Use the work-orders tab to dispatch — RF Tech is one of the listed vendors.",
  sections: [
    {
      heading: "Contact",
      items: [
        { label: "Dispatch phone", value: "1-800-555-0317", href: "tel:18005550317" },
        { label: "After-hours", value: "Same number, press 9 for emergency." },
        { label: "Email", value: "service@rftech.example", href: "mailto:service@rftech.example" },
      ],
    },
    {
      heading: "Service tiers",
      items: [
        { label: "Emergency", value: "On-site within 4 hours (down equipment)." },
        { label: "Same-day", value: "Performance issues, no outage." },
        { label: "Scheduled", value: "Preventive maintenance, calibration." },
      ],
    },
  ],
};
