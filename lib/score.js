require("dotenv").config();

const fetch = require("node-fetch");
const atlas = require("@staratlas/factory");
const { PublicKey, Transaction } = require("@solana/web3.js");
const {
  atlasTokenMint,
  usdcTokenMint,
  millisecondsInDay,
  traderProgramId,
  traderOwnerId,
  decimals,
} = require("./constants");
const Web3 = require("./web3");
const Write = require("./write");
const web3 = require("@solana/web3.js");
const bs58 = require("bs58");

class Score {
  connection;
  keypair;
  nftInformation;
  gmClientService;
  inventory = [];
  autoBuyFleet;
  activeFleets;
  activeFleetsToRefill = [];
  dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };
  triggerPercentage = 1;
  orderForDays = 30;
  resourceAddresses = {
    arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
    food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
    toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
    fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
  };
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
    this.gmClientService = new atlas.GmClientService();
  }

  async claimAtlas() {
    const transaction = new Transaction(); //{ feePayer: keypair.publicKey });

    for (const fleet of this.activeFleets) {
      const harvestInstruction = await atlas.createHarvestInstruction(
        this.connection,
        this.keypair.publicKey,
        new PublicKey(atlasTokenMint),
        fleet.shipMint,
        this.scoreProgramId,
      );
      transaction.add(harvestInstruction);
    }

    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash("finalized")
    ).blockhash;

    transaction.sign(this.keypair, this.keypair);

    const txId = transaction.signatures[0].signature;

    if (!txId) {
      throw new Error("Could not derive transaction signature");
    }

    const txIdStr = bs58.encode(txId);
    const wireTransaction = transaction.serialize();
    await this.connection.sendRawTransaction(wireTransaction);
    await this.finalize(txIdStr);

    return Promise.resolve(false);
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

    if (process.env.AUTO_BUY) {
      this.autoBuyFleet = this.nftInformation.ships?.find(
        (nft) => nft.mint === process.env.AUTO_BUY,
      );

      if (!this.autoBuyFleet) {
        Write.printLine({
          text: `Auto buy value incorrect.`,
          color: Write.colors.fgRed,
        });
      }
    }
  }

  async refreshScoreAccountInfo() {
    const inventory = [];

    await this.connection
      .getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: this.tokenProgramId },
        "confirmed",
      )
      .then(
        async (results) => {
          // WALLET CONTENT
          if (!!results?.value.length) {
            await results.value
              .filter(
                (value) =>
                  !!value?.account?.data?.parsed?.info?.tokenAmount?.uiAmount,
              )
              .forEach((value) => {
                const { info } = value.account.data.parsed;

                switch (info.mint) {
                  case atlasTokenMint:
                    inventory.push({
                      name: "ATLAS",
                      tokenAccount: value.pubkey.toString(),
                      mint: info.mint,
                      owner: info.owner,
                      amount: info.tokenAmount.uiAmount,
                      type: "currency",
                    });
                    break;
                  case usdcTokenMint:
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
                    const nft = this.nftInformation.all.find((nft) => {
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
                    }
                    break;
                }
              });

            this.inventory = inventory;
          }
        },
        () => Write.printLine({ text: "Error", color: Write.colors.fgRed }),
      );

    return inventory;
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
    this.inventory.length = 0;
    const inventory = [];
    const accountInfo = await this.refreshScoreAccountInfo();

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

  getResourcesLeft(
    fleetResourceBurnOutTime,
    shipTimeToBurnOneResource,
    currentCapacityTimestamp,
    currentTimeSec,
  ) {
    const fleetResourceCapacity =
      fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000);
    return (
      fleetResourceCapacity -
      (currentTimeSec - currentCapacityTimestamp) /
        (shipTimeToBurnOneResource / 1000)
    );
  }

  calculatePercentLeft(
    fleetResourceBurnOutTime,
    shipTimeToBurnOneResource,
    currentCapacityTimestamp,
    shipResourceMaxReserve,
    currentTimeSec,
  ) {
    const resourcesLeft = this.getResourcesLeft(
      fleetResourceBurnOutTime,
      shipTimeToBurnOneResource,
      currentCapacityTimestamp,
      currentTimeSec,
    );
    return resourcesLeft / (shipResourceMaxReserve / 100);
  }

  async showFleet() {
    const nowSec = new Date().getTime() / 1000;
    if (!!this.activeFleets.length) {
      Write.printLine({
        text: ` ${"-".repeat(27)} STAKING ${"-".repeat(27)}`,
      });
      this.activeFleets.sort((a, b) =>
        this.nftInformation.all.find(
          (nft) => nft.mint === a.shipMint.toString(),
        )?.name <
        this.nftInformation.all.find(
          (nft) => nft.mint === b.shipMint.toString(),
        )?.name
          ? -1
          : 1,
      );
    } else {
      Write.printLine({
        text: ` ${"-".repeat(63)}`,
      });
    }
    for (const fleet of this.activeFleets) {
      let needTransaction = false;

      const nft = this.nftInformation.all.find(
        (nft) => nft.mint === fleet.shipMint.toString(),
      );
      const name = ` | ${nft.name} (${fleet.shipQuantityInEscrow})`;
      Write.printLine({
        text: `${name}${" ".repeat(65 - name.length - 1)}|`,
      });
      const shipInfo = await atlas.getScoreVarsShipInfo(
        this.connection,
        this.scoreProgramId,
        new PublicKey(nft.mint),
      );

      const healthPercent = this.calculatePercentLeft(
        fleet.healthCurrentCapacity,
        shipInfo.millisecondsToBurnOneToolkit,
        fleet.currentCapacityTimestamp,
        shipInfo.toolkitMaxReserve,
        nowSec,
      );

      Write.printPercent(healthPercent > 0 ? healthPercent : 0, "HEALTH");
      if (healthPercent <= this.triggerPercentage) needTransaction = true;

      const fuelPercent = this.calculatePercentLeft(
        fleet.fuelCurrentCapacity,
        shipInfo.millisecondsToBurnOneFuel,
        fleet.currentCapacityTimestamp,
        shipInfo.fuelMaxReserve,
        nowSec,
      );

      Write.printPercent(fuelPercent > 0 ? fuelPercent : 0, "FUEL");
      if (fuelPercent <= this.triggerPercentage) needTransaction = true;

      const foodPercent = this.calculatePercentLeft(
        fleet.foodCurrentCapacity,
        shipInfo.millisecondsToBurnOneFood,
        fleet.currentCapacityTimestamp,
        shipInfo.foodMaxReserve,
        nowSec,
      );

      Write.printPercent(foodPercent > 0 ? foodPercent : 0, "FOOD");
      if (foodPercent <= this.triggerPercentage) needTransaction = true;

      const armsPercent = this.calculatePercentLeft(
        fleet.armsCurrentCapacity,
        shipInfo.millisecondsToBurnOneArms,
        fleet.currentCapacityTimestamp,
        shipInfo.armsMaxReserve,
        nowSec,
      );

      Write.printPercent(armsPercent > 0 ? armsPercent : 0, "ARMS");
      if (armsPercent <= this.triggerPercentage) {
        needTransaction = true;
      }

      if (needTransaction) {
        this.activeFleetsToRefill.push({
          fleet,
          shipInfo,
          nft,
        });
      }

      const calculateDailyUsage = (millisecondsForOne) =>
        (millisecondsInDay / millisecondsForOne) * fleet.shipQuantityInEscrow;
      const {
        millisecondsToBurnOneFuel,
        millisecondsToBurnOneArms,
        millisecondsToBurnOneFood,
        millisecondsToBurnOneToolkit,
      } = shipInfo;
      this.dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };
      this.dailyUsage.fuel.push(calculateDailyUsage(millisecondsToBurnOneFuel));
      this.dailyUsage.food.push(calculateDailyUsage(millisecondsToBurnOneFood));
      this.dailyUsage.arms.push(calculateDailyUsage(millisecondsToBurnOneArms));
      this.dailyUsage.toolkit.push(
        calculateDailyUsage(millisecondsToBurnOneToolkit),
      );
    }
  }

  async haveEnoughResources({ fleet, shipInfo }, nowSec) {
    let enoughResources = true;
    for (const resource of Object.keys(this.resourceAddresses)) {
      const shipAmount = fleet.shipQuantityInEscrow;
      const fleetResource = resource === "toolkit" ? "health" : resource;
      const left = this.getResourcesLeft(
        fleet[`${fleetResource}CurrentCapacity`],
        shipInfo[
          `millisecondsToBurnOne${
            resource.charAt(0).toUpperCase() + resource.slice(1)
          }`
        ],
        fleet.currentCapacityTimestamp,
        nowSec,
      );

      const max = shipInfo[`${resource}MaxReserve`] * shipAmount;
      const current = left * shipAmount;
      const needed = max - current;
      if (this.inventory[resource] < needed) {
        enoughResources = false;
      }
    }

    return Promise.resolve(enoughResources);
  }

  async getResupplyInstruction(resource, shipInfo, fleet) {
    const nowSec = new Date().getTime() / 1000;
    const {
      createRefeedInstruction,
      createRearmInstruction,
      createRefuelInstruction,
      createRepairInstruction,
    } = atlas;
    let quantity;
    let createInstruction;

    switch (resource.name) {
      case "Ammunition":
        createInstruction = createRearmInstruction;
        quantity =
          (shipInfo.armsMaxReserve -
            this.getResourcesLeft(
              fleet.armsCurrentCapacity,
              shipInfo.millisecondsToBurnOneArms,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Food":
        createInstruction = createRefeedInstruction;
        quantity =
          (shipInfo.foodMaxReserve -
            this.getResourcesLeft(
              fleet.foodCurrentCapacity,
              shipInfo.millisecondsToBurnOneFood,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Fuel":
        createInstruction = createRefuelInstruction;
        quantity =
          (shipInfo.fuelMaxReserve -
            this.getResourcesLeft(
              fleet.fuelCurrentCapacity,
              shipInfo.millisecondsToBurnOneFuel,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Toolkit":
        createInstruction = createRepairInstruction;
        quantity =
          (shipInfo.toolkitMaxReserve -
            this.getResourcesLeft(
              fleet.healthCurrentCapacity,
              shipInfo.millisecondsToBurnOneToolkit,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      default:
        return false;
    }

    return await createInstruction(
      this.connection,
      this.keypair.publicKey,
      this.keypair.publicKey,
      quantity,
      fleet.shipMint,
      new PublicKey(resource.mint),
      new PublicKey(resource.tokenAccount),
      this.scoreProgramId,
    );
  }

  async refillResources({ fleet, shipInfo }) {
    const txInstructions = [];

    const resources = this.inventory.filter((item) => item.type === "resource");
    for (const resource of resources) {
      const instruction = await this.getResupplyInstruction(
        resource,
        shipInfo,
        fleet,
      );
      txInstructions.push(instruction);
    }
    return await this.sendTransactions(txInstructions);
  }

  async sendMarketOrder({ order, quantity }) {
    try {
      await this.connection.sendTransaction(
        new web3.Transaction().add(
          (
            await this.gmClientService.getCreateExchangeTransaction(
              this.connection,
              order,
              this.keypair.publicKey,
              quantity,
              traderProgramId,
            )
          ).transaction,
        ),
        [this.keypair],
      );
    } catch (e) {
      Write.printError(e);
    }
  }

  async orderResources(nftInformation) {
    const orders = await this.gmClientService.getOpenOrdersForPlayer(
      this.connection,
      new PublicKey(traderOwnerId),
      new PublicKey(traderProgramId),
    );

    return await Promise.allSettled(
      orders.map(async (order) => {
        const resource = nftInformation.find((nft) => {
          return nft.mint === order.orderMint;
        });
        const resourceName =
          resource.name === "Ammunition" ? "Arms" : resource.name;

        await this.sendMarketOrder({
          order,
          quantity:
            this.dailyUsage[resourceName.toLowerCase()].reduce(
              (partialSum, a) => partialSum + a,
              0,
            ) * this.orderForDays,
        }).then(async () => {
          Write.printLine({
            text: " RESOURCE ORDER COMPLETED: " + resource.name,
          });
        });
      }),
    );
  }

  async refillFleet() {
    const nowSec = new Date().getTime() / 1000;
    if (this.activeFleetsToRefill.length > 0) {
      for (const { fleet, shipInfo, nft } of this.activeFleetsToRefill) {
        Write.printLine({
          text: `\n ### Resupplying ${nft.name} ###`,
        });

        const hasEnoughResources = await this.haveEnoughResources(
          { fleet, shipInfo },
          nowSec,
        );

        if (hasEnoughResources) {
          await this.refillResources({ shipInfo, fleet }).then(async () => {
            Write.printLine({ text: "\n  Resources refilled successfully" });
          });
        } else {
          Write.printLine({ text: "\n  Not enough resources, claiming ATLAS" });
          await this.claimAtlas().then(async (result) => {
            if (!!result) {
              Write.printLine({
                text: " ATLAS claimed successfully, buying resources",
              });
              await this.orderResources(this.nftInformation.all).then(
                async () => {
                  Write.printLine({ text: " Resources bought, resupplying" });
                  await this.refillResources({ shipInfo, fleet }).then(
                    async () => {
                      Write.printLine({
                        text: " Resources resupplied successfully",
                      });
                      if (!!this.autoBuyFleet) {
                        await this.processAutoBuy(this.autoBuyFleet).then(
                          async () => {
                            Write.printLine({
                              text:
                                " Auto buy order completed: " +
                                this.autoBuyFleet.name,
                            });
                          },
                        );
                      }
                    },
                  );
                },
              );
            }
          });
        }
      }
    }
  }

  async processAutoBuy(shipToAutoBuy) {
    if (!!shipToAutoBuy) {
      const sellOrders = (
        await this.gmClientService.getOpenOrdersForAsset(
          this.connection,
          new PublicKey(this.autoBuyFleet.mint),
          traderProgramId,
        )
      )
        .filter(
          (order) =>
            order.currencyMint === atlasTokenMint && order.orderType === "sell",
        )
        .sort((a, b) => (a.price / decimals < b.price / decimals ? -1 : 1));
      sellOrders.splice(0, 2);
      const [sellOrder] = sellOrders;

      const atlas = this.inventory.find((item) => item.mint === atlasTokenMint);
      const price =
        sellOrder.price /
        Number("1".padEnd(sellOrder.currencyDecimals + 1, "0"));

      if (atlas.amount > price) {
        const quantity = Math.floor(atlas.amount / price);
        return await this.sendMarketOrder({
          order: sellOrder,
          quantity:
            quantity > sellOrder.orderQtyRemaining
              ? sellOrder.orderQtyRemaining
              : quantity,
        });
      }
    }
  }
}

module.exports = Score;
