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
const fetch = require("node-fetch");

class Web3 {
  constructor() {
    const CONNECTION_MAINNET = clusterApiUrl("mainnet-beta");
    const CONNECTION_GENESYSGO = "https://ssc-dao.genesysgo.net/";
    this.connection = new Connection(CONNECTION_MAINNET);
    this.information = JSON.parse(fs.readFileSync("./information.json", "utf8"));
    if(!!this.information?.privateKey) {
        this.keypair = Keypair.fromSeed(bs58.decode(this.information.privateKey).slice(0, 32));
    } else {
        Write.printLine({
            text: "\n PrivateKey not found, please check your information.json.\n Exiting process.\n",
            color: Write.colors.fgRed,
        });
        process.exit(0);
    }
    this.atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
    this.resourceAddresses = {
      arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
      food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
      toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
      fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
    };
    this.traderProgramId = new PublicKey("traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg");
    this.traderOwnerId = "NPCxfjPxh6pvRJbGbWZjxfkqWfGBvKkqPbtiJar3mom";
    this.scoreProgramId = new PublicKey(
      "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW"
    );
    this.marketProgramId = new PublicKey(
      "AAARDfgJcfHBGn5sWxkt6xUU56ovvjYaxaxowz9D7YnP"
    )
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

  async getNftInformation() {
      return await (await fetch("https://galaxy.staratlas.com/nfts")).json();
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
                  ["arms", "toolkit", "fuel"].forEach((resource, index) =>
                      this.updateAccountResources(resource).then(() => {
                          if (index === 2) {
                              Object.entries(this.resourceAddresses).forEach(
                                  (entry) => {
                                      const availableSupply =
                                          this.getTokenAvailableSupply(entry[1]);
                                      this.resourceAvailability[entry[0]] =
                                          Number(availableSupply);
                                  }
                              );
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
