export const CONFIG = {
  timezone: "Asia/Kolkata",
  cron: "0 8 * * *",

  // Can also be set with TARGET_NUMBER in Railway/local env.
  targetNumber: "91XXXXXXXXXX",

  // Optional. If set, manual runs require ?token=... or x-run-token header.
  manualRunToken: "",

  openaiModel: "gpt-4.1",
  maxCompanies: 12
};
