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
    const information = JSON.parse(
      fs.readFileSync("./information.json", "utf8")
    );
    if (!!information?.privateKey) {
      this.keypair = Keypair.fromSeed(
        bs58.decode(information.privateKey).slice(0, 32)
      );
    } else {
      Write.printLine({
        text: "\n PrivateKey not found, please check your information.json.\n Exiting process.\n",
        color: Write.colors.fgRed,
      });
      process.exit(0);
    }
    this.autoBuy = information.autoBuy;
    this.autoStake = information.autoStake === "true";
    this.DECIMALS = 100000000;
    const CONNECTION_MAINNET = clusterApiUrl("mainnet-beta");
    const CONNECTION_GENESYSGO = "https://ssc-dao.genesysgo.net/";
    this.connection = new Connection(CONNECTION_GENESYSGO);
    this.atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
    this.usdcTokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    this.resourceAddresses = {
      arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
      food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
      toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
      fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
    };
    this.traderProgramId = new PublicKey(
      "traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg"
    );
    this.traderOwnerId = "NPCxfjPxh6pvRJbGbWZjxfkqWfGBvKkqPbtiJar3mom";
    this.scoreProgramId = new PublicKey(
      "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW"
    );
    this.marketProgramId = new PublicKey(
      "AAARDfgJcfHBGn5sWxkt6xUU56ovvjYaxaxowz9D7YnP"
    );
    this.tokenProgramId = new PublicKey(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );
    this.resourceAvailability = {};
    this.inventory = [];
    this.nftInformation = [];
    this.nftShipInformation = [];
    this.nftResourceInformation = [];
  }

  async getNftInformation() {
    return await (await fetch("https://galaxy.staratlas.com/nfts")).json();
  }

  async refreshAccountInfo() {
    const inventory = [];

    await this.connection
      .getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: this.tokenProgramId },
        "confirmed"
      )
      .then(
        async (results) => {
          // WALLET CONTENT
          if (!!results?.value.length) {
            await results.value
              .filter(
                (value) =>
                  !!value?.account?.data?.parsed?.info?.tokenAmount?.uiAmount
              )
              .forEach((value) => {
                const { info } = value.account.data.parsed;

                switch (info.mint) {
                  case this.atlasTokenMint:
                    inventory.push({
                      name: "ATLAS",
                      tokenAccount: value.pubkey.toString(),
                      mint: info.mint,
                      owner: info.owner,
                      amount: info.tokenAmount.uiAmount,
                      type: "currency",
                    });
                    break;
                  case this.usdcTokenMint:
                    inventory.push({
                      name: "USDC",
                      tokenAccount: value.pubkey.toString(),
                      mint: info.mint,
                      owner: info.owner,
                      amount: info.tokenAmount.uiAmount,
                      type: "currency",
                    });
                    break;
                  default:
                    const nft = this.nftInformation.find((nft) => {
                      return nft.mint === info.mint;
                    });

                    if (!!nft) {
                      inventory.push({
                        name: nft.name,
                        tokenAccount: value.pubkey.toString(),
                        mint: info.mint,
                        owner: info.owner,
                        amount: info.tokenAmount.uiAmount,
                        type: nft.attributes.itemType,
                      });
                      switch (nft.name) {
                        case "Ammunition":
                          this.resourceAvailability["arms"] = info.tokenAmount.uiAmount;
                          break;
                        case "Food":
                          this.resourceAvailability["food"] = info.tokenAmount.uiAmount;
                          break;
                        case "Fuel":
                          this.resourceAvailability["fuel"] = info.tokenAmount.uiAmount;
                          break;
                        case "Toolkit":
                          this.resourceAvailability["toolkit"] = info.tokenAmount.uiAmount;
                          break;
                      };
                    }
                    break;
                }
              });

            this.inventory = inventory;
          }
        },
        () => Write.printLine({ text: "Error", color: Write.colors.fgRed })
      );

    return inventory;
  }
}

module.exports = new Web3();
