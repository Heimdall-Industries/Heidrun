require("dotenv").config();

module.exports = {
  atlasTokenMint: "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx",
  usdcTokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  traderOwnerId: "NPCxfjPxh6pvRJbGbWZjxfkqWfGBvKkqPbtiJar3mom",
  traderProgramId: "traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg",
  millisecondsInDay: 86100000,
  decimals: 100000000,
  donationsWallet: "DEkjnxbkD9UjjNTgSn3Nx47RnRWRUCfLKNjqLjjWytHS",
  donationPercentage: 2,
  donationOptOut: process.env.DONATION_OPT_OUT === "true",
};
