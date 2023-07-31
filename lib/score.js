const fetch = require("node-fetch");
const atlas = require("@staratlas/factory");
const { PublicKey, Transaction } = require("@solana/web3.js");
const Web3 = require("./web3");
const Write = require("./write");
const web3 = require("@solana/web3.js");

class Score {
  connection;
  keypair;
  nftInformation;
  inventory;
  dailyUsage;
  activeFleets;
  resourceAddresses = {
    arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
    food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
    toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
    fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
  };
  traderProgramId = new PublicKey(
    "traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg",
  );
  traderOwnerId = "NPCxfjPxh6pvRJbGbWZjxfkqWfGBvKkqPbtiJar3mom";
  scoreProgramId = new PublicKey(
    "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW",
  );
  marketProgramId = new PublicKey(
    "AAARDfgJcfHBGn5sWxkt6xUU56ovvjYaxaxowz9D7YnP",
  );
  tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  constructor({ connection, keypair }) {
    this.connection = connection;
    this.keypair = keypair;
  }

  async getStarAtlasNftInformation() {
    const nftInformation = await (
      await fetch("https://galaxy.staratlas.com/nfts")
    ).json();

    const ships = [
      ...nftInformation.filter((nft) => nft.attributes.itemType === "ship"),
    ];
    const resources = [
      ...nftInformation.filter((nft) => nft.attributes.itemType === "resource"),
    ];

    this.nftInformation = {
      all: nftInformation,
      ships,
      resources,
    };
  }

  async sendTransactions(txInstruction) {
    try {
      const tx = new Transaction().add(...txInstruction);
      return await this.connection.sendTransaction(tx, [this.keypair]);
    } catch (e) {
      Write.printError(e);
    }
  }

  async refreshStakingFleet() {
    this.activeFleets = await atlas.getAllFleetsForUserPublicKey(
      this.connection,
      this.keypair.publicKey,
      this.scoreProgramId,
    );
  }

  async autoStake(ships) {
    for (const ship of ships) {
      Write.printLine({
        text: "\n Auto staking " + ship.name,
        color: Write.colors.fgYellow,
      });
      const fleet = this.activeFleets.find(
        (fleet) => fleet.shipMint.toString() === ship.mint,
      );
      let tx;
      if (!!fleet) {
        tx = await atlas.createPartialDepositInstruction(
          this.connection,
          this.keypair.publicKey,
          ship.amount,
          new PublicKey(ship.mint),
          new PublicKey(ship.tokenAccount),
          this.scoreProgramId,
        );
      } else {
        tx = await atlas.createInitialDepositInstruction(
          this.connection,
          this.keypair.publicKey,
          ship.amount,
          new PublicKey(ship.mint),
          new PublicKey(ship.tokenAccount),
          this.scoreProgramId,
        );
      }
      if (!!tx) {
        await this.sendTransactions([tx]).then(async () => {
          Write.printLine([
            {
              text:
                "\n " +
                ship.name +
                " is now staking, it will be reflected on refresh.",
              color: Write.colors.fgYellow,
            },
          ]);
        });
      }
    }
  }

  async refreshInventory() {
    const inventory = [];
    const accountInfo = await Web3.refreshAccountInfo();

    if (Web3.autoStake) {
      const ships = accountInfo.filter((value) => value.type === "ship");
      const others = accountInfo.filter((value) => value.type !== "ship");

      if (!!ships.length) {
        await this.autoStake(ships);
        inventory.push(...others);
      } else {
        inventory.push(...ships, ...others);
      }
    } else {
      inventory.push(...accountInfo);
    }

    this.inventory = inventory;
  }
  async sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  async finalize(sig) {
    let finalized = false;

    do {
      // eslint-disable-next-line no-await-in-loop
      await this.sleep(5000);

      // eslint-disable-next-line no-await-in-loop
      const status = await this.connection.getSignatureStatus(sig);

      if (status?.value?.confirmationStatus === "finalized") {
        finalized = true;
      } else {
        console.log(`Waiting for finalization: ${status.value?.confirmations}`);
      }
    } while (!finalized);
    console.log(`finalized ${sig}`);
  }
}

module.exports = Score;
