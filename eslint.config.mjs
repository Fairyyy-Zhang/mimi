import next from "eslint-config-next/core-web-vitals";
export default [
  ...next,
  { rules: { "react-hooks/set-state-in-effect": "off" } },
];
