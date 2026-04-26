export const CONFIG = {
  timezone: "Asia/Kolkata",
  cron: "0 8 * * *",

  // Can also be set with TARGET_NUMBER in Railway/local env.
  targetNumber: "91XXXXXXXXXX",

  // Optional. If set, /qr, /run, /logout, and /clear-locks require ?token=...
  manualRunToken: "",

  openaiModel: "gpt-4.1",
  minCompanies: 10,
  maxCompanies: 12
};
