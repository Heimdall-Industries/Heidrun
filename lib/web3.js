const {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
} = require("@solana/web3.js");
const fs = require("fs");
const bs58 = require("bs58");
const web3 = require("@solana/web3.js");
const Write = require("./write");

class Web3 {
  constructor() {
    this.connection = new Connection(clusterApiUrl("mainnet-beta"));
    this.keypair = Keypair.fromSeed(
      bs58.decode(fs.readFileSync("./lib/.info.txt", "utf8")).slice(0, 32)
    );
    this.nftNames = JSON.parse(fs.readFileSync("./lib/nft_names.json", "utf8"));
    this.atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
    this.resourceAddresses = {
      ammo: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
      food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
      tool: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
      fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
    };
    this.scoreProgramId = new PublicKey(
      "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW"
    );
    this.tokenProgramId = new PublicKey(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );
    this.tokenAccountInfo = null;
    this.resourceAvailability = {};
  }

  getTokenInfo(tokenMint) {
    return this.tokenAccountInfo.value.find(
      (v) => v.account.data.parsed.info.mint === tokenMint
    );
  }

  getTokenPublicKey(tokenMint) {
    return this.getTokenInfo(tokenMint).pubkey;
  }

  getTokenAvailableSupply(tokenMint) {
    return this.getTokenInfo(tokenMint).account.data.parsed.info.tokenAmount
      .amount;
  }

  async updateAccountResources(resource, triggerUpdates = false) {
    return await this.connection
      .getTokenAccountsByOwner(this.keypair.publicKey, {
        mint: new web3.PublicKey(this.resourceAddresses[resource]),
      })
      .then(
        async (accounts) =>
          await this.connection
            .getTokenAccountBalance(accounts.value[0]?.pubkey)
            .then((results) => {
              const needsUpdate =
                this.resourceAvailability[resource] !== results.value.amount;

              if (needsUpdate) {
                this.resourceAvailability[resource] = results.value.amount;
              }

              return triggerUpdates && needsUpdate;
            })
      );
  }

  async refreshAccountInfo() {
    await this.connection
      .getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: this.tokenProgramId },
        "confirmed"
      )
      .then(
        async (results) => {
          this.tokenAccountInfo = results;
          return await this.updateAccountResources("food", true).then(
            (triggerUpdate) => {
              if(triggerUpdate) {
                  ["ammo", "tool", "fuel"].forEach((resource, index) =>
                      this.updateAccountResources(resource).then(() => {
                          if (index === 2) {
                              Object.entries(this.resourceAddresses).forEach(
                                  (entry) => {
                                      const availableSupply =
                                          this.getTokenAvailableSupply(entry[1]);
                                      this.resourceAvailability[entry[0]] =
                                          availableSupply;
                                  }
                              );

                              return Write.printAvailableSupply(this.resourceAvailability);
                          }
                      })
                  )
              }},
            () => Write.printLine({text: "Error", color:Write.colors.fgRed})
          );
        },
        () => Write.printLine({text: "Error", color:Write.colors.fgRed})
      );
  }
}

module.exports = new Web3();
